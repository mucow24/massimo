import { describe, expect, it } from 'vitest';
import * as T from './transforms';
import { repackStationForSpacing } from './stationPacking';
import type { Line, LineId } from './types';

// Width-edit shorthand: interline gaps unchanged at 0 — the pre-gap contract
// these tests pin. Gap-edit repack behavior has its own tests below.
const repackStationForWidth = (
  st: Station,
  lines: Record<LineId, Line>,
  lineId: LineId,
  oldWidth: number,
  newWidth: number,
): Station => repackStationForSpacing(st, lines, lineId, oldWidth, newWidth, 0, 0);
import { applyStyleToItem } from './styles';
import { DEFAULT_STOP_DOT_STYLE_ID } from './dotStyle';
import { buildBandGeometry } from '../geometry/interlining';
import { SQRT2_2 } from '../geometry/vec';
import { makeDoc, makeLabel, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc, Station, StopOrientation } from './types';

// Width edits re-pack tangent stop chains: stops that sat edge-to-edge under
// the OLD widths are rewritten to sit edge-to-edge under the NEW widths,
// preserving each chain's centroid (so band centerlines stay put). Stops that
// were NOT tangent never move. This is what keeps interlined bands merged
// through width edits — the merge gate requires exact tangency
// (tangentGap = (wA+wB)/2 within 0.5 world units) at both corridor ends.

const stopOf = (doc: MapDoc, stationId: string, lineId: string) => {
  const cell = doc.stations[stationId].stops.find((c) => c.lineId === lineId);
  if (!cell) throw new Error(`no stop for ${lineId} at ${stationId}`);
  return cell;
};

// Two-line horizontal corridor s1 → s2 with stops stacked one row apart
// (tangent at the default width 14).
function interlinedPairDoc(rows: [number, number] = [0, 1]): MapDoc {
  const stops = (): Station['stops'] => [
    makeStop('L1', { row: rows[0], col: 0, orientation: 'auto-horizontal' }),
    makeStop('L2', { row: rows[1], col: 0, orientation: 'auto-horizontal' }),
  ];
  return makeDoc({
    stations: [
      makeStation({ id: 's1', x: 0, y: 0, stops: stops(), label: makeLabel({ row: 0, col: -1 }) }),
      makeStation({
        id: 's2',
        x: 200,
        y: 0,
        stops: stops(),
        label: makeLabel({ row: 0, col: -1 }),
      }),
    ],
    lines: [
      makeLine({ id: 'L1', stations: ['s1', 's2'] }),
      makeLine({ id: 'L2', stations: ['s1', 's2'] }),
    ],
  });
}

