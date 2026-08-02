/* eslint-disable no-undef -- throwaway */
import { describe, it, expect } from 'vitest';
import { readPerfMap } from '../perfMap';
import { parse } from '../../src/model/serialize';
import type { MapDoc, Station, StationId } from '../../src/model/types';
import { buildBandGeometry, buildStopMarkers, withLinePriorities } from '../../src/geometry/interlining';
import { buildRegionsIncremental, type RegionIncrementalState } from '../../src/geometry/regionIncremental';

const PERF = !!process.env.PERF;
function loadDoc(): MapDoc {
  const r = parse(readPerfMap());
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}
describe.runIf(PERF)('zone locality', () => {
  it('is the zone union local or global per drag frame?', () => {
    const doc = loadDoc();
    const all = Object.values(doc.stations);
    const find = (f: string) => all.find((s) => s.name.toLowerCase().replace(/\s+/g,' ').includes(f.toLowerCase()))!;
    for (const t of [find('Times Sq'), find('Atlantic'), find('Halsey')]) {
      const g = (st: Record<StationId, Station>) => {
        const b = buildBandGeometry(st, doc.lines, doc.lineCircles);
        const wp = withLinePriorities(b, doc.lines, doc.lineOrder);
        return { b, m: buildStopMarkers(st, doc.lines, doc.lineOrder, wp, doc.lineCircles) };
      };
      let prev: RegionIncrementalState | null = null;
      let stations = doc.stations;
      { const x = g(stations); prev = buildRegionsIncremental(x.b, x.m, prev).state; }
      const parts: number[] = [];
      const rebuilt: number[] = [];
      for (let i = 0; i < 10; i++) {
        stations = { ...stations, [t.id]: { ...stations[t.id], x: stations[t.id].x + 2, y: stations[t.id].y + 1.4 } };
        const x = g(stations);
        const r = buildRegionsIncremental(x.b, x.m, prev);
        prev = r.state;
        parts.push(r.zoneUnionParts);
        rebuilt.push(r.rebuilt);
      }
      console.log(
        `[${t.name.replace(/\n/g,' ')}] zoneUnionParts per frame: ${parts.join(',')}  ` +
        `(0=fast path, ~1900=GLOBAL union of every pair part, small=local splice)\n` +
        `   comps rebuilt: ${rebuilt.join(',')} of ${prev!.zoneComps.length}`,
      );
    }
    expect(true).toBe(true);
  }, 600000);
});
