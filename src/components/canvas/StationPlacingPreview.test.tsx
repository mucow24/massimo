import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { StationPlacingPreview, makePreviewStation } from './StationPlacingPreview';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
});

describe('<StationPlacingPreview />', () => {
  it('renders nothing when world is null', () => {
    const { container } = render(
      <svg>
        <StationPlacingPreview world={null} name="Acton" lines={{}} />
      </svg>,
    );
    expect(container.querySelector('[data-station-preview]')).toBeNull();
  });

  it('renders nothing when name is null', () => {
    const { container } = render(
      <svg>
        <StationPlacingPreview world={{ x: 0, y: 0 }} name={null} lines={{}} />
      </svg>,
    );
    expect(container.querySelector('[data-station-preview]')).toBeNull();
  });

  it('renders the preview group with the name and at the world position', () => {
    const { container, getByText } = render(
      <svg>
        <StationPlacingPreview world={{ x: 100, y: 200 }} name="Acton" lines={{}} />
      </svg>,
    );
    const group = container.querySelector('[data-station-preview]');
    expect(group).toBeTruthy();
    expect(group?.getAttribute('opacity')).toBe('0.5');
    expect(group?.getAttribute('pointer-events')).toBe('none');
    expect(getByText('Acton')).toBeTruthy();
    // Both StationView passes (label + dots) translate to (x y) in their root <g>.
    const translated = container.querySelector(
      '[data-station-preview] g[transform*="translate(100 200)"]',
    );
    expect(translated).toBeTruthy();
  });
});

describe('makePreviewStation', () => {
  it('matches the shape T.addStation produces (rotation 0, no stops, default label)', () => {
    const s = makePreviewStation({ x: 5, y: 7 }, 'Bayswater');
    expect(s.x).toBe(5);
    expect(s.y).toBe(7);
    expect(s.name).toBe('Bayswater');
    expect(s.rotation).toBe(0);
    expect(s.stops).toEqual([]);
    expect(s.label).toEqual({
      row: 0,
      col: -1,
      rotation: 0,
      offset: 0,
      offsetPerp: 0,
      align: 'auto',
      valign: 'auto-down',
    });
  });
});
