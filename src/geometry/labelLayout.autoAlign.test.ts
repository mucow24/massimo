import { describe, it, expect } from 'vitest';
import { labelLayoutLocal, DEFAULT_LABEL_STYLE, type StopMetrics } from './labelLayout';
import type { StopMetricsFn } from './labelLayout';
import { STOP_SIZE } from './orientation';
import type { Rotation, Station, StopCell, StopOrientation } from '../model/types';

const HALF = STOP_SIZE / 2;
const LABEL_GAP = 3;

/**
 * A `StopMetricsFn` from explicit per-field overrides — constant, or per stop.
 * These tests pin the GEOMETRY (which obstacle moves the pin how far), so they
 * state the obstacles outright; `stopMetrics.test.ts` pins the other half, that
 * a real line/dot-style/transfer resolves to these numbers.
 */
const metrics = (
  over: Partial<StopMetrics> | ((stop: StopCell) => Partial<StopMetrics>) = {},
): StopMetricsFn => {
  return (_station, stop) => ({
    half: HALF,
    gap: 0,
    dash: null,
    dot: null,
    transfers: [],
    labelGap: LABEL_GAP,
    continues: { plus: true, minus: true },
    ...(typeof over === 'function' ? over(stop) : over),
  });
};

// Typographic constants pinned independently of the implementation (the
// implementation derives them from BASELINE_FRACTION/CAP_FRACTION; the test
// hardcodes the Helvetica-Neue numbers so a constant change is a deliberate
// red, not a silent drift). fontSize 12 from DEFAULT_LABEL_STYLE.
const FS = 12;
// Distance from a line's central-baseline center DOWN to the baseline
// (= fontSize * (BASELINE_FRACTION 0.8 − 0.5)).
const CB = 0.3 * FS; // 3.6
// Cap height (Söhne: sCapHeight 718/1000 em).
const CAP = 0.718 * FS; // 8.616
// Anchor fold-ins per vertical mode (see plan): the anchor is the first
// line's central-baseline center; these place baseline / cap line / Core
// Type Area center at the pinned target.
const HANG = CAP - CB; // +4.968 below the cap target
const CTR = CAP / 2 - CB; // +0.684 below the CTA-center target
// The deepest-ink drop below the baseline (= fontSize * (1 − BASELINE_FRACTION
// 0.8)). Above-side pins charge HALF of it, scaled by the vertical share of the
// approach — the deliberate compromise between clearing a "g" outright and the
// too-airy look full clearance gave real maps. Name-independent either way, so
// every above-side baseline stays level.
const DESC = 0.2 * FS; // 2.4

const S2 = Math.SQRT1_2; // √2/2 — diagonal-lattice step and octant unit component

// The above-side charge per approach: straight above (vertical share 1) and
// 45° corner (vertical share √2/2).
const DESC_N = DESC / 2; // 1.2
const DESC_DIAG = (DESC / 2) * S2; // 0.848…