// Three-line corridor, rows 0/1/2 (one tangent chain of three).
function interlinedTrioDoc(): MapDoc {
  const stops = (): Station['stops'] => [
    makeStop('L1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
    makeStop('L2', { row: 1, col: 0, orientation: 'auto-horizontal' }),
    makeStop('L3', { row: 2, col: 0, orientation: 'auto-horizontal' }),
  ];
  return makeDoc({
    stations: [
      makeStation({ id: 's1', x: 0, y: 0, stops: stops(), label: makeLabel({ row: 3, col: 0 }) }),
      makeStation({
        id: 's2',
        x: 200,
        y: 0,
        stops: stops(),
        label: makeLabel({ row: 3, col: 0 }),
      }),
    ],
    lines: [
      makeLine({ id: 'L1', stations: ['s1', 's2'] }),
      makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      makeLine({ id: 'L3', stations: ['s1', 's2'] }),
    ],
  });
}

describe('setLineWidth repacks tangent chains', () => {
  it('shrinking one line of a tangent pair keeps the pair tangent at the mixed gap', () => {
    const doc = interlinedPairDoc();
    const next = T.setLineWidth(doc, 'L1', 8);
    // New gap = tangentGap(8, 14) = 11 world units, centroid (y = 7) preserved:
    // rows 0/1 → 1.5/14 and 12.5/14, at BOTH stations.
    for (const sid of ['s1', 's2']) {
      expect(stopOf(next, sid, 'L1').row).toBeCloseTo(1.5 / 14, 12);
      expect(stopOf(next, sid, 'L2').row).toBeCloseTo(12.5 / 14, 12);
      expect(stopOf(next, sid, 'L1').col).toBe(0);
      expect(stopOf(next, sid, 'L2').col).toBe(0);
    }
    // The headline invariant: the corridor is still ONE merged band.
    const bands = buildBandGeometry(next.stations, next.lines);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(2);
  });

  it('shrinking both lines lands the uniform tangent gap and stays merged', () => {
    const doc = interlinedPairDoc();
    const next = T.setLineWidth(T.setLineWidth(doc, 'L1', 8), 'L2', 8);
    // Gap 8, centroid preserved: rows 3/14 and 11/14.
    for (const sid of ['s1', 's2']) {
      expect(stopOf(next, sid, 'L1').row).toBeCloseTo(3 / 14, 12);
      expect(stopOf(next, sid, 'L2').row).toBeCloseTo(11 / 14, 12);
    }
    const bands = buildBandGeometry(next.stations, next.lines);
    expect(bands).toHaveLength(1);
    expect(bands[0].stripeWidths).toEqual([8, 8]);
  });

  it('widening keeps the pair tangent too (the fat-band case)', () => {
    const doc = interlinedPairDoc();
    const next = T.setLineWidth(doc, 'L2', 28);
    // Gap = tangentGap(14, 28) = 21, centroid preserved: rows -0.25 and 1.25.
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(-0.25, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(1.25, 12);
    expect(buildBandGeometry(next.stations, next.lines)).toHaveLength(1);
  });

  it('setting the width back to the DEFAULT repacks too (field-drop branch) and round-trips', () => {
    const doc = interlinedPairDoc();
    const next = T.setLineWidth(T.setLineWidth(doc, 'L1', 8), 'L1', 14);
    // The stored field collapses to absence at the default…
    expect(next.lines.L1.width).toBeUndefined();
    // …and the packed-at-11 pair reopens to the 14 gap — exactly the seed
    // layout, centroid preserved through the round trip.
    for (const sid of ['s1', 's2']) {
      expect(stopOf(next, sid, 'L1').row).toBeCloseTo(0, 12);
      expect(stopOf(next, sid, 'L2').row).toBeCloseTo(1, 12);
    }
    expect(buildBandGeometry(next.stations, next.lines)).toHaveLength(1);
  });

  it('editing the middle line of a three-chain leaves the middle stop in place', () => {
    const doc = interlinedTrioDoc();
    const next = T.setLineWidth(doc, 'L2', 8);
    // Gaps become 11/11 around the thin middle line; the chain centroid pins
    // the middle stop exactly where it was.
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(3 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(1, 12);
    expect(stopOf(next, 's1', 'L3').row).toBeCloseTo(25 / 14, 12);
    const bands = buildBandGeometry(next.stations, next.lines);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(3);
  });

  it('non-tangent stops never move (stop arrays pass through by reference)', () => {
    const doc = interlinedPairDoc([0, 2]); // two rows apart — not tangent
    const next = T.setLineWidth(doc, 'L1', 8);
    expect(next.lines.L1.width).toBe(8);
    for (const sid of ['s1', 's2']) {
      expect(next.stations[sid].stops).toBe(doc.stations[sid].stops);
      // The label parked against L1's stop still tracks its edge (14→8
      // pulls the west edge in by 3 world units).
      expect(next.stations[sid].label.col).toBeCloseTo(-11 / 14, 12);
    }
  });

  it('stops with mismatched parallel positions are not chained', () => {
    const doc = interlinedPairDoc();
    // Shift L2's stop one column east: same axis, tangent perp step, but the
    // along-travel positions differ — the merge gate would not link these.
    const shifted = {
      ...doc,
      stations: {
        ...doc.stations,
        s1: {
          ...doc.stations.s1,
          stops: doc.stations.s1.stops.map((c) => (c.lineId === 'L2' ? { ...c, col: 1 } : c)),
        },
      },
    };
    const next = T.setLineWidth(shifted, 'L1', 8);
    // s1's pair is un-chained by the par mismatch and its stops pass through
    // by reference; s2 (still tangent) repacks as usual.
    expect(next.stations.s1.stops).toBe(shifted.stations.s1.stops);
    expect(stopOf(next, 's2', 'L1').row).toBeCloseTo(1.5 / 14, 12);
  });

  it('stops on a different travel axis are not chained', () => {
    const doc = interlinedPairDoc();
    const crossed = {
      ...doc,
      stations: {
        ...doc.stations,
        s1: {
          ...doc.stations.s1,
          stops: doc.stations.s1.stops.map((c) =>
            c.lineId === 'L2' ? { ...c, orientation: 'auto-vertical' as StopOrientation } : c,
          ),
        },
      },
    };
    const next = T.setLineWidth(crossed, 'L1', 8);
    expect(next.stations.s1.stops).toBe(crossed.stations.s1.stops);
    // s2 is untouched fixture data — still one tangent chain there.
    expect(stopOf(next, 's2', 'L1').row).toBeCloseTo(1.5 / 14, 12);
  });

  it('the label follows its nearest stop', () => {
    const doc = interlinedTrioDoc(); // label at row 3, under L3 (row 2)
    const next = T.setLineWidth(doc, 'L2', 8);
    // L3 moved 2 → 25/14 (delta -3/14); the label rides along.
    expect(next.stations.s1.label.row).toBeCloseTo(3 - 3 / 14, 12);
    expect(next.stations.s1.label.col).toBe(0);
  });

  it('the label tracks the edited edge even when its nearest stop is pinned', () => {
    // Label beside the MIDDLE stop: editing the middle line pins L2 in place
    // (chain centroid) so there is no ride — but L2's near edge still moved
    // in by 3 world units, and the parked label follows the EDGE.
    const base = interlinedTrioDoc();
    const doc = {
      ...base,
      stations: {
        ...base.stations,
        s1: { ...base.stations.s1, label: makeLabel({ row: 1, col: -1 }) },
      },
    };
    const next = T.setLineWidth(doc, 'L2', 8);
    expect(next.stations.s1.label.col).toBeCloseTo(-11 / 14, 12);
    expect(next.stations.s1.label.row).toBe(1);
  });

  it('a chain of repacked (off-lattice) stops is still recognized by the next edit', () => {
    const doc = interlinedPairDoc();
    const thin = T.setLineWidth(T.setLineWidth(doc, 'L1', 8), 'L2', 8);
    // Now widen back out from the packed-at-8 state: gap must become 20.
    const wide = T.setLineWidth(T.setLineWidth(thin, 'L1', 20), 'L2', 20);
    const dRow = stopOf(wide, 's1', 'L2').row - stopOf(wide, 's1', 'L1').row;
    expect(dRow * 14).toBeCloseTo(20, 9);
    expect(buildBandGeometry(wide.stations, wide.lines)).toHaveLength(1);
  });

  it('slider ticks compose: stepping 14→8 one unit at a time ≡ jumping straight to 8', () => {
    const doc = interlinedPairDoc();
    let stepped = doc;
    for (const w of [13, 12, 11, 10, 9, 8]) stepped = T.setLineWidth(stepped, 'L1', w);
    const direct = T.setLineWidth(doc, 'L1', 8);
    for (const lineId of ['L1', 'L2']) {
      expect(stopOf(stepped, 's1', lineId).row).toBeCloseTo(stopOf(direct, 's1', lineId).row, 9);
    }
  });

  it('repacks diagonal-axis chains along their own perpendicular', () => {
    const stops = (): Station['stops'] => [
      makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
      makeStop('L2', { row: SQRT2_2, col: SQRT2_2, orientation: 'auto-ne-sw' }),
    ];
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
        makeStation({ id: 's2', x: 200, y: 200, stops: stops() }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    const next = T.setLineWidth(doc, 'L1', 8);
    // Tangent along the NW–SE perpendicular at gap 14 → repack to gap 11,
    // centroid preserved: the pair slides toward each other along the
    // diagonal, equal row/col components.
    const a = stopOf(next, 's1', 'L1');
    const b = stopOf(next, 's1', 'L2');
    expect(a.row).toBeCloseTo((1.5 / 14) * SQRT2_2, 9);
    expect(a.col).toBeCloseTo((1.5 / 14) * SQRT2_2, 9);
    expect(b.row).toBeCloseTo((12.5 / 14) * SQRT2_2, 9);
    expect(b.col).toBeCloseTo((12.5 / 14) * SQRT2_2, 9);
    const gap = Math.hypot((b.row - a.row) * 14, (b.col - a.col) * 14);
    expect(gap).toBeCloseTo(11, 9);
  });
});

describe('style-driven width changes repack through the same path', () => {
  it('applying a thin style to both lines of a pair lands the uniform gap', () => {
    const base = interlinedPairDoc();
    const doc: MapDoc = {
      ...base,
      styles: {
        ...base.styles,
        thin: {
          id: 'thin',
          name: 'Thin',
          kind: 'line',
          props: {
            singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
            multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
            singletonDotSize: 8,
            multiDotSize: 8,
            width: 8,
            curveRadius: 24,
            endStyle: 'square',
            strokeWidth: 0,
            strokeColor: '#ffffff',
          },
        },
      },
    };
    const next = applyStyleToItem(applyStyleToItem(doc, 'thin', 'L1'), 'thin', 'L2');
    expect(next.lines.L1.width).toBe(8);
    expect(next.lines.L2.width).toBe(8);
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(3 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(11 / 14, 12);
    expect(buildBandGeometry(next.stations, next.lines)).toHaveLength(1);
  });
});

describe('spawnStopCell places new stops at the tangent gap', () => {
  it('a new stop on a thin line lands tangent to the thin anchor', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'], width: 8 }), makeLine({ id: 'L2', width: 8 })],
    });
    const next = T.addStationToLine(doc, 'L2', 's1');
    const cell = stopOf(next, 's1', 'L2');
    expect(cell.row).toBe(0);
    expect(cell.col).toBeCloseTo(8 / 14, 12);
  });

  it('default-width spawn still lands exactly one cell east (legacy pin)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2' })],
    });
    const next = T.addStationToLine(doc, 'L2', 's1');
    expect(stopOf(next, 's1', 'L2').col).toBe(1);
  });

  it('the auto-label nudge steps clear of a fractional spawn cell', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L2', { row: 0, col: 8 / 14 })],
          label: makeLabel({ row: 0, col: 16 / 14 }), // exactly the spawn cell
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1'], width: 8 }),
        makeLine({ id: 'L2', stations: ['s1'], width: 8 }),
        makeLine({ id: 'L3', width: 8 }),
      ],
    });
    const next = T.addStationToLine(doc, 'L3', 's1');
    expect(stopOf(next, 's1', 'L3').row).toBe(0);
    expect(stopOf(next, 's1', 'L3').col).toBeCloseTo(16 / 14, 12);
    // The auto label stepped one whole cell east of the new stop.
    expect(next.stations.s1.label.col).toBeCloseTo(16 / 14 + 1, 12);
    expect(next.stations.s1.label.row).toBe(0);
  });
});

