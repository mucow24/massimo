/* eslint-disable no-undef -- throwaway node-env perf harness, never committed */
/**
 * Dumps a digest of every face produced over a real drag sequence on the MTA
 * map, so the masked and unmasked builders can be compared byte for byte:
 *
 *   PERF=1 PERF_MASK=0 npx vitest run -c .perf/vitest.bench.config.ts .perf/bench/maskEquality.perf.test.ts --disableConsoleIntercept
 *   PERF=1              npx vitest run -c .perf/vitest.bench.config.ts .perf/bench/maskEquality.perf.test.ts --disableConsoleIntercept
 *   diff .perf/faces-nomask.txt .perf/faces-mask.txt
 */
import { describe, it, expect } from 'vitest';
import { readPerfMap } from '../perfMap';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '../../src/model/serialize';
import type { MapDoc, Station, StationId } from '../../src/model/types';
import { buildBandGeometry, buildStopMarkers, withLinePriorities } from '../../src/geometry/interlining';
import { buildExclusionHolesCached, resolveRegionWinners } from '../../src/geometry/lineRegions';
import { regionsFor } from '../../src/geometry/regionCache';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../../src/model/lineStroke';
import { lineWidthOf } from '../../src/model/lineWidth';

const PERF = !!process.env.PERF;
const MASKED = process.env.PERF_MASK !== '0';
const OUT = MASKED ? '.perf/faces-mask.txt' : '.perf/faces-nomask.txt';
const LONG = 600000;

function loadDoc(): MapDoc {
  const res = parse(readPerfMap());
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
}

function frame(doc: MapDoc, stations: Record<StationId, Station>) {
  const g = { stations, lines: doc.lines, lineCircles: doc.lineCircles };
  const bg = buildBandGeometry(stations, doc.lines, doc.lineCircles);
  const bands = withLinePriorities(bg, doc.lines, doc.lineOrder);
  const markers = buildStopMarkers(stations, doc.lines, doc.lineOrder, bands, doc.lineCircles);
  const geom = regionsFor(g, { bands: bg, markers }, { transient: true });
  const winners = resolveRegionWinners(geom.faces, doc.regionAssignments, geom.bands, doc.lineOrder);
  const holes = buildExclusionHolesCached(
    geom.faces,
    winners,
    doc.lineOrder,
    geom.bands,
    geom.markers,
    (id) => {
      const l = doc.lines[id];
      return l ? lineStrokeRailWidth(lineStrokeWidthOf(l), lineWidthOf(l)) : 0;
    },
    geom.slivers,
    geom.holeChain,
  );
  return { geom, winners, holes };
}

const q = (n: number) => Math.round(n * 1000);

describe.runIf(PERF)('mask equality', () => {
  it(
    'face + winner + hole digest across a drag',
    async () => {
      const doc = loadDoc();
      const all = Object.values(doc.stations);
      const find = (f: string) =>
        all.find((s) => s.name.toLowerCase().replace(/\s+/g, ' ').includes(f.toLowerCase()))!;
      const targets = [find('Times Sq'), find('Atlantic'), find('Canal'), find('Halsey')];

      const lines: string[] = [];
      let totalMs = 0;
      let frames = 0;

      for (const t of targets) {
        // Warm, then a drag out and back — "away and back" also exercises the
        // no-hysteresis law.
        frame(doc, doc.stations);
        let stations = doc.stations;
        for (let i = 0; i < 16; i++) {
          const dir = i < 8 ? 1 : -1;
          stations = {
            ...stations,
            [t.id]: {
              ...stations[t.id],
              x: stations[t.id].x + 2.5 * dir,
              y: stations[t.id].y + 1.5 * dir,
            },
          };
          const t0 = performance.now();
          const { geom, winners, holes } = frame(doc, stations);
          totalMs += performance.now() - t0;
          frames++;
          lines.push(
            `${t.name.replace(/\n/g, ' ')}#${i} faces=${geom.faces.length} slivers=${geom.slivers.length}`,
          );
          for (const f of geom.faces) {
            lines.push(
              `  F ${f.key} [${f.lineIds.join(',')}] a=${q(f.area)} ` +
                f.face.map((r) => r.map((p) => `${q(p.x)},${q(p.y)}`).join(' ')).join(' | '),
            );
          }
          lines.push(`  W ${winners.map((w) => `${w.winner}:${w.assignmentId ?? '-'}`).join(' ')}`);
          for (const [id, rings] of [...holes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            lines.push(
              `  H ${id} ` + rings.map((r) => r.map((p) => `${q(p.x)},${q(p.y)}`).join(' ')).join(' | '),
            );
          }
        }
      }
      writeFileSync(OUT, lines.join('\n'));
      console.log(
        `\n[${MASKED ? 'MASKED' : 'UNMASKED'}] wrote ${OUT} — ${lines.length} digest lines, ` +
          `${frames} frames, ${(totalMs / frames).toFixed(1)}ms/frame avg`,
      );
      expect(lines.length).toBeGreaterThan(0);
    },
    LONG,
  );
});
