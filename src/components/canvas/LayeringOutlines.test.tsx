import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LayeringDashedOutlines, LayeringHoverOutline } from './LayeringOutlines';
import type { SegmentBandSpec } from '../../geometry/interlining';

const makeBand = (lineIds: string[]): SegmentBandSpec => {
  const lines = lineIds.map((id) => ({ id, color: '#EF374B', style: 'solid' as const }));
  return {
    pairKey: 's1|s2',
    bandKey: `s1|s2#${lineIds.slice().sort().join(',')}`,
    fromId: 's1',
    toId: 's2',
    lines,
    paths: lineIds.map(() => 'M0,0 L100,0'),
    warning: false,
    centerline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    radius: 24,
    linePriorities: lineIds.map((_, i) => i),
  };
};

const renderDashed = (
  bands: SegmentBandSpec[],
  hovered: { bandKey: string; lineId: string } | null = null,
) =>
  render(
    <svg>
      <LayeringDashedOutlines bands={bands} hovered={hovered} />
    </svg>,
  );

const renderHover = (
  bands: SegmentBandSpec[],
  hovered: { bandKey: string; lineId: string } | null,
) =>
  render(
    <svg>
      <LayeringHoverOutline bands={bands} hovered={hovered} />
    </svg>,
  );

describe('<LayeringDashedOutlines>', () => {
  it('renders one dashed group per band stripe when nothing is hovered', () => {
    const { container } = renderDashed([makeBand(['A', 'B'])]);
    const groups = container.querySelectorAll('[data-layering-outline]');
    expect(groups.length).toBe(2);
  });

  it('renders no groups for an empty band list', () => {
    const { container } = renderDashed([]);
    expect(container.querySelectorAll('[data-layering-outline]').length).toBe(0);
  });

  it('dashed groups carry the expected stroke attributes', () => {
    const { container } = renderDashed([makeBand(['A'])]);
    const g = container.querySelector('[data-layering-outline]')!;
    expect(g.getAttribute('stroke')).toBe('#000');
    expect(g.getAttribute('stroke-width')).toBe('1.5');
    expect(g.getAttribute('stroke-opacity')).toBe('0.2');
    expect(g.getAttribute('stroke-dasharray')).toBe('4 2');
    // Two long edges + two cap lines per stripe.
    expect(g.querySelectorAll('path').length).toBe(2);
    expect(g.querySelectorAll('line').length).toBe(2);
  });

  it('skips the hovered stripe (it paints via LayeringHoverOutline instead)', () => {
    const band = makeBand(['A', 'B']);
    const { container } = renderDashed([band], { bandKey: band.bandKey, lineId: 'A' });
    const groups = container.querySelectorAll('[data-layering-outline]');
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute('data-line-id')).toBe('B');
  });
});

describe('<LayeringHoverOutline>', () => {
  it('renders nothing when hovered is null', () => {
    const { container } = renderHover([makeBand(['A'])], null);
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });

  it('renders a 2px white halo and a 1px black stroke over the same closed path', () => {
    const band = makeBand(['A']);
    const { container } = renderHover([band], { bandKey: band.bandKey, lineId: 'A' });
    const hover = container.querySelector('[data-layering-hover-outline]')!;
    const paths = hover.querySelectorAll('path');
    expect(paths.length).toBe(2);
    const [halo, black] = paths;
    expect(halo.getAttribute('stroke')).toBe('#fff');
    expect(halo.getAttribute('stroke-width')).toBe('2');
    expect(black.getAttribute('stroke')).toBe('#000');
    expect(black.getAttribute('stroke-width')).toBe('1');
    // Same `d` for both layers — they trace the same closed perimeter.
    expect(halo.getAttribute('d')).toBe(black.getAttribute('d'));
    expect(halo.getAttribute('d')?.endsWith('Z')).toBe(true);
  });

  it('is a no-op when the hovered bandKey does not match any band', () => {
    const band = makeBand(['A']);
    const { container } = renderHover([band], { bandKey: 'nope', lineId: 'A' });
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });

  it('is a no-op when the hovered lineId is not in the matched band', () => {
    const band = makeBand(['A']);
    const { container } = renderHover([band], { bandKey: band.bandKey, lineId: 'ghost' });
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });
});