describe('repackStationForWidth (unit)', () => {
  const linePair = () => ({
    L1: makeLine({ id: 'L1' }),
    L2: makeLine({ id: 'L2' }),
  });

  it('is rotation-blind: a rotated station repacks to the same local cells', () => {
    // The repack works entirely in the unrotated local frame — rotation
    // preserves lengths, so a rotated station must produce byte-for-byte the
    // numbers of the rotation-0 case (a future world-frame projection sneaking
    // in would break this).
    const st = makeStation({
      id: 's1',
      rotation: 3,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
        makeStop('L2', { row: 1, col: 0, orientation: 'auto-horizontal' }),
      ],
    });
    const out = repackStationForWidth(st, linePair(), 'L1', 14, 8);
    expect(out.rotation).toBe(3);
    expect(out.stops[0].row).toBeCloseTo(1.5 / 14, 12);
    expect(out.stops[1].row).toBeCloseTo(12.5 / 14, 12);
    expect(out.stops[0].col).toBe(0);
    expect(out.stops[1].col).toBe(0);
  });

  it('treats orphan stops (line id gone) as default width instead of throwing', () => {
    const st = makeStation({
      id: 's1',
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
        makeStop('ghost', { row: 1, col: 0, orientation: 'auto-horizontal' }),
      ],
    });
    const out = repackStationForWidth(st, { L1: makeLine({ id: 'L1' }) }, 'L1', 14, 8);
    // ghost falls back to width 14 → mixed gap 11, centroid preserved.
    expect(out.stops[0].row).toBeCloseTo(1.5 / 14, 12);
    expect(out.stops[1].row).toBeCloseTo(12.5 / 14, 12);
  });

  it('returns the same station reference when the line has no stop here', () => {
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L2', { row: 0, col: 0 })],
    });
    expect(repackStationForWidth(st, linePair(), 'L1', 14, 8)).toBe(st);
  });
});

