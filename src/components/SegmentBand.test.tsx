import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SegmentBand } from './SegmentBand';
import { hatchPatternId } from './HatchPatterns';
import type { SegmentBandSpec } from '../geometry/interlining';

const baseSpec = (
  styles: Array<'solid' | 'dashed' | 'hatched'>,
  color = '#EF374B',
): SegmentBandSpec => ({
  pairKey: 's1|s2',
  fromId: 's1',
  toId: 's2',
  lines: styles.map((style, i) => ({ id: `L${i + 1}`, color, style })),
  paths: styles.map(() => 'M0,0 L100,0'),
  warning: false,
  centerline: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  priority: 0,
});

const renderBand = (spec: SegmentBandSpec) =>
  render(
    <svg>
      <SegmentBand spec={spec} />
    </svg>,
  );

describe('<SegmentBand> — style switching', () => {
  it('renders a solid stroke for solid segments (current behavior)', () => {
    const { container } = renderBand(baseSpec(['solid']));
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe('#EF374B');
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
  });

  it('applies stroke-dasharray for dashed segments and renders a solid white underlay beneath', () => {
    const { container } = renderBand(baseSpec(['dashed']));
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    const [underlay, foreground] = paths;
    expect(underlay.getAttribute('stroke')).toBe('#fff');
    expect(underlay.getAttribute('stroke-dasharray')).toBeNull();
    expect(foreground.getAttribute('stroke')).toBe('#EF374B');
    expect(foreground.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('uses the hatch pattern url for hatched segments (no underlay; white is baked into the pattern)', () => {
    const { container } = renderBand(baseSpec(['hatched']));
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
  });

  it('switches each line in a multi-line band independently', () => {
    const { container } = renderBand(baseSpec(['solid', 'dashed', 'hatched']));
    const paths = Array.from(container.querySelectorAll('path'));
    // solid: 1 path; dashed: 2 (white underlay + colored dashed); hatched: 1.
    expect(paths.length).toBe(4);

    const solid = paths.filter(
      (p) => p.getAttribute('stroke') === '#EF374B' && !p.getAttribute('stroke-dasharray'),
    );
    expect(solid.length).toBe(1);

    const dashed = paths.filter((p) => p.getAttribute('stroke-dasharray'));
    expect(dashed.length).toBe(1);
    expect(dashed[0].getAttribute('stroke')).toBe('#EF374B');

    const underlay = paths.filter((p) => p.getAttribute('stroke') === '#fff');
    expect(underlay.length).toBe(1);

    const hatched = paths.filter(
      (p) => p.getAttribute('stroke') === `url(#${hatchPatternId('#EF374B')})`,
    );
    expect(hatched.length).toBe(1);
  });
});
