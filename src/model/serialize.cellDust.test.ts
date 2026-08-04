import { describe, it, expect } from 'vitest';
import { parse, serialize, snapStationCells } from './serialize';
import { migrateDoc, useDoc } from '../state/store';
import { makeDoc, makeLabel, makeLine, makeStation, makeStop } from '../test/fixtures';
import * as T from './transforms';
import type { Station } from './types';

// Real values lifted from a saved map ("DKLB - v17"): cells that mean 0, left
// a hair off it by the editor's old trig-projected ghost lattice. The lattice
// is exact now, but a document that already recorded them keeps them forever —
// nothing else in the load path touches a cell coordinate.
const DUST = 2.220446049250313e-16;
const DUST_2 = 4.440892098500626e-16;
// The other shape the drift took: an integer that came back a ulp short.
const NEAR_ONE = 0.9999999999999998;

const SQRT2_2 = Math.SQRT1_2;

const dustyStation = (): Station =>
  makeStation({
    id: 's1',
    rotation: 3,
    stops: [makeStop('L1', { row: DUST, col: 1 }), makeStop('L2', { row: NEAR_ONE, col: -0 })],
    label: makeLabel({ row: DUST_2, col: 2 }),
    transferAnchors: [{ id: 'a1', row: -DUST, col: 3 }],
  });

describe('snapStationCells', () => {
  it('snaps cells that drifted off the integer lattice back onto it', () => {
    const { stations, changed } = snapStationCells({ s1: dustyStation() });
    expect(changed).toBe(true);
    const st = stations.s1;
    expect(st.stops[0]).toMatchObject({ row: 0, col: 1 });
    expect(st.stops[1]).toMatchObject({ row: 1, col: 0 });
    expect(st.label).toMatchObject({ row: 0, col: 2 });
    expect(st.transferAnchors?.[0]).toMatchObject({ row: 0, col: 3 });
    // -0 is an integer already, but it stringifies into `data-cell-col` and
    // loses every Object.is comparison, so it is normalized too.
    expect(Object.is(st.stops[1].col, -0)).toBe(false);
  });

  it('leaves every legitimately fractional cell exactly as recorded', () => {
    // The diagonal lattice (±k·√2/2 — what Shift-drag and any 45°-rotated
    // station write) and the width-derived pitches (a width-28 line sits 1.5
    // cells from a default one) are real coordinates, not drift. Snapping them
    // would move stops on the map.
    const keep = makeStation({
      id: 's1',
      stops: [
        makeStop('L1', { row: SQRT2_2, col: -3 * SQRT2_2 }),
        makeStop('L2', { row: 1.25, col: 2.75 }),
        makeStop('L3', { row: 17 / 14, col: 1.5 }),
      ],
      label: makeLabel({ row: 2 * SQRT2_2, col: 0.5 }),
    });
    const { stations, changed } = snapStationCells({ s1: keep });
    expect(changed).toBe(false);
    expect(stations.s1).toBe(keep);
  });

  it('is idempotent', () => {
    const once = snapStationCells({ s1: dustyStation() });
    const twice = snapStationCells(once.stations);
    expect(twice.changed).toBe(false);
    expect(twice.stations.s1).toBe(once.stations.s1);
  });
});

describe('cell dust is repaired on both load paths', () => {
  const dustyDoc = () =>
    makeDoc({
      stations: [dustyStation()],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: ['s1'] })],
      styles: Object.values(T.DEFAULT_STYLES),
    });

  it('parse() cleans an imported file', () => {
    const result = parse(serialize(dustyDoc()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const st = result.doc.stations.s1;
    expect(st.stops.map((c) => c.row)).toEqual([0, 1]);
    expect(st.label.row).toBe(0);
    expect(st.transferAnchors?.[0].row).toBe(0);
  });

  it('a saved file no longer carries 17 digits where it means zero', () => {
    // The reason this is worth repairing rather than tolerating: the drift is
    // below every epsilon the app compares cells with, so it is invisible until
    // you read the file.
    const before = serialize(dustyDoc());
    expect(before).toContain('2.220446049250313e-16');
    const reloaded = parse(before);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(serialize(reloaded.doc)).not.toContain('e-16');
  });

  it('migrateDoc cleans a doc that comes through the version chain', () => {
    const out = migrateDoc({ stations: { s1: dustyStation() } }, 3);
    const st = out.stations.s1;
    expect(st.stops.map((c) => c.row)).toEqual([0, 1]);
    expect(st.label.row).toBe(0);
  });

  it('rehydrating a doc stored at the CURRENT version still cleans it', () => {
    // The case that matters most, and the one an ungated step in `migrateDoc`
    // does NOT cover: zustand only calls `migrate` when the stored version
    // DIFFERS from the config version, and dust is not tied to a schema bump —
    // docs saved by today's build carry it at today's version. So the repair
    // has to ride the `merge` hook, which runs on every rehydrate.
    // Read the live persist version rather than a literal: the whole point is
    // that the stored version EQUALS the config version, so zustand skips
    // `migrate` and only `merge` can do the repair. A hardcoded number silently
    // stops testing that the day the version bumps.
    localStorage.setItem(
      'vignelli-map-doc-v1',
      JSON.stringify({
        version: useDoc.persist.getOptions().version,
        state: { stations: { s1: dustyStation() } },
      }),
    );
    useDoc.persist.rehydrate();
    const st = useDoc.getState().stations.s1;
    expect(st.stops.map((c) => c.row)).toEqual([0, 1]);
    expect(st.label.row).toBe(0);
    expect(st.transferAnchors?.[0].row).toBe(0);
  });
});
