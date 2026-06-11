import { describe, it, expect, beforeEach } from 'vitest';
import { migrateDoc, beginHistoryGroup, cancelAppendMode, useDoc, useSelection } from './store';
import { historyDepth } from './history';
import {
  DEFAULT_DOC,
  TEXT_LABEL_COLOR_DEFAULT,
  TEXT_LABEL_DARK_COLOR_DEFAULT,
} from '../model/transforms';
import { DOT_SHAPE_PRESETS } from '../model/dotStyle';
import { makeLine, makeStation, makeStop, makeLabel, stationWithStop } from '../test/fixtures';
import type {
  DotStyle,
  LineId,
  StationId,
  StopOrientation,
  LabelValign,
  Polygon,
  TextLabel,
} from '../model/types';

// Loose view of the migrated doc so we can read fields without fighting the
// branded id types / partial-shape casts.
type AnyDoc = {
  lines?: Record<
    string,
    { name?: string; service?: string; defaultDotShape?: string; defaultDotStyle?: DotStyle }
  >;
  stations?: Record<
    string,
    {
      stops: { orientation: string; dotShape?: string; dotStyle?: DotStyle }[];
      label: { valign: string };
    }
  >;
  polygons?: Record<string, Polygon>;
  textLabels?: Record<string, TextLabel>;
  labelWeight?: number;
  labelBold?: boolean;
};
const run = (persisted: unknown, version: number): AnyDoc =>
  migrateDoc(persisted, version) as unknown as AnyDoc;