describe('interline gap edits (setLineInterlineGap)', () => {
  it('spreads a packed pair apart and keeps the band merged', () => {
    const doc = interlinedPairDoc();
    const next = T.setLineInterlineGap(doc, 'L1', 4);
    expect(next.lines.L1.interlineGap).toBe(4);
    // Packed spacing 14 → 18; chain centroid (y = 7) preserved: rows
    // −2/14 and 16/14 at both corridor ends.
    for (const sid of ['s1', 's2']) {
      expect(stopOf(next, sid, 'L1').row).toBeCloseTo(-2 / 14, 12);
      expect(stopOf(next, sid, 'L2').row).toBeCloseTo(16 / 14, 12);
    }
    // The band survives the edit (merge gate and repack agree on the gap),
    // and the stripes spread to the packed offsets.
    const bands = buildBandGeometry(next.stations, next.lines);
    expect(bands).toHaveLength(1);
    expect(bands[0].stripeOffsets).toEqual([-9, 9]);
  });

  it('round-trips: clearing the gap re-packs to plain tangency', () => {
    const doc = interlinedPairDoc();
    const back = T.setLineInterlineGap(T.setLineInterlineGap(doc, 'L1', 4), 'L1', 0);
    expect(back.lines.L1.interlineGap).toBeUndefined();
    for (const sid of ['s1', 's2']) {
      expect(stopOf(back, sid, 'L1').row).toBeCloseTo(0, 12);
      expect(stopOf(back, sid, 'L2').row).toBeCloseTo(1, 12);
    }
  });

  it('never moves deliberately non-tangent stops', () => {
    const doc = interlinedPairDoc([0, 2]);
    const next = T.setLineInterlineGap(doc, 'L1', 4);
    expect(next.lines.L1.interlineGap).toBe(4);
    for (const sid of ['s1', 's2']) {
      expect(stopOf(next, sid, 'L1').row).toBe(0);
      expect(stopOf(next, sid, 'L2').row).toBe(2);
    }
  });

  it('no-ops (same reference) on an unchanged stored gap and non-finite input', () => {
    const doc = interlinedPairDoc();
    expect(T.setLineInterlineGap(doc, 'L1', 0)).toBe(doc);
    expect(T.setLineInterlineGap(doc, 'L1', Number.NaN)).toBe(doc);
    const gapped = T.setLineInterlineGap(doc, 'L1', 4);
    expect(T.setLineInterlineGap(gapped, 'L1', 4)).toBe(gapped);
  });

  it('rounds to the quarter-unit grid and drops the field at 0', () => {
    const doc = interlinedPairDoc();
    expect(T.setLineInterlineGap(doc, 'L1', 3.9).lines.L1.interlineGap).toBe(4);
    expect(T.setLineInterlineGap(doc, 'L1', 0.1).lines.L1.interlineGap).toBeUndefined();
  });

  it('a width edit preserves an existing gap (the repack recognizes gapped chains)', () => {
    const gapped = T.setLineInterlineGap(interlinedPairDoc(), 'L1', 4);
    const widened = T.setLineWidth(gapped, 'L1', 20);
    // Packed spacing (20+14)/2 + 4 = 21; centroid preserved: 7 ∓ 10.5.
    for (const sid of ['s1', 's2']) {
      expect(stopOf(widened, sid, 'L1').row).toBeCloseTo(-3.5 / 14, 12);
      expect(stopOf(widened, sid, 'L2').row).toBeCloseTo(17.5 / 14, 12);
    }
    expect(buildBandGeometry(widened.stations, widened.lines)).toHaveLength(1);
  });

  it('spawns a new stop at the packed distance from a gapped line', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
          label: makeLabel({ row: 3, col: 0 }),
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L3', interlineGap: 4 })],
    });
    const next = T.addStationToLine(doc, 'L3', 's1');
    // Packed col step = ((14+14)/2 + max(4, 0)) / 14 = 18/14.
    expect(stopOf(next, 's1', 'L3').row).toBe(0);
    expect(stopOf(next, 's1', 'L3').col).toBeCloseTo(18 / 14, 12);
  });
});