// Build a station at the origin (rotation 0, so local == world) whose label
// cell is at (0,0) with autoAlign on; stops are given as (dRow, dCol) deltas
// from the label cell with an explicit orientation (the marker's travel
// axis — it determines the marker square's extent along the approach).
function autoStation({
  stops,
  rotation = 0,
  stationRotation = 0,
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
  stationRotation?: Rotation;
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
    rotation: stationRotation,
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

describe('labelLayoutLocal — autoAlign clears the dash tick', () => {
  // Every stop reports a TfL tick of the default derived dimensions
  // (length 14 = one line width, thickness 7). The pin must clear the tick's
  // support extent along the approach — not just the marker square.
  const DASH = { length: 14, width: 7 };
  const withTick = metrics({ dash: DASH });

  it('E of a dashed vertical stop: the pin clears the tick tip', () => {
    const st = autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] });
    const lay = labelLayoutLocal(st, undefined, undefined, withTick);
    // Tick reaches HALF + length = 21 east of the stop center; text begins
    // LABEL_GAP past the tip: −14 + (21 + 3) = +10 (vs −4 without the tick).
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + (HALF + DASH.length + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('along the travel axis the tick is beside the approach — pin unchanged', () => {
    // Label S of a vertical-line stop: the tick points sideways (tie ⇒ west),
    // so only its thin cross-section matters and the marker square dominates.
    const stops = [{ dRow: -1, dCol: 0, orientation: 'auto-vertical' as const }];
    const base = labelLayoutLocal(autoStation({ stops }));
    const dashed = labelLayoutLocal(autoStation({ stops }), undefined, undefined, withTick);
    expect(dashed.anchorX).toBeCloseTo(base.anchorX, 6);
    expect(dashed.anchorY).toBeCloseTo(base.anchorY, 6);
  });

  it('offsets that park the label on the far side leave the pin tick-free (tick points away)', () => {
    // Label cell E of the stop, but offset −30 carries the painted anchor
    // west across the line. The octant still reads E (cells), the tick flips
    // W (offset-aware side), so the E-approach clearance is the plain marker
    // square — no cycle, no phantom clearance.
    const stops = [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' as const }];
    const base = labelLayoutLocal(autoStation({ stops, offset: -30 }));
    const dashed = labelLayoutLocal(
      autoStation({ stops, offset: -30 }),
      undefined,
      undefined,
      withTick,
    );
    expect(dashed.anchorX).toBeCloseTo(base.anchorX, 6);
    expect(dashed.anchorY).toBeCloseTo(base.anchorY, 6);
  });

  it('a diagonal approach clears the tick corner via its support function', () => {
    // Label NE of a dashed vertical stop (stop SW of the label): tick points
    // E. Along u = NE the tick support is (HALF+L)·√2/2 + (t/2)·√2/2 = 24.5·√2/2,
    // vs the square's 7·√2 — the pin moves out by exactly (24.5−14)·½ = 5.25
    // on each axis.
    const stops = [{ dRow: 1, dCol: -1, orientation: 'auto-vertical' as const }];
    const base = labelLayoutLocal(autoStation({ stops }));
    const dashed = labelLayoutLocal(autoStation({ stops }), undefined, undefined, withTick);
    expect(dashed.anchorX - base.anchorX).toBeCloseTo(5.25, 6);
    expect(dashed.anchorY - base.anchorY).toBeCloseTo(-5.25, 6);
  });

  it('a waypoint station never ticks — the lookup is neutralized (matches the renderer)', () => {
    // StationDots' waypoint override replaces every stop style with the
    // overlay circle, so no tick is ever painted for a waypoint (hidden or
    // revealed). The pin must not clear a phantom tick.
    const stops = [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' as const }];
    const wp = (s: Station): Station => ({ ...s, isWaypoint: true });
    const base = labelLayoutLocal(wp(autoStation({ stops })));
    const dashed = labelLayoutLocal(wp(autoStation({ stops })), undefined, undefined, withTick);
    expect(dashed.anchorX).toBeCloseTo(base.anchorX, 6);
    expect(dashed.anchorY).toBeCloseTo(base.anchorY, 6);
  });

  it('non-dash stops are unaffected by the lookup being present', () => {
    const stops = [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' as const }];
    const base = labelLayoutLocal(autoStation({ stops }));
    const withLookup = labelLayoutLocal(autoStation({ stops }), undefined, undefined, metrics());
    expect(withLookup.anchorX).toBeCloseTo(base.anchorX, 6);
    expect(withLookup.anchorY).toBeCloseTo(base.anchorY, 6);
  });
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
    // Baseline target = stop row 14 − (7+3) = 4, lifted by the half-descender
    // charge; the anchor a further CB above that.
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N, 6);
    // The DEEPEST ink may dip the other half-descender into the gap — the
    // deliberate dial (ink keeps 1.8 of LABEL_GAP's 3 here).
    expect(lay.anchorY + CB + DESC).toBeCloseTo(7 - LABEL_GAP + DESC_N, 6);
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
    expect(lay.anchorY).toBeCloseTo(dPin - CB - DESC_DIAG, 6);
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
    expect(lay.anchorY).toBeCloseTo(dPin - CB - DESC_DIAG, 6);
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
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N, 6);
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
    expect(lay.anchorY).toBeCloseTo(perAxis - CB - DESC_DIAG, 6);
  });

  it('beside a DIAGONAL-line stop: clears the stripe at the text corner, not just the CTA row', () => {
    // A rotated marker square reaches HALF·√2 ≈ 9.9 horizontally at the CTA
    // row — but a NE–SW stripe advances toward a west-side label by one unit
    // per unit BELOW the row, so the tight point is the text's baseline-side
    // corner: the slant eats CAP/2 + half a descender more (the descender at
    // the same half weight the above octants charge).
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: 1, orientation: 'auto-ne-sw' }] }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(
      STOP_SIZE - (HALF * Math.SQRT2 + CAP / 2 + DESC / 2 + LABEL_GAP),
      6,
    );
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('wide line: gap uses the stop’s own half-extent', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: 1, orientation: 'auto-vertical', lineId: 'L1' }] }),
      DEFAULT_LABEL_STYLE,
      undefined,
      metrics({ half: 28 / 2 }),
    );
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (14 + LABEL_GAP), 6); // = -3
  });
});

describe('labelLayoutLocal — per-stop labelGap drives every pin', () => {
  // The gap rides the LINE, not the label (Line.labelGap, default 3), so a
  // row of labels along one corridor stays consistent by construction. Each
  // pin reads the gap of the stop that blocks it.

  it('beside: the text starts the stop line’s own gap past the marker edge', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] }),
      undefined,
      undefined,
      metrics({ labelGap: 6 }),
    );
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + 6, 6);
  });

  it('above: the baseline target rides the gap too', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }] }),
      undefined,
      undefined,
      metrics({ labelGap: 6 }),
    );
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + 6) - CB - DESC_N, 6);
  });

  it('at a crossing, each axis reads the gap of the line that blocks it', () => {
    // Own line keeps the default 3 (perpendicular axis / baseline); the
    // crossing line carries 8 (reading axis / the butt).
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
      undefined,
      undefined,
      metrics((stop) => (stop.lineId === 'L2' ? { labelGap: 8 } : {})),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF + 8), 6);
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N, 6);
  });

  it('the legacy align:"auto" stop-relative clamp honors it', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }],
        autoAlign: false,
        align: 'auto',
      }),
      undefined,
      undefined,
      metrics({ labelGap: 6 }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + 6, 6);
  });
});

