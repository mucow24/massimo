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

describe("labelLayoutLocal — valign='auto-down'", () => {
  // labelLayout derives vertical metrics from the rendered font size: a line
  // is fontSize * LINE_HEIGHT (1.2) tall, and the central half-extent is half
  // of that. At the default 12px style that's 14.4 / 7.2.
  const HIT_PAD = 2;
  const TEXT_HALF_H = 7.2;
  const LINE_HEIGHT = 14.4;

  it("single-line 'auto-down' is indistinguishable from 'middle'", () => {
    const a = labelLayoutLocal(vStation({ name: 'Foo', valign: 'auto-down' }));
    const m = labelLayoutLocal(vStation({ name: 'Foo', valign: 'middle' }));
    expect(a.baseline).toBe(m.baseline);
    expect(a.firstLineDy).toBe(m.firstLineDy);
    expect(a.hitX).toBeCloseTo(m.hitX, 5);
    expect(a.hitY).toBeCloseTo(m.hitY, 5);
    expect(a.hitW).toBeCloseTo(m.hitW, 5);
    expect(a.hitH).toBeCloseTo(m.hitH, 5);
    expect(a.blockTopY).toBeCloseTo(m.blockTopY, 5);
  });

  it("multi-line 'auto-down' keeps first line centered on the anchor (no dy shift)", () => {
    // anchor is at (0, 0) for vStation, so firstLineDy='0' + baseline='central'
    // is the SVG combination that puts the first line's center on the anchor.
    const lay = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-down' }));
    expect(lay.baseline).toBe('central');
    expect(lay.firstLineDy).toBe('0');
  });

  it("multi-line 'auto-down' hit rect top sits at anchorY - TEXT_HALF_H regardless of line count", () => {
    // For 'auto-down' the first line top is at anchorY - TEXT_HALF_H and the
    // block grows downward; the hit-rect top should not move when extra
    // lines appear below.
    const oneLine = labelLayoutLocal(vStation({ name: 'Foo', valign: 'auto-down' }));
    const twoLines = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-down' }));
    const threeLines = labelLayoutLocal(vStation({ name: 'Foo\nBar\nBaz', valign: 'auto-down' }));
    expect(oneLine.hitY).toBeCloseTo(-TEXT_HALF_H - HIT_PAD, 5);
    expect(twoLines.hitY).toBeCloseTo(-TEXT_HALF_H - HIT_PAD, 5);
    expect(threeLines.hitY).toBeCloseTo(-TEXT_HALF_H - HIT_PAD, 5);
    // Block heights still grow by one LINE_HEIGHT per extra line.
    expect(twoLines.hitH - oneLine.hitH).toBeCloseTo(LINE_HEIGHT, 5);
    expect(threeLines.hitH - twoLines.hitH).toBeCloseTo(LINE_HEIGHT, 5);
  });

  it("multi-line 'auto-down' vs 'middle' differ in hit-rect top by extraLines * LINE_HEIGHT / 2", () => {
    const a = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-down' }));
    const m = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'middle' }));
    // Auto-down's first line sits where middle's block center would be —
    // i.e. auto-down's top is HIGHER (less negative) than middle's by half
    // a line.
    expect(a.hitY - m.hitY).toBeCloseTo(LINE_HEIGHT / 2, 5);
    // Block heights are identical (same line count, same line height).
    expect(a.hitH).toBeCloseTo(m.hitH, 5);
  });

  it('blockTopY tracks the rendered text block top for each valign', () => {
    // 'auto-down' single-line and multi-line: blockTopY = anchorY - TEXT_HALF_H.
    const aSingle = labelLayoutLocal(vStation({ name: 'Foo', valign: 'auto-down' }));
    const aMulti = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-down' }));
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

describe("labelLayoutLocal — valign='auto-up'", () => {
  // Vertical metrics derive from font size: line = fontSize * LINE_HEIGHT
  // (1.2), half-extent = half a line. At the default 12px style → 14.4 / 7.2.
  const HIT_PAD = 2;
  const TEXT_HALF_H = 7.2;
  const LINE_HEIGHT = 14.4;

  it("single-line 'auto-up' is indistinguishable from 'middle'", () => {
    const a = labelLayoutLocal(vStation({ name: 'Foo', valign: 'auto-up' }));
    const m = labelLayoutLocal(vStation({ name: 'Foo', valign: 'middle' }));
    expect(a.baseline).toBe(m.baseline);
    expect(a.firstLineDy).toBe(m.firstLineDy);
    expect(a.hitX).toBeCloseTo(m.hitX, 5);
    expect(a.hitY).toBeCloseTo(m.hitY, 5);
    expect(a.hitW).toBeCloseTo(m.hitW, 5);
    expect(a.hitH).toBeCloseTo(m.hitH, 5);
    expect(a.blockTopY).toBeCloseTo(m.blockTopY, 5);
  });

  it("multi-line 'auto-up' keeps the LAST line centered on the anchor (first line shifted up)", () => {
    // The first line moves UP by extraLines*LINE_HEIGHT so that line N-1
    // (which natively sits extraLines*LINE_HEIGHT below the first) lands on
    // anchorY. dy is in em, negative = upward.
    const FONT_SIZE_PX = 12;
    const lay = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-up' }));
    expect(lay.baseline).toBe('central');
    const expectedEm = (-LINE_HEIGHT / FONT_SIZE_PX).toFixed(3);
    expect(lay.firstLineDy).toBe(`${expectedEm}em`);
  });

  it("multi-line 'auto-up' hit rect BOTTOM stays put (block grows upward as lines are added)", () => {
    // Block bottom = blockTopY + blockH; for 'auto-up' that should equal
    // anchorY + TEXT_HALF_H regardless of line count. Equivalently, hitY +
    // hitH (which adds HIT_PAD to each side) is constant.
    const oneLine = labelLayoutLocal(vStation({ name: 'Foo', valign: 'auto-up' }));
    const twoLines = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-up' }));
    const threeLines = labelLayoutLocal(vStation({ name: 'Foo\nBar\nBaz', valign: 'auto-up' }));
    const oneBot = oneLine.hitY + oneLine.hitH;
    const twoBot = twoLines.hitY + twoLines.hitH;
    const threeBot = threeLines.hitY + threeLines.hitH;
    expect(oneBot).toBeCloseTo(TEXT_HALF_H + HIT_PAD, 5);
    expect(twoBot).toBeCloseTo(TEXT_HALF_H + HIT_PAD, 5);
    expect(threeBot).toBeCloseTo(TEXT_HALF_H + HIT_PAD, 5);
    // Block heights still grow by one LINE_HEIGHT per extra line.
    expect(twoLines.hitH - oneLine.hitH).toBeCloseTo(LINE_HEIGHT, 5);
    expect(threeLines.hitH - twoLines.hitH).toBeCloseTo(LINE_HEIGHT, 5);
  });

  it("multi-line 'auto-up' vs 'middle' differ in hit-rect top by -extraLines * LINE_HEIGHT / 2", () => {
    // Mirror of the auto-down case: auto-up's block top is LOWER (more
    // negative) than middle's by half a line, since auto-up adds extra
    // lines above the anchor while middle splits them above and below.
    const a = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-up' }));
    const m = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'middle' }));
    expect(a.hitY - m.hitY).toBeCloseTo(-LINE_HEIGHT / 2, 5);
    expect(a.hitH).toBeCloseTo(m.hitH, 5);
  });

  it('auto-down and auto-up are vertical mirrors around the anchor', () => {
    // For a two-line label, the block top under auto-down equals the
    // negation of the block bottom under auto-up (both measured from
    // anchorY = 0).
    const d = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-down' }));
    const u = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-up' }));
    const dBlockH = d.hitH - 2 * HIT_PAD;
    const uBlockH = u.hitH - 2 * HIT_PAD;
    const dBottom = d.blockTopY + dBlockH;
    const uBottom = u.blockTopY + uBlockH;
    // auto-down: block top = -TEXT_HALF_H (anchor at top edge of first line center).
    // auto-up:   block bot = +TEXT_HALF_H (anchor at bottom edge of last line center).
    expect(d.blockTopY).toBeCloseTo(-TEXT_HALF_H, 5);
    expect(uBottom).toBeCloseTo(TEXT_HALF_H, 5);
    // And the mirror identity: u.blockTopY === -dBottom.
    expect(u.blockTopY).toBeCloseTo(-dBottom, 5);
  });

  it("firstLineCenterY puts line 0 above the anchor for multi-line 'auto-up'", () => {
    // The bullet-rendering path reads firstLineCenterY directly. For
    // auto-up with two lines, line 0's center should sit one LINE_HEIGHT
    // above the anchor (so line 1 lands on the anchor).
    const lay = labelLayoutLocal(vStation({ name: 'Foo\nBar', valign: 'auto-up' }));
    expect(lay.firstLineCenterY).toBeCloseTo(-LINE_HEIGHT, 5);
  });
});

