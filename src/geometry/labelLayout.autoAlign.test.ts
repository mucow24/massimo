import { describe, it, expect } from 'vitest';
import { labelLayoutLocal, DEFAULT_LABEL_STYLE } from './labelLayout';
import { STOP_SIZE } from './orientation';
import { stopHalfOf } from '../model/lineWidth';
import type { Rotation, Station, StopOrientation } from '../model/types';

const HALF = STOP_SIZE / 2;
const LABEL_GAP = 3;

// Typographic constants pinned independently of the implementation (the
// implementation derives them from BASELINE_FRACTION/CAP_FRACTION; the test
// hardcodes the Helvetica-Neue numbers so a constant change is a deliberate
// red, not a silent drift). fontSize 12 from DEFAULT_LABEL_STYLE.
const FS = 12;
// Distance from a line's central-baseline center DOWN to the baseline
// (= fontSize * (BASELINE_FRACTION 0.8 − 0.5)).
const CB = 0.3 * FS; // 3.6
// Cap height (Helvetica Neue: 714/1000 em).
const CAP = 0.714 * FS; // 8.568
// Anchor fold-ins per vertical mode (see plan): the anchor is the first
// line's central-baseline center; these place baseline / cap line / Core
// Type Area center at the pinned target.
const HANG = CAP - CB; // +4.968 below the cap target
const CTR = CAP / 2 - CB; // +0.684 below the CTA-center target

const S2 = Math.SQRT1_2; // √2/2 — diagonal-lattice step and octant unit component

// Build a station at the origin (rotation 0, so local == world) whose label
// cell is at (0,0) with autoAlign on; stops are given as (dRow, dCol) deltas
// from the label cell with an explicit orientation (the marker's travel
// axis — it determines the marker square's extent along the approach).
function autoStation({
  stops,
  rotation = 0,
  name = 'Foo',
  align = 'auto',
  valign = 'middle',
  autoAlign = true,
  autoHAlign,
  autoVAlign,
  offset = 0,
  offsetPerp = 0,
}: {
  stops: { dRow: number; dCol: number; orientation?: StopOrientation; lineId?: string }[];
  rotation?: Rotation;
  name?: string;
  align?: 'auto' | 'start' | 'middle' | 'end';
  valign?: 'auto-down' | 'top' | 'middle' | 'bottom' | 'auto-up';
  autoAlign?: boolean;
  autoHAlign?: 'start' | 'middle' | 'end';
  autoVAlign?: 'up' | 'down';
  offset?: number;
  offsetPerp?: number;
}): Station {
  return {
    id: 's',
    name,
    x: 0,
    y: 0,
    rotation: 0,
    stops: stops.map((s, i) => ({
      lineId: s.lineId ?? `L${i + 1}`,
      row: s.dRow,
      col: s.dCol,
      orientation: s.orientation ?? 'auto-vertical',
    })),
    label: {
      row: 0,
      col: 0,
      rotation,
      offset,
      offsetPerp,
      align,
      valign,
      autoAlign,
      ...(autoHAlign ? { autoHAlign } : {}),
      ...(autoVAlign ? { autoVAlign } : {}),
    },
  };
}

// Per-line width stub: exercises the within-block alignment shift, which
// needs the ANCHOR line's advance. `lines: []` makes the implementation fall
// back to lineWidths per line.
const measureLines = (widths: number[]) => () => ({
  width: Math.max(...widths),
  height: FS * 1.2 * widths.length,
  lineCount: widths.length,
  lineWidths: widths,
  lines: [],
});

