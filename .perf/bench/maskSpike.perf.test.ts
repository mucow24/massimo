/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * EXACT-OUTPUT alternative to chunking: keep the monolithic bodies (so every
 * clipper result is byte-identical to today's) and attack the REJECT instead.
 *
 * Two rejects run today, both on whole-body BBOXes:
 *   - buildZoneCached (regionIncremental.ts:432-439): recompute a pair whenever
 *     either LINE is dirty, gated only by bbox overlap.
 *   - restrictBodiesToZone (lineRegions.ts:607-612): body vs component bbox.
 * A line body's bbox covers ~26% of the world box, so both rejects are weak.
 *
 * A coarse OCCUPANCY MASK per body (cells any of its rings touches) is a strict
 * refinement of the bbox: mask-disjoint implies bbox-disjoint is false, but
 * mask-disjoint still implies the intersection is EMPTY, so skipping is exactly
 * what the clipper would have returned. Purely a rejection accelerator — it
 * cannot change any non-empty result.
 *
 * Third, and the big one: a cached pair is reusable when no DIRTY BOX can reach
 * the region where the two bodies meet. Today dirtiness is line-granular.
 *
 *   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts .perf/bench/maskSpike.perf.test.ts --disableConsoleIntercept
 */
import { describe, it, expect } from 'vitest';
import { readPerfMap } from '../perfMap';
import { readFileSync } from 'node:fs';
import { parse } from '../../src/model/serialize';
import type { LineId, MapDoc, Station, StationId } from '../../src/model/types';
import { buildBandGeometry, buildStopMarkers, withLinePriorities } from '../../src/geometry/interlining';
import {
  buildLineBodies,
  ringsBbox,
  boxesOverlap,
  significantComponents,
  overlapZoneParts,
} from '../../src/geometry/lineRegions';
import { intersect, type Ring } from '../../src/geometry/clip';

const PERF = !!process.env.PERF;
const LONG = 600000;
const CELL = Number(process.env.PERF_CELL ?? 32);

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}
const verts = (rings: Ring[]) => rings.reduce((a, r) => a + r.length, 0);
type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Cells any ring of the body touches, at CELL resolution. Conservative: a ring
 * marks every cell its BBOX covers, so a cell is never missed. Cheap to build
 * (one pass over ring bboxes) and cheap to test.
 */
function maskOf(rings: Ring[]): Set<number> {
  const cells = new Set<number>();
  // Per EDGE, not per ring: a line body is one enormous snake-shaped ring, so
  // its ring bbox is its body bbox and a per-ring mask degenerates to exactly
  // the reject it is meant to sharpen. Marking each segment's covered cells
  // gives the real footprint. Conservative: a segment marks every cell its own
  // bbox covers, which is a superset of the cells it crosses. Bodies are thin
  // stroke outlines (8-16 world units wide) against CELL=32, so edge coverage
  // subsumes the interior; a production version would want a scanline fill to
  // make that guarantee rather than rely on it.
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      const q = r[(i + 1) % r.length];
      const cx0 = Math.floor(Math.min(p.x, q.x) / CELL);
      const cx1 = Math.floor(Math.max(p.x, q.x) / CELL);
      const cy0 = Math.floor(Math.min(p.y, q.y) / CELL);
      const cy1 = Math.floor(Math.max(p.y, q.y) / CELL);
      for (let x = cx0; x <= cx1; x++) for (let y = cy0; y <= cy1; y++) cells.add(x * 100000 + y);
    }
  }
  return cells;
}
const boxCells = (b: Box): number[] => {
  const out: number[] = [];
  for (let x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++)
    for (let y = Math.floor(b.y0 / CELL); y <= Math.floor(b.y1 / CELL); y++) out.push(x * 100000 + y);
  return out;
};
const masksOverlap = (a: Set<number>, b: Set<number>) => {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  for (const c of s) if (l.has(c)) return true;
  return false;
};

function geomFor(doc: MapDoc, stations: Record<StationId, Station>) {
  const bands = buildBandGeometry(stations, doc.lines, doc.lineCircles);
  const withPri = withLinePriorities(bands, doc.lines, doc.lineOrder);
  const markers = buildStopMarkers(stations, doc.lines, doc.lineOrder, withPri, doc.lineCircles);
  return { bands, markers, bodies: buildLineBodies(bands, markers) };
}