// Graft extra lone-member stops (no edges — the repack only reads the
// station layout) onto s1 of a fixture doc.
function withExtraStopsAtS1(
  base: MapDoc,
  extra: { lineId: string; row: number; col: number; orientation: StopOrientation }[],
): MapDoc {
  const lines = { ...base.lines };
  for (const e of extra) lines[e.lineId] = makeLine({ id: e.lineId, stations: ['s1'] });
  return {
    ...base,
    lines,
    lineOrder: Object.keys(lines),
    stations: {
      ...base.stations,
      s1: {
        ...base.stations.s1,
        stops: [
          ...base.stations.s1.stops,
          ...extra.map((e) =>
            makeStop(e.lineId, { row: e.row, col: e.col, orientation: e.orientation }),
          ),
        ],
      },
    },
  };
}

// Vertical twin of interlinedPairDoc: L1/L2 stops one COLUMN apart.
function interlinedVerticalPairDoc(): MapDoc {
  const stops = (): Station['stops'] => [
    makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
    makeStop('L2', { row: 0, col: 1, orientation: 'auto-vertical' }),
  ];
  return makeDoc({
    stations: [
      makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
      makeStation({ id: 's2', x: 0, y: 200, stops: stops() }),
    ],
    lines: [
      makeLine({ id: 'L1', stations: ['s1', 's2'] }),
      makeLine({ id: 'L2', stations: ['s1', 's2'] }),
    ],
  });
}

