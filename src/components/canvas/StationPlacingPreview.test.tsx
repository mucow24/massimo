import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { StationPlacingPreview, makePreviewStation } from './StationPlacingPreview';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC, addStation } from '../../model/transforms';
import type { StationId } from '../../model/types';

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
  // Drift guard: the placement ghost must have the EXACT shape of the station
  // that addStation actually drops (both flow through the shared makeStation
  // factory). Compared against addStation's real output — not a hand-copied
  // literal — so a change to the new-station skeleton can't silently desync
  // the preview from the dropped station.
  it('matches the station T.addStation drops at the same point', () => {
    const world = { x: 5, y: 7 };
    const preview = makePreviewStation(world, 'Bayswater');

    const id = 's1' as StationId;
    const added = addStation(DEFAULT_DOC, world.x, world.y, id, 'Bayswater').stations[id];

    // Identical apart from the id (the ghost carries a sentinel preview id).
    expect({ ...preview, id: added.id }).toEqual(added);
  });
});
