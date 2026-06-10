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
