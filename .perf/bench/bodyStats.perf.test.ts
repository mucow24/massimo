/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * Characterizes line BODIES: how big they are, how much of one changes when a
 * single station moves, and how many pair intersections a spatially chunked
 * body would actually have to compute.
 *
 *   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts .perf/bench/bodyStats.perf.test.ts --disableConsoleIntercept
 */
import { describe, it, expect } from 'vitest';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/model/serialize';
import type { LineId, MapDoc, Station, StationId } from '../../src/model/types';
import { buildBandGeometry, buildStopMarkers, withLinePriorities } from '../../src/geometry/interlining';
import { buildLineBodies, ringsBbox, boxesOverlap } from '../../src/geometry/lineRegions';
import type { Ring } from '../../src/geometry/clip';

const PERF = !!process.env.PERF;
const LONG = 600000;

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}

const verts = (rings: Ring[]) => rings.reduce((a, r) => a + r.length, 0);
const boxArea = (b: { x0: number; y0: number; x1: number; y1: number }) =>
  Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

function bodiesFor(doc: MapDoc, stations: Record<StationId, Station>) {
  const bg = buildBandGeometry(stations, doc.lines, doc.lineCircles);
  const bands = withLinePriorities(bg, doc.lines, doc.lineOrder);
  const markers = buildStopMarkers(stations, doc.lines, doc.lineOrder, bands, doc.lineCircles);
  return { bodies: buildLineBodies(bg, markers), bands: bg, markers };
}