describe('labelLayoutLocal — autoAlign octant table', () => {
  // Cardinal octants against a straight line through the stop. The pinned
  // typographic target sits (marker extent + LABEL_GAP) from the stop
  // center along the approach; default extent = HALF = 7, so gap g = 10.

  it('E of a vertical-line stop: start-aligned, Core Type Area centered on the stop row', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] }),
    );
    expect(lay.textAnchor).toBe('start');
    // Text begins at the stop's east edge + gap: −14 + (7+3) = −4.
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP, 6);
    // CTA-center pinned on the stop's row (0) ⇒ anchor sits CTR below it.
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
    expect(lay.baseline).toBe('central');
  });

  it('W of a vertical-line stop: end-aligned, CTA centered', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: 1, orientation: 'auto-vertical' }] }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('N of a horizontal-line stop: centered, baseline sits LABEL_GAP above the marker top', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }] }),
    );
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
    // Baseline target = stop row 14 − (7+3) = 4; anchor = target − CB = 0.4.
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB, 6);
    // The baseline itself lands 3px above the marker's top edge (at 14−7=7).
    expect(lay.anchorY + CB).toBeCloseTo(7 - LABEL_GAP + 0, 6);
  });

  it('S of a horizontal-line stop: centered, cap line hangs LABEL_GAP below the marker bottom', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: -1, dCol: 0, orientation: 'auto-horizontal' }] }),
    );
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
    // Cap target = −14 + (7+3) = −4; anchor = target + HANG = 0.968.
    expect(lay.anchorY).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP + HANG, 6);
  });

  // Diagonal octants against a 45° line (diagonal-lattice neighbor at
  // ±√2/2, marker rotated to the line): the CTA corner facing the stop pins
  // at (HALF + LABEL_GAP) = 10 from the stop center along the perpendicular,
  // i.e. (10·√2/2) per axis from the stop at radius 14·√2/2·√2 … = 9.899.

  const dPin = STOP_SIZE * S2 - (HALF + LABEL_GAP) * S2; // 9.899… − 7.071… = 2.828…

  it('NW of a NE–SW line stop: end-aligned, sits on its bottom-right baseline corner', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: S2, dCol: S2, orientation: 'auto-ne-sw' }] }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(dPin, 6);
    expect(lay.anchorY).toBeCloseTo(dPin - CB, 6);
  });

  it('SE of a NE–SW line stop: start-aligned, hangs from its top-left cap corner', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: -S2, dCol: -S2, orientation: 'auto-ne-sw' }] }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-dPin, 6);
    expect(lay.anchorY).toBeCloseTo(-dPin + HANG, 6);
  });

  it('NE of a NW–SE line stop: start-aligned, sits on its bottom-left baseline corner', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }] }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-dPin, 6);
    expect(lay.anchorY).toBeCloseTo(dPin - CB, 6);
  });

  it('SW of a NW–SE line stop: end-aligned, hangs from its top-right cap corner', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: -S2, dCol: S2, orientation: 'auto-nw-se' }] }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(dPin, 6);
    expect(lay.anchorY).toBeCloseTo(-dPin + HANG, 6);
  });
});

describe('labelLayoutLocal — autoAlign centers over interline rows (legacy end-snapped)', () => {
  it('label above a 3-stop horizontal row: centered on the stop below, not end-snapped', () => {
    // Legacy 'auto' sees the (1,1) stop in the reading half-plane and
    // returns textAnchor 'end' — the bug this mode exists to fix.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: -1, orientation: 'auto-horizontal' },
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal' },
          { dRow: 1, dCol: 1, orientation: 'auto-horizontal' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB, 6);
  });

  it('label at the east end of a horizontal row: reads away, CTA centered', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 0, dCol: -1, orientation: 'auto-horizontal' },
          { dRow: 0, dCol: -2, orientation: 'auto-horizontal' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP, 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });
});

describe('labelLayoutLocal — autoAlign marker extent (support function)', () => {
  it('corner-adjacent stop on a CARDINAL line: clears the axis-aligned square by LABEL_GAP diagonally', () => {
    // Full-cell diagonal neighbor (1,1) whose marker square is axis-aligned
    // (horizontal line): extent along the 45° approach is HALF·√2, so the
    // corner pins at (HALF·√2 + LABEL_GAP)·√2/2 per axis from the stop.
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 1, dCol: 1, orientation: 'auto-horizontal' }] }),
    );
    const perAxis = STOP_SIZE - (HALF * Math.SQRT2 + LABEL_GAP) * S2; // ≈ 4.8787
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(perAxis, 6);
    expect(lay.anchorY).toBeCloseTo(perAxis - CB, 6);
  });

  it('beside a DIAGONAL-line stop: clears the rotated square’s full horizontal extent', () => {
    // A rotated marker square reaches HALF·√2 ≈ 9.9 horizontally; the text
    // must start beyond that + gap (legacy used flat HALF+3 and clipped it).
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: 1, orientation: 'auto-ne-sw' }] }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF * Math.SQRT2 + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('wide line: gap uses the stop’s own half-extent', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: 1, orientation: 'auto-vertical', lineId: 'L1' }] }),
      DEFAULT_LABEL_STYLE,
      undefined,
      stopHalfOf({ L1: { width: 28 } }),
    );
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (14 + LABEL_GAP), 6); // = -3
  });
});