describe('migrateDoc', () => {
  describe('v0 → v1: line.name backfill', () => {
    it('fills a missing name from the service letter', () => {
      const out = run({ lines: { L1: { service: 'A', stations: [] } } }, 0);
      expect(out.lines!.L1.name).toBe('A line');
    });

    it('leaves an existing name untouched', () => {
      const out = run({ lines: { L1: { service: 'A', name: 'Already', stations: [] } } }, 0);
      expect(out.lines!.L1.name).toBe('Already');
    });
  });

  describe('v1/v3 → v4: station sanitation (orientation + valign)', () => {
    const legacyStation = () => ({
      ...makeStation({ id: 'S' as StationId }),
      stops: [makeStop('L1' as LineId, { orientation: 'up' as unknown as StopOrientation })],
      label: makeLabel({ valign: 'auto' as unknown as LabelValign }),
    });

    it('migrates legacy cardinal orientations and the legacy auto valign', () => {
      const out = run({ stations: { S: legacyStation() } }, 0);
      expect(out.stations!.S.stops[0].orientation).toBe('auto-vertical');
      expect(out.stations!.S.label.valign).toBe('auto-down');
    });

    it('does not run station sanitation at version >= 4', () => {
      const out = run({ stations: { S: legacyStation() } }, 4);
      expect(out.stations!.S.stops[0].orientation).toBe('up');
    });
  });

  describe('v4 → v5: polygon dark colors', () => {
    it('backfills darkFill/darkStroke from the light colors', () => {
      const legacy = {
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        fill: '#cfe3f2',
        stroke: '#102030',
        strokeWidth: 2,
      } as unknown as Polygon;
      const out = run({ polygons: { P: legacy } }, 0);
      expect(out.polygons!.P.darkFill).toBe('#cfe3f2');
      expect(out.polygons!.P.darkStroke).toBe('#102030');
    });
  });

  describe('v5 → v6: text-label colors', () => {
    it('backfills color/darkColor to the theme defaults', () => {
      const legacy = {
        x: 0,
        y: 0,
        rotation: 0,
        text: 'Hi',
        fontSize: 16,
        weight: 400,
        italic: false,
        align: 'left',
      } as unknown as TextLabel;
      const out = run({ textLabels: { G: legacy } }, 0);
      expect(out.textLabels!.G.color).toBe(TEXT_LABEL_COLOR_DEFAULT);
      expect(out.textLabels!.G.darkColor).toBe(TEXT_LABEL_DARK_COLOR_DEFAULT);
    });
  });

  describe('v2 → v3: labelBold → labelWeight', () => {
    it('translates labelBold:true to weight 700 and drops the legacy field', () => {
      const out = run({ labelBold: true }, 0);
      expect(out.labelWeight).toBe(700);
      expect(out.labelBold).toBeUndefined();
    });

    it('translates labelBold:false to weight 400', () => {
      expect(run({ labelBold: false }, 0).labelWeight).toBe(400);
    });

    it('keeps an explicit labelWeight when both fields are present', () => {
      const out = run({ labelBold: true, labelWeight: 300 }, 0);
      expect(out.labelWeight).toBe(300);
      expect(out.labelBold).toBeUndefined();
    });

    it('does not translate labelBold at version >= 3', () => {
      const out = run({ labelBold: true }, 3);
      expect(out.labelWeight).toBeUndefined();
      expect(out.labelBold).toBe(true);
    });
  });

  describe('v6 → v7: dotShape preset ids → DotStyle objects', () => {
    const stationWithDotShape = (dotShape?: string) => ({
      ...makeStation({ id: 'S' as StationId }),
      stops: [dotShape ? { ...makeStop('L1' as LineId), dotShape } : makeStop('L1' as LineId)],
    });

    it('converts a per-stop dotShape preset id to its style object and strips the key', () => {
      const out = run({ stations: { S: stationWithDotShape('filled-black-diamond') } }, 6);
      const stop = out.stations!.S.stops[0];
      expect(stop.dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-black-diamond']);
      expect('dotShape' in stop).toBe(false);
    });

    it("converts a line's defaultDotShape and strips the key", () => {
      const out = run(
        {
          lines: {
            L1: { service: 'A', name: 'A line', stations: [], defaultDotShape: 'open-white' },
          },
        },
        6,
      );
      expect(out.lines!.L1.defaultDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
      expect('defaultDotShape' in out.lines!.L1).toBe(false);
    });

    it("converts a legacy 'none' to the invisible style", () => {
      const out = run({ stations: { S: stationWithDotShape('none') } }, 6);
      expect(out.stations!.S.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['none']);
    });

    it('passes a doc without legacy dot fields through by reference', () => {
      const input = {
        stations: { S: stationWithDotShape() },
        lines: { L1: { service: 'A', name: 'A line', stations: [] } },
      };
      expect(run(input, 6)).toBe(input);
    });

    it('does not convert at version >= 7', () => {
      const out = run({ stations: { S: stationWithDotShape('filled-white') } }, 7);
      const stop = out.stations!.S.stops[0];
      expect(stop.dotShape).toBe('filled-white');
      expect(stop.dotStyle).toBeUndefined();
    });
  });

  describe('version handling', () => {
    it('treats a missing/corrupt version as v0 so every migration runs', () => {
      const out = run(
        { lines: { L1: { service: 'A', stations: [] } } },
        undefined as unknown as number,
      );
      expect(out.lines!.L1.name).toBe('A line');
    });

    it('returns the input as-is when already at the current version', () => {
      // `width`, `defaultDotSize`, and per-stop `dotSize` ride along
      // untouched — each field is optional with a runtime default, so none
      // needs a migration (and adding one would break this
      // reference-equality pin).
      const input = {
        stations: {
          S: {
            ...makeStation({ id: 'S' as StationId }),
            stops: [{ ...makeStop('L1' as LineId), dotSize: 16 }],
          },
        },
        lines: {
          L1: { service: 'A', name: 'A line', stations: ['S'], width: 21, defaultDotSize: 12 },
        },
      };
      const out = run(input, 7);
      // No migration applies → same reference passes straight through.
      expect(out).toBe(input);
    });
  });
});

describe('beginHistoryGroup', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
  });

  it('commit pushes exactly one history entry covering the grouped edit', () => {
    const before = historyDepth();
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(10, 20);
    useDoc.getState().addStation(30, 40);
    grp.commit();
    expect(historyDepth()).toBe(before + 1);
  });

  it('commit is a no-op when nothing changed in the group', () => {
    const before = historyDepth();
    beginHistoryGroup().commit();
    expect(historyDepth()).toBe(before);
  });

  it('cancel never pushes, even after a change', () => {
    const before = historyDepth();
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(0, 0);
    grp.cancel();
    expect(historyDepth()).toBe(before);
  });

  it('a second commit is a no-op (done flag)', () => {
    const before = historyDepth();
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(0, 0);
    grp.commit();
    grp.commit();
    expect(historyDepth()).toBe(before + 1);
  });
});

describe('cancelAppendMode', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'idle' } });
  });

  it('deletes a freshly-created empty line and returns to idle', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: [] }) },
      lineOrder: ['L1' as LineId],
    });
    useSelection.getState().setAppending('L1' as LineId);

    cancelAppendMode();

    expect(useDoc.getState().lines['L1' as LineId]).toBeUndefined();
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('keeps a line that already has stations', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['A' as StationId] }) },
      lineOrder: ['L1' as LineId],
      stations: { A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
    });
    useSelection.getState().setAppending('L1' as LineId);

    cancelAppendMode();

    expect(useDoc.getState().lines['L1' as LineId]).toBeDefined();
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('is a no-op (beyond clearing append) when not in appending mode', () => {
    expect(() => cancelAppendMode()).not.toThrow();
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});