describe('labelLayoutLocal — beside a diagonal line, the slant advances into the text', () => {
  // A beside pin clears the stripe along the CTA-center row, but the text is
  // a BLOCK — half a cap tall each side, plus stacked lines — and a stripe at
  // 45° to the reading axis advances toward the label by one unit per unit of
  // that height. Without the window term the near corner kept LABEL_GAP −
  // CAP/2 of clearance: negative at any font size ≥ 8.4 (the FURTA "label
  // left of a NW–SE line touches it" bug). The window charges the descender
  // at HALF weight on the baseline side, the same dial the above octants use.
  const LINE_STACK = 14.4; // FS · LINE_HEIGHT (leading 1)

  it('E of a NW–SE stop: the stripe rises under the text — baseline-corner window', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-nw-se' }] }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(
      -STOP_SIZE + HALF * Math.SQRT2 + CAP / 2 + DESC / 2 + LABEL_GAP,
      6,
    );
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('W of a NW–SE stop: the stripe drops over the text — cap-corner window, no descender', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: 1, orientation: 'auto-nw-se' }] }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF * Math.SQRT2 + CAP / 2 + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('extra lines growing INTO the slant widen the window', () => {
    // E of NW–SE grows down (auto-down default) and down is the advancing
    // side, so the second line pushes the whole block out by one line stack.
    const lay = labelLayoutLocal(
      autoStation({ name: 'A\nB', stops: [{ dRow: 0, dCol: -1, orientation: 'auto-nw-se' }] }),
    );
    expect(lay.anchorX).toBeCloseTo(
      -STOP_SIZE + HALF * Math.SQRT2 + CAP / 2 + DESC / 2 + LINE_STACK + LABEL_GAP,
      6,
    );
  });

  it('extra lines growing AWAY from the slant leave the pin alone', () => {
    // W of NW–SE: the advancing side is UP, the block grows DOWN — same pin
    // as the single-line case whatever the line count.
    const lay = labelLayoutLocal(
      autoStation({ name: 'A\nB', stops: [{ dRow: 0, dCol: 1, orientation: 'auto-nw-se' }] }),
    );
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF * Math.SQRT2 + CAP / 2 + LABEL_GAP), 6);
  });

  it("autoVAlign 'up' flips which side the block grows onto, and the window follows", () => {
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB',
        stops: [{ dRow: 0, dCol: 1, orientation: 'auto-nw-se' }],
        autoVAlign: 'up',
      }),
    );
    expect(lay.anchorX).toBeCloseTo(
      STOP_SIZE - (HALF * Math.SQRT2 + CAP / 2 + LINE_STACK + LABEL_GAP),
      6,
    );
  });

  it('the slant charges only when the stripe CONTINUES on the side being cleared', () => {
    // The window models line body running past the marker on the axis half the
    // approach leans toward. At a terminus facing the other way there is
    // nothing there (the Yipping bug: label E of a NW–SE terminus whose line
    // leaves NW sat ~4 units too far out) — the finite marker square is then
    // the honest obstacle. E of NW–SE needs the SE (+axis) half:
    const stops = [{ dRow: 0, dCol: -1, orientation: 'auto-nw-se' as const }];
    const nwOnly = labelLayoutLocal(
      autoStation({ stops }),
      undefined,
      undefined,
      metrics({ continues: { plus: false, minus: true } }),
    );
    expect(nwOnly.anchorX).toBeCloseTo(-STOP_SIZE + HALF * Math.SQRT2 + LABEL_GAP, 6);
    const seOnly = labelLayoutLocal(
      autoStation({ stops }),
      undefined,
      undefined,
      metrics({ continues: { plus: true, minus: false } }),
    );
    expect(seOnly.anchorX).toBeCloseTo(
      -STOP_SIZE + HALF * Math.SQRT2 + CAP / 2 + DESC / 2 + LABEL_GAP,
      6,
    );
  });

  it('the W-side mirror needs the NW (−axis) half', () => {
    const stops = [{ dRow: 0, dCol: 1, orientation: 'auto-nw-se' as const }];
    const seOnly = labelLayoutLocal(
      autoStation({ stops }),
      undefined,
      undefined,
      metrics({ continues: { plus: true, minus: false } }),
    );
    expect(seOnly.anchorX).toBeCloseTo(STOP_SIZE - (HALF * Math.SQRT2 + LABEL_GAP), 6);
    const nwOnly = labelLayoutLocal(
      autoStation({ stops }),
      undefined,
      undefined,
      metrics({ continues: { plus: false, minus: true } }),
    );
    expect(nwOnly.anchorX).toBeCloseTo(STOP_SIZE - (HALF * Math.SQRT2 + CAP / 2 + LABEL_GAP), 6);
  });

  it('a wide dot still joins by MAX and can out-reach the slanted stripe', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-nw-se' }] }),
      undefined,
      undefined,
      metrics({ dot: { r: 20, shape: 'circle' } }),
    );
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + 20 + LABEL_GAP, 6);
  });

  it('a rotated label sees the slant in ITS reading frame: NE-reading beside a vertical line', () => {
    // Rotation 1 label with a vertical-line stop ahead of reading: in the
    // reading frame the stripe is diagonal, so this IS the W-of-diagonal case
    // — cap-side window — rotated back out.
    const lay = labelLayoutLocal(
      autoStation({
        rotation: 1,
        stops: [{ dRow: S2, dCol: S2, orientation: 'auto-vertical' }],
      }),
    );
    expect(lay.textAnchor).toBe('end');
    const aR = STOP_SIZE - (HALF * Math.SQRT2 + CAP / 2 + LABEL_GAP);
    // (aR, CTR) rotated by +45° (y-down): x = (aR − CTR)·√2/2, y = (aR + CTR)·√2/2.
    expect(lay.anchorX).toBeCloseTo((aR - CTR) * S2, 6);
    expect(lay.anchorY).toBeCloseTo((aR + CTR) * S2, 6);
  });
});

describe('labelLayoutLocal — narrow stops keep the 1-cell adjacency gate', () => {
  it('label one cell beside a vertical stop stays end-snapped when the line narrows', () => {
    // Shrink repro: label parked one cell west of a vertical stop while the
    // line was ≥ default width, line then narrowed to 13. The tangency gate
    // (6.5+7)/14 ≈ 0.964 would exclude the stop and the label jumps to the
    // centered fallback — the gate must floor at the historical 1-cell.
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: 1, orientation: 'auto-vertical', lineId: 'L1' }] }),
      DEFAULT_LABEL_STYLE,
      undefined,
      metrics({ half: 13 / 2 }),
    );
    expect(lay.textAnchor).toBe('end');
    // The pin stays stop-relative: text ends LABEL_GAP west of the 6.5 edge.
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (6.5 + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('a label parked tangent to a slightly-wider line (14.75) survives a shrink to 13', () => {
    // The gate recognizes tangency-parks with the same 0.5-world tolerance
    // (BAND_MERGE_TOL) the band machinery uses: this label was dragged
    // against the dot while the line was 14.75 wide (cell ≈ 1.0268), and the
    // line has since shrunk to 13.
    const parked = (7.375 + HALF) / STOP_SIZE;
    const lay = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 0, dCol: parked, orientation: 'auto-vertical', lineId: 'L1' }],
      }),
      DEFAULT_LABEL_STYLE,
      undefined,
      metrics({ half: 13 / 2 }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(parked * STOP_SIZE - (6.5 + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('a label parked tangent to a 5px stop survives a shrink to 4.75px', () => {
    // Dragging a label against a dot parks the cell at the CURRENT tangency
    // ((2.5+7)/14 for 5px), so any later shrink used to detach it.
    const tangent5 = (2.5 + HALF) / STOP_SIZE;
    const lay = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 0, dCol: tangent5, orientation: 'auto-vertical', lineId: 'L1' }],
      }),
      DEFAULT_LABEL_STYLE,
      undefined,
      metrics({ half: 4.75 / 2 }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(tangent5 * STOP_SIZE - (2.375 + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });
});

