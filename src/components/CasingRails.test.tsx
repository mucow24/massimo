import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CasingRails } from './CasingRails';

// A straight horizontal centerline; offsetFilletPath then just shifts it along
// the left normal (screen-up), so a rail's first M-y reveals its offset.
const CENTERLINE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];
const startY = (p: Element) => Number(p.getAttribute('d')!.match(/M [\d.-]+ ([\d.-]+)/)![1]);

const renderRails = (props: Partial<Parameters<typeof CasingRails>[0]> = {}) =>
  render(
    <svg>
      <CasingRails
        centerline={CENTERLINE}
        radius={24}
        offset={0}
        bodyWidth={14}
        railW={4}
        color="#ff0000"
        {...props}
      />
    </svg>,
  );

describe('<CasingRails>', () => {
  it('renders two rails centered on the body edges (offset ± bodyWidth/2)', () => {
    const { container } = renderRails({ offset: 0, bodyWidth: 14 });
    const rails = Array.from(container.querySelectorAll('path'));
    expect(rails.length).toBe(2);
    expect(rails.map(startY).sort((a, b) => a - b)).toEqual([-7, 7]);
    for (const r of rails) {
      expect(r.getAttribute('stroke')).toBe('#ff0000');
      expect(r.getAttribute('stroke-width')).toBe('4');
      expect(r.getAttribute('stroke-linecap')).toBe('butt');
      expect(r.getAttribute('pointer-events')).toBe('none');
    }
  });

  it('honors a non-zero stripe offset', () => {
    // offset 10.5, width 28 ⇒ rail centers 10.5 ± 14 = [-3.5, 24.5] (screen-up).
    const { container } = renderRails({ offset: 10.5, bodyWidth: 28 });
    const rails = Array.from(container.querySelectorAll('path'));
    expect(rails.map(startY).sort((a, b) => a - b)).toEqual([-24.5, 3.5]);
  });

  it('renders nothing when there is no casing (railW ≤ 0)', () => {
    const { container } = renderRails({ railW: 0 });
    expect(container.querySelectorAll('path').length).toBe(0);
  });

  it('tags each rail for DOM lookup only when a lineId is given', () => {
    const tagged = renderRails({ lineId: 'L1' }).container;
    for (const r of tagged.querySelectorAll('path')) {
      expect(r.hasAttribute('data-band-casing')).toBe(true);
      expect(r.getAttribute('data-line-id')).toBe('L1');
    }
    const untagged = renderRails({}).container;
    for (const r of untagged.querySelectorAll('path')) {
      expect(r.hasAttribute('data-band-casing')).toBe(false);
      expect(r.hasAttribute('data-line-id')).toBe(false);
    }
  });
});
