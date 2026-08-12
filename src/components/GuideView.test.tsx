import { describe, it, expect, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { GuideView } from './GuideView';
import { makeGuide } from '../test/fixtures';
import { useLiveViewportStore } from '../state/viewportStore';
import type { AlignmentGuide } from '../model/types';

const renderGuide = (guide: AlignmentGuide, zoom = 1, vbX = -500) =>
  render(
    <svg>
      <GuideView
        guide={guide}
        zoom={zoom}
        vbX={vbX}
        vbY={-500}
        vbW={1000}
        vbH={1000}
        guideColor="#888"
        casingColor="#fff"
        selectedColor="#a80"
        hoverColor="#cb6"
        accentColor="#1a4ea8"
        selected={false}
        hovered={false}
        engaged={false}
        interactive={true}
        inHandMode={false}
      />
    </svg>,
  );

const inkOf = (container: HTMLElement) => {
  const line = container.querySelector('[data-guide-ink]')!;
  return {
    width: Number(line.getAttribute('stroke-width')),
    dashes: line.getAttribute('stroke-dasharray')!.split(' ').map(Number),
    phase: Number(line.getAttribute('stroke-dashoffset')),
  };
};

describe('<GuideView /> diagonals', () => {
  it('draws a diagonal clipped to the overdrawn box, with the move cursor', () => {
    // The / at intercept 200: from the top edge (700, -500)… but x is capped
    // at the box's right edge, so it runs (−500, 700)→… — clipped both ways:
    // enters at the left edge (−500, 700)? y 700 is outside; the real span is
    // x ∈ [−300, 500], i.e. (−300, 500) → (500, −300).
    const { container } = renderGuide(
      makeGuide({ id: 'gu', orientation: 'diagonal-up', offset: 200 }),
    );
    const visible = container.querySelector('line')!;
    expect(Number(visible.getAttribute('x1'))).toBe(-300);
    expect(Number(visible.getAttribute('y1'))).toBe(500);
    expect(Number(visible.getAttribute('x2'))).toBe(500);
    expect(Number(visible.getAttribute('y2'))).toBe(-300);
    const hit = container.querySelector<HTMLElement>('[data-guide-hit]')!;
    expect(hit.style.cursor).toBe('nwse-resize');
  });

  it('mounts nothing for a diagonal that misses the box', () => {
    const { container } = renderGuide(
      makeGuide({ id: 'gd', orientation: 'diagonal-down', offset: 5000 }),
    );
    expect(container.querySelector('[data-guide]')).toBeNull();
  });
});

// Recipe: 1.5px stroke, 5/2 dash, 0.5px screen floor, 200% reference zoom.
describe('<GuideView /> hybrid ink sizing', () => {
  it('holds screen-constant ink at/above the 200% reference zoom', () => {
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 4);
    const ink = inkOf(container);
    // World 1.5/4 → 1.5 screen px at zoom 4.
    expect(ink.width).toBeCloseTo(0.375, 10);
    expect(ink.dashes[0]).toBeCloseTo(1.25, 10);
    expect(ink.dashes[1]).toBeCloseTo(0.5, 10);
  });

  it('rides the canvas below the reference: frozen world size, shrinking screen size', () => {
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    const ink = inkOf(container);
    // World 0.75 at zoom 1 = 0.75 screen px — half the reference weight.
    expect(ink.width).toBeCloseTo(0.75, 10);
    expect(ink.dashes[0]).toBeCloseTo(2.5, 10);
    expect(ink.dashes[1]).toBeCloseTo(1, 10);
    // The grab stroke is exempt from the hybrid: plain screen-constant.
    const hit = container.querySelector('[data-guide-hit]')!;
    expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(12, 10);
  });

  it('floors the whole recipe at 0.5 screen px when zoomed far out', () => {
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 0.25);
    const ink = inkOf(container);
    // Scale floor 0.5/1.5 = ⅓: stroke 1.5·⅓ = 0.5 screen px → 2 world units.
    expect(ink.width * 0.25).toBeCloseTo(0.5, 10);
    // Dashes floor along with it (5·⅓ / 2·⅓ screen px), keeping the rhythm.
    expect(ink.dashes[0] * 0.25).toBeCloseTo(5 / 3, 10);
    expect(ink.dashes[1] * 0.25).toBeCloseTo(2 / 3, 10);
  });
});

describe('<GuideView /> dash phase', () => {
  it('anchors the pattern to the world line, not the clip box', () => {
    // Same guide, two overdrawn boxes (a pan commit re-clips the segment):
    // the pattern must sit at the same WORLD phase in both, i.e. segment
    // start minus dashoffset lands on a whole number of periods from the
    // guide's (0, offset) anchor. Period at zoom 1: (5+2)·0.5 = 3.5 world.
    for (const vbX of [-500, -501]) {
      const { container, unmount } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1, vbX);
      const line = container.querySelector('line')!;
      const x1 = Number(line.getAttribute('x1'));
      const phase = Number(line.getAttribute('stroke-dashoffset'));
      expect(x1).toBe(vbX);
      const periods = (x1 - phase) / 3.5;
      expect(periods).toBeCloseTo(Math.round(periods), 10);
      unmount();
    }
  });
});

describe('<GuideView /> casing', () => {
  it('outlines every dash with the paper tone so the guide reads over any body', () => {
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    const casing = container.querySelector('[data-guide-casing]')!;
    const ink = container.querySelector('[data-guide-ink]')!;
    expect(casing.getAttribute('stroke')).toBe('#fff');
    // 0.75 recipe px per side around the 1.5 core → 3, at the same hybrid
    // scale as the ink (0.5 at zoom 1).
    expect(Number(casing.getAttribute('stroke-width'))).toBeCloseTo(1.5, 10);
    // Identical dash pattern and world phase — the casing hugs each dash.
    expect(casing.getAttribute('stroke-dasharray')).toBe(ink.getAttribute('stroke-dasharray'));
    expect(casing.getAttribute('stroke-dashoffset')).toBe(ink.getAttribute('stroke-dashoffset'));
    expect(casing.getAttribute('pointer-events')).toBe('none');
    // Painted directly under the core.
    expect(casing.nextElementSibling).toBe(ink);
  });
});

describe('<GuideView /> in-flight zoom', () => {
  afterEach(() => {
    useLiveViewportStore.getState().setPending(null);
  });

  it('sizes ink from the live pending zoom, then falls back to committed', () => {
    // The committed prop says zoom 1, but a wheel gesture is mid-flight at
    // zoom 4: the ink must track the gesture (no pop at the settle commit).
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    expect(inkOf(container).width).toBeCloseTo(0.75, 10);
    act(() => useLiveViewportStore.getState().setPending({ x: 0, y: 0, zoom: 4 }));
    expect(inkOf(container).width).toBeCloseTo(0.375, 10);
    act(() => useLiveViewportStore.getState().setPending(null));
    expect(inkOf(container).width).toBeCloseTo(0.75, 10);
  });
});