describe('labelLayoutLocal — autoAlign across an interline gap', () => {
  // The ghost lattice parks a label against a gapped line at the PACKED
  // pitch — tangency plus the pair's interline gap (the label itself is
  // gapless, so the stop's own gap decides). The adjacency gate must accept
  // those parks, or the exact slot the station editor offers renders as the
  // detached centered fallback and the text slides over the dot (the
  // Plaistow regression: gap 4.25 ⇒ pitch 18.25/14 ≈ 1.304, past the
  // width-only gate ≈ 1.036).
  const GAP = 4.25;
  const PITCH = (STOP_SIZE + GAP) / STOP_SIZE; // default-width park: 18.25/14
  const gapped = metrics({ gap: GAP });

  it('E of a vertical stop at the gap pitch: still pinned start-anchored at the marker edge', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -PITCH, orientation: 'auto-vertical' }] }),
      undefined,
      undefined,
      gapped,
    );
    expect(lay.textAnchor).toBe('start');
    // The pin stays stop-relative (marker edge + LABEL_GAP): the gap widens
    // only the GATE, not the painted clearance — empty space, not body.
    expect(lay.anchorX).toBeCloseTo(-PITCH * STOP_SIZE + (HALF + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('without a gap the same distance stays detached (no blanket widening)', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -PITCH, orientation: 'auto-vertical' }] }),
    );
    expect(lay.textAnchor).toBe('middle'); // centered fallback — by design
  });

  it('the Plaistow field repro: crossing gap-packed stops, S-reading label right of the lower dot', () => {
    // Faithful cell geometry from the bug report (station rotation stripped —
    // labelLayoutLocal works in the unrotated local frame): label reads S
    // (rotation 2); the horizontal-line stop sits PITCH behind the reading
    // direction, the vertical-line stop PITCH behind and PITCH beside. The
    // nearer horizontal stop wins as reference and the text starts at its
    // edge — the regression centered it on the label cell, over the dot.
    const lay = labelLayoutLocal(
      autoStation({
        rotation: 2,
        stops: [
          { dRow: -PITCH, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: -PITCH, dCol: PITCH, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
      undefined,
      undefined,
      gapped,
    );
    expect(lay.textAnchor).toBe('start');
    // Reading-frame S: the pin sits (HALF + LABEL_GAP) past the horizontal
    // stop's edge along reading — local y = −PITCH·14 + 7 + 3.
    expect(lay.anchorY).toBeCloseTo(-PITCH * STOP_SIZE + (HALF + LABEL_GAP), 6);
    expect(lay.anchorX).toBeCloseTo(-CTR, 6);
  });

  it('the legacy align:"auto" snap recognizes the gap pitch too', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [{ dRow: 0, dCol: -PITCH, orientation: 'auto-vertical' }],
        autoAlign: false,
        align: 'auto',
      }),
      undefined,
      undefined,
      gapped,
    );
    expect(lay.textAnchor).toBe('start');
    // Stop-relative clamp: text begins HALF + LABEL_GAP past the stop center.
    expect(lay.anchorX).toBeCloseTo(-PITCH * STOP_SIZE + (HALF + LABEL_GAP), 6);
  });
});

