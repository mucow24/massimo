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

describe('<RegionExcludeClips>', () => {
  it('renders one world-minus-holes clipPath per losing line', () => {
    const holes = new Map<LineId, Ring[]>([
      ['l1', [square(50, 0, 7)]],
      ['l2', [square(200, 0, 7), square(300, 0, 7)]],
    ]);
    const { container } = render(
      <svg>
        <defs>
          <RegionExcludeClips holes={holes} />
        </defs>
      </svg>,
    );
    const clips = container.querySelectorAll('clipPath');
    expect(clips).toHaveLength(2);
    const l1 = container.querySelector(`#${regionExcludeClipId('l1')}`)!;
    expect(l1.getAttribute('data-region-exclude')).toBe('l1');
    // World rect + one hole ring = two subpaths.
    const d = l1.querySelector('path')!.getAttribute('d')!;
    expect(d.match(/M /g)!.length).toBe(2);
    // Two holes for l2 = three subpaths.
    const d2 = container
      .querySelector(`#${regionExcludeClipId('l2')}`)!
      .querySelector('path')!
      .getAttribute('d')!;
    expect(d2.match(/M /g)!.length).toBe(3);
  });

  it('renders nothing without holes', () => {
    const { container } = render(
      <svg>
        <defs>
          <RegionExcludeClips holes={new Map()} />
        </defs>
      </svg>,
    );
    expect(container.querySelectorAll('clipPath')).toHaveLength(0);
  });
});
