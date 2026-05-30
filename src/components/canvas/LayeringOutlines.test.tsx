import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LayeringOutlines } from './LayeringOutlines';
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

const renderOutlines = (
  bands: SegmentBandSpec[],
  hovered: { bandKey: string; lineId: string } | null = null,
) =>
  render(
    <svg>
      <LayeringOutlines bands={bands} hovered={hovered} />
    </svg>,
  );

describe('<LayeringOutlines>', () => {
  it('renders one outline group per band stripe when nothing is hovered', () => {
    const { container } = renderOutlines([makeBand(['A', 'B'])]);
    const groups = container.querySelectorAll('[data-layering-outline]');
    expect(groups.length).toBe(2);
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });

  it('renders no outline groups for an empty band list', () => {
    const { container } = renderOutlines([]);
    expect(container.querySelectorAll('[data-layering-outline]').length).toBe(0);
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });

  it('dashed groups carry the expected stroke attributes', () => {
    const { container } = renderOutlines([makeBand(['A'])]);
    const g = container.querySelector('[data-layering-outline]')!;
    expect(g.getAttribute('stroke')).toBe('#000');
    expect(g.getAttribute('stroke-width')).toBe('1.5');
    expect(g.getAttribute('stroke-opacity')).toBe('0.2');
    expect(g.getAttribute('stroke-dasharray')).toBe('4 2');
    // Two long edges + two cap lines per stripe.
    expect(g.querySelectorAll('path').length).toBe(2);
    expect(g.querySelectorAll('line').length).toBe(2);
  });

  it('hovered stripe drops the dashed group and renders the hover outline instead', () => {
    const band = makeBand(['A', 'B']);
    const { container } = renderOutlines([band], { bandKey: band.bandKey, lineId: 'A' });
    // 1 dashed group remains (for B); the hover outline takes A's slot.
    const dashed = container.querySelectorAll('[data-layering-outline]');
    expect(dashed.length).toBe(1);
    expect(dashed[0].getAttribute('data-line-id')).toBe('B');
    const hover = container.querySelector('[data-layering-hover-outline]')!;
    expect(hover.getAttribute('data-line-id')).toBe('A');
  });

  it('hover outline paints a 2px white halo then a 1px black stroke on the same closed path', () => {
    const band = makeBand(['A']);
    const { container } = renderOutlines([band], { bandKey: band.bandKey, lineId: 'A' });
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

  it('hover with a missing bandKey is a no-op (no hover element rendered)', () => {
    const band = makeBand(['A']);
    const { container } = renderOutlines([band], { bandKey: 'nope', lineId: 'A' });
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });

  it('hover with a missing lineId on a real band is a no-op', () => {
    const band = makeBand(['A']);
    const { container } = renderOutlines([band], { bandKey: band.bandKey, lineId: 'ghost' });
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });
});