describe('labelLayoutLocal — autoAlign at a crossing (cross station)', () => {
  // A cross packs the crossing line's stop BESIDE the stop the label belongs
  // to, in the same cell row. The label parks squarely across the line from
  // its own stop (octant 2/6 ⇒ 'middle'), which straddles the crossing
  // stripe. The text must butt up to that stripe instead — while the
  // baseline keeps its LABEL_GAP off the line it labels, so a row of labels
  // along that line stays level.
  const SIT = STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N; // −0.8 — the plain-N anchorY
  const HANG_Y = -STOP_SIZE + HALF + LABEL_GAP + HANG; // 0.968 — the plain-S one

  it('crossing stop to the EAST: text ends at its edge, baseline unchanged', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP), 6); // 4
    expect(lay.anchorY).toBeCloseTo(SIT, 6);
  });

  it('crossing stop to the WEST: text starts at its edge', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: -1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP, 6); // −4
    expect(lay.anchorY).toBeCloseTo(SIT, 6);
  });

  it('mirror case below the line: hangs from the cap, still butted to the stripe', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: -1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: -1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(HANG_Y, 6);
  });

  it('a wider crossing line pushes the text along READING only, never off its line', () => {
    // The whole point of measuring each axis against the stop that blocks it:
    // the crossing stripe's width moves the text sideways, the baseline stays
    // level with the rest of the labels on the horizontal line.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
      DEFAULT_LABEL_STYLE,
      undefined,
      metrics((stop) => ({ half: stop.lineId === 'L2' ? STOP_SIZE : HALF })),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (STOP_SIZE + LABEL_GAP), 6); // −3
    expect(lay.anchorY).toBeCloseTo(SIT, 6);
  });

  it("the crossing stop's dash tick points AT the label, and the text clears it", () => {
    // A crossing dash stop ticks perpendicular to its own travel axis — i.e.
    // straight down the reading axis at the label. The reading-axis pin has
    // to clear the tick tip, not just the stripe.
    const DASH = { length: 14, width: 7 };
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
      undefined,
      undefined,
      metrics((stop) => (stop.lineId === 'L2' ? { dash: DASH } : {})),
    );
    expect(lay.textAnchor).toBe('end');
    // Tick reaches HALF + length = 21 west of the crossing stop's center.
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF + DASH.length + LABEL_GAP), 6); // −10
    expect(lay.anchorY).toBeCloseTo(SIT, 6); // its own stop is tickless: unchanged
  });

  it('boxed in on BOTH sides: stays centered on its own stop', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
          { dRow: 1, dCol: -1, orientation: 'auto-vertical', lineId: 'L3' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
    expect(lay.anchorY).toBeCloseTo(SIT, 6);
  });

  it('a PARALLEL neighbour is not a crossing: centered as before', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
  });

  it('rotation 2 (S-reading) cross = the rotation-0 cross rotated 90°', () => {
    // Oracle: 'end' at (4, SIT). Rotate the config 90° CW (y-down:
    // (x, y) → (−y, x)); cells rotate row′ = col, col′ = −row.
    const lay = labelLayoutLocal(
      autoStation({
        rotation: 2,
        stops: [
          { dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: 1, dCol: -1, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(-SIT, 6);
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP), 6);
  });
});

describe('labelLayoutLocal — autoAlign beside a stop beats centering over it', () => {
  // The other very common interchange park: the label sits in the CORNER of a
  // cross — one stop beside it (the crossing line's), one below it (its own
  // line's). Centering on the stop below runs the text straight through the
  // stop beside, so the beside stop takes the anchor instead.
  const SIT = STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N; // −0.8 — the plain-N anchorY

  it('a stop below AND one to the west: reads east off the west marker, not centered', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP, 6); // −4
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('the east mirror: reads west off the east marker', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 0, dCol: 1, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP), 6); // 4
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('the stop ABOVE mirror already preferred beside, and still does', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: -1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP, 6);
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('a beside stop the text does not tie with still takes it: a WIDE line packed 1.5 cells out', () => {
    // Not a tie-break: the below stop is strictly nearer (1 vs 1.5 cells) and
    // still loses, because centering on it is what puts the text over the
    // wide marker. The pin is stop-relative, so the text starts at the wide
    // stripe's own east edge.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 0, dCol: -1.5, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
      DEFAULT_LABEL_STYLE,
      undefined,
      metrics((stop) => ({ half: stop.lineId === 'L1' ? STOP_SIZE : HALF })),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-1.5 * STOP_SIZE + STOP_SIZE + LABEL_GAP, 6); // −4
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });

  it('boxed in on BOTH sides: no side to escape to, stays centered', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: 0, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L3' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
    expect(lay.anchorY).toBeCloseTo(SIT, 6);
  });

  it('a beside stop OUTSIDE the adjacency gate is not in the way: stays centered', () => {
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 0, dCol: -2, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('middle');
    expect(lay.anchorX).toBeCloseTo(0, 6);
    expect(lay.anchorY).toBeCloseTo(SIT, 6);
  });

  // One line stack (fontSize 12 × LINE_HEIGHT 1.2), the step extra lines take.
  const STACK = FS * 1.2;

  it('a two-line name stacks AWAY from the stop below, not into it', () => {
    // The whole point of the re-anchor is to dodge a marker; growing the block
    // into the OTHER one would just trade which stop the text lands on. The
    // bottom line takes the beside pin and earlier lines lift off it.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'Foo\nBar',
        stops: [
          { dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.firstLineDyPx).toBeCloseTo(-STACK, 6);
    // The LAST line lands exactly where a single-line name would, so a name
    // gaining a line never moves the line that reads level with the dot.
    expect(lay.firstLineCenterY + STACK).toBeCloseTo(CTR, 6);
    // ...and its deepest ink still clears the stripe below (top edge at 7).
    expect(lay.firstLineCenterY + STACK + CB + DESC).toBeLessThan(STOP_SIZE - HALF);
  });

  it('the stop ABOVE mirror keeps growing DOWN, away from that one', () => {
    const lay = labelLayoutLocal(
      autoStation({
        name: 'Foo\nBar',
        stops: [
          { dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: -1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.firstLineDyPx).toBeCloseTo(0, 6);
    expect(lay.firstLineCenterY).toBeCloseTo(CTR, 6);
  });

  it('a plain beside label (no stop below) still grows DOWN', () => {
    const lay = labelLayoutLocal(
      autoStation({
        name: 'Foo\nBar',
        stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L1' }],
      }),
    );
    expect(lay.firstLineDyPx).toBeCloseTo(0, 6);
  });

  it('the ink window follows the stacking side, not the default one', () => {
    // The window is what the pin clears, so it must span the ink that actually
    // exists. A NE–SW stripe's edge advances as it goes UP — exactly where a
    // corner-park block stacks — so the extra line is a real charge. Measured
    // against the DOWN side (the ordinary beside default) the same stripe has
    // retreated and the line costs nothing, leaving the text on it.
    const at = (name: string) =>
      labelLayoutLocal(
        autoStation({
          name,
          stops: [
            { dRow: 0, dCol: -1, orientation: 'auto-ne-sw', lineId: 'L1' },
            { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
          ],
        }),
      ).anchorX;
    // Single line: the stripe edge at the block's cap-top corner.
    expect(at('Foo')).toBeCloseTo(-STOP_SIZE + (HALF * Math.SQRT2 + CAP / 2) + LABEL_GAP, 6);
    // Two lines stacking UP: the corner moves a whole line-stack higher, where
    // the edge has advanced that much further east.
    expect(at('Foo\nBar')).toBeCloseTo(
      -STOP_SIZE + (HALF * Math.SQRT2 + CAP / 2 + STACK) + LABEL_GAP,
      6,
    );
  });

  it('rotation 2 (S-reading) corner = the rotation-0 corner rotated 90°', () => {
    // Oracle: 'start' at (−4, CTR). Rotate the config 90° CW (y-down:
    // (x, y) → (−y, x)); cells rotate row′ = col, col′ = −row.
    const lay = labelLayoutLocal(
      autoStation({
        rotation: 2,
        stops: [
          { dRow: -1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-CTR, 6);
    expect(lay.anchorY).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP, 6);
  });
});

describe('labelLayoutLocal — autoAlign at a DIAGONAL crossing', () => {
  // The butt measures the crossing stripe where the TEXT is, not on the stop
  // row: the block sits wholly above/below the row, and a 45° stripe has
  // slanted one unit sideways per unit of that height by then. The block's
  // nearest ink corner pins at the crossing labelGap off the slanted edge —
  // pulled INWARD when the stripe retreats from the text, pushed OUT when it
  // advances over it. Same window model as the beside octants, same
  // half-descender charge on the ink bottom.
  const SIT = STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N;
  const HANG_Y = -STOP_SIZE + HALF + LABEL_GAP + HANG;
  const RISE = HALF * Math.SQRT2; // a 45° stripe's row-level support along reading
  const LINE_STACK = 14.4; // FS · LINE_HEIGHT (leading 1)
  // The charged ink sits HALF + LABEL_GAP off the row on either side (the
  // above pin already folds the half-descender; the below cap hangs there).
  const NEAR = HALF + LABEL_GAP;

  it('above the line, stripe slanting AWAY: the ink-bottom corner pulls the text inward', () => {
    // Crossing NW–SE stop to the WEST: above the row its stripe retreats
    // west, so at the ink bottom the east edge sits NEAR short of the
    // row-level RISE and the text starts that much closer to the crossing.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: -1, orientation: 'auto-nw-se', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + (RISE - NEAR) + LABEL_GAP, 6);
    expect(lay.anchorY).toBeCloseTo(SIT, 6); // baseline stays level with its row
  });

  it('above the line, stripe slanting TOWARD: the ink-top corner pushes the text out', () => {
    // Same cross with the OTHER diagonal (NE–SW): above the row the stripe
    // advances east over the text, and the top corner — a cap and the
    // half-descender charge beyond NEAR — is what has to clear. The row-level
    // ray under-clears here: this is the overlapping mirror case.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: -1, orientation: 'auto-ne-sw', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + RISE + (NEAR + DESC_N + CAP) + LABEL_GAP, 6);
    expect(lay.anchorY).toBeCloseTo(SIT, 6);
  });

  it('below-the-line mirror: hanging text pulls inward the same way', () => {
    // Crossing NW–SE stop to the EAST, label hanging below: below the row
    // that stripe retreats east, and the ink TOP (the hanging cap line at
    // NEAR) is the binding corner.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: -1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: -1, dCol: 1, orientation: 'auto-nw-se', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (RISE - NEAR) - LABEL_GAP, 6);
    expect(lay.anchorY).toBeCloseTo(HANG_Y, 6);
  });

  it('extra lines stacking AWAY from the row leave a retreating pin alone', () => {
    // Below-label lines grow further down, where the stripe has retreated
    // even further: the binding corner stays the hanging cap line.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB',
        stops: [
          { dRow: -1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: -1, dCol: 1, orientation: 'auto-nw-se', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (RISE - NEAR) - LABEL_GAP, 6);
  });

  it('extra lines stacking INTO an advancing stripe widen the window', () => {
    // Above-label lines stack upward, into the NE–SW stripe's advance: the
    // second line moves the binding top corner a line stack further out.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB',
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: -1, orientation: 'auto-ne-sw', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.anchorX).toBeCloseTo(
      -STOP_SIZE + RISE + (NEAR + DESC_N + CAP + LINE_STACK) + LABEL_GAP,
      6,
    );
  });

  it('the slant reads only stripe body that CONTINUES toward the text side', () => {
    // A crossing line terminating at the shared station paints no stripe on
    // the text's half of its axis: the row-level support is then the honest
    // obstacle — no credit, no charge. The above-west NW–SE credit lives on
    // the NW (−axis) half; the NE–SW charge on the NE (+axis) half.
    const stops = [
      { dRow: 1, dCol: 0, orientation: 'auto-horizontal' as const, lineId: 'L1' },
      { dRow: 1, dCol: -1, orientation: 'auto-nw-se' as const, lineId: 'L2' },
    ];
    const seOnly = labelLayoutLocal(
      autoStation({ stops }),
      undefined,
      undefined,
      metrics((stop) => (stop.lineId === 'L2' ? { continues: { plus: true, minus: false } } : {})),
    );
    expect(seOnly.anchorX).toBeCloseTo(-STOP_SIZE + RISE + LABEL_GAP, 6);
    const neSw = [{ ...stops[0] }, { ...stops[1], orientation: 'auto-ne-sw' as const }];
    const swOnly = labelLayoutLocal(
      autoStation({ stops: neSw }),
      undefined,
      undefined,
      metrics((stop) => (stop.lineId === 'L2' ? { continues: { plus: false, minus: true } } : {})),
    );
    expect(swOnly.anchorX).toBeCloseTo(-STOP_SIZE + RISE + LABEL_GAP, 6);
  });

  it('a perpendicular crossing is untouched: the row-level support IS the stripe', () => {
    // The vertical-cross butt (every existing cross test) must not move: a
    // stripe perpendicular to reading has no slant, whatever the window.
    const lay = labelLayoutLocal(
      autoStation({
        name: 'A\nB',
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
    );
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP), 6);
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
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N, 6); // sit, not hang
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
    const anchorY = STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N; // −0.8
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
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N - 2, 6);
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
    const anchorY = STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N; // fold unchanged
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
    expect(lay.anchorY).toBeCloseTo(dPin - CB - DESC_DIAG, 6); // name's baseline at the charged pin
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

describe('labelLayoutLocal — autoAlign clears the stop DOT', () => {
  // A dot is not a subset of its stripe: a service-code disc sizes itself for
  // legibility, and any dot size is settable, so a dot routinely reaches past a
  // narrow line. Every obstacle at the stop joins by MAX along the approach.

  // Distance from the stop CENTER to the pinned typographic edge, per axis, for
  // a 45° approach — the same "across and up/down an even amount" the corner
  // octants place by.
  const diagReach = (extent: number) => S2 * (extent + LABEL_GAP);

  it('a dot wider than the stripe drives the pin; a narrower one changes nothing', () => {
    const stops = [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' as const }];
    const big = labelLayoutLocal(
      autoStation({ stops }),
      undefined,
      undefined,
      metrics({ dot: { r: 10, shape: 'circle' } }),
    );
    // Text begins at the DOT's east edge + gap: −14 + (10 + 3) = −1.
    expect(big.anchorX).toBeCloseTo(-STOP_SIZE + 10 + LABEL_GAP, 6);

    const small = labelLayoutLocal(
      autoStation({ stops }),
      undefined,
      undefined,
      metrics({ dot: { r: 4, shape: 'circle' } }),
    );
    // Stripe half 7 still wins, so this is the plain beside pin.
    expect(small.anchorX).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP, 6);
  });

  it('a circle is isotropic — the same clearance cardinally and diagonally', () => {
    const R = 10;
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }] }),
      undefined,
      undefined,
      metrics({ dot: { r: R, shape: 'circle' } }),
    );
    const stop = { x: -S2 * STOP_SIZE, y: S2 * STOP_SIZE };
    expect(lay.anchorX - stop.x).toBeCloseTo(diagReach(R), 6);
    // Above octant: the baseline sits the corner charge above the pin.
    expect(lay.anchorY + CB + DESC_DIAG - stop.y).toBeCloseTo(-diagReach(R), 6);
  });

  it('a square reaches √2 FURTHER on the diagonal than a circle of the same r', () => {
    const R = 10;
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }] }),
      undefined,
      undefined,
      metrics({ dot: { r: R, shape: 'square' } }),
    );
    const stop = { x: -S2 * STOP_SIZE, y: S2 * STOP_SIZE };
    expect(lay.anchorX - stop.x).toBeCloseTo(diagReach(R * Math.SQRT2), 6);
  });

  it('a diamond reaches √2 LESS on the diagonal — the opposite of a square', () => {
    // Which direction a polygon dot is narrow in flips with the shape, so one
    // circumscribing radius would over-clear one of the two by √2.
    const R = 14;
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }] }),
      undefined,
      undefined,
      metrics({ dot: { r: R, shape: 'diamond' } }),
    );
    const stop = { x: -S2 * STOP_SIZE, y: S2 * STOP_SIZE };
    expect(lay.anchorX - stop.x).toBeCloseTo(diagReach(R * S2), 6);
  });

  it('a square dot is exactly as wide as a circle on a CARDINAL approach', () => {
    const R = 10;
    const at = (shape: 'circle' | 'square') =>
      labelLayoutLocal(
        autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] }),
        undefined,
        undefined,
        metrics({ dot: { r: R, shape } }),
      ).anchorX;
    expect(at('square')).toBeCloseTo(at('circle'), 6);
  });

  it('a waypoint paints no dot of its own, so its pin clears none', () => {
    // Same rule the tick already follows: hidden it paints nothing, revealed the
    // overlay replaces every style with a fixed circle — so layout must not shift
    // with the Show-waypoints toggle.
    const stops = [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' as const }];
    const wp = (s: Station): Station => ({ ...s, isWaypoint: true });
    const lay = labelLayoutLocal(
      wp(autoStation({ stops })),
      undefined,
      undefined,
      metrics({ dot: { r: 10, shape: 'circle' } }),
    );
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + HALF + LABEL_GAP, 6);
  });
});

