import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { StationPlacingPreview, makePreviewStation } from './StationPlacingPreview';
import { useDoc } from '../../state/store';
import { defaultStyleProps } from '../../model/styles';
import { DEFAULT_DOC, addStation, effectiveStationStyleProps } from '../../model/transforms';
import type { StationId } from '../../model/types';
import { makeStyle } from '../../test/fixtures';

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
  // Drift guard: without a style the ghost must have the EXACT skeleton shape
  // of the raw `addStation` transform (both flow through the shared makeStation
  // factory), so a change to the new-station skeleton can't silently desync the
  // preview. NOTE: the raw transform carries NO typography/styleId — the store
  // action's default-style stamp is covered by the seeding tests below.
  it('matches the raw addStation skeleton at the same point (no style)', () => {
    const world = { x: 5, y: 7 };
    const preview = makePreviewStation(world, 'Bayswater');

    const id = 's1' as StationId;
    const added = addStation(DEFAULT_DOC, world.x, world.y, id, 'Bayswater').stations[id];

    // Identical apart from the id (the ghost carries a sentinel preview id).
    expect({ ...preview, id: added.id }).toEqual(added);
  });

  it('applies a provided style so the ghost renders at that look', () => {
    const style = {
      fontSize: 20,
      weight: 700 as const,
      italic: true,
      leading: 1.2,
      tracking: 0.02,
    };
    const preview = makePreviewStation({ x: 0, y: 0 }, 'Acton', style);
    expect(effectiveStationStyleProps(preview)).toEqual(style);
  });

  it('seeded from the default style, the ghost matches the store-dropped look (customized default)', () => {
    // The exact desync the seeding prevents: with a NON-factory default station
    // style, the dropped station (store addStation → applyDefaultStyle) carries
    // that typography, and the ghost — seeded from defaultStyleProps, exactly as
    // the component does — must render identically.
    useDoc.setState({
      ...DEFAULT_DOC,
      styles: {
        ...DEFAULT_DOC.styles,
        'default-station': makeStyle('station', 'default-station', {
          name: 'Default',
          props: { fontSize: 20, weight: 700, italic: false, leading: 1.4, tracking: 0.05 },
        }),
      },
    });
    const ghost = makePreviewStation(
      { x: 5, y: 7 },
      'Acton',
      defaultStyleProps(useDoc.getState(), 'station'),
    );
    const id = useDoc.getState().addStation(5, 7, 'Acton');
    const dropped = useDoc.getState().stations[id];
    expect(effectiveStationStyleProps(ghost)).toEqual(effectiveStationStyleProps(dropped));
    // And that look is the customized default (not the factory 12/400).
    expect(effectiveStationStyleProps(ghost)).toMatchObject({ fontSize: 20, weight: 700 });
  });
});
