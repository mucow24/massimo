import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BandWarning, SegmentBand } from './SegmentBand';
import { hatchPatternId } from './HatchPatterns';
import type { SegmentBandSpec } from '../geometry/interlining';
import type { Line, LineId } from '../model/types';
import { makeLine } from '../test/fixtures';

type StripeStyle = 'solid' | 'dashed' | 'hatched';

// Presentation-free band over the canonical station pair s1|s2. The spec
// carries only line ids; color + per-segment style are resolved at render
// from the live `lines` map (mirrors how MapCanvas drives the real render).
const baseSpec = (lineIds: LineId[]): SegmentBandSpec => ({
  pairKey: 's1|s2',
  bandKey: `s1|s2#${lineIds.slice().sort().join(',')}`,
  fromId: 's1',
  toId: 's2',
  lines: lineIds.map((id) => ({ id })),
  paths: lineIds.map(() => 'M0,0 L100,0'),
  warning: false,
  centerline: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  radius: 24,
  linePriorities: lineIds.map((_, i) => i),
});

// Live lines map: a per-stripe style becomes a segmentStyles override on the
// band's pairKey, exactly as the doc stores it. Solid carries no override.
const linesFor = (styles: StripeStyle[], color = '#EF374B'): Record<LineId, Line> => {
  const out: Record<LineId, Line> = {};
  styles.forEach((style, i) => {
    const id = `L${i + 1}`;
    out[id] = makeLine({
      id,
      color,
      stations: ['s1', 's2'],
      segmentStyles: style === 'solid' ? undefined : { 's1|s2': style },
    });
  });
  return out;
};

const renderStripe = (
  styles: StripeStyle[],
  stripeIndex: number,
  opts: { color?: string; underlayColor?: string } = {},
) => {
  const color = opts.color ?? '#EF374B';
  const ids = styles.map((_, i) => `L${i + 1}`);
  return render(
    <svg>
      <SegmentBand
        spec={baseSpec(ids)}
        stripeIndex={stripeIndex}
        lines={linesFor(styles, color)}
        underlayColor={opts.underlayColor}
      />
    </svg>,
  );
};

describe('<SegmentBand> — single-stripe renderer', () => {
  it('renders a solid stroke for solid stripes', () => {
    const { container } = renderStripe(['solid'], 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe('#EF374B');
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
  });

  it('renders a white underlay + dashed foreground for dashed stripes', () => {
    const { container } = renderStripe(['dashed'], 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    const [underlay, foreground] = paths;
    expect(underlay.getAttribute('stroke')).toBe('#fff');
    expect(underlay.getAttribute('stroke-dasharray')).toBeNull();
    expect(foreground.getAttribute('stroke')).toBe('#EF374B');
    expect(foreground.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('uses the hatch pattern url for hatched stripes (no underlay)', () => {
    const { container } = renderStripe(['hatched'], 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
  });

  it('selects the requested stripe out of a multi-stripe band', () => {
    const styles: StripeStyle[] = ['solid', 'dashed', 'hatched'];
    // stripeIndex 1 → dashed → 2 paths (underlay + foreground).
    const { container } = renderStripe(styles, 1);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[1].getAttribute('stroke-dasharray')).toBeTruthy();
    // stripeIndex 2 → hatched → single path with the hatch pattern url.
    const hatched = renderStripe(styles, 2).container.querySelectorAll('path');
    expect(hatched.length).toBe(1);
    expect(hatched[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
  });

  it('resolves color live from the lines map — a color edit repaints without a new spec', () => {
    // Regression: presentation is NOT baked into the spec, so re-rendering
    // with a changed `lines` map (same spec reference) updates the stripe.
    // This is the unit-level guard for the "color change needs reload" bug.
    const spec = baseSpec(['L1']);
    const stroke = () => document.querySelector('path')?.getAttribute('stroke');
    const { rerender } = render(
      <svg>
        <SegmentBand spec={spec} stripeIndex={0} lines={linesFor(['solid'], '#EF374B')} />
      </svg>,
    );
    expect(stroke()).toBe('#EF374B');
    rerender(
      <svg>
        <SegmentBand spec={spec} stripeIndex={0} lines={linesFor(['solid'], '#00AA55')} />
      </svg>,
    );
    expect(stroke()).toBe('#00AA55');
  });

  it('resolves per-segment style live — a style edit repaints without a new spec', () => {
    const spec = baseSpec(['L1']);
    const { container, rerender } = render(
      <svg>
        <SegmentBand spec={spec} stripeIndex={0} lines={linesFor(['solid'])} />
      </svg>,
    );
    // Solid: one path, no dasharray.
    expect(container.querySelectorAll('path').length).toBe(1);
    rerender(
      <svg>
        <SegmentBand spec={spec} stripeIndex={0} lines={linesFor(['hatched'])} />
      </svg>,
    );
    // Hatched: still one path, now the hatch pattern url.
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
  });

  it('paints the dashed underlay in the supplied underlayColor (dark mode)', () => {
    const { container } = renderStripe(['dashed'], 0, { underlayColor: '#000000' });
    const [underlay] = container.querySelectorAll('path');
    expect(underlay.getAttribute('stroke')).toBe('#000000');
  });
});

describe('<BandWarning>', () => {
  it('renders the warning glyph at the centerline midpoint when band.warning is true', () => {
    const spec = baseSpec(['L1']);
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
        <BandWarning spec={baseSpec(['L1'])} />
      </svg>,
    );
    expect(container.querySelector('text')).toBeNull();
  });
});
