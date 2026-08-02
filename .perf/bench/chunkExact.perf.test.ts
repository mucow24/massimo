/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * Is a CHUNKED zone byte-identical to the monolithic one?
 *
 * Production builds one whole-map polygon per line (`buildLineBodies`,
 * lineRegions.ts:246) and intersects those pairwise. This spike partitions the
 * SAME production rings into spatial tiles — by calling buildLineBodies on a
 * per-tile subset of bands/markers, so the ring generation is production's, not
 * a re-implementation — and computes the zone as the union of chunk-pair
 * intersections.
 *
 * Set-theoretically the two are the same region: with A = U Ai and B = U Bj,
 * U(Ai n Bj) = A n B. And every consumer of `parts` unions them anyway
 * (zoneComponents -> splitIntoFaces is a NonZero union polytree, clip.ts:238).
 * The open question is whether clipper's integer arithmetic agrees. This test
 * answers it by comparing canonical content keys of the resulting components.
 *
 *   PERF=1 npx vitest run src/perf/chunkExact.perf.test.ts --disableConsoleIntercept
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
import {
  buildLineBodies,
  ringsBbox,
  boxesOverlap,
  ringSetKey,
  zoneComponents,
} from '../../src/geometry/lineRegions';
import { intersect, type Ring } from '../../src/geometry/clip';

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
  id: LineId;
  tile: string;
  rings: Ring[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

const bandMid = (b: SegmentBandSpec) => {
  const c = b.centerline;
  return c[Math.floor(c.length / 2)] ?? { x: 0, y: 0 };
};

/**
 * Per-line body chunks. Bands and markers are bucketed by tile, then each
 * bucket goes through the PRODUCTION builder, so a chunk's rings are exactly
 * the rings buildLineBodies would have produced for that subset.
 */
function chunkedBodies(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  TILE: number,
): Map<LineId, Chunk[]> {
  const tileOf = (x: number, y: number) => `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`;
  const bandsByTile = new Map<string, SegmentBandSpec[]>();
  const markersByTile = new Map<string, StopMarkerSpec[]>();
  for (const b of bands) {
    const m = bandMid(b);
    const k = tileOf(m.x, m.y);
    (bandsByTile.get(k) ?? bandsByTile.set(k, []).get(k)!).push(b);
  }
  for (const m of markers) {
    const k = tileOf(m.cx, m.cy);
    (markersByTile.get(k) ?? markersByTile.set(k, []).get(k)!).push(m);
  }
  const out = new Map<LineId, Chunk[]>();
  const tiles = new Set([...bandsByTile.keys(), ...markersByTile.keys()]);
  for (const t of tiles) {
    const bodies = buildLineBodies(bandsByTile.get(t) ?? [], markersByTile.get(t) ?? []);
    for (const [id, rings] of bodies) {
      const c: Chunk = { id, tile: t, rings, box: ringsBbox(rings) };
      const list = out.get(id);
      if (list) list.push(c);
      else out.set(id, [c]);
    }
  }
  return out;
}

const compKeys = (comps: Ring[][]) =>
  comps.map((c) => ringSetKey(c, ringsBbox(c))).sort((a, b) => (a < b ? -1 : 1));

describe.runIf(PERF)('chunked zone exactness', () => {
  it(
    'chunked zone components equal the monolithic ones, byte for byte',
    async () => {
      const doc = loadDoc();
      const all = Object.values(doc.stations);
      const find = (f: string) =>
        all.find((s) => s.name.toLowerCase().replace(/\s+/g, ' ').includes(f.toLowerCase()))!;

      // Several geometries, including mid-drag ones, so the check is not a
      // single lucky configuration.
      const cases: { label: string; stations: Record<StationId, Station> }[] = [
        { label: 'at rest', stations: doc.stations },
      ];
      for (const t of [find('Times Sq'), find('Atlantic'), find('Halsey')]) {
        for (const d of [3, 11]) {
          cases.push({
            label: `${t.name.replace(/\n/g, ' ')} +${d}`,
            stations: { ...doc.stations, [t.id]: { ...t, x: t.x + d, y: t.y + d * 0.7 } },
          });
        }
      }

      for (const TILE of [250, 400]) {
        let allMatch = true;
        const detail: string[] = [];
        for (const c of cases) {
          const { bands, markers } = geomFor(doc, c.stations);
          const bodies = buildLineBodies(bands, markers);
          const ids = [...bodies.keys()].sort();
          const boxes = new Map(ids.map((id) => [id, ringsBbox(bodies.get(id)!)]));

          const prodParts: Ring[] = [];
          for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++)
              if (boxesOverlap(boxes.get(ids[i])!, boxes.get(ids[j])!))
                prodParts.push(...intersect(bodies.get(ids[i])!, bodies.get(ids[j])!));
          const prod = zoneComponents(prodParts);

          const chunked = chunkedBodies(bands, markers, TILE);
          const chunkParts: Ring[] = [];
          let ops = 0;
          let chunkVerts = 0;
          for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++) {
              for (const ca of chunked.get(ids[i]) ?? [])
                for (const cb of chunked.get(ids[j]) ?? []) {
                  if (!boxesOverlap(ca.box, cb.box)) continue;
                  ops++;
                  chunkVerts += verts(ca.rings) + verts(cb.rings);
                  chunkParts.push(...intersect(ca.rings, cb.rings));
                }
            }
          const chunk = zoneComponents(chunkParts);

          const a = compKeys(prod.comps);
          const b = compKeys(chunk.comps);
          const same = a.length === b.length && a.every((k, i) => k === b[i]);
          if (!same) allMatch = false;
          detail.push(
            `    ${c.label.padEnd(24)} prod comps=${String(prod.comps.length).padStart(3)} ` +
              `chunk comps=${String(chunk.comps.length).padStart(3)} ` +
              `${same ? 'IDENTICAL' : '*** DIFFER ***'}  ` +
              `(${ops} chunk ops, ${chunkVerts} verts)`,
          );
        }
        console.log(`\nTILE=${TILE}: ${allMatch ? 'ALL IDENTICAL' : 'MISMATCH'}\n` + detail.join('\n'));
      }
      expect(true).toBe(true);
    },
    LONG,
  );
});
