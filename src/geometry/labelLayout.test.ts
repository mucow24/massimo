import { describe, it, expect } from 'vitest';
import { labelLayoutLocal } from './labelLayout';
import { stopCenterAt, STOP_SIZE } from './orientation';
import type { LabelValign, Rotation, Station } from '../model/types';

const HALF = STOP_SIZE / 2;
const LABEL_GAP = 3;

// Build a single-stop station whose label sits at (labelRow, labelCol) with
// the given rotation, and whose stop sits at the given grid offset from
// the label cell. Station is at world origin with no station rotation, so
// local coords == world-frame offsets.
function station({
  labelRow = 0,
  labelCol = 0,
  rotation,
  stopOffsetRow,
  stopOffsetCol,
  align = 'auto' as const,
}: {
  labelRow?: number;
  labelCol?: number;
  rotation: Rotation;
  stopOffsetRow: number;
  stopOffsetCol: number;
  align?: 'auto' | 'start' | 'middle' | 'end';
}): Station {
  return {
    id: 's',
    name: 'Foo',
    x: 0,
    y: 0,
    rotation: 0,
    stops: [
      {
        lineId: 'L1',
        row: labelRow + stopOffsetRow,
        col: labelCol + stopOffsetCol,
        orientation: 'auto-vertical',
      },
    ],
    label: { row: labelRow, col: labelCol, rotation, offset: 0, align, valign: 'middle' },
  };
}

