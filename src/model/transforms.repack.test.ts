import { describe, expect, it } from 'vitest';
import * as T from './transforms';
import { repackStationForWidth } from './stationPacking';
import { applyStyleToItem } from './styles';
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
    const bands = buildBandGeometry(next.stations, next.lines, next.curveRadius);
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
    const bands = buildBandGeometry(next.stations, next.lines, next.curveRadius);
    expect(bands).toHaveLength(1);
    expect(bands[0].stripeWidths).toEqual([8, 8]);
  });

  it('widening keeps the pair tangent too (the fat-band case)', () => {
    const doc = interlinedPairDoc();
    const next = T.setLineWidth(doc, 'L2', 28);
    // Gap = tangentGap(14, 28) = 21, centroid preserved: rows -0.25 and 1.25.
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(-0.25, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(1.25, 12);
    expect(buildBandGeometry(next.stations, next.lines, next.curveRadius)).toHaveLength(1);
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
    expect(buildBandGeometry(next.stations, next.lines, next.curveRadius)).toHaveLength(1);
  });

  it('editing the middle line of a three-chain leaves the middle stop in place', () => {
    const doc = interlinedTrioDoc();
    const next = T.setLineWidth(doc, 'L2', 8);
    // Gaps become 11/11 around the thin middle line; the chain centroid pins
    // the middle stop exactly where it was.
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(3 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(1, 12);
    expect(stopOf(next, 's1', 'L3').row).toBeCloseTo(25 / 14, 12);
    const bands = buildBandGeometry(next.stations, next.lines, next.curveRadius);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(3);
  });

  it('non-tangent stops never move (stations pass through by reference)', () => {
    const doc = interlinedPairDoc([0, 2]); // two rows apart — not tangent
    const next = T.setLineWidth(doc, 'L1', 8);
    expect(next.lines.L1.width).toBe(8);
    expect(next.stations).toBe(doc.stations);
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
    // s1's pair is un-chained by the par mismatch and passes through by
    // reference; s2 (still tangent) repacks as usual.
    expect(next.stations.s1).toBe(shifted.stations.s1);
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
    expect(next.stations.s1).toBe(crossed.stations.s1);
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

  it('the label stays put when its nearest stop does not move', () => {
    // Label beside the MIDDLE stop: editing the middle line pins L2 in place
    // (chain centroid), so the label must not move — same reference, even.
    const base = interlinedTrioDoc();
    const doc = {
      ...base,
      stations: {
        ...base.stations,
        s1: { ...base.stations.s1, label: makeLabel({ row: 1, col: -1 }) },
      },
    };
    const next = T.setLineWidth(doc, 'L2', 8);
    expect(next.stations.s1.label).toBe(doc.stations.s1.label);
  });

  it('a chain of repacked (off-lattice) stops is still recognized by the next edit', () => {
    const doc = interlinedPairDoc();
    const thin = T.setLineWidth(T.setLineWidth(doc, 'L1', 8), 'L2', 8);
    // Now widen back out from the packed-at-8 state: gap must become 20.
    const wide = T.setLineWidth(T.setLineWidth(thin, 'L1', 20), 'L2', 20);
    const dRow = stopOf(wide, 's1', 'L2').row - stopOf(wide, 's1', 'L1').row;
    expect(dRow * 14).toBeCloseTo(20, 9);
    expect(buildBandGeometry(wide.stations, wide.lines, wide.curveRadius)).toHaveLength(1);
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
            defaultDotStyle: {
              shape: 'circle',
              fill: { day: '#000000', night: '#000000' },
              strokeWidth: 0,
              strokeColor: { day: '#000000', night: '#000000' },
              showServiceCode: false,
            },
            defaultDotSize: 8,
            width: 8,
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
    expect(buildBandGeometry(next.stations, next.lines, next.curveRadius)).toHaveLength(1);
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
    const next = T.toggleStationOnLine(doc, 'L2', 's1');
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
    const next = T.toggleStationOnLine(doc, 'L2', 's1');
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
    const next = T.toggleStationOnLine(doc, 'L3', 's1');
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
    expect(buildBandGeometry(next.stations, next.lines, next.curveRadius)).toHaveLength(1);
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
    expect(buildBandGeometry(next.stations, next.lines, next.curveRadius)).toHaveLength(1);
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
    const bands = buildBandGeometry(next.stations, next.lines, next.curveRadius);
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
    expect(buildBandGeometry(doc.stations, doc.lines, doc.curveRadius)).toHaveLength(1);
    const next = T.setLineWidth(doc, 'L1', 8);
    // Old centroid 7.15 preserved, EXACT new gap 11.
    expect(stopOf(next, 's1', 'L1').row).toBeCloseTo(1.65 / 14, 12);
    expect(stopOf(next, 's1', 'L2').row).toBeCloseTo(12.65 / 14, 12);
    expect(buildBandGeometry(next.stations, next.lines, next.curveRadius)).toHaveLength(1);
  });

  it('slop beyond the merge tolerance is left alone', () => {
    const doc = interlinedPairDoc([0, 14.6 / 14]); // gap 14.6 — never merged
    expect(buildBandGeometry(doc.stations, doc.lines, doc.curveRadius)).toHaveLength(2);
    const next = T.setLineWidth(doc, 'L1', 8);
    expect(next.stations).toBe(doc.stations);
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
    const bands = buildBandGeometry(next.stations, next.lines, next.curveRadius);
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