describe('labelLayoutLocal — autoAlign rotation covariance', () => {
  it('rotation 2 (S-reading) beside-stop case = rotation-0 case rotated 90°', () => {
    // Rotation-0 oracle: stop (0,1) auto-vertical ⇒ anchor (4, CTR), 'end'.
    // Rotate the whole config 90° CW: stop (1,0) auto-horizontal, reading S.
    const lay = labelLayoutLocal(
      autoStation({
        rotation: 2,
        stops: [{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }],
      }),
    );
    expect(lay.textAnchor).toBe('end');
    // (4, CTR) rotated 90° CW (y-down): (x, y) → (−y, x).
    expect(lay.anchorX).toBeCloseTo(-CTR, 6);
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP), 6);
  });

  it('rotation 7 (NE-reading) beside-stop case = rotation-0 case rotated −45°', () => {
    // Same oracle rotated −45°: stop at lattice (−√2/2, √2/2), axis NW–SE.
    const lay = labelLayoutLocal(
      autoStation({
        rotation: 7,
        stops: [{ dRow: -S2, dCol: S2, orientation: 'auto-nw-se' }],
      }),
    );
    expect(lay.textAnchor).toBe('end');
    const g = STOP_SIZE - (HALF + LABEL_GAP); // 4, the reading-frame anchor
    // (g, CTR) rotated −45° (y-down): x' = g·c + CTR·s, y' = −g·s + CTR·c, c=s=√2/2.
    expect(lay.anchorX).toBeCloseTo((g + CTR) * S2, 6);
    expect(lay.anchorY).toBeCloseTo((-g + CTR) * S2, 6);
  });
});

describe('labelLayoutLocal — autoAlign tie-breaking and fallbacks', () => {
  it('equidistant stops above and below: prefers sitting above the lower stop', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal' },
          { dRow: -1, dCol: 0, orientation: 'auto-horizontal' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB, 6); // sit, not hang
  });

  it('no stop within the adjacency gate: first line CTA-centered on the cell, grows down', () => {
    // A dragged-away label keeps first-line anchoring — the top line stays
    // where the user put the cell as more lines are added (align-down),
    // instead of the whole block re-centering around it.
    const lay = labelLayoutLocal(autoStation({ name: 'A\nB\nC', stops: [{ dRow: 0, dCol: 3 }] }));
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
    expect(lay.firstLineDyPx).toBeCloseTo(0, 6);
    expect(lay.blockTopY).toBeCloseTo(CTR - 7.2, 6);
  });

  it('a stop exactly on the label cell gives no direction: same first-line fallback', () => {
    const lay = labelLayoutLocal(autoStation({ stops: [{ dRow: 0, dCol: 0 }] }));
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('stopless station: phantom east dot ⇒ end-aligned at the legacy anchor, CTA centered', () => {
    const lay = labelLayoutLocal(autoStation({ stops: [] }));
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP), 6); // 4, as legacy
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });
});

