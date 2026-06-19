import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StopMarker } from './StopMarker';
import type { StopMarkerSpec } from '../geometry/interlining';
import type { LineId, StationId, LineStyle } from '../model/types';

function spec(over: Partial<StopMarkerSpec> = {}): StopMarkerSpec {
  return {
    cx: 10,
    cy: 20,
    color: '#ff0000',
    lineId: 'L1' as LineId,
    stationId: 'S' as StationId,
    rotationDeg: 0,
    priority: 0,
    style: 'solid' as LineStyle,
    outward: null,
    width: 14,
    ...over,
  };
}

function renderMarker(props: Parameters<typeof StopMarker>[0]) {
  return render(
    <svg>
      <StopMarker {...props} />
    </svg>,
  );
}

describe('StopMarker', () => {
  it('renders a solid stop as a filled, transformed rect', () => {
    const { container } = renderMarker({ spec: spec() });
    const rect = container.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect!.getAttribute('fill')).toBe('#ff0000');
    expect(rect!.getAttribute('transform')).toContain('translate(10 20)');
  });

  it('honors the effectiveColor override', () => {
    const { container } = renderMarker({ spec: spec(), effectiveColor: '#00ff00' });
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe('#00ff00');
  });

  it('renders a hatched stop as a pattern-filled polygon', () => {
    const { container } = renderMarker({ spec: spec({ style: 'hatched' }) });
    const poly = container.querySelector('polygon');
    expect(poly).not.toBeNull();
    expect(poly!.getAttribute('fill')).toMatch(/^url\(#/);
    expect(container.querySelector('rect')).toBeNull();
  });

  it('renders a hatched-mirror stop with the MIRROR pattern url, distinct from hatched (E5b)', () => {
    // hatched-mirror must reference the -45° pattern (hatchPatternId(color,
    // 'hatched-mirror') → 'hatch-m-…'), not the +45° 'hatch-…' that plain
    // hatched uses, or the two styles render identically.
    const mirror = renderMarker({ spec: spec({ style: 'hatched-mirror' }) });
    const mPoly = mirror.container.querySelector('polygon')!;
    expect(mPoly).not.toBeNull();
    const mFill = mPoly.getAttribute('fill')!;
    expect(mFill).toBe('url(#hatch-m--ff0000)');

    const plain = renderMarker({ spec: spec({ style: 'hatched' }) });
    const pFill = plain.container.querySelector('polygon')!.getAttribute('fill')!;
    expect(pFill).toBe('url(#hatch--ff0000)');

    // The mirror id is genuinely different from the non-mirror id.
    expect(mFill).not.toBe(pFill);
  });

  it('renders nothing for a dashed stop at an interior station', () => {
    const { container } = renderMarker({ spec: spec({ style: 'dashed', outward: null }) });
    expect(container.querySelector('line')).toBeNull();
    expect(container.querySelector('rect')).toBeNull();
  });

  it('renders a dashed terminus stub as line(s) with a dash array', () => {
    const { container } = renderMarker({
      spec: spec({ style: 'dashed', outward: { x: 1, y: 0 } }),
    });
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const dashed = Array.from(lines).find((l) => l.getAttribute('stroke-dasharray'));
    expect(dashed).toBeTruthy();
  });

  it('renders nothing for the open styles at an interior station', () => {
    for (const style of ['dotted', 'dashed-open'] as const) {
      const { container } = renderMarker({ spec: spec({ style, outward: null }) });
      expect(container.querySelector('line')).toBeNull();
      expect(container.querySelector('rect')).toBeNull();
    }
  });

  it('paints an open-style terminus stub with NO underlay line (gaps stay transparent)', () => {
    for (const style of ['dotted', 'dashed-open'] as const) {
      const { container } = renderMarker({
        spec: spec({ style, outward: { x: 1, y: 0 } }),
      });
      const lines = Array.from(container.querySelectorAll('line'));
      expect(lines.length).toBe(1); // the patterned stroke only
      expect(lines[0].getAttribute('stroke-dasharray')).toBeTruthy();
      expect(lines[0].getAttribute('stroke')).toBe('#ff0000');
    }
  });

  it('the dotted stub uses a round linecap so its dashes render as circles', () => {
    const { container } = renderMarker({
      spec: spec({ style: 'dotted', outward: { x: 1, y: 0 } }),
    });
    expect(container.querySelector('line')!.getAttribute('stroke-linecap')).toBe('round');
  });

  describe('per-line width', () => {
    it('sizes the solid square to spec.width (default output unchanged)', () => {
      const def = renderMarker({ spec: spec() }).container.querySelector('rect')!;
      expect(def.getAttribute('width')).toBe('14');
      expect(def.getAttribute('height')).toBe('14');
      expect(def.getAttribute('x')).toBe('-7');
      expect(def.getAttribute('y')).toBe('-7');

      const wide = renderMarker({ spec: spec({ width: 28 }) }).container.querySelector('rect')!;
      expect(wide.getAttribute('width')).toBe('28');
      expect(wide.getAttribute('height')).toBe('28');
      expect(wide.getAttribute('x')).toBe('-14');
      expect(wide.getAttribute('y')).toBe('-14');
    });

    it('sizes the hatched polygon corners to width/2', () => {
      const { container } = renderMarker({
        spec: spec({ style: 'hatched', width: 28, cx: 0, cy: 0 }),
      });
      const pts = container
        .querySelector('polygon')!
        .getAttribute('points')!
        .split(' ')
        .map((p) => p.split(',').map(Number));
      for (const [x, y] of pts) {
        expect(Math.abs(x)).toBeCloseTo(14, 6);
        expect(Math.abs(y)).toBeCloseTo(14, 6);
      }
    });

    it('scales the dashed terminus stub stroke and length with width', () => {
      const { container } = renderMarker({
        spec: spec({ style: 'dashed', outward: { x: 1, y: 0 }, width: 28, cx: 0, cy: 0 }),
      });
      const lines = Array.from(container.querySelectorAll('line'));
      expect(lines.length).toBeGreaterThanOrEqual(1);
      for (const l of lines) {
        expect(l.getAttribute('stroke-width')).toBe('28');
        // Stub runs width/2 = 14 outward along +x.
        expect(Number(l.getAttribute('x2'))).toBeCloseTo(14, 6);
      }
    });
  });
});

describe('StopMarker — casing rails (centered on the body edges)', () => {
  const strokedLines = (strokeWidth: number, strokeColor?: string) => ({
    L1: { strokeWidth: strokeWidth > 0 ? strokeWidth : undefined, strokeColor },
  });

  function renderWithStroke(s: StopMarkerSpec, strokeWidth: number, strokeColor?: string) {
    return render(
      <svg>
        <StopMarker spec={s} lines={strokedLines(strokeWidth, strokeColor)} />
      </svg>,
    );
  }

  it('paints two rails AFTER the body, centered on its travel-axis edges', () => {
    // rotationDeg 0 ⇒ travel along +x: rails are width-long rects straddling
    // local y = ±w/2 — along the body, never across its ends.
    const { container } = renderWithStroke(spec(), 4, '#ff0000');
    const rects = Array.from(container.querySelectorAll('rect'));
    expect(rects.length).toBe(3); // body + 2 rails
    expect(rects[0].hasAttribute('data-marker-casing')).toBe(false);
    const rails = rects.slice(1);
    for (const r of rails) {
      expect(r.hasAttribute('data-marker-casing')).toBe(true);
      expect(r.getAttribute('data-line-id')).toBe('L1');
      expect(r.getAttribute('fill')).toBe('#ff0000');
      expect(r.getAttribute('width')).toBe('14'); // along travel
      expect(r.getAttribute('height')).toBe('4'); // rail thick
      expect(r.getAttribute('x')).toBe('-7');
      expect(r.getAttribute('transform')).toContain('translate(10 20)');
    }
    const ys = rails.map((r) => Number(r.getAttribute('y'))).sort((a, b) => a - b);
    expect(ys).toEqual([-9, 5]); // [−w/2 − s/2, w/2 − s/2]
  });

  it('defaults the rail color to white and follows the marker rotation', () => {
    const { container } = renderWithStroke(spec({ rotationDeg: 90 }), 4);
    const rails = Array.from(container.querySelectorAll('[data-marker-casing]'));
    expect(rails.length).toBe(2);
    for (const r of rails) {
      expect(r.getAttribute('fill')).toBe('#ffffff');
      expect(r.getAttribute('transform')).toContain('rotate(90)');
    }
  });

  it('rails a hatched marker the same way as a solid one', () => {
    const { container } = renderWithStroke(spec({ style: 'hatched' }), 3, '#ff0000');
    expect(container.querySelector('polygon')).not.toBeNull();
    expect(container.querySelectorAll('[data-marker-casing]').length).toBe(2);
  });

  it('renders nothing extra for a dashed interior stop (matching the body)', () => {
    const { container } = renderWithStroke(spec({ style: 'dashed', outward: null }), 4);
    expect(container.querySelector('rect')).toBeNull();
    expect(container.querySelector('line')).toBeNull();
  });

  it('rails a dashed terminus stub straddling its edges, plus an end cap', () => {
    const { container } = renderWithStroke(
      spec({ style: 'dashed', outward: { x: 1, y: 0 }, cx: 0, cy: 0 }),
      4,
      '#ff0000',
    );
    const casings = Array.from(container.querySelectorAll('line[data-marker-casing]'));
    expect(casings.length).toBe(3); // 2 side rails + 1 end cap
    for (const l of casings) {
      expect(l.getAttribute('stroke')).toBe('#ff0000');
      expect(l.getAttribute('stroke-width')).toBe('4');
      expect(l.getAttribute('stroke-dasharray')).toBeNull();
    }
    // Side rails run along the stub (x 0 → 7) at perpendicular ±w/2 = ±7.
    const sideRails = casings.filter((l) => l.getAttribute('y1') === l.getAttribute('y2'));
    expect(sideRails.length).toBe(2);
    for (const l of sideRails) {
      expect(Number(l.getAttribute('x1'))).toBeCloseTo(0, 6);
      expect(Number(l.getAttribute('x2'))).toBeCloseTo(7, 6);
    }
    const ys = sideRails.map((l) => Number(l.getAttribute('y1'))).sort((a, b) => a - b);
    expect(ys).toEqual([-7, 7]);
    // The cap straddles the stub's far end (x = w/2), spanning w + railW.
    const cap = casings.find((l) => l.getAttribute('x1') === l.getAttribute('x2'))!;
    expect(cap).toBeTruthy();
    expect(Number(cap.getAttribute('x1'))).toBeCloseTo(7, 6);
    const capYs = [Number(cap.getAttribute('y1')), Number(cap.getAttribute('y2'))].sort(
      (a, b) => a - b,
    );
    expect(capYs).toEqual([-9, 9]); // ±(w/2 + railW/2)
  });

  it('caps a SOLID line end at a terminus (outward set)', () => {
    const { container } = renderWithStroke(spec({ outward: { x: 1, y: 0 } }), 4, '#ff0000');
    // Body rect + 2 rail rects + 1 cap line.
    expect(container.querySelectorAll('rect').length).toBe(3);
    const cap = container.querySelector('line[data-marker-casing]')!;
    expect(cap).not.toBeNull();
    expect(cap.getAttribute('stroke')).toBe('#ff0000');
    expect(cap.getAttribute('stroke-width')).toBe('4');
    // Straddles the end edge at world x = cx + w/2 = 17, spanning w + railW
    // around cy = 20.
    expect(Number(cap.getAttribute('x1'))).toBeCloseTo(17, 6);
    expect(Number(cap.getAttribute('x2'))).toBeCloseTo(17, 6);
    const ys = [Number(cap.getAttribute('y1')), Number(cap.getAttribute('y2'))].sort(
      (a, b) => a - b,
    );
    expect(ys).toEqual([11, 29]); // 20 ± (7 + 2)
  });

  it('paints no cap at an interior stop (outward null)', () => {
    const { container } = renderWithStroke(spec(), 4);
    expect(container.querySelector('line')).toBeNull();
  });

  it('suppresses the end cap when noEndCap is set (highlight arrow tip)', () => {
    const { container } = render(
      <svg>
        <StopMarker
          spec={spec({ outward: { x: 1, y: 0 } })}
          lines={strokedLines(4, '#ff0000')}
          noEndCap
        />
      </svg>,
    );
    // Side rails stay; only the cap goes.
    expect(container.querySelectorAll('rect').length).toBe(3);
    expect(container.querySelector('line')).toBeNull();
  });

  it('clamps the rendered rail at the marker width', () => {
    const { container } = renderWithStroke(spec(), 30);
    const rails = Array.from(container.querySelectorAll('[data-marker-casing]'));
    expect(rails.length).toBe(2);
    for (const r of rails) expect(r.getAttribute('height')).toBe('14');
  });

  it('renders no rails for a stroke-less line or without a lines map', () => {
    const stroked = renderWithStroke(spec(), 0);
    expect(stroked.container.querySelectorAll('rect').length).toBe(1);
    const bare = renderMarker({ spec: spec() });
    expect(bare.container.querySelectorAll('rect').length).toBe(1);
  });
});
