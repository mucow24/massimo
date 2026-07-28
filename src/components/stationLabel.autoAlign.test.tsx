import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import type { Rotation, StopOrientation } from '../model/types';
import { makeLabel, makeStation, makeStop } from '../test/fixtures';
import { STOP_SIZE } from '../geometry/orientation';
import { CAP_FRACTION, DESCENDER_FRACTION } from '../geometry/textMeasure';

/**
 * The magic wand's typography, measured on the PAINTED glyphs.
 *
 * `labelLayout.autoAlign.test.ts` pins the model (anchor + textAnchor + valign);
 * `StationView.test.tsx` pins model-baseline == painted-baseline for a plain
 * (wand-off) label. Nothing crossed both, so the one number the transitmap.net
 * rules are actually about — where the ink sits relative to the marker — was
 * only ever asserted one hop away from the ink. That hop is exactly what #361
 * and #363 moved: the renderer used to paint through `dominant-baseline`, whose
 * real offset Chrome derives from platform font metrics, so every pin below was
 * silently off by ~0.4 world units on Windows and ~-0.5 on macOS.
 *
 * These tests therefore read the `<text>` element's own alphabetic baseline and
 * compare it against targets derived from the marker and the Core Type Area
 * alone — never from `labelLayoutLocal`. The four tutorials:
 *   https://transitmap.net/label-horizontal-vertical/
 *   https://transitmap.net/labels-45-degrees/
 *   https://transitmap.net/angled-labels/
 *   https://transitmap.net/labels-crossing/
 */

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
});

const FS = 12; // DEFAULT_DOC label size
const HALF = STOP_SIZE / 2; // marker half-extent, 7
const GAP = 3; // LABEL_GAP
// The Core Type Area: baseline up to cap height. The whole vertical model.
const CTA = CAP_FRACTION * FS;
// How far the deepest ink drops below the baseline. The CTA stops AT the
// baseline, so this is the part of the label the tutorials' alignment rules
// don't describe — and the part that would otherwise reach into the route line.
const DESC = DESCENDER_FRACTION * FS;
const S2 = Math.SQRT1_2;

type StopSpec = { dRow: number; dCol: number; orientation: StopOrientation };

/**
 * Render one wand-aligned station and report where its glyphs actually landed,
 * in station-local units relative to the label cell (which sits at the station
 * origin here, so local == the numbers the tutorials talk about).
 *
 * `<text>`'s `y` IS the alphabetic baseline and its `x` the pen origin, but both
 * live in the label's UNROTATED frame — the renderer spins the group about the
 * anchor. So the rotation is undone here, and an angled label is measured on the
 * same map the reader sees rather than in its own reading frame.
 */
function paintedLabel(stops: StopSpec[], labelRotation: Rotation = 0) {
  const station = makeStation({
    id: 's1',
    name: 'Foo',
    x: 0,
    y: 0,
    stops: stops.map((s, i) =>
      makeStop(`L${i + 1}`, { row: s.dRow, col: s.dCol, orientation: s.orientation }),
    ),
    label: makeLabel({ row: 0, col: 0, rotation: labelRotation, autoAlign: true }),
  });
  const { container } = render(
    <svg>
      <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
    </svg>,
  );
  const text = container.querySelector('text');
  if (!text) throw new Error('expected <text> for the station label');
  // The label group the renderer rotates about the anchor.
  const spun = Array.from(container.querySelectorAll('g')).find((g) =>
    (g.getAttribute('transform') ?? '').startsWith('rotate('),
  );
  const [deg, cx, cy] = (spun!.getAttribute('transform') ?? '')
    .replace(/^rotate\(|\)$/g, '')
    .split(/[\s,]+/)
    .map(Number);
  const x = Number(text.getAttribute('x'));
  const y = Number(text.getAttribute('y'));
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    // The pen origin, on the baseline, after the label's own rotation.
    penX: cx + (x - cx) * c - (y - cy) * s,
    baselineY: cy + (x - cx) * s + (y - cy) * c,
    textAnchor: text.getAttribute('textAnchor') ?? text.getAttribute('text-anchor'),
  };
}

