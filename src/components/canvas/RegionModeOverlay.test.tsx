import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RegionModeOverlay } from './RegionModeOverlay';
import { buildOverlapRegions } from '../../geometry/lineRegions';
import { makeBandSpec } from '../../test/fixtures';

const crossFaces = () =>
  buildOverlapRegions(
    [
      makeBandSpec(['l1'], {
        pairKey: 's1|s2',
        bandKey: 's1|s2#l1',
        fromId: 's1',
        toId: 's2',
        centerline: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      }),
      makeBandSpec(['l2'], {
        pairKey: 's3|s4',
        bandKey: 's3|s4#l2',
        fromId: 's3',
        toId: 's4',
        centerline: [
          { x: 50, y: -50 },
          { x: 50, y: 50 },
        ],
      }),
    ],
    [],
  );

describe('<RegionModeOverlay>', () => {
  it('draws one dashed outline per face, skipping the hovered one', () => {
    const faces = crossFaces();
    const { container, rerender } = render(
      <svg>
        <RegionModeOverlay faces={faces} hoveredKey={null} layer="outlines" />
      </svg>,
    );
    expect(container.querySelectorAll('[data-region-outline]')).toHaveLength(1);
    rerender(
      <svg>
        <RegionModeOverlay faces={faces} hoveredKey={faces[0].key} layer="outlines" />
      </svg>,
    );
    expect(container.querySelectorAll('[data-region-outline]')).toHaveLength(0);
  });

  it('halos the hovered face and exposes clickable targets in the hit layer', () => {
    const faces = crossFaces();
    const { container } = render(
      <svg>
        <RegionModeOverlay faces={faces} hoveredKey={faces[0].key} layer="hit" />
      </svg>,
    );
    expect(container.querySelectorAll('[data-region-hover-outline]')).toHaveLength(1);
    const target = container.querySelector('[data-region-target]');
    expect(target).not.toBeNull();
    expect(target!.getAttribute('data-line-ids')).toBe('l1,l2');
  });

  it('cycles forward on click and backward on right-click, flooding when shift is held', () => {
    const faces = crossFaces();
    const onFaceClick = vi.fn();
    const { container } = render(
      <svg>
        <RegionModeOverlay faces={faces} hoveredKey={null} layer="hit" onFaceClick={onFaceClick} />
      </svg>,
    );
    const target = container.querySelector('[data-region-target]')!;
    fireEvent.click(target);
    expect(onFaceClick).toHaveBeenLastCalledWith(0, 1, false);
    // Shift is the flood modifier — it does NOT reverse the cycle (right-click
    // is the way to that). `dir` still rides along, and the owner ignores it
    // when flooding (a flood spreads the CURRENT winner, so it has no
    // direction), which is why shift-right-click reports dir -1 with flood on.
    fireEvent.click(target, { shiftKey: true });
    expect(onFaceClick).toHaveBeenLastCalledWith(0, 1, true);
    fireEvent.contextMenu(target);
    expect(onFaceClick).toHaveBeenLastCalledWith(0, -1, false);
    fireEvent.contextMenu(target, { shiftKey: true });
    expect(onFaceClick).toHaveBeenLastCalledWith(0, -1, true);
    expect(onFaceClick).toHaveBeenCalledTimes(4);
  });

  it('reports hover enter/leave with the face key', () => {
    const faces = crossFaces();
    const onHover = vi.fn();
    const { container } = render(
      <svg>
        <RegionModeOverlay faces={faces} hoveredKey={null} layer="hit" onHover={onHover} />
      </svg>,
    );
    const target = container.querySelector('[data-region-target]')!;
    fireEvent.pointerEnter(target);
    expect(onHover).toHaveBeenLastCalledWith(faces[0].key);
    fireEvent.pointerLeave(target);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});