describe('labelLayoutLocal — auto-snap', () => {
  describe('cardinal reading direction (rotation=0, "E")', () => {
    it('snaps to W cell (strict adjMinus)', () => {
      const lay = labelLayoutLocal(station({ rotation: 0, stopOffsetRow: 0, stopOffsetCol: -1 }));
      expect(lay.textAnchor).toBe('start');
      // Anchor at W edge of label cell, gapped inward.
      expect(lay.anchorX).toBeCloseTo(-HALF + LABEL_GAP, 5);
      expect(lay.anchorY).toBeCloseTo(0, 5);
    });

    it('snaps to E cell (strict adjPlus)', () => {
      const lay = labelLayoutLocal(station({ rotation: 0, stopOffsetRow: 0, stopOffsetCol: 1 }));
      expect(lay.textAnchor).toBe('end');
      expect(lay.anchorX).toBeCloseTo(HALF - LABEL_GAP, 5);
      expect(lay.anchorY).toBeCloseTo(0, 5);
    });

    it('does NOT snap to a perpendicular (N) stop', () => {
      const lay = labelLayoutLocal(station({ rotation: 0, stopOffsetRow: -1, stopOffsetCol: 0 }));
      expect(lay.textAnchor).toBe('middle');
      expect(lay.anchorX).toBeCloseTo(0, 5);
      expect(lay.anchorY).toBeCloseTo(0, 5);
    });

    it('does NOT snap to a perpendicular (S) stop', () => {
      const lay = labelLayoutLocal(station({ rotation: 0, stopOffsetRow: 1, stopOffsetCol: 0 }));
      expect(lay.textAnchor).toBe('middle');
    });

    it('snaps with diagonal SW stop (in -reading half-plane)', () => {
      const lay = labelLayoutLocal(station({ rotation: 0, stopOffsetRow: 1, stopOffsetCol: -1 }));
      expect(lay.textAnchor).toBe('start');
    });

    it('snaps with diagonal NE stop (in +reading half-plane)', () => {
      const lay = labelLayoutLocal(station({ rotation: 0, stopOffsetRow: -1, stopOffsetCol: 1 }));
      expect(lay.textAnchor).toBe('end');
    });
  });

  describe('diagonal reading direction (rotation=7, "NE")', () => {
    it('snaps to strict NE diagonal stop (existing adjPlus)', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: -1, stopOffsetCol: 1 }));
      expect(lay.textAnchor).toBe('end');
    });

    it('snaps to strict SW diagonal stop (existing adjMinus)', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: 1, stopOffsetCol: -1 }));
      expect(lay.textAnchor).toBe('start');
    });

    // The bug: a cardinal-adjacent stop W of a NE-reading label leaves the
    // snap unfired, dropping the label way out at cell-center distance.
    it('snaps to W stop (in -reading half-plane, was buggy)', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: 0, stopOffsetCol: -1 }));
      expect(lay.textAnchor).toBe('start');
    });

    it('snaps to S stop (in -reading half-plane, was buggy)', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: 1, stopOffsetCol: 0 }));
      expect(lay.textAnchor).toBe('start');
    });

    it('snaps to E stop (in +reading half-plane, was buggy)', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: 0, stopOffsetCol: 1 }));
      expect(lay.textAnchor).toBe('end');
    });

    it('snaps to N stop (in +reading half-plane, was buggy)', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: -1, stopOffsetCol: 0 }));
      expect(lay.textAnchor).toBe('end');
    });

    it('does NOT snap to perpendicular NW stop', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: -1, stopOffsetCol: -1 }));
      expect(lay.textAnchor).toBe('middle');
    });

    it('does NOT snap to perpendicular SE stop', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: 1, stopOffsetCol: 1 }));
      expect(lay.textAnchor).toBe('middle');
    });
  });

  describe('symmetric coverage across rotations', () => {
    // For each rotation, a stop that's directly along the reading direction
    // (one cardinal step "ahead") should snap to adjPlus; directly opposite
    // should snap to adjMinus.
    const cases: { rotation: Rotation; ahead: [number, number]; behind: [number, number] }[] = [
      { rotation: 0, ahead: [0, 1], behind: [0, -1] }, // E
      { rotation: 1, ahead: [1, 1], behind: [-1, -1] }, // SE
      { rotation: 2, ahead: [1, 0], behind: [-1, 0] }, // S
      { rotation: 3, ahead: [1, -1], behind: [-1, 1] }, // SW
      { rotation: 4, ahead: [0, -1], behind: [0, 1] }, // W
      { rotation: 5, ahead: [-1, -1], behind: [1, 1] }, // NW
      { rotation: 6, ahead: [-1, 0], behind: [1, 0] }, // N
      { rotation: 7, ahead: [-1, 1], behind: [1, -1] }, // NE
    ];

    for (const { rotation, ahead, behind } of cases) {
      it(`rotation ${rotation}: stop directly ahead snaps to 'end'`, () => {
        const lay = labelLayoutLocal(
          station({ rotation, stopOffsetRow: ahead[0], stopOffsetCol: ahead[1] }),
        );
        expect(lay.textAnchor).toBe('end');
      });
      it(`rotation ${rotation}: stop directly behind snaps to 'start'`, () => {
        const lay = labelLayoutLocal(
          station({ rotation, stopOffsetRow: behind[0], stopOffsetCol: behind[1] }),
        );
        expect(lay.textAnchor).toBe('start');
      });
    }
  });

  describe('diagonal-grid adjacency (cells tangent at √2/2 per axis)', () => {
    // Since the dual cardinal/diagonal grid editor (#36) landed, neighbors
    // on the diagonal grid are at (row, col) offsets of ±√2/2 rather than
    // ±1. The old strict `Chebyshev === 1` adjacency check rejected those,
    // so labels sitting one diagonal-tangent step from a stop rendered
    // unsnapped — anchor stayed at cell center, text landed on the stop.
    const D = Math.SQRT1_2;

    it('NE-reading label, SW-tangent stop on diagonal grid → snaps to start', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: D, stopOffsetCol: -D }));
      expect(lay.textAnchor).toBe('start');
    });

    it('NE-reading label, NE-tangent stop on diagonal grid → snaps to end', () => {
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: -D, stopOffsetCol: D }));
      expect(lay.textAnchor).toBe('end');
    });

    it('E-reading label, W-tangent stop on diagonal grid → snaps to start', () => {
      // Mixed case: cardinal reading dir, stop at a diagonal-tangent
      // position in the -reading half-plane.
      const lay = labelLayoutLocal(station({ rotation: 0, stopOffsetRow: D, stopOffsetCol: -D }));
      expect(lay.textAnchor).toBe('start');
    });

    it('does NOT snap to a perpendicular diagonal-tangent stop', () => {
      // NE reading, stop at NW-tangent (dot product with reading dir = 0).
      const lay = labelLayoutLocal(station({ rotation: 7, stopOffsetRow: -D, stopOffsetCol: -D }));
      expect(lay.textAnchor).toBe('middle');
    });
  });

  describe('explicit alignment overrides snap', () => {
    it('align="middle" stays middle even with adjacent stop', () => {
      const lay = labelLayoutLocal(
        station({ rotation: 0, stopOffsetRow: 0, stopOffsetCol: -1, align: 'middle' }),
      );
      expect(lay.textAnchor).toBe('middle');
      expect(lay.anchorX).toBeCloseTo(0, 5);
    });
  });

  describe('no stops (phantom dot)', () => {
    it('phantom dot east of label triggers adjPlus snap (rotation=0)', () => {
      const stationNoStops: Station = {
        id: 's',
        name: 'Foo',
        x: 0,
        y: 0,
        rotation: 0,
        stops: [],
        label: { row: 0, col: 0, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
      };
      // Phantom dot is at (label.row, label.col + 1) — directly east. The
      // existing strict-adjacency check already handled this.
      const lay = labelLayoutLocal(stationNoStops);
      expect(lay.textAnchor).toBe('end');
    });
  });
});

