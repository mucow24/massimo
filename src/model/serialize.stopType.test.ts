import { describe, it, expect } from 'vitest';
import { parse, sanitizeStopType, SCHEMA_FORMAT } from './serialize';
import { STATION_STOP_TYPES } from './transforms';
import { makeStation } from '../test/fixtures';

/**
 * `Station.stopType` is a STORED string union that no schema bump ever touches,
 * so it is judged by membership and runs ungated on both load paths — the same
 * standing as the label's alignment ladders.
 *
 * It fails quietly, which is why it needs the gate: `stationIsSingleton` matches
 * both declarations by NAME, so a junk value is no vote at all and the visible-
 * stop count answers instead — while the inspector's Stop type picker, matching
 * the same value against its three options, shows no choice selected. The map
 * looks right, the control looks blank, and the value survives every save.
 */
describe('station stopType membership gate', () => {
  const fileWithStopType = (stopType: unknown): string =>
    JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: {
        stations: {
          s1: {
            id: 's1',
            name: 'Foo',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [],
            label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
            stopType,
          },
        },
        lines: {},
        lineOrder: [],
      },
    });

  const stationOf = (json: string) => {
    const r = parse(json);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    return r.doc.stations['s1'];
  };

  it('drops a non-member declaration', () => {
    expect('stopType' in stationOf(fileWithStopType('Interchange'))).toBe(false);
  });

  it('drops a wrong-typed declaration rather than letting it reach the picker', () => {
    expect('stopType' in stationOf(fileWithStopType(7))).toBe(false);
  });

  it('drops a stored "auto", which is the picker rung the ABSENT field spells', () => {
    // 'auto' is a member of the picker's ladder but not of the stored value
    // space — canonical form for it is the key absent, which is what
    // `setStationStopType('auto')` writes.
    expect('stopType' in stationOf(fileWithStopType('auto'))).toBe(false);
  });

  it('keeps both real declarations', () => {
    expect(stationOf(fileWithStopType('singleton')).stopType).toBe('singleton');
    expect(stationOf(fileWithStopType('interchange')).stopType).toBe('interchange');
  });

  it('leaves a station carrying no declaration alone', () => {
    const r = parse(
      JSON.stringify({
        format: SCHEMA_FORMAT,
        doc: {
          stations: {
            s1: {
              id: 's1',
              name: 'Foo',
              x: 0,
              y: 0,
              rotation: 0,
              stops: [],
              label: {
                row: 0,
                col: -1,
                rotation: 0,
                offset: 0,
                align: 'auto',
                valign: 'auto-down',
              },
            },
          },
          lines: {},
          lineOrder: [],
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('stopType' in r.doc.stations['s1']).toBe(false);
  });

  // `changed: false` on a canonical doc is what lets the rehydrate path run
  // this on every load without the doc reading dirty — its callers assign only
  // when the flag is set (see `repairUngatedDocInvariants`).
  it('reports no change for a canonical stations dict, and touches no station', () => {
    const s1 = makeStation({ id: 's1', stopType: 'singleton' });
    const s2 = makeStation({ id: 's2' });
    const out = sanitizeStopType({ s1, s2 });
    expect(out.changed).toBe(false);
    expect(out.stations.s1).toBe(s1);
    expect(out.stations.s2).toBe(s2);
  });

  it('rewrites only the stations it heals', () => {
    const keep = makeStation({ id: 's1', stopType: 'interchange' });
    const stations = {
      s1: keep,
      s2: makeStation({ id: 's2', stopType: 'bogus' as 'singleton' }),
    };
    const out = sanitizeStopType(stations);
    expect(out.changed).toBe(true);
    expect(out.stations.s1).toBe(keep);
    expect('stopType' in out.stations.s2).toBe(false);
  });

  it('offers "auto" plus every stored declaration, and nothing else', () => {
    // The picker's ladder. The two stored rungs are this list minus its absent
    // one, which is what the gate above judges by — so neither can drift.
    expect([...STATION_STOP_TYPES]).toEqual(['auto', 'singleton', 'interchange']);
  });
});