describe('magic wand — horizontal and vertical route lines', () => {
  // https://transitmap.net/label-horizontal-vertical/
  // "Labels below the line: align to the cap height. Labels above the line:
  // align to the baseline, NOT the descender line."

  it('above a horizontal line: the glyphs SIT on their baseline, a descender clear of the marker', () => {
    const { baselineY, textAnchor } = paintedLabel([
      { dRow: 1, dCol: 0, orientation: 'auto-horizontal' },
    ]);
    // The label sits on its baseline — the tutorial's rule, and what keeps a row
    // of these level whatever letters they contain. The GAP is then measured to
    // the DESCENDER line, not the baseline: the Core Type Area stops at the
    // baseline but the ink does not, and "ensure sufficient clearance between
    // the descender line and station markers" is the tutorial's own caveat.
    expect(baselineY + DESC).toBeCloseTo(STOP_SIZE - HALF - GAP, 5);
    expect(textAnchor).toBe('middle');
  });

  it('the descender allowance is unconditional, so above-line baselines stay level', () => {
    // Measuring each name's real descender would clear the line just as well and
    // is exactly what the tutorial rules out: it puts neighbouring labels on
    // different baselines. Nothing here depends on the text, so nothing can.
    const withTail = paintedLabel([{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }]);
    expect(withTail.baselineY).toBeCloseTo(STOP_SIZE - HALF - GAP - DESC, 5);
  });

  it('below a horizontal line: the glyphs HANG from their cap line, GAP clear of the marker', () => {
    const { baselineY, textAnchor } = paintedLabel([
      { dRow: -1, dCol: 0, orientation: 'auto-horizontal' },
    ]);
    const capY = baselineY - CTA;
    expect(capY).toBeCloseTo(-STOP_SIZE + HALF + GAP, 5);
    expect(textAnchor).toBe('middle');
  });

  it('the two sides are mirror images: equal INK clearance, not equal baselines', () => {
    // The tutorial's whole argument for cap-aligning the lower label. Aligning
    // both by baseline would leave the lower one CTA-tall too close to the line.
    // What matches on the two sides is how much clear space the deepest ink
    // leaves — below, the cap line IS the top of the ink; above, the descender
    // line is the bottom of it.
    const above = paintedLabel([{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }]);
    const below = paintedLabel([{ dRow: -1, dCol: 0, orientation: 'auto-horizontal' }]);
    const topClear = STOP_SIZE - HALF - (above.baselineY + DESC);
    const bottomClear = below.baselineY - CTA - (-STOP_SIZE + HALF);
    expect(topClear).toBeCloseTo(bottomClear, 5);
    expect(topClear).toBeCloseTo(GAP, 5);
  });

  it('beside a vertical line: the Core Type Area CENTERS on the stop row', () => {
    // "the Core Type Area method ... slightly better regardless of whether the
    // label is to the left or the right."
    const east = paintedLabel([{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }]);
    expect(east.baselineY - CTA / 2).toBeCloseTo(0, 5);
    expect(east.textAnchor).toBe('start');
    expect(east.penX).toBeCloseTo(-STOP_SIZE + HALF + GAP, 5);

    const west = paintedLabel([{ dRow: 0, dCol: 1, orientation: 'auto-vertical' }]);
    expect(west.baselineY - CTA / 2).toBeCloseTo(0, 5);
    expect(west.textAnchor).toBe('end');
    expect(west.penX).toBeCloseTo(STOP_SIZE - HALF - GAP, 5);
    // Left and right sit at the same height — the reason to center the CTA.
    expect(east.baselineY).toBeCloseTo(west.baselineY, 5);
  });
});

describe('magic wand — 45° route lines', () => {
  // https://transitmap.net/labels-45-degrees/ — the CTA CORNER facing the stop
  // pins at the marker edge + GAP, moved "across and up/down an even amount".
  // The marker square is rotated onto its own 45° line, so its support along
  // the perpendicular 45° approach is exactly HALF.
  const PIN = STOP_SIZE * S2 - (HALF + GAP) * S2;

  it('above-right of the line: the bottom-LEFT corner of the CTA pins', () => {
    const { penX, baselineY, textAnchor } = paintedLabel([
      { dRow: S2, dCol: -S2, orientation: 'auto-nw-se' },
    ]);
    expect(textAnchor).toBe('start'); // left edge faces the stop
    expect(penX).toBeCloseTo(-PIN, 5);
    expect(baselineY + DESC).toBeCloseTo(PIN, 5); // bottom edge = the descender line
  });

  it('above-left of the line: the bottom-RIGHT corner of the CTA pins', () => {
    const { penX, baselineY, textAnchor } = paintedLabel([
      { dRow: S2, dCol: S2, orientation: 'auto-ne-sw' },
    ]);
    expect(textAnchor).toBe('end');
    expect(penX).toBeCloseTo(PIN, 5);
    expect(baselineY + DESC).toBeCloseTo(PIN, 5);
  });

  it('below-right of the line: the top-LEFT corner of the CTA pins', () => {
    const { penX, baselineY, textAnchor } = paintedLabel([
      { dRow: -S2, dCol: -S2, orientation: 'auto-ne-sw' },
    ]);
    expect(textAnchor).toBe('start');
    expect(penX).toBeCloseTo(-PIN, 5);
    expect(baselineY - CTA).toBeCloseTo(-PIN, 5); // top edge = the cap line
  });

  it('below-left of the line: the top-RIGHT corner of the CTA pins', () => {
    const { penX, baselineY, textAnchor } = paintedLabel([
      { dRow: -S2, dCol: S2, orientation: 'auto-nw-se' },
    ]);
    expect(textAnchor).toBe('end');
    expect(penX).toBeCloseTo(PIN, 5);
    expect(baselineY - CTA).toBeCloseTo(-PIN, 5);
  });

  it('moves the corner ACROSS and UP/DOWN an even amount, never sideways only', () => {
    // The tutorial's named error: shifting the label sideways off the marker
    // gives inconsistent spacing and uneven baselines. Along a 45° approach the
    // two components must be equal.
    // Measured on the INK box, whose bottom edge is the descender line — that is
    // the corner actually facing the marker on an above-side approach.
    const stop = { x: -S2 * STOP_SIZE, y: S2 * STOP_SIZE };
    const { penX, baselineY } = paintedLabel([{ dRow: S2, dCol: -S2, orientation: 'auto-nw-se' }]);
    expect(Math.abs(penX - stop.x)).toBeCloseTo(Math.abs(baselineY + DESC - stop.y), 5);
  });
});

