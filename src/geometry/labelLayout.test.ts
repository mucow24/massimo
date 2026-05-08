import { describe, it, expect } from 'vitest';
import { labelLayoutLocal } from './labelLayout';
import { stopCenterAt, STOP_SIZE } from './orientation';
import type { Rotation, Station } from '../model/types';

const HALF = STOP_SIZE / 2;
const LABEL_GAP = 5;

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
