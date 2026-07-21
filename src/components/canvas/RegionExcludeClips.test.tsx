import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RegionExcludeClips, regionExcludeClipId } from './RegionExcludeClips';
import type { Ring } from '../../geometry/clip';
import type { LineId } from '../../model/types';

const square = (cx: number, cy: number, half: number): Ring => [
  { x: cx - half, y: cy - half },
  { x: cx + half, y: cy - half },
  { x: cx + half, y: cy + half },
  { x: cx - half, y: cy + half },
];

const BOUNDS = { x0: -100, y0: -50, x1: 400, y1: 50 };

describe('<RegionExcludeClips>', () => {
  it('renders one bounds-minus-holes clipPath per losing line', () => {
    const holes = new Map<LineId, Ring[]>([
      ['l1', [square(50, 0, 7)]],
      ['l2', [square(200, 0, 7), square(300, 0, 7)]],
    ]);
    const { container } = render(
      <svg>
        <defs>
          <RegionExcludeClips holes={holes} bounds={BOUNDS} />
        </defs>
      </svg>,
    );
    const clips = container.querySelectorAll('clipPath');
    expect(clips).toHaveLength(2);
    const l1 = container.querySelector(`#${regionExcludeClipId('l1')}`)!;
    expect(l1.getAttribute('data-region-exclude')).toBe('l1');
    // Bounds rect + one hole ring = two subpaths.
    const d = l1.querySelector('path')!.getAttribute('d')!;
    expect(d.match(/M /g)!.length).toBe(2);
    // Two holes for l2 = three subpaths.
    const d2 = container
      .querySelector(`#${regionExcludeClipId('l2')}`)!
      .querySelector('path')!
      .getAttribute('d')!;
    expect(d2.match(/M /g)!.length).toBe(3);
  });

  it('hugs the passed bounds — no giant-coordinate outer rect', () => {
    // The outer ring used to be a ±500000 constant; coordinates that large
    // lose float precision in GPU clip rasterization at deep zoom, painting
    // the hole edges pixels off (white notches over an interline gap). Every
    // clip vertex must now stay within the passed content bounds.
    const holes = new Map<LineId, Ring[]>([['l1', [square(50, 0, 7)]]]);
    const { container } = render(
      <svg>
        <defs>
          <RegionExcludeClips holes={holes} bounds={BOUNDS} />
        </defs>
      </svg>,
    );
    const d = container
      .querySelector(`#${regionExcludeClipId('l1')}`)!
      .querySelector('path')!
      .getAttribute('d')!;
    const coords = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    for (const c of coords) {
      expect(Math.abs(c)).toBeLessThanOrEqual(400);
    }
    // The outer subpath really is the bounds rect (all four corners present).
    expect(coords).toContain(BOUNDS.x0);
    expect(coords).toContain(BOUNDS.x1);
    expect(coords).toContain(BOUNDS.y0);
    expect(coords).toContain(BOUNDS.y1);
  });

  it('renders nothing without holes', () => {
    const { container } = render(
      <svg>
        <defs>
          <RegionExcludeClips holes={new Map()} bounds={BOUNDS} />
        </defs>
      </svg>,
    );
    expect(container.querySelectorAll('clipPath')).toHaveLength(0);
  });
});
