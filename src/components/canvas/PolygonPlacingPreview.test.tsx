import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PolygonPlacingPreview } from './PolygonPlacingPreview';
import { starterPolygonVertices } from '../../model/transforms';

describe('<PolygonPlacingPreview />', () => {
  it('renders nothing when there is no cursor world point', () => {
    const { container } = render(
      <svg>
        <PolygonPlacingPreview world={null} />
      </svg>,
    );
    expect(container.querySelector('[data-polygon-preview]')).toBeNull();
  });

  it('renders a semitransparent starter square centered on the cursor', () => {
    const { container } = render(
      <svg>
        <PolygonPlacingPreview world={{ x: 100, y: 50 }} />
      </svg>,
    );
    const ghost = container.querySelector('[data-polygon-preview]') as Element;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('opacity')).toBe('0.5');
    expect(ghost.getAttribute('pointer-events')).toBe('none');
    // Points match exactly what addPolygon would drop at that point.
    const expected = starterPolygonVertices(100, 50)
      .map((v) => `${v.x},${v.y}`)
      .join(' ');
    expect(ghost.querySelector('polygon')?.getAttribute('points')).toBe(expected);
  });
});