describe('labelLayoutLocal — label.offsetPerp', () => {
  // Anchor without any offset, for diff baselines.
  const baseline = (rotation: Rotation) =>
    labelLayoutLocal({
      ...vStation({ valign: 'middle', rotation }),
      label: {
        row: 0,
        col: 0,
        rotation,
        offset: 0,
        align: 'middle',
        valign: 'middle',
      },
    });

  const withPerp = (rotation: Rotation, perp: number) =>
    labelLayoutLocal({
      ...vStation({ valign: 'middle', rotation }),
      label: {
        row: 0,
        col: 0,
        rotation,
        offset: 0,
        offsetPerp: perp,
        align: 'middle',
        valign: 'middle',
      },
    });

  it('rotation=0 (E-reading): positive perp pushes anchor south (no x shift)', () => {
    const base = baseline(0);
    const moved = withPerp(0, 7);
    expect(moved.anchorX - base.anchorX).toBeCloseTo(0, 5);
    expect(moved.anchorY - base.anchorY).toBeCloseTo(7, 5);
  });

  it('rotation=2 (S-reading): positive perp pushes anchor west (no y shift)', () => {
    const base = baseline(2);
    const moved = withPerp(2, 7);
    expect(moved.anchorX - base.anchorX).toBeCloseTo(-7, 5);
    expect(moved.anchorY - base.anchorY).toBeCloseTo(0, 5);
  });

  it('parallel and perp offsets compose without interference', () => {
    // offset along reading is unchanged in size; perp is orthogonal — apply
    // both, expect the anchor at (offset*read + perp*perpUnit) from baseline.
    const rotation: Rotation = 1; // SE diagonal — cos=sin=√2/2
    const base = baseline(rotation);
    const both = labelLayoutLocal({
      ...vStation({ valign: 'middle', rotation }),
      label: {
        row: 0,
        col: 0,
        rotation,
        offset: 10,
        offsetPerp: 4,
        align: 'middle',
        valign: 'middle',
      },
    });
    const c = Math.cos((rotation * Math.PI) / 4);
    const s = Math.sin((rotation * Math.PI) / 4);
    const expectedDx = 10 * c + 4 * -s;
    const expectedDy = 10 * s + 4 * c;
    expect(both.anchorX - base.anchorX).toBeCloseTo(expectedDx, 5);
    expect(both.anchorY - base.anchorY).toBeCloseTo(expectedDy, 5);
  });

  it('missing offsetPerp is treated as 0 (legacy-save compatibility)', () => {
    const a = labelLayoutLocal({
      ...vStation({ valign: 'middle' }),
      label: {
        row: 0,
        col: 0,
        rotation: 0,
        offset: 0,
        align: 'middle',
        valign: 'middle',
      },
    });
    const b = labelLayoutLocal({
      ...vStation({ valign: 'middle' }),
      label: {
        row: 0,
        col: 0,
        rotation: 0,
        offset: 0,
        offsetPerp: 0,
        align: 'middle',
        valign: 'middle',
      },
    });
    expect(a.anchorX).toBeCloseTo(b.anchorX, 5);
    expect(a.anchorY).toBeCloseTo(b.anchorY, 5);
  });
});

describe('labelLayoutLocal — hit-rect width hugs the rendered glyphs', () => {
  const base = (name: string, fontSize = 12) =>
    labelLayoutLocal(
      { ...vStation({ name, valign: 'middle' }) },
      { fontSize, weight: 400, italic: false },
    );

  it('inline bullet tokens are measured as compact circles, not literal characters', () => {
    // "<C><S><T><X>" is 12 literal characters but renders as four small
    // bullets. The old per-character heuristic (len * 7) ballooned the hit
    // rect; measuring treats each token as one bullet diameter, so a line of
    // four bullets is far narrower than 12 chars of text would be.
    const bullets = base('<C><S><T><X>');
    const asChars = base('CSTXCSTXCSTX'); // same 12 characters, plain text
    expect(bullets.hitW).toBeLessThan(asChars.hitW);
  });

  it('hit-rect width scales with font size (no hard-coded 7px/char)', () => {
    const small = base('Floptropolis', 8);
    const large = base('Floptropolis', 20);
    expect(large.hitW).toBeGreaterThan(small.hitW);
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
