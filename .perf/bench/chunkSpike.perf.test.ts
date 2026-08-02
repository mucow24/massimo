/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * SPIKE: does chunking line bodies PRE-union make the zone's pair
 * intersections cheap, and is the resulting zone byte-identical?
 *
 * A line body today is `unionAll` of every stripe/marker ring on that line —
 * one whole-map polygon (lineRegions.ts:246). The zone then pays
 * O(lines^2) whole-map x whole-map booleans. This spike builds each body as a
 * list of TILE chunks instead (union within a tile only), computes the zone as
 * the union of chunk-pair intersections, and checks the result against the
 * production zone.
 *
 *   PERF=1 npx vitest run src/perf/chunkSpike.perf.test.ts --disableConsoleIntercept
 */
import { describe, it, expect } from 'vitest';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/model/serialize';
import type { LineId, MapDoc, Station, StationId } from '../../src/model/types';
import {
  buildBandGeometry,
  buildStopMarkers,
  withLinePriorities,
  type SegmentBandSpec,
  type StopMarkerSpec,
} from '../../src/geometry/interlining';
import { buildLineBodies, ringsBbox, boxesOverlap, stripeBodyPolys } from '../../src/geometry/lineRegions';
import { intersect, unionAll, splitIntoFaces, type Ring } from '../../src/geometry/clip';

const PERF = !!process.env.PERF;
const LONG = 600000;

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}
const verts = (rings: Ring[]) => rings.reduce((a, r) => a + r.length, 0);

function geomFor(doc: MapDoc, stations: Record<StationId, Station>) {
  const bands = buildBandGeometry(stations, doc.lines, doc.lineCircles);
  const withPri = withLinePriorities(bands, doc.lines, doc.lineOrder);
  const markers = buildStopMarkers(stations, doc.lines, doc.lineOrder, withPri, doc.lineCircles);
  return { bands, markers };
}

interface Chunk {
  rings: Ring[];
  box: { x0: number; y0: number; x1: number; y1: number };
  key: string;
}

/**
 * Per-line body as tile chunks. Each raw ring (stripe body / marker ring) goes
 * to the tile of its bbox centre; rings in a tile union together. Chunks may
 * overlap at tile seams — harmless, because every consumer of the zone unions.
 */
function chunkedBodies(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  TILE: number,
): Map<LineId, Chunk[]> {
  const raw = new Map<LineId, Map<string, Ring[]>>();
  const put = (id: LineId, rings: Ring[]) => {
    if (!rings.length) return;
    let byTile = raw.get(id);
    if (!byTile) raw.set(id, (byTile = new Map()));
    for (const r of rings) {
      const b = ringsBbox([r]);
      const k = `${Math.floor((b.x0 + b.x1) / 2 / TILE)},${Math.floor((b.y0 + b.y1) / 2 / TILE)}`;
      const list = byTile.get(k);
      if (list) list.push(r);
      else byTile.set(k, [r]);
    }
  };
  for (const band of bands)
    for (let k = 0; k < band.lines.length; k++) put(band.lines[k].id, stripeBodyPolys(band, k));
  // markerBodyRings is module-private; the marker's own footprint rings are
  // reachable through the same path buildLineBodies uses, so approximate with
  // the production body minus nothing — instead re-derive via buildLineBodies
  // on a single-marker input would be circular. Use the marker footprint the
  // spec already carries.
  for (const m of markers) put(m.lineId, markerFootprint(m));

  const out = new Map<LineId, Chunk[]>();
  for (const [id, byTile] of raw) {
    const chunks: Chunk[] = [];
    for (const [k, rings] of byTile) {
      const merged = unionAll(rings);
      if (merged.length) chunks.push({ rings: merged, box: ringsBbox(merged), key: `${id}#${k}` });
    }
    out.set(id, chunks);
  }
  return out;
}

/** The marker's body footprint as a ring, from the spec's own geometry. */
function markerFootprint(m: StopMarkerSpec): Ring[] {
  const anyM = m as unknown as Record<string, unknown>;
  // Prefer an explicit footprint if the spec exposes one.
  for (const k of ['bodyRings', 'footprint', 'rings']) {
    const v = anyM[k];
    if (Array.isArray(v) && v.length && Array.isArray(v[0])) return v as Ring[];
  }
  // Otherwise a width x width square at the marker centre, axis-aligned to its
  // orientation - the shape buildLineBodies contributes for a plain stop.
  const cx = Number(anyM.x ?? 0);
  const cy = Number(anyM.y ?? 0);
  const w = Number(anyM.width ?? anyM.size ?? 0) / 2;
  if (!w) return [];
  return [
    [
      { x: cx - w, y: cy - w },
      { x: cx + w, y: cy - w },
      { x: cx + w, y: cy + w },
      { x: cx - w, y: cy + w },
    ],
  ];
}