describe('labelLayoutLocal — autoAlign clears a TRANSFER cap', () => {
  // A transfer is a round-capped capsule: at the stop it ends in a disc of its
  // half-width — often fatter than the line it lands on — and its BODY leaves
  // toward the other end, which is what the `dir`-carrying cases below pin.

  it('a fat transfer stub pushes the text out', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] }),
      undefined,
      undefined,
      metrics({ transfers: [{ r: 12, dir: null }] }),
    );
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + 12 + LABEL_GAP, 6);
  });

  it('joins the dot by MAX, not by sum', () => {
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] }),
      undefined,
      undefined,
      metrics({ dot: { r: 10, shape: 'circle' }, transfers: [{ r: 6, dir: null }] }),
    );
    expect(lay.anchorX).toBeCloseTo(-STOP_SIZE + 10 + LABEL_GAP, 6);
  });

  it('a transfer on the CROSSING stop butts the text to its cap', () => {
    // The crossing re-anchor measures the reading axis against the stop that
    // actually blocks it, so a fat transfer there moves the text sideways while
    // the baseline stays level with the rest of its own line's labels.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
      undefined,
      undefined,
      metrics((stop) => (stop.lineId === 'L2' ? { transfers: [{ r: 11, dir: null }] } : {})),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (11 + LABEL_GAP), 6);
    expect(lay.anchorY).toBeCloseTo(STOP_SIZE - (HALF + LABEL_GAP) - CB - DESC_N, 6);
  });
});