describe('labelLayoutLocal — autoAlign multi-line blocks', () => {
  // 3-line name: extraLines = 2, lineStack = 12·1.2 = 14.4, textHalfH = 7.2.

  it('sit mode grows the block upward (last line pinned)', () => {
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB\nC',
        stops: [{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }],
      }),
    );
    const anchorY = STOP_SIZE - (HALF + LABEL_GAP) - CB; // 0.4
    expect(lay.anchorY).toBeCloseTo(anchorY, 6);
    expect(lay.firstLineDyPx).toBeCloseTo(-2 * 14.4, 6);
    expect(lay.blockTopY).toBeCloseTo(anchorY - 7.2 - 2 * 14.4, 6);
  });

  it('hang mode grows the block downward (first line pinned)', () => {
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB\nC',
        stops: [{ dRow: -1, dCol: 0, orientation: 'auto-horizontal' }],
      }),
    );
    const anchorY = -STOP_SIZE + HALF + LABEL_GAP + HANG; // 0.968
    expect(lay.anchorY).toBeCloseTo(anchorY, 6);
    expect(lay.firstLineDyPx).toBeCloseTo(0, 6);
    expect(lay.blockTopY).toBeCloseTo(anchorY - 7.2, 6);
  });

  it('SW corner (below-left): the TOP line hangs from the pinned corner, later lines below', () => {
    // Multi-line below the marker anchors by its top line — the line nearest
    // the station — never the bottom one.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB\nC',
        stops: [{ dRow: -S2, dCol: S2, orientation: 'auto-nw-se' }],
      }),
    );
    const dPin = STOP_SIZE * S2 - (HALF + LABEL_GAP) * S2;
    const anchorY = -dPin + HANG;
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorY).toBeCloseTo(anchorY, 6);
    // First (top) line pinned: no first-line shift, block grows down.
    expect(lay.firstLineDyPx).toBeCloseTo(0, 6);
    expect(lay.blockTopY).toBeCloseTo(anchorY - 7.2, 6);
  });

  it('beside mode pins the FIRST line CTA on the stop row; extra lines grow down', () => {
    // NOT block-centered: the first line reads level with the dot and the
    // rest stack below it (align-down), so adding lines never moves the
    // line that sits level with the station.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB\nC',
        stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }],
      }),
    );
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
    expect(lay.firstLineDyPx).toBeCloseTo(0, 6);
    expect(lay.blockTopY).toBeCloseTo(CTR - 7.2, 6);
  });
});

describe('labelLayoutLocal — autoAlign overrides and offsets', () => {
  it('ignores explicit align/valign while on', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 0, dCol: 1, orientation: 'auto-vertical' }],
        align: 'start',
        valign: 'top',
      }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
    expect(lay.baseline).toBe('central'); // not 'text-before-edge'
  });

  it('offset / offsetPerp still apply on top', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }],
        offset: 5,
        offsetPerp: -2,
      }),
    );
    expect(lay.anchorX).toBeCloseTo(5, 6);
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB - 2, 6);
  });
});