// The merge gate groups stops per station-pair BEFORE comparing them, so a
// stop from another corridor — same axis, different parallel position — can
// never block a merge. The repack's chain detection must not let such a stop
// sever a tangent chain it could never belong to.
describe('chains survive same-axis stops from other corridors', () => {
  it('a perp-interposed stop at another parallel position does not sever the chain', () => {
    const doc = withExtraStopsAtS1(interlinedPairDoc(), [
      { lineId: 'L3', row: 0.5, col: 3, orientation: 'auto-horizontal' },
    ]);
    const next = T.setLineWidth(doc, 'L1', 8);
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(1.5 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(12.5 / 14, 12);
    // The interloper itself never moves.
    expect(stopOf(next, 's1', 'L3')).toBe(doc.stations.s1.stops[2]);
    expect(buildBandGeometry(next.stations, next.lines)).toHaveLength(1);
  });

  it('a perp-TIED stop at another parallel position does not sever the chain', () => {
    // L3 shares L2's perpendicular position exactly — a par tie-break must
    // not interleave it between the tangent pair and break the walk.
    const doc = withExtraStopsAtS1(interlinedPairDoc(), [
      { lineId: 'L3', row: 1, col: 3, orientation: 'auto-horizontal' },
    ]);
    const next = T.setLineWidth(doc, 'L1', 8);
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(1.5 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(12.5 / 14, 12);
    expect(stopOf(next, 's1', 'L3')).toBe(doc.stations.s1.stops[2]);
  });

  it('vertical chains repack past a branch stop parked along the corridor', () => {
    const doc = withExtraStopsAtS1(interlinedVerticalPairDoc(), [
      { lineId: 'L3', row: -5, col: 1, orientation: 'auto-vertical' },
    ]);
    const next = T.setLineWidth(doc, 'L1', 8);
    for (const sid of ['s1', 's2']) {
      expect(stopOf(next, sid, 'L1').col).toBeCloseTo(1.5 / 14, 12);
      expect(stopOf(next, sid, 'L2').col).toBeCloseTo(12.5 / 14, 12);
    }
    expect(stopOf(next, 's1', 'L3')).toBe(doc.stations.s1.stops[2]);
    expect(buildBandGeometry(next.stations, next.lines)).toHaveLength(1);
  });

  it('an interloper never triggers a PARTIAL chain rewrite', () => {
    // Trio chain + an interloper perp-tied to its middle stop: the whole
    // trio must repack as ONE chain — a partial {middle, outer} rewrite
    // would shatter the merged 3-line band and shift the trunk sideways.
    const doc = withExtraStopsAtS1(interlinedTrioDoc(), [
      { lineId: 'L5', row: 1, col: 3, orientation: 'auto-horizontal' },
    ]);
    const next = T.setLineWidth(doc, 'L1', 8);
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(2 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(13 / 14, 12);
    expect(stopOf(next, 's1', 'L3').row).toBeCloseTo(27 / 14, 12);
    const bands = buildBandGeometry(next.stations, next.lines);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(3);
  });

  it('a second PACKED corridor on the same axis neither blocks nor joins the repack', () => {
    const doc = withExtraStopsAtS1(interlinedPairDoc(), [
      { lineId: 'L3', row: 0, col: 3, orientation: 'auto-horizontal' },
      { lineId: 'L4', row: 1, col: 3, orientation: 'auto-horizontal' },
    ]);
    const next = T.setLineWidth(doc, 'L1', 8);
    // The edited corridor repacks…
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(1.5 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(12.5 / 14, 12);
    // …while the other tangent pair holds its exact old cells: its chain
    // does not contain the edited line.
    expect(stopOf(next, 's1', 'L3')).toBe(doc.stations.s1.stops[2]);
    expect(stopOf(next, 's1', 'L4')).toBe(doc.stations.s1.stops[3]);
  });
});

describe('tolerances mirror the merge gate', () => {
  it('within-TOL slop is recognized and canonicalized to the exact new gap', () => {
    const doc = interlinedPairDoc([0, 14.3 / 14]); // gap 14.3 — merges (TOL 0.5)
    expect(buildBandGeometry(doc.stations, doc.lines)).toHaveLength(1);
    const next = T.setLineWidth(doc, 'L1', 8);
    // Old centroid 7.15 preserved, EXACT new gap 11.
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(1.65 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(12.65 / 14, 12);
    expect(buildBandGeometry(next.stations, next.lines)).toHaveLength(1);
  });

  it('slop beyond the merge tolerance is left alone', () => {
    const doc = interlinedPairDoc([0, 14.6 / 14]); // gap 14.6 — never merged
    expect(buildBandGeometry(doc.stations, doc.lines)).toHaveLength(2);
    const next = T.setLineWidth(doc, 'L1', 8);
    for (const sid of ['s1', 's2']) expect(next.stations[sid].stops).toBe(doc.stations[sid].stops);
  });
});

describe('chain arithmetic details', () => {
  it('editing an END line shifts the chain asymmetrically and keeps interior gaps exact', () => {
    const doc = interlinedTrioDoc();
    const next = T.setLineWidth(doc, 'L1', 8);
    // Old perps 0/14/28 (mean 14); new cumulative gaps [0, 11, 25] (mean 12):
    // rows 2/14, 13/14, 27/14 — the untouched L2–L3 gap stays exactly 14.
    for (const sid of ['s1', 's2']) {
      expect(stopOf(next, sid, 'L1').row).toBeCloseTo(2 / 14, 12);
      expect(stopOf(next, sid, 'L2').row).toBeCloseTo(13 / 14, 12);
      expect(stopOf(next, sid, 'L3').row).toBeCloseTo(27 / 14, 12);
    }
    const bands = buildBandGeometry(next.stations, next.lines);
    expect(bands).toHaveLength(1);
    expect([...bands[0].stripeWidths].sort((a, b) => a - b)).toEqual([8, 14, 14]);
  });

  it('the label passes through by reference when its nearest stop is off-axis', () => {
    const base = withExtraStopsAtS1(interlinedPairDoc(), [
      { lineId: 'L3', row: 0.5, col: 4, orientation: 'auto-vertical' },
    ]);
    const doc = {
      ...base,
      stations: {
        ...base.stations,
        s1: { ...base.stations.s1, label: makeLabel({ row: 0.5, col: 5 }) },
      },
    };
    const next = T.setLineWidth(doc, 'L1', 8);
    // The chain repacked…
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(1.5 / 14, 12);
    // …but the label's nearest stop (the off-axis L3) never moved, so the
    // label rides nothing — same reference.
    expect(next.stations.s1.label).toBe(doc.stations.s1.label);
    expect(stopOf(next, 's1', 'L3')).toBe(doc.stations.s1.stops[2]);
  });
});

describe('label collision dodge', () => {
  const threeLines = () => ({
    L1: makeLine({ id: 'L1' }),
    L2: makeLine({ id: 'L2' }),
    L3: makeLine({ id: 'L3' }),
  });

  it('shoves a label that rode onto another stop further along its push direction', () => {
    // Widening L1 to 70 (gap 42 = 3 whole cells) slides L2 from col 1 to
    // col 2 — exactly the label's cell. The label rides L2 (+1 col) onto
    // L3's cell at col 3, then keeps stepping to the free col 4.
    const st = makeStation({
      id: 's1',
      stops: [
        makeStop('L1', { row: 0, col: 0 }),
        makeStop('L2', { row: 0, col: 1 }),
        makeStop('L3', { row: 0, col: 3 }),
      ],
      label: makeLabel({ row: 0, col: 2 }),
    });
    const out = repackStationForWidth(st, threeLines(), 'L1', 14, 70);
    expect(out.stops[0].col).toBeCloseTo(-1, 12);
    expect(out.stops[1].col).toBeCloseTo(2, 12);
    expect(out.stops[2].col).toBe(3);
    expect(out.label.row).toBe(0);
    expect(out.label.col).toBe(4);
  });

  it('shoves an unmoved label ahead of a stop that landed on its cell', () => {
    // Same layout, but the stops array leads with L3 so the label's nearest
    // stop (tie broken by array order) is the UNMOVED L3: the label stays —
    // until L2 lands on it, then it is pushed along L2's direction past L3.
    const st = makeStation({
      id: 's1',
      stops: [
        makeStop('L3', { row: 0, col: 3 }),
        makeStop('L1', { row: 0, col: 0 }),
        makeStop('L2', { row: 0, col: 1 }),
      ],
      label: makeLabel({ row: 0, col: 2 }),
    });
    const out = repackStationForWidth(st, threeLines(), 'L1', 14, 70);
    expect(out.label.row).toBe(0);
    expect(out.label.col).toBe(4);
  });
});

// A width edit moves a stop's EDGE by Δwidth/2 while the label cell records a
// position relative to the lattice, so a label parked against the stop (the
// renderer pins it at the stop's edge + gap) would be stranded at the OLD
// width's tangency. The repack carries every ATTACHED label — within the
// shared labelAdjacencyGate of a stop of the edited line — along its approach
// octant by the edge displacement, so parked stays parked at ANY width.
describe('width edits carry attached labels with the stop edge', () => {
  const oneLine = () => ({ L1: makeLine({ id: 'L1' }) });

  it('a parked label follows a shrinking edge (single-stop station)', () => {
    // The user's "label left of the dot on a vertical line" layout. 14→13
    // moves the west edge east by 0.5; the cell follows, staying exactly
    // tangent ((6.5+7)/14).
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: 0, col: -1 }),
    });
    const out = repackStationForWidth(st, oneLine(), 'L1', 14, 13);
    expect(out.label.col).toBeCloseTo(-13.5 / 14, 12);
    expect(out.label.row).toBe(0);
    // No chain here — the stop array passes through by reference.
    expect(out.stops).toBe(st.stops);
  });

  it('a grown edge pushes the label out, and the round trip is exact', () => {
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: 0, col: -1 }),
    });
    const grown = repackStationForWidth(st, oneLine(), 'L1', 14, 20);
    expect(grown.label.col).toBeCloseTo(-17 / 14, 12); // tangent to the 20 edge
    const back = repackStationForWidth(grown, oneLine(), 'L1', 20, 14);
    expect(back.label.col).toBeCloseTo(-1, 12);
  });

  it('a detached label (beyond the gate) never moves — same station reference', () => {
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: 0, col: -3 }),
    });
    expect(repackStationForWidth(st, oneLine(), 'L1', 14, 8)).toBe(st);
  });

  it("a label attached to ANOTHER line's stop stays put — same station reference", () => {
    const st = makeStation({
      id: 's1',
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 3, orientation: 'auto-vertical' }),
      ],
      label: makeLabel({ row: 0, col: 4 }),
    });
    const lines = { L1: makeLine({ id: 'L1' }), L2: makeLine({ id: 'L2' }) };
    expect(repackStationForWidth(st, lines, 'L1', 14, 8)).toBe(st);
  });

  it('a corner-parked label carries along the 45° approach (support function)', () => {
    // Label NW of a vertical stop: the marker square's extent along the
    // diagonal approach is half·√2, so a width edit moves the pin by
    // Δhalf·√2 along NW — exactly Δhalf per axis. 14→10 pulls (−1,−1) in to
    // (−12/14, −12/14).
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: -1, col: -1 }),
    });
    const out = repackStationForWidth(st, oneLine(), 'L1', 14, 10);
    expect(out.label.col).toBeCloseTo(-12 / 14, 12);
    expect(out.label.row).toBeCloseTo(-12 / 14, 12);
  });

  it('ride and edge-carry compose into the full edge delta', () => {
    // Horizontal tangent pair; label west of L1's stop. Shrinking L1 14→8
    // moves L1's stop +1.5/14 rows (chain centroid preserved) AND pulls its
    // west edge in by 3 world units — the label follows both.
    const st = makeStation({
      id: 's1',
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
        makeStop('L2', { row: 1, col: 0, orientation: 'auto-horizontal' }),
      ],
      label: makeLabel({ row: 0, col: -1 }),
    });
    const lines = { L1: makeLine({ id: 'L1' }), L2: makeLine({ id: 'L2' }) };
    const out = repackStationForWidth(st, lines, 'L1', 14, 8);
    expect(out.label.row).toBeCloseTo(1.5 / 14, 12);
    expect(out.label.col).toBeCloseTo(-11 / 14, 12);
  });

  it('setLineWidth carries the label at every station hosting the line (the 15→13 repro)', () => {
    // Two single-stop stations with labels parked one cell west of a
    // vertical line — shrinking 15→13 lands every label at −13/14, exactly
    // where re-dragging it against the dot would.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
          label: makeLabel({ row: 0, col: -1 }),
        }),
        makeStation({
          id: 's2',
          y: 100,
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
          label: makeLabel({ row: 0, col: -1 }),
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'], width: 15 })],
    });
    const next = T.setLineWidth(doc, 'L1', 13);
    for (const sid of ['s1', 's2']) {
      expect(next.stations[sid].label.col).toBeCloseTo(-13 / 14, 12);
      expect(next.stations[sid].label.row).toBe(0);
    }
  });
});