// Builds a station with align='middle' (so anchor stays at cell center,
// independent of stop position) and a configurable name/valign. Used for
// vertical-alignment tests that only care about the y-axis layout.
function vStation({
  name = 'Foo',
  valign,
  rotation = 0,
}: {
  name?: string;
  valign: LabelValign;
  rotation?: Rotation;
}): Station {
  return {
    id: 's',
    name,
    x: 0,
    y: 0,
    rotation: 0,
    stops: [
      // Perpendicular to any reading direction we use here; presence keeps
      // the station valid without affecting horizontal snap.
      { lineId: 'L1', row: 1, col: 0, orientation: 'auto-vertical' },
    ],
    label: { row: 0, col: 0, rotation, offset: 0, align: 'middle', valign },
  };
}

describe("labelLayoutLocal — valign='auto'", () => {
  // From labelLayout.ts: HIT_PAD=2, TEXT_HALF_H=7, LABEL_LINE_HEIGHT=14.
  const HIT_PAD = 2;
  const TEXT_HALF_H = 7;
  const LINE_HEIGHT = 14;

  it("single-line 'auto' is indistinguishable from 'middle'", () => {
    const a = labelLayoutLocal(vStation({ name: 'Foo', valign: 'auto' }));
    const m = labelLayoutLocal(vStation({ name: 'Foo', valign: 'middle' }));
    expect(a.baseline).toBe(m.baseline);
    expect(a.firstLineDy).toBe(m.firstLineDy);
    expect(a.hitX).toBeCloseTo(m.hitX, 5);
    expect(a.hitY).toBeCloseTo(m.hitY, 5);
    expect(a.hitW).toBeCloseTo(m.hitW, 5);
    expect(a.hitH).toBeCloseTo(m.hitH, 5);
    expect(a.blockTopY).toBeCloseTo(m.blockTopY, 5);
  });

  it("multi-line 'auto' keeps first line centered on the anchor (no dy shift)", () => {
    // anchor is at (0, 0) for vStation, so firstLineDy='0' + baseline='central'
    // is the SVG combination that puts the first line's center on the anchor.
    const lay = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto' }));
    expect(lay.baseline).toBe('central');
    expect(lay.firstLineDy).toBe('0');
  });

  it("multi-line 'auto' hit rect top sits at anchorY - TEXT_HALF_H regardless of line count", () => {
    // For 'auto' the first line top is at anchorY - TEXT_HALF_H and the
    // block grows downward; the hit-rect top should not move when extra
    // lines appear below.
    const oneLine = labelLayoutLocal(vStation({ name: 'Foo', valign: 'auto' }));
    const twoLines = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto' }));
    const threeLines = labelLayoutLocal(vStation({ name: 'Foo\nBar\nBaz', valign: 'auto' }));
    expect(oneLine.hitY).toBeCloseTo(-TEXT_HALF_H - HIT_PAD, 5);
    expect(twoLines.hitY).toBeCloseTo(-TEXT_HALF_H - HIT_PAD, 5);
    expect(threeLines.hitY).toBeCloseTo(-TEXT_HALF_H - HIT_PAD, 5);
    // Block heights still grow by one LINE_HEIGHT per extra line.
    expect(twoLines.hitH - oneLine.hitH).toBeCloseTo(LINE_HEIGHT, 5);
    expect(threeLines.hitH - twoLines.hitH).toBeCloseTo(LINE_HEIGHT, 5);
  });

  it("multi-line 'auto' vs 'middle' differ in hit-rect top by extraLines * LINE_HEIGHT / 2", () => {
    const a = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto' }));
    const m = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'middle' }));
    // Auto's first line sits where middle's block center would be — i.e.
    // auto's top is HIGHER (less negative) than middle's by half a line.
    expect(a.hitY - m.hitY).toBeCloseTo(LINE_HEIGHT / 2, 5);
    // Block heights are identical (same line count, same line height).
    expect(a.hitH).toBeCloseTo(m.hitH, 5);
  });

  it('blockTopY tracks the rendered text block top for each valign', () => {
    // 'auto' single-line and multi-line: blockTopY = anchorY - TEXT_HALF_H.
    const aSingle = labelLayoutLocal(vStation({ name: 'Foo', valign: 'auto' }));
    const aMulti = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto' }));
    expect(aSingle.blockTopY).toBeCloseTo(-TEXT_HALF_H, 5);
    expect(aMulti.blockTopY).toBeCloseTo(-TEXT_HALF_H, 5);
    // 'middle' multi-line: block centered on the anchor.
    const mMulti = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'middle' }));
    expect(mMulti.blockTopY).toBeCloseTo(-(2 * TEXT_HALF_H + LINE_HEIGHT) / 2, 5);
    // 'top' multi-line: block top at the anchor.
    const tMulti = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'top' }));
    expect(tMulti.blockTopY).toBeCloseTo(0, 5);
    // 'bottom' multi-line: block bottom at the anchor.
    const bMulti = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'bottom' }));
    expect(bMulti.blockTopY).toBeCloseTo(-(2 * TEXT_HALF_H + LINE_HEIGHT), 5);
  });
});

// Sanity-check the numeric anchor for the new bug-fix case so the gap is in
// the expected ballpark (i.e. text-start is near the stop, not at cell-
// center distance).
describe('labelLayoutLocal — anchor distance after fix', () => {
  it('NE-reading label with W stop puts text-start within ~12px of stop center', () => {
    const st = station({ rotation: 7, stopOffsetRow: 0, stopOffsetCol: -1 });
    const lay = labelLayoutLocal(st);
    const stopCenter = stopCenterAt(0, -1);
    const dx = lay.anchorX - stopCenter.x;
    const dy = lay.anchorY - stopCenter.y;
    const dist = Math.hypot(dx, dy);
    expect(dist).toBeLessThan(12);
    // And NOT at cell-center distance (which would indicate "no snap").
    expect(dist).toBeGreaterThan(HALF); // at least past the stop's own edge
  });
});
