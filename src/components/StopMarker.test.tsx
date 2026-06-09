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
});