describe('labelLayoutLocal — a transfer BODY leaning into the approach', () => {
  // The disc is only the capsule's END. A transfer leaving the stop at an
  // angle passes UNDER the approach, and its straight side reaches r/sin θ
  // along it — √2·r at 45°, the corner a thick transfer closes off between two
  // stops of a cross. Measured over the text's ink window, exactly like a
  // diagonal stripe's, and floored at r: the cap is always there.
  const R = 12;
  const SE = { x: S2, y: S2 };
  const besideR = (dir: { x: number; y: number } | null) =>
    labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] }),
      undefined,
      undefined,
      metrics({ transfers: [{ r: R, dir }] }),
    ).anchorX +
    STOP_SIZE -
    LABEL_GAP; // the reach the pin cleared, back out of the anchor

  it('leaving SE under an east-reading label: the ink BOTTOM corner binds', () => {
    // The edge advances east by 1 per unit down (45°), so the window's lowest
    // ink — the half-descender below the CTA — is the corner that must clear.
    expect(besideR(SE)).toBeCloseTo(R * Math.SQRT2 + CAP / 2 + DESC / 2, 6);
  });

  it('leaving NE instead: the mirror corner binds — the ink TOP, half a descender nearer', () => {
    // The window straddles the stop's row, so a body slanting either way leans
    // into one of its corners; only WHICH corner changes. The top one sits
    // closer to the row (no descender hangs off it), so this charges less.
    expect(besideR({ x: S2, y: -S2 })).toBeCloseTo(R * Math.SQRT2 + CAP / 2, 6);
    expect(besideR({ x: S2, y: -S2 })).toBeCloseTo(besideR(SE) - DESC / 2, 6);
  });

  it('leaving SW — away from the label — is just the cap, not the edge line', () => {
    // The edge LINE still crosses the approach at √2·r, but the body does not
    // live there: it is behind the cap. Charging it would push every label off
    // a transfer that runs the other way.
    expect(besideR({ x: -S2, y: S2 })).toBeCloseTo(R, 6);
  });

  it('a transfer running straight at the label has no slant, so the cap stands', () => {
    expect(besideR({ x: 1, y: 0 })).toBeCloseTo(R, 6);
  });

  it('no direction (an end this lookup cannot resolve) keeps the plain disc', () => {
    expect(besideR(null)).toBeCloseTo(R, 6);
  });

  it('two transfers on one stop: the DEEPEST reach wins, each measured its own way', () => {
    // Not "largest r then a direction": a slim slanted transfer can out-reach a
    // fatter square-on one.
    const lay = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] }),
      undefined,
      undefined,
      metrics({
        transfers: [
          { r: 12, dir: null },
          { r: 6, dir: SE },
        ],
      }),
    );
    expect(lay.anchorX).toBeCloseTo(
      -STOP_SIZE + (6 * Math.SQRT2 + CAP / 2 + DESC / 2) + LABEL_GAP,
      6,
    );
  });

  it('at a crossing butt the reach is measured on the stop ROW, no ink window', () => {
    // Octant 6 pins the block's middle, not a corner: the reading axis butts
    // against the crossing stop's capsule at row level, where a 45° body
    // reaches exactly √2·r.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L1' },
          { dRow: 1, dCol: 1, orientation: 'auto-vertical', lineId: 'L2' },
        ],
      }),
      undefined,
      undefined,
      metrics((stop) =>
        stop.lineId === 'L2' ? { transfers: [{ r: 11, dir: { x: -S2, y: S2 } }] } : {},
      ),
    );
    expect(lay.textAnchor).toBe('end');
    expect(lay.anchorX).toBeCloseTo(STOP_SIZE - (11 * Math.SQRT2 + LABEL_GAP), 6);
  });

  it('the corner repro: the label reads off the stop the transfer leaves, clearing its body', () => {
    // Screenshot 3 — a thick transfer runs SE from the vertical line's stop to
    // the horizontal line's stop below the label, closing off the corner the
    // label parks in. The corner re-anchor puts the text beside the vertical
    // stop; the capsule then pushes it clear of the diagonal.
    const lay = labelLayoutLocal(
      autoStation({
        stops: [
          { dRow: 0, dCol: -1, orientation: 'auto-vertical', lineId: 'L1' },
          { dRow: 1, dCol: 0, orientation: 'auto-horizontal', lineId: 'L2' },
        ],
      }),
      undefined,
      undefined,
      metrics((stop) => (stop.lineId === 'L1' ? { transfers: [{ r: R, dir: SE }] } : {})),
    );
    expect(lay.textAnchor).toBe('start');
    expect(lay.anchorX).toBeCloseTo(
      -STOP_SIZE + (R * Math.SQRT2 + CAP / 2 + DESC / 2) + LABEL_GAP,
      6,
    );
    expect(lay.anchorY).toBeCloseTo(CTR, 6);
  });
});