// The interline gap widens the packed label⇄stop pitch (the ghost lattice
// parks a label at tangentGap(unit cell, stop) — the label itself is
// gapless, so the pair uses the line's gap). A gap edit therefore moves the
// packed pitch exactly like a width edit moves the edge: the carry follows
// Δgap along the approach octant — scaled by the octant's L1 length, since
// the lattice rescales per AXIS (√2 along a corner approach) — so parked
// stays parked at any gap and inside the gap-aware labelAdjacencyGate.
describe('interline-gap edits carry attached labels with the packed pitch', () => {
  const oneLine = () => ({ L1: makeLine({ id: 'L1' }) });
  // Default-width park pitch under a 4.25 gap: (7 + 7 + 4.25)/14.
  const PITCH = 18.25 / 14;

  it('a gap-parked label follows the gap back down to plain tangency', () => {
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: 0, col: -PITCH }),
    });
    const out = repackStationForSpacing(st, oneLine(), 'L1', 14, 14, 4.25, 0);
    expect(out.label.col).toBeCloseTo(-1, 12);
    expect(out.label.row).toBe(0);
    // No chain here — the stop array passes through by reference.
    expect(out.stops).toBe(st.stops);
  });

  it('a gap increase pushes the parked label out, and the round trip is exact', () => {
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: 0, col: -1 }),
    });
    const gapped = repackStationForSpacing(st, oneLine(), 'L1', 14, 14, 0, 4.25);
    expect(gapped.label.col).toBeCloseTo(-PITCH, 12);
    const back = repackStationForSpacing(gapped, oneLine(), 'L1', 14, 14, 4.25, 0);
    expect(back.label.col).toBeCloseTo(-1, 12);
  });

  it('a corner-parked label carries Δgap per axis (lattice rescale)', () => {
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: -PITCH, col: -PITCH }),
    });
    const out = repackStationForSpacing(st, oneLine(), 'L1', 14, 14, 4.25, 0);
    expect(out.label.col).toBeCloseTo(-1, 12);
    expect(out.label.row).toBeCloseTo(-1, 12);
  });

  it('width and gap deltas compose in one edit', () => {
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: 0, col: -PITCH }),
    });
    // 14→10 pulls the west edge in by 2; 4.25→0 pulls the pitch in by 4.25:
    // −18.25 + 6.25 = −12 world units.
    const out = repackStationForSpacing(st, oneLine(), 'L1', 14, 10, 4.25, 0);
    expect(out.label.col).toBeCloseTo(-12 / 14, 12);
  });

  it('a detached label (beyond the gap-aware gate) never moves — same station reference', () => {
    const st = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
      label: makeLabel({ row: 0, col: -3 }),
    });
    expect(repackStationForSpacing(st, oneLine(), 'L1', 14, 14, 4.25, 0)).toBe(st);
  });

  it("a label attached to ANOTHER line's stop stays put — same station reference", () => {
    const st = makeStation({
      id: 's1',
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 3, orientation: 'auto-vertical' }),
      ],
      label: makeLabel({ row: 0, col: 4 }),
    });
    const lines = { L1: makeLine({ id: 'L1' }), L2: makeLine({ id: 'L2' }) };
    expect(repackStationForSpacing(st, lines, 'L1', 14, 14, 0, 4.25)).toBe(st);
  });

  it('setLineInterlineGap carries the label end to end (the Plaistow-class park)', () => {
    // A label parked against the stop at the gap pitch; clearing the gap via
    // the real transform re-parks it at plain tangency.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
          label: makeLabel({ row: 0, col: -PITCH }),
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'], interlineGap: 4.25 })],
    });
    const next = T.setLineInterlineGap(doc, 'L1', 0);
    expect(next.stations.s1.label.col).toBeCloseTo(-1, 12);
  });
});
