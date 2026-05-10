import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BandWarning, SegmentBand } from './SegmentBand';
import { hatchPatternId } from './HatchPatterns';
import type { SegmentBandSpec } from '../geometry/interlining';

const baseSpec = (
  styles: Array<'solid' | 'dashed' | 'hatched'>,
  color = '#EF374B',
): SegmentBandSpec => {
  const lines = styles.map((style, i) => ({ id: `L${i + 1}`, color, style }));
  const sortedIds = lines
    .map((l) => l.id)
    .slice()
    .sort();
  return {
    pairKey: 's1|s2',
    bandKey: `s1|s2#${sortedIds.join(',')}`,
    fromId: 's1',
    toId: 's2',
    lines,
    paths: styles.map(() => 'M0,0 L100,0'),
    warning: false,
    centerline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    linePriorities: styles.map((_, i) => i),
  };
};

const renderStripe = (spec: SegmentBandSpec, stripeIndex: number) =>
  render(
    <svg>
      <SegmentBand spec={spec} stripeIndex={stripeIndex} />
    </svg>,
  );

describe('<SegmentBand> — single-stripe renderer', () => {
  it('renders a solid stroke for solid stripes', () => {
    const { container } = renderStripe(baseSpec(['solid']), 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe('#EF374B');
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
  });

  it('renders a white underlay + dashed foreground for dashed stripes', () => {
    const { container } = renderStripe(baseSpec(['dashed']), 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    const [underlay, foreground] = paths;
    expect(underlay.getAttribute('stroke')).toBe('#fff');
    expect(underlay.getAttribute('stroke-dasharray')).toBeNull();
    expect(foreground.getAttribute('stroke')).toBe('#EF374B');
    expect(foreground.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('uses the hatch pattern url for hatched stripes (no underlay)', () => {
    const { container } = renderStripe(baseSpec(['hatched']), 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
  });

  it('selects the requested stripe out of a multi-stripe band', () => {
    const spec = baseSpec(['solid', 'dashed', 'hatched']);
    // stripeIndex 1 → dashed → 2 paths (underlay + foreground), no solid/hatched.
    const { container } = renderStripe(spec, 1);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[1].getAttribute('stroke-dasharray')).toBeTruthy();
    // stripeIndex 2 → hatched → single path with the hatch pattern url.
    const hatched = renderStripe(spec, 2).container.querySelectorAll('path');
    expect(hatched.length).toBe(1);
    expect(hatched[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
  });
});

describe('<BandWarning>', () => {
  it('renders the warning glyph at the centerline midpoint when band.warning is true', () => {
    const spec = baseSpec(['solid']);
    spec.warning = true;
    spec.centerline = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const { container } = render(
      <svg>
        <BandWarning spec={spec} />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.textContent).toBe('⚠');
  });

  it('renders nothing when band.warning is false', () => {
    const { container } = render(
      <svg>
        <BandWarning spec={baseSpec(['solid'])} />
      </svg>,
    );
    expect(container.querySelector('text')).toBeNull();
  });
});