describe('magic wand — angled labels', () => {
  // https://transitmap.net/angled-labels/ — "rotate the entire labeling system";
  // the placement rules are unchanged, just applied in the rotated frame.

  it('a 90°-rotated label beside a line reproduces the beside rule, rotated', () => {
    // Reading S past a horizontal stop below the cell. The Core Type Area still
    // centers on the stop's row (now the vertical line x = 0) and the text still
    // ends GAP short of the marker edge (now measured down the page).
    const { penX, baselineY, textAnchor } = paintedLabel(
      [{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }],
      2,
    );
    expect(textAnchor).toBe('end');
    expect(baselineY).toBeCloseTo(STOP_SIZE - HALF - GAP, 5); // pen stops GAP short
    expect(penX).toBeCloseTo(-CTA / 2, 5); // CTA centered on the stop's column
  });

  it('a 45°-rotated label keeps the same gap to the marker as its unrotated twin', () => {
    // Rotating the system must not change the CLEARANCE, only the direction it
    // is measured in — the invariant that lets a map mix angles at all.
    // Both measured stop-center → CTA-center, which is what "beside" pins.
    const flat = paintedLabel([{ dRow: 0, dCol: -1, orientation: 'auto-vertical' }], 0);
    const flatGap = Math.hypot(flat.penX - -STOP_SIZE, flat.baselineY - CTA / 2 - 0);
    const spun = paintedLabel([{ dRow: -S2, dCol: S2, orientation: 'auto-nw-se' }], 7);
    const stop = { x: S2 * STOP_SIZE, y: -S2 * STOP_SIZE };
    // A NE-reading label stacks its lines toward (S2, S2), so its CTA center is
    // half a cap height back along that axis from the baseline.
    const spunGap = Math.hypot(
      spun.penX - (CTA / 2) * S2 - stop.x,
      spun.baselineY - (CTA / 2) * S2 - stop.y,
    );
    expect(spunGap).toBeCloseTo(flatGap, 5);
  });
});

describe('magic wand — labels at a crossing', () => {
  // https://transitmap.net/labels-crossing/ — for crossing horizontal and
  // vertical lines: "keep the same distance from the side and top/bottom of
  // your label for consistent results."

  it('butts the text to the crossing stripe while holding its own baseline', () => {
    const plain = paintedLabel([{ dRow: 1, dCol: 0, orientation: 'auto-horizontal' }]);
    const crossed = paintedLabel([
      { dRow: 1, dCol: 0, orientation: 'auto-horizontal' }, // its own line
      { dRow: 1, dCol: 1, orientation: 'auto-vertical' }, // the crossing one
    ]);
    // Side: GAP off the crossing stripe's west edge.
    expect(crossed.textAnchor).toBe('end');
    expect(crossed.penX).toBeCloseTo(STOP_SIZE - HALF - GAP, 5);
    // Top/bottom: the SAME distance, off its own line — so a row of labels
    // along that line stays level whether or not one of them is at a cross.
    expect(crossed.baselineY).toBeCloseTo(plain.baselineY, 5);
    expect(STOP_SIZE - HALF - (crossed.baselineY + DESC)).toBeCloseTo(GAP, 5);
  });

  it('below the crossing line it still hangs from the cap, butted the same way', () => {
    const crossed = paintedLabel([
      { dRow: -1, dCol: 0, orientation: 'auto-horizontal' },
      { dRow: -1, dCol: 1, orientation: 'auto-vertical' },
    ]);
    expect(crossed.textAnchor).toBe('end');
    expect(crossed.penX).toBeCloseTo(STOP_SIZE - HALF - GAP, 5);
    expect(crossed.baselineY - CTA).toBeCloseTo(-STOP_SIZE + HALF + GAP, 5);
  });
});
