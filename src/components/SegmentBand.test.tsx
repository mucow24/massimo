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
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('#EF374B');
    expect(path?.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('applies stroke-dasharray for dashed segments', () => {
    const { container } = renderBand(baseSpec(['dashed']));
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('#EF374B');
    expect(path?.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('uses the hatch pattern url for hatched segments', () => {
    const { container } = renderBand(baseSpec(['hatched']));
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
    expect(path?.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('switches each line in a multi-line band independently', () => {
    const { container } = renderBand(baseSpec(['solid', 'dashed', 'hatched']));
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(3);
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
    expect(paths[0].getAttribute('stroke')).toBe('#EF374B');
    expect(paths[1].getAttribute('stroke-dasharray')).toBeTruthy();
    expect(paths[2].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
  });
});