describe.runIf(PERF)('body characterization', () => {
  it(
    'body size, pair cost, and chunking potential',
    async () => {
      const doc = loadDoc();
      const { bodies, bands, markers } = bodiesFor(doc, doc.stations);
      const ids = [...bodies.keys()].sort();

      let totV = 0;
      let maxV = 0;
      const worldBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const id of ids) {
        const v = verts(bodies.get(id)!);
        totV += v;
        maxV = Math.max(maxV, v);
        const b = ringsBbox(bodies.get(id)!);
        worldBox.x0 = Math.min(worldBox.x0, b.x0);
        worldBox.y0 = Math.min(worldBox.y0, b.y0);
        worldBox.x1 = Math.max(worldBox.x1, b.x1);
        worldBox.y1 = Math.max(worldBox.y1, b.y1);
      }
      const W = worldBox.x1 - worldBox.x0;
      const H = worldBox.y1 - worldBox.y0;
      console.log(
        `\n${ids.length} line bodies — ${totV} verts total, ` +
          `mean ${Math.round(totV / ids.length)}, max ${maxV}\n` +
          `world ${W.toFixed(0)} x ${H.toFixed(0)}, ${bands.length} bands, ${markers.length} markers`,
      );

      // How much of the world does one body's BBOX claim? (The bbox reject in
      // buildZoneCached / restrictBodiesToZone is only as good as this.)
      let bboxShare = 0;
      for (const id of ids) bboxShare += boxArea(ringsBbox(bodies.get(id)!)) / (W * H);
      console.log(
        `mean body bbox covers ${((bboxShare / ids.length) * 100).toFixed(0)}% of the world box ` +
          `— the reject that gates every whole-body intersect`,
      );

      // Pair census: how many of the 406 pairs survive the bbox reject, and how
      // much geometry each surviving intersect marshals.
      let pairs = 0;
      let survive = 0;
      let marshalled = 0;
      const boxes = new Map(ids.map((id) => [id, ringsBbox(bodies.get(id)!)]));
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          pairs++;
          if (!boxesOverlap(boxes.get(ids[i])!, boxes.get(ids[j])!)) continue;
          survive++;
          marshalled += verts(bodies.get(ids[i])!) + verts(bodies.get(ids[j])!);
        }
      }
      console.log(
        `pairs ${pairs}, survive bbox reject ${survive} (${((survive / pairs) * 100).toFixed(0)}%), ` +
          `${Math.round(marshalled / survive)} verts marshalled per surviving intersect`,
      );

      // What ACTUALLY changes in a body when one station moves.
      const all = Object.values(doc.stations);
      const find = (f: string) =>
        all.find((s) => s.name.toLowerCase().replace(/\s+/g, ' ').includes(f.toLowerCase()))!;
      for (const target of [find('Times Sq'), find('Atlantic'), find('Halsey')]) {
        const movedStations = {
          ...doc.stations,
          [target.id]: { ...target, x: target.x + 6, y: target.y + 4 },
        };
        const after = bodiesFor(doc, movedStations).bodies;
        const dirty: LineId[] = [];
        for (const id of ids) {
          const a = bodies.get(id)!;
          const b = after.get(id);
          if (!b || verts(a) !== verts(b) || JSON.stringify(a) !== JSON.stringify(b)) dirty.push(id);
        }
        // Bounding box of the actual change, vs the bodies' own boxes.
        const changeBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const s of [target]) {
          changeBox.x0 = Math.min(changeBox.x0, s.x - 120, s.x + 6 - 120);
          changeBox.y0 = Math.min(changeBox.y0, s.y - 120, s.y + 4 - 120);
          changeBox.x1 = Math.max(changeBox.x1, s.x + 120, s.x + 6 + 120);
          changeBox.y1 = Math.max(changeBox.y1, s.y + 120, s.y + 4 + 120);
        }
        const changeShare = boxArea(changeBox) / (W * H);
        const dirtyPairs = pairsTouching(ids, dirty);
        console.log(
          `\n[${target.name.replace(/\n/g, ' ')}] ${dirty.length}/${ids.length} bodies dirty ` +
            `-> ${dirtyPairs} pairs must re-intersect (of ${pairs})\n` +
            `  change neighbourhood is ${(changeShare * 100).toFixed(2)}% of the world box; ` +
            `each re-intersect marshals ~${Math.round(marshalled / survive)} verts of ` +
            `WHOLE-MAP geometry to answer a question about that ${(changeShare * 100).toFixed(2)}%`,
        );

        // Chunked projection: tile the world; how many CHUNK pairs would a
        // dirty line actually have to re-intersect?
        for (const TILE of [200, 400, 800]) {
          const chunksOf = (rings: Ring[]) => {
            const byTile = new Map<string, Ring[]>();
            for (const r of rings) {
              const b = ringsBbox([r]);
              const k = `${Math.floor(((b.x0 + b.x1) / 2 - worldBox.x0) / TILE)},${Math.floor(((b.y0 + b.y1) / 2 - worldBox.y0) / TILE)}`;
              (byTile.get(k) ?? byTile.set(k, []).get(k)!).push(r);
            }
            return [...byTile.values()].map((rs) => ({ rings: rs, box: ringsBbox(rs) }));
          };
          const chunked = new Map(ids.map((id) => [id, chunksOf(bodies.get(id)!)]));
          let chunkPairOps = 0;
          let chunkVerts = 0;
          for (const d of dirty) {
            for (const other of ids) {
              if (other === d) continue;
              for (const ca of chunked.get(d)!) {
                for (const cb of chunked.get(other)!) {
                  if (!boxesOverlap(ca.box, cb.box)) continue;
                  chunkPairOps++;
                  chunkVerts += verts(ca.rings) + verts(cb.rings);
                }
              }
            }
          }
          const nChunks = [...chunked.values()].reduce((a, c) => a + c.length, 0);
          console.log(
            `  tile=${TILE}: ${nChunks} chunks total; dirty-line work = ${chunkPairOps} chunk-pair ` +
              `intersects @ ~${chunkPairOps ? Math.round(chunkVerts / chunkPairOps) : 0} verts ` +
              `(vs ${dirtyPairs} @ ~${Math.round(marshalled / survive)} verts) ` +
              `-> ${(chunkVerts / (dirtyPairs * (marshalled / survive))).toFixed(3)}x the vertex volume`,
          );
        }
      }
      expect(true).toBe(true);
    },
    LONG,
  );
});

function pairsTouching(ids: LineId[], dirty: LineId[]): number {
  const d = new Set(dirty);
  let n = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) if (d.has(ids[i]) || d.has(ids[j])) n++;
  return n;
}
