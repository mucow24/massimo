import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StopGlyph } from './StopGlyph';
import { BLACK_PAIR, DEFAULT_DOT_STYLE, WHITE_PAIR } from '../model/dotStyle';
import { stopMetricsOf } from '../model/stopMetrics';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { DotStyle } from '../model/types';

/**
 * The seam between the stop dot the canvas PAINTS and the stop dot the label
 * geometry CLEARS. `StopGlyph` outsets its silhouette pass by its own radius
 * delta; `stopMetricsOf` reports `dot.r` for the label pins to clear. The two
 * are the same rule, and a label sitting off the painted ink is exactly the
 * drift the `StopMetrics` bundle exists to prevent — so this measures the
 * rendered silhouette and asserts the reported clearance matches it.
 *
 * Scoped to the split-border case (filled + stroked + non-'x'), which is where
 * the silhouette is a discrete element whose radius can be read back off the
 * DOM. Open rings and the concave 'x' keep a native centred stroke instead.
 */

const DOT_SIZE = 20;
const STROKE = 3;

const style = (over: Partial<DotStyle>): DotStyle => ({
  ...DEFAULT_DOT_STYLE,
  fill: BLACK_PAIR,
  strokeWidth: STROKE,
  strokeColor: WHITE_PAIR,
  ...over,
});

/** The painted silhouette's radius, read off the stroke pass's element. */
function paintedOuterRadius(s: DotStyle): number {
  const { container } = render(
    <svg>
      <StopGlyph
        cx={0}
        cy={0}
        style={s}
        sizeOverride={DOT_SIZE}
        stationId="s1"
        lineId="L1"
        pass="stroke"
      />
    </svg>,
  );
  const el = container.querySelector('[data-stop-stroke]');
  if (!el) throw new Error('no silhouette element — the split-border case did not render');
  const circle = el.getAttribute('r');
  if (circle !== null) return parseFloat(circle);
  const rect = el.getAttribute('width');
  if (rect !== null) return parseFloat(rect) / 2;
  // A polygon: the vertex distance IS the radius the shape was built from.
  const pts = el
    .getAttribute('points')!
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number) as [number, number]);
  return Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
}

/** The clearance the label geometry reports for the same dot. */
function reportedClearance(s: DotStyle): number {
  const st = makeStation({ id: 's1', stops: [makeStop('L1')] });
  const metrics = stopMetricsOf({
    lines: { L1: makeLine({ id: 'L1', singletonDotSize: DOT_SIZE, singletonDotStyle: s }) },
    transfers: {},
    stations: {},
  });
  return metrics(st, st.stops[0]).dot!.r;
}

describe('stop dot: painted silhouette === reported label clearance', () => {
  for (const shape of ['circle', 'square', 'diamond'] as const) {
    for (const strokeAlign of ['inside', 'center', 'outside'] as const) {
      it(`agrees for a ${strokeAlign}-stroked ${shape}`, () => {
        const s = style({ shape, strokeAlign });
        expect(reportedClearance(s)).toBeCloseTo(paintedOuterRadius(s), 6);
      });
    }
  }

  it('agrees for an unstroked dot, where the silhouette is the nominal radius', () => {
    // No stroke ⇒ no split, so the fill pass carries the whole dot.
    const s = style({ shape: 'circle', strokeWidth: 0 });
    expect(reportedClearance(s)).toBe(DOT_SIZE / 2);
  });
});