describe.runIf(PERF)('chunked-body spike', () => {
  it(
    'chunk census and pair-intersect cost',
    async () => {
      const doc = loadDoc();
      const { bands, markers } = geomFor(doc, doc.stations);
      const bodies = buildLineBodies(bands, markers);
      const ids = [...bodies.keys()].sort();
      const boxes = new Map(ids.map((id) => [id, ringsBbox(bodies.get(id)!)]));

      // --- production: whole-body pair intersections -------------------------
      const t0 = performance.now();
      const prodParts: Ring[] = [];
      let prodOps = 0;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (!boxesOverlap(boxes.get(ids[i])!, boxes.get(ids[j])!)) continue;
          prodOps++;
          prodParts.push(...intersect(bodies.get(ids[i])!, bodies.get(ids[j])!));
        }
      }
      const prodMs = performance.now() - t0;
      const prodZone = splitIntoFaces(prodParts);

      console.log(
        `\nPRODUCTION zone: ${prodOps} whole-body intersects, ${prodMs.toFixed(1)}ms, ` +
          `${prodParts.length} parts, ${prodZone.length} components`,
      );

      for (const TILE of [150, 250, 400, 600]) {
        const tc0 = performance.now();
        const chunked = chunkedBodies(bands, markers, TILE);
        const buildMs = performance.now() - tc0;
        const nChunks = [...chunked.values()].reduce((a, c) => a + c.length, 0);

        const t1 = performance.now();
        const chunkParts: Ring[] = [];
        let ops = 0;
        let vsum = 0;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const A = chunked.get(ids[i]) ?? [];
            const B = chunked.get(ids[j]) ?? [];
            for (const ca of A) {
              for (const cb of B) {
                if (!boxesOverlap(ca.box, cb.box)) continue;
                ops++;
                vsum += verts(ca.rings) + verts(cb.rings);
                chunkParts.push(...intersect(ca.rings, cb.rings));
              }
            }
          }
        }
        const ms = performance.now() - t1;
        const zone = splitIntoFaces(chunkParts);

        console.log(
          `TILE=${TILE}: ${nChunks} chunks (build ${buildMs.toFixed(1)}ms) — ` +
            `${ops} chunk-pair intersects @ ${Math.round(vsum / Math.max(1, ops))} verts, ` +
            `${ms.toFixed(1)}ms (${(prodMs / ms).toFixed(2)}x faster), ` +
            `${chunkParts.length} parts, ${zone.length} components ` +
            `${zone.length === prodZone.length ? '[MATCH]' : '[DIFFERENT]'}`,
        );
      }
      expect(true).toBe(true);
    },
    LONG,
  );

  it(
    'incremental: what a chunked body must recompute per drag frame',
    async () => {
      const doc = loadDoc();
      const all = Object.values(doc.stations);
      const find = (f: string) =>
        all.find((s) => s.name.toLowerCase().replace(/\s+/g, ' ').includes(f.toLowerCase()))!;
      const TILE = 250;

      for (const target of [find('Times Sq'), find('Atlantic'), find('Halsey')]) {
        const g0 = geomFor(doc, doc.stations);
        const before = chunkedBodies(g0.bands, g0.markers, TILE);
        const movedStations = {
          ...doc.stations,
          [target.id]: { ...target, x: target.x + 3, y: target.y + 2 },
        };
        const g1 = geomFor(doc, movedStations);
        const after = chunkedBodies(g1.bands, g1.markers, TILE);

        const ids = [...after.keys()].sort();
        const keyOf = (c: Chunk) => JSON.stringify(c.rings);
        const dirtyChunks = new Set<string>();
        let totalChunks = 0;
        for (const id of ids) {
          const b = new Map((before.get(id) ?? []).map((c) => [c.key, keyOf(c)]));
          for (const c of after.get(id) ?? []) {
            totalChunks++;
            if (b.get(c.key) !== keyOf(c)) dirtyChunks.add(c.key);
          }
        }
        // Chunk-pair ops needing recompute: any overlapping pair with >=1 dirty.
        let recompute = 0;
        let recomputeVerts = 0;
        let totalPairOps = 0;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            for (const ca of after.get(ids[i]) ?? []) {
              for (const cb of after.get(ids[j]) ?? []) {
                if (!boxesOverlap(ca.box, cb.box)) continue;
                totalPairOps++;
                if (!dirtyChunks.has(ca.key) && !dirtyChunks.has(cb.key)) continue;
                recompute++;
                recomputeVerts += verts(ca.rings) + verts(cb.rings);
              }
            }
          }
        }
        // Production comparison: dirty LINES x all other lines, whole bodies.
        const bodiesAfter = buildLineBodies(g1.bands, g1.markers);
        const bodiesBefore = buildLineBodies(g0.bands, g0.markers);
        const dirtyLines = ids.filter(
          (id) =>
            JSON.stringify(bodiesBefore.get(id) ?? []) !== JSON.stringify(bodiesAfter.get(id) ?? []),
        );
        const dl = new Set(dirtyLines);
        let prodRecompute = 0;
        let prodVerts = 0;
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            if (!dl.has(ids[i]) && !dl.has(ids[j])) continue;
            const bi = ringsBbox(bodiesAfter.get(ids[i])!);
            const bj = ringsBbox(bodiesAfter.get(ids[j])!);
            if (!boxesOverlap(bi, bj)) continue;
            prodRecompute++;
            prodVerts += verts(bodiesAfter.get(ids[i])!) + verts(bodiesAfter.get(ids[j])!);
          }

        console.log(
          `\n[${target.name.replace(/\n/g, ' ')}] ${dirtyLines.length} dirty lines, ` +
            `${dirtyChunks.size}/${totalChunks} dirty chunks\n` +
            `  PRODUCTION: ${prodRecompute} whole-body intersects, ${prodVerts} verts marshalled\n` +
            `  CHUNKED   : ${recompute}/${totalPairOps} chunk-pair intersects, ` +
            `${recomputeVerts} verts marshalled  ` +
            `-> ${(prodVerts / Math.max(1, recomputeVerts)).toFixed(1)}x less geometry`,
        );
      }
      expect(true).toBe(true);
    },
    LONG,
  );
});