describe('labelLayoutLocal — autoAlign H/V overrides', () => {
  // autoVAlign picks WHICH line is the anchor line ('down' = top line,
  // 'up' = bottom line); the octant still supplies the pin and the
  // typographic edge (baseline / cap / CTA-center). autoHAlign re-aligns the
  // lines WITHIN the block while the anchor line stays pinned — so both are
  // inert for single-line labels. Absent = octant-derived (existing rules).

  const dPin = STOP_SIZE * S2 - (HALF + LABEL_GAP) * S2; // 2.828…

  it("V 'down' on a sit octant anchors the TOP line's baseline instead of the bottom's", () => {
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB\nC',
        stops: [{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }],
        autoVAlign: 'down',
      }),
    );
    const anchorY = STOP_SIZE - (HALF + LABEL_GAP) - CB; // fold unchanged
    expect(lay.anchorY).toBeCloseTo(anchorY, 6);
    // First line pinned, block grows down (default sit shifts up 2 stacks).
    expect(lay.firstLineDyPx).toBeCloseTo(0, 6);
    expect(lay.blockTopY).toBeCloseTo(anchorY - 7.2, 6);
  });

  it("V 'up' on a hang octant anchors the BOTTOM line's cap, block grows up", () => {
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB\nC',
        stops: [{ dRow: -1, dCol: 0, orientation: 'auto-horizontal' }],
        autoVAlign: 'up',
      }),
    );
    const anchorY = -STOP_SIZE + HALF + LABEL_GAP + HANG; // fold unchanged
    expect(lay.anchorY).toBeCloseTo(anchorY, 6);
    expect(lay.firstLineDyPx).toBeCloseTo(-2 * 14.4, 6);
    expect(lay.blockTopY).toBeCloseTo(anchorY - 7.2 - 2 * 14.4, 6);
  });

  it("V 'up' beside a stop centers the LAST line's CTA on the stop row", () => {
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB\nC',
        stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }],
        autoVAlign: 'up',
      }),
    );
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
    expect(lay.firstLineDyPx).toBeCloseTo(-2 * 14.4, 6);
  });

  it("H 'end' re-aligns lines within the block; the anchor line's pinned edge stays put", () => {
    // NE octant defaults to 'start' + sit ('up': anchor line = LAST, w=40).
    // Forcing 'end' right-aligns the block, and anchorX slides by the
    // anchor line's width so its left edge stays at the pin.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'Longest Name\nBB',
        stops: [{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }],
        autoHAlign: 'end',
      }),
      DEFAULT_LABEL_STYLE,
      measureLines([100, 40]),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(-dPin + 40, 6);
  });

  it("the screenshot case: NE octant + V 'down' + H 'end' pins the NAME, bullets tuck under its right end", () => {
    // First line (the name, w=100) anchors at the NE pin by its baseline;
    // the second line right-aligns under the name's right edge and hangs
    // below, toward the free side.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'Snuggle Point\n|E| |S|',
        stops: [{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }],
        autoVAlign: 'down',
        autoHAlign: 'end',
      }),
      DEFAULT_LABEL_STYLE,
      measureLines([100, 40]),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(-dPin + 100, 6); // name's left edge at the pin
    expect(lay.anchorY).toBeCloseTo(dPin - CB, 6); // name's baseline on the pin
    expect(lay.firstLineDyPx).toBeCloseTo(0, 6); // grows down
  });

  it("H 'start' on a centered octant keeps the anchor line centered on the dot", () => {
    // N octant defaults to 'middle'; forcing 'start' left-aligns the block
    // and anchorX slides half the anchor line's width left so that line
    // stays centered over the stop.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'Wide Line\nBB',
        stops: [{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }],
        autoHAlign: 'start',
      }),
      DEFAULT_LABEL_STYLE,
      measureLines([100, 40]),
    );
    expect(lay.textAnchor).toBe('start');
    // Default V for sit = 'up' → anchor line is the LAST line (w=40).
    expect(lay.anchorX).toBeCloseTo(-40 / 2, 6);
  });

  it('H matching the derived value is a no-op', () => {
    const base = labelLayoutLocal(
      autoStation({
        name: 'Longest Name\nBB',
        stops: [{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }],
      }),
      DEFAULT_LABEL_STYLE,
      measureLines([100, 40]),
    );
    const forced = labelLayoutLocal(
      autoStation({
        name: 'Longest Name\nBB',
        stops: [{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }],
        autoHAlign: 'start',
      }),
      DEFAULT_LABEL_STYLE,
      measureLines([100, 40]),
    );
    expect(forced).toEqual(base);
  });

  it('a single-line label keeps its exact span under an H override', () => {
    // E octant: text begins at the stop edge + gap (−4). Forcing 'end'
    // shifts anchorX by the full line width, so the glyphs occupy the same
    // pixels — the control only matters once a second line exists.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }],
        autoHAlign: 'end',
      }),
      DEFAULT_LABEL_STYLE,
      measureLines([80]),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP + 80, 6);
  });

  it('overrides also steer the no-adjacent-stop fallback', () => {
    // Fallback defaults: middle + first-line ('down'). Forcing 'end' keeps
    // the anchor line (first, w=100) centered on the cell while the block
    // right-aligns to its right edge.
    const lay = labelLayoutLocal(
      autoStation({ name: 'Wide Line\nBB', stops: [{ dRow: 0, dCol: 3 }], autoHAlign: 'end' }),
      DEFAULT_LABEL_STYLE,
      measureLines([100, 40]),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(100 / 2, 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('overrides are ignored while autoAlign is off', () => {
    const plain = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 0, dCol: 1, orientation: 'auto-vertical' }],
        autoAlign: false,
      }),
      DEFAULT_LABEL_STYLE,
      measureLines([100, 40]),
    );
    const withOverrides = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 0, dCol: 1, orientation: 'auto-vertical' }],
        autoAlign: false,
        autoHAlign: 'end',
        autoVAlign: 'down',
      }),
      DEFAULT_LABEL_STYLE,
      measureLines([100, 40]),
    );
    expect(withOverrides).toEqual(plain);
  });
});