describe.runIf(PERF)('occupancy-mask rejects', () => {
  it(
    'how many pair intersects survive a mask reject, and a dirty-reach test',
    async () => {
      const doc = loadDoc();
      const base = geomFor(doc, doc.stations);
      const ids = [...base.bodies.keys()].sort();
      const all = Object.values(doc.stations);
      const find = (f: string) =>
        all.find((s) => s.name.toLowerCase().replace(/\s+/g, ' ').includes(f.toLowerCase()))!;

      // --- static census: bbox reject vs mask reject ------------------------
      const t0 = performance.now();
      const masks = new Map(ids.map((id) => [id, maskOf(base.bodies.get(id)!)]));
      const maskBuildMs = performance.now() - t0;
      const boxes = new Map(ids.map((id) => [id, ringsBbox(base.bodies.get(id)!)]));

      let pairs = 0;
      let byBox = 0;
      let byMask = 0;
      let emptyResults = 0;
      let boxSurvivorVerts = 0;
      let maskSurvivorVerts = 0;
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          pairs++;
          const a = ids[i];
          const b = ids[j];
          const bx = boxesOverlap(boxes.get(a)!, boxes.get(b)!);
          if (!bx) continue;
          byBox++;
          boxSurvivorVerts += verts(base.bodies.get(a)!) + verts(base.bodies.get(b)!);
          if (!masksOverlap(masks.get(a)!, masks.get(b)!)) continue;
          byMask++;
          maskSurvivorVerts += verts(base.bodies.get(a)!) + verts(base.bodies.get(b)!);
          if (!intersect(base.bodies.get(a)!, base.bodies.get(b)!).length) emptyResults++;
        }
      console.log(
        `\nCELL=${CELL} — masks built in ${maskBuildMs.toFixed(1)}ms ` +
          `(${[...masks.values()].reduce((s, m) => s + m.size, 0)} cells total)\n` +
          `  ${pairs} pairs -> bbox lets ${byBox} through (${boxSurvivorVerts} verts) ` +
          `-> mask lets ${byMask} through (${maskSurvivorVerts} verts)\n` +
          `  mask removes ${byBox - byMask} whole-body intersects ` +
          `(${(((byBox - byMask) / byBox) * 100).toFixed(0)}% of survivors, ` +
          `${(((boxSurvivorVerts - maskSurvivorVerts) / boxSurvivorVerts) * 100).toFixed(0)}% of the vertex volume)\n` +
          `  of the ${byMask} that still run, ${emptyResults} return EMPTY`,
      );

      // --- the real question: per drag frame -------------------------------
      for (const target of [find('Times Sq'), find('Atlantic'), find('Halsey')]) {
        const after = geomFor(doc, {
          ...doc.stations,
          [target.id]: { ...target, x: target.x + 3, y: target.y + 2 },
        });
        const dirty = new Set<LineId>();
        for (const id of ids) {
          const A = base.bodies.get(id)!;
          const B = after.bodies.get(id);
          if (!B || JSON.stringify(A) !== JSON.stringify(B)) dirty.add(id);
        }
        // Dirty boxes at UNIT granularity — the changed bands and markers —
        // which is exactly what regionIncremental already computes
        // (regionIncremental.ts:635-645). Diffing post-union bodies instead
        // would make every dirty line's box the whole line.
        const dirtyBoxes: Box[] = [];
        {
          const keyBand = (b: (typeof base.bands)[number]) =>
            `${b.bandKey}|${b.centerline.map((p) => `${p.x},${p.y}`).join(' ')}|${b.radius}`;
          const beforeBands = new Map(base.bands.map((b) => [b.bandKey, keyBand(b)]));
          const bandBox = (b: (typeof base.bands)[number]): Box => {
            const xs = b.centerline.map((p) => p.x);
            const ys = b.centerline.map((p) => p.y);
            const pad = b.radius + 24;
            return {
              x0: Math.min(...xs) - pad,
              y0: Math.min(...ys) - pad,
              x1: Math.max(...xs) + pad,
              y1: Math.max(...ys) + pad,
            };
          };
          for (const b of after.bands)
            if (beforeBands.get(b.bandKey) !== keyBand(b)) dirtyBoxes.push(bandBox(b));
          const afterKeys = new Set(after.bands.map((b) => b.bandKey));
          for (const b of base.bands) if (!afterKeys.has(b.bandKey)) dirtyBoxes.push(bandBox(b));
          const mk = (m: (typeof base.markers)[number]) => `${m.stationId}|${m.lineId}`;
          const beforeM = new Map(base.markers.map((m) => [mk(m), `${m.cx},${m.cy},${m.rotationDeg}`]));
          for (const m of after.markers)
            if (beforeM.get(mk(m)) !== `${m.cx},${m.cy},${m.rotationDeg}`)
              dirtyBoxes.push({ x0: m.cx - 40, y0: m.cy - 40, x1: m.cx + 40, y1: m.cy + 40 });
          for (const m of base.markers)
            if (!after.markers.some((n) => mk(n) === mk(m)))
              dirtyBoxes.push({ x0: m.cx - 40, y0: m.cy - 40, x1: m.cx + 40, y1: m.cy + 40 });
        }
        const dirtyCells = new Set<number>();
        for (const b of dirtyBoxes) for (const c of boxCells(b)) dirtyCells.add(c);

        const masksAfter = new Map(ids.map((id) => [id, maskOf(after.bodies.get(id)!)]));
        const boxesAfter = new Map(ids.map((id) => [id, ringsBbox(after.bodies.get(id)!)]));

        // TODAY: recompute whenever either line is dirty and bboxes overlap.
        let today = 0;
        let todayVerts = 0;
        // MASK: same, but reject on masks.
        let withMask = 0;
        let maskVerts = 0;
        // DIRTY-REACH: additionally, a cached pair is provably unchanged when
        // no dirty CELL is shared by both bodies' masks — outside the dirty
        // region both bodies are identical, so their intersection is too.
        let withReach = 0;
        let reachVerts = 0;
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i];
            const b = ids[j];
            if (!dirty.has(a) && !dirty.has(b)) continue;
            if (!boxesOverlap(boxesAfter.get(a)!, boxesAfter.get(b)!)) continue;
            today++;
            todayVerts += verts(after.bodies.get(a)!) + verts(after.bodies.get(b)!);
            if (!masksOverlap(masksAfter.get(a)!, masksAfter.get(b)!)) continue;
            withMask++;
            maskVerts += verts(after.bodies.get(a)!) + verts(after.bodies.get(b)!);
            // A dirty cell that BOTH bodies occupy is the only place the
            // intersection can differ.
            let reachable = false;
            const ma = masksAfter.get(a)!;
            const mb = masksAfter.get(b)!;
            for (const c of dirtyCells) {
              if (ma.has(c) && mb.has(c)) {
                reachable = true;
                break;
              }
            }
            if (!reachable) continue;
            withReach++;
            reachVerts += verts(after.bodies.get(a)!) + verts(after.bodies.get(b)!);
          }
        console.log(
          `\n[${target.name.replace(/\n/g, ' ')}] ${dirty.size} dirty lines, ` +
            `${dirtyBoxes.length} dirty rings, ${dirtyCells.size} dirty cells\n` +
            `  today       ${String(today).padStart(4)} intersects  ${todayVerts} verts\n` +
            `  + mask      ${String(withMask).padStart(4)} intersects  ${maskVerts} verts\n` +
            `  + reach     ${String(withReach).padStart(4)} intersects  ${reachVerts} verts   ` +
            `=> ${(todayVerts / Math.max(1, reachVerts)).toFixed(1)}x less geometry, ` +
            `${(today / Math.max(1, withReach)).toFixed(1)}x fewer calls`,
        );
      }

      // --- restrictBodiesToZone: body vs component ---------------------------
      const zone = overlapZoneParts(ids, base.bodies);
      const comps = significantComponents(zone);
      let rbBox = 0;
      let rbMask = 0;
      let rbBoxVerts = 0;
      let rbMaskVerts = 0;
      for (const comp of comps) {
        const cbox = ringsBbox(comp);
        const cmask = maskOf(comp);
        for (const id of ids) {
          if (!boxesOverlap(boxes.get(id)!, cbox)) continue;
          rbBox++;
          rbBoxVerts += verts(base.bodies.get(id)!);
          if (!masksOverlap(masks.get(id)!, cmask)) continue;
          rbMask++;
          rbMaskVerts += verts(base.bodies.get(id)!);
        }
      }
      console.log(
        `\nrestrictBodiesToZone over ${comps.length} significant components:\n` +
          `  bbox reject lets ${rbBox} intersects through (${rbBoxVerts} verts)\n` +
          `  mask reject lets ${rbMask} through (${rbMaskVerts} verts)  ` +
          `=> ${(rbBoxVerts / Math.max(1, rbMaskVerts)).toFixed(1)}x less geometry, ` +
          `${(rbBox / Math.max(1, rbMask)).toFixed(1)}x fewer calls`,
      );
      expect(true).toBe(true);
    },
    LONG,
  );
});