describe('labelLayoutLocal — a polygon dot is axis-aligned in the WORLD frame', () => {
  // StationDots paints real dots at `stopPosWorld` inside an UNTRANSFORMED <g>
  // — only the phantom drag preview sits in the station-rotated group. So a
  // square or diamond dot keeps its edges square to the WORLD on a rotated
  // station, unlike the stripe (which rotates with its travel axis). The
  // support has to be evaluated in that frame or every odd station rotation is
  // wrong by √2, in opposite directions for the two shapes.
  const R = 10;
  // Station rotation 1 = 45°, so a label reading E in the station's local frame
  // approaches the dot along a 45° WORLD direction.
  const at = (shape: 'circle' | 'square' | 'diamond') =>
    labelLayoutLocal(
      autoStation({
        stationRotation: 1,
        stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }],
      }),
      undefined,
      undefined,
      metrics({ dot: { r: R, shape } }),
    ).anchorX;

  it('a square is widest across its diagonals, so a 45° station APPROACH sees r·√2', () => {
    expect(at('square')).toBeCloseTo(-STOP_SIZE + R * Math.SQRT2 + LABEL_GAP, 6);
  });

  it('a diamond is narrowest across its diagonals, so the same approach sees only r/√2', () => {
    // Stripe half 7 still loses to 10/√2 ≈ 7.07, so the dot is what is measured.
    expect(at('diamond')).toBeCloseTo(-STOP_SIZE + R * S2 + LABEL_GAP, 6);
  });

  it('a circle is isotropic, so station rotation cannot change its clearance', () => {
    const unrotated = labelLayoutLocal(
      autoStation({ stops: [{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }] }),
      undefined,
      undefined,
      metrics({ dot: { r: R, shape: 'circle' } }),
    ).anchorX;
    expect(at('circle')).toBeCloseTo(unrotated, 6);
  });
});
