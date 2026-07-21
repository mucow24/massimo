import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CLIP_RASTER_SCALE, RegionExcludeClips, regionExcludeClipId } from './RegionExcludeClips';
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

  it('emits ×CLIP_RASTER_SCALE local coordinates under an inverse scale()', () => {
    // Browsers rasterize clip resource content on a coarse grid in the
    // resource's LOCAL user space (~1 unit) — hole edges snapped by up to a
    // world unit, visible as white notches over exposed background (interline
    // gaps). Scaled-up local coordinates shrink the snap to 1/K world units.
    const holes = new Map<LineId, Ring[]>([['l1', [square(50, 0, 7)]]]);
    const { container } = render(
      <svg>
        <defs>
          <RegionExcludeClips holes={holes} bounds={BOUNDS} />
        </defs>
      </svg>,
    );
    const path = container.querySelector(`#${regionExcludeClipId('l1')}`)!.querySelector('path')!;
    expect(path.getAttribute('transform')).toBe(`scale(${1 / CLIP_RASTER_SCALE})`);
    const coords = path
      .getAttribute('d')!
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
    // Every vertex stays within the scaled content bounds — never the legacy
    // ±500000 world rect (which also carried float-precision hazards).
    for (const c of coords) {
      expect(Math.abs(c)).toBeLessThanOrEqual(400 * CLIP_RASTER_SCALE);
    }
    // The outer subpath really is the bounds rect, in scaled coordinates.
    expect(coords).toContain(BOUNDS.x0 * CLIP_RASTER_SCALE);
    expect(coords).toContain(BOUNDS.x1 * CLIP_RASTER_SCALE);
    expect(coords).toContain(BOUNDS.y0 * CLIP_RASTER_SCALE);
    expect(coords).toContain(BOUNDS.y1 * CLIP_RASTER_SCALE);
    // And the hole ring is present in the same scaled space.
    expect(coords).toContain(43 * CLIP_RASTER_SCALE);
    expect(coords).toContain(57 * CLIP_RASTER_SCALE);
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
