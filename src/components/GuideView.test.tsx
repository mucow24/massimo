import { describe, it, expect, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { GuideView } from './GuideView';
import { makeGuide } from '../test/fixtures';
import { useLiveViewportStore } from '../state/viewportStore';
import { useDevSettings, type GuideRenderSettings } from '../state/devSettings';
import type { AlignmentGuide } from '../model/types';

const renderGuide = (
  guide: AlignmentGuide,
  zoom = 1,
  vbX = -500,
  vbY = -500,
  extra: { selected?: boolean } = {},
) =>
  render(
    <svg>
      <GuideView
        guide={guide}
        zoom={zoom}
        vbX={vbX}
        vbY={vbY}
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
        {...extra}
      />
    </svg>,
  );

const strokeOf = (container: HTMLElement, part: 'ink' | 'casing') => {
  const line = container.querySelector(`[data-guide-${part}]`)!;
  return {
    width: Number(line.getAttribute('stroke-width')),
    dashes: line.getAttribute('stroke-dasharray')!.split(' ').map(Number),
    phase: Number(line.getAttribute('stroke-dashoffset')),
  };
};
const inkOf = (container: HTMLElement) => strokeOf(container, 'ink');
const casingOf = (container: HTMLElement) => strokeOf(container, 'casing');

// The recipe's thirds don't land on exact binary fractions, so dash lists are
// compared elementwise rather than by value equality.
const expectDashes = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
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
    const visible = container.querySelector('[data-guide-ink]')!;
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

// Recipe: 1.5px stroke, 10/2 dash, 0.5px screen floor, 300% reference zoom —
// so the floor (⅓ of the core) and the canvas-riding stretch meet at 100%.
describe('<GuideView /> hybrid ink sizing', () => {
  it('holds screen-constant ink at/above the 300% reference zoom', () => {
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 4);
    const ink = inkOf(container);
    // World 1.5/4 → 1.5 screen px at zoom 4.
    expect(ink.width).toBeCloseTo(0.375, 10);
    expect(ink.dashes[0]).toBeCloseTo(2.5, 10);
    expect(ink.dashes[1]).toBeCloseTo(0.5, 10);
  });

  it('rides the canvas below the reference: frozen world size, shrinking screen size', () => {
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1.5);
    const ink = inkOf(container);
    // Half the reference zoom, so half the recipe: world 0.5 at zoom 1.5 =
    // 0.75 screen px, and still clear of the ⅓ floor.
    expect(ink.width).toBeCloseTo(0.5, 10);
    expect(ink.dashes[0]).toBeCloseTo(10 / 3, 10);
    expect(ink.dashes[1]).toBeCloseTo(2 / 3, 10);
    // The grab stroke is exempt from the hybrid: plain screen-constant.
    const hit = container.querySelector('[data-guide-hit]')!;
    expect(Number(hit.getAttribute('stroke-width')) * 1.5).toBeCloseTo(12, 10);
  });

  it('floors the whole recipe at 0.5 screen px when zoomed far out', () => {
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 0.25);
    const ink = inkOf(container);
    // Scale floor 0.5/1.5 = ⅓: stroke 1.5·⅓ = 0.5 screen px → 2 world units.
    expect(ink.width * 0.25).toBeCloseTo(0.5, 10);
    // Dashes floor along with it (10·⅓ / 2·⅓ screen px), keeping the rhythm.
    expect(ink.dashes[0] * 0.25).toBeCloseTo(10 / 3, 10);
    expect(ink.dashes[1] * 0.25).toBeCloseTo(2 / 3, 10);
  });
});

describe('<GuideView /> dash phase', () => {
  const ORIENTATIONS = ['horizontal', 'vertical', 'diagonal-up', 'diagonal-down'] as const;

  it.each(ORIENTATIONS)('anchors the %s pattern to the world line, not the clip box', (o) => {
    // Same guide, two overdrawn boxes (a pan commit re-clips the segment —
    // the origin shifts on BOTH axes so every orientation's start actually
    // moves): the pattern must sit at the same WORLD phase in both, i.e. the
    // segment start's distance along the line from the guide's (0, offset)
    // anchor minus dashoffset lands on a whole number of periods. That
    // distance is x1 (horizontal), y1 (vertical), or x1·√2 (diagonals — the
    // x-span foreshortens true length). Period at zoom 1: (10+2)·⅓ = 4.
    const starts = new Set<number>();
    for (const shift of [0, -1]) {
      const { container, unmount } = renderGuide(
        makeGuide({ id: 'g', orientation: o, offset: 0 }),
        1,
        -500 + shift,
        -500 + shift,
      );
      const line = container.querySelector('[data-guide-ink]')!;
      const x1 = Number(line.getAttribute('x1'));
      const y1 = Number(line.getAttribute('y1'));
      const along = o === 'horizontal' ? x1 : o === 'vertical' ? y1 : x1 * Math.SQRT2;
      starts.add(along);
      const phase = Number(line.getAttribute('stroke-dashoffset'));
      const periods = (along - phase) / 4;
      expect(periods).toBeCloseTo(Math.round(periods), 10);
      unmount();
    }
    // Guard the guard: if the shifted box didn't move the segment start, the
    // two renders proved nothing.
    expect(starts.size).toBe(2);
  });
});

describe('<GuideView /> casing', () => {
  it('runs a solid translucent rail under the dashed core', () => {
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    const casing = container.querySelector('[data-guide-casing]')!;
    const ink = container.querySelector('[data-guide-ink]')!;
    // The recipe's own near-white, not the theme paper the prop carries — a
    // translucent casing reads over the band art as well as over the paper.
    expect(casing.getAttribute('stroke')).toBe('#fafafab5');
    // 0.5 recipe px per side around the 1.5 core → 2.5, at the same hybrid
    // scale as the ink (⅓ at zoom 1).
    expect(Number(casing.getAttribute('stroke-width'))).toBeCloseTo(2.5 / 3, 10);
    // "1 0" — a dash with no gap, so the rail is continuous under a core that
    // is not.
    expectDashes(casingOf(container).dashes, [1 / 3, 0]);
    expectDashes(inkOf(container).dashes, [10 / 3, 2 / 3]);
    expect(casing.getAttribute('pointer-events')).toBe('none');
    // Painted directly under the core.
    expect(casing.nextElementSibling).toBe(ink);
  });
});

// Every number in the recipe is a dial in the Developer pane, not a constant —
// the defaults reproduce the tuned-by-eye recipe the tests above assert.
describe('<GuideView /> developer dials', () => {
  const setGuide = (patch: Partial<GuideRenderSettings>) =>
    act(() => useDevSettings.getState().setGuide(patch));

  afterEach(() => {
    act(() => useDevSettings.getState().resetGuide());
  });

  it('sizes the core and its casing from the thickness dial', () => {
    setGuide({ thickness: 3 });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    // Scale at zoom 1 is ⅓ (the 300% reference), so 3 recipe px → 1.
    expect(inkOf(container).width).toBeCloseTo(1, 10);
    // The casing keeps its own 0.5 per side around whatever the core is:
    // 3 + 1 → 4 → 4/3.
    expect(casingOf(container).width).toBeCloseTo(4 / 3, 10);
  });

  it('sizes the casing from its own dial, independent of the core', () => {
    setGuide({ casingThickness: 2 });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    // The core is untouched — 1.5 recipe px at zoom 1's ⅓ scale…
    expect(inkOf(container).width).toBeCloseTo(0.5, 10);
    // …while the casing is now 2 per SIDE around it: 1.5 + 4 → 5.5 → 5.5/3.
    expect(casingOf(container).width).toBeCloseTo(5.5 / 3, 10);
  });

  it('scales the casing with the core at every zoom, the min-thickness floor included', () => {
    // Independent in VALUE, locked in SIZING: the pair rides the one scale the
    // core's thickness/min-thickness pair defines, so the guide reads
    // proportionally the same at any zoom — and stops shrinking exactly where
    // the core's floor stops it.
    setGuide({ casingThickness: 3 });
    const at = (zoom: number) => {
      const { container, unmount } = renderGuide(makeGuide({ id: 'g', offset: 0 }), zoom);
      // Screen px, so the numbers are what the eye gets.
      const sizes = {
        core: inkOf(container).width * zoom,
        casing: casingOf(container).width * zoom,
      };
      unmount();
      return sizes;
    };
    // Above the reference, riding the canvas, and floored: (1.5 + 2·3) / 1.5.
    for (const zoom of [4, 2, 0.25]) {
      const { core, casing } = at(zoom);
      expect(casing / core).toBeCloseTo(5, 10);
    }
    // Guard the guard: 0.25 really is in the floored regime (core at its 0.5
    // screen-px min), so the ratio there is a claim about a floored casing.
    expect(at(0.25).core).toBeCloseTo(0.5, 10);
    expect(at(0.25).casing).toBeCloseTo(2.5, 10);
  });

  it('takes an arbitrary dash pattern, phase included', () => {
    setGuide({ dash: '9 3 1 3' });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    const ink = inkOf(container);
    expectDashes(ink.dashes, [3, 1, 1 / 3, 1]);
    // Phase is still anchored to the world foot, now modulo the new period
    // (16 recipe px → 16/3 world units at this scale).
    const line = container.querySelector('[data-guide-ink]')!;
    const periods = (Number(line.getAttribute('x1')) - ink.phase) / (16 / 3);
    expect(periods).toBeCloseTo(Math.round(periods), 10);
  });

  it('insets the casing behind the core at a negative thickness', () => {
    setGuide({ casingThickness: -0.25 });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    // 1.5 − 0.5 = 1 recipe px: narrower than the core that covers it, so the
    // paper only shows where the casing dash overhangs the core's.
    expect(casingOf(container).width).toBeCloseTo(1 / 3, 10);
    expect(inkOf(container).width).toBeCloseTo(0.5, 10);
  });

  it('never lets an inset casing cross zero into a negative stroke width', () => {
    // Reachable in two turns of the pane: dial the casing to its inset floor
    // against a 1.5 core, then thin the core under it. The pair then asks for
    // a negative width, which the DOM takes as an invalid attribute rather
    // than as a hidden stroke.
    setGuide({ casingThickness: -0.75, thickness: 0.5 });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    const casing = container.querySelector('[data-guide-casing]')!;
    expect(Number(casing.getAttribute('stroke-width'))).toBe(0);
  });

  it('takes an arbitrary casing dash, leaving the core on its own', () => {
    setGuide({ casingDash: '6 1' });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    // Recipe px at zoom 1's ⅓ scale, same hybrid as everything else.
    expectDashes(casingOf(container).dashes, [2, 1 / 3]);
    // The core keeps its own 10 2 — the two patterns are separate dials.
    expectDashes(inkOf(container).dashes, [10 / 3, 2 / 3]);
  });

  it('falls back to the CORE pattern while the casing text is unusable', () => {
    // Clearing the field to retype must not de-register the casing from a
    // non-default core: the generic 10 2 fallback would visibly unstitch the
    // two mid-edit, which is the opposite of what the fallback is for.
    setGuide({ dash: '9 3', casingDash: '' });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    const casing = container.querySelector('[data-guide-casing]')!;
    const ink = container.querySelector('[data-guide-ink]')!;
    expectDashes(casingOf(container).dashes, [3, 1]);
    expect(casing.getAttribute('stroke-dasharray')).toBe(ink.getAttribute('stroke-dasharray'));
    expect(casing.getAttribute('stroke-dashoffset')).toBe(ink.getAttribute('stroke-dashoffset'));
  });

  it('phases the casing on its OWN period, so a differing pattern is pan-stable too', () => {
    // Core period 12, casing period 7: borrowing the core's period here would
    // re-phase the casing on every pan or zoom commit — the flicker the
    // world-foot anchor exists to kill.
    setGuide({ casingDash: '3 4' });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    const casing = container.querySelector('[data-guide-casing]')!;
    const phase = Number(casing.getAttribute('stroke-dashoffset'));
    // 7 recipe px → 7/3 world units at this scale.
    const periods = (Number(casing.getAttribute('x1')) - phase) / (7 / 3);
    expect(periods).toBeCloseTo(Math.round(periods), 10);
    // Guard the guard: the core's own phase differs, so this isn't a pass by
    // coincidence of the two patterns agreeing.
    expect(phase).not.toBeCloseTo(inkOf(container).phase, 10);
  });

  it('floors the recipe at the min-thickness dial', () => {
    // Floor raised to the full core width: the ink can never ride the canvas
    // down, so it holds 1.5 screen px however far out the camera goes.
    setGuide({ minThickness: 1.5 });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 0.25);
    expect(inkOf(container).width * 0.25).toBeCloseTo(1.5, 10);
  });

  it('flips to screen-constant at the transition-zoom dial', () => {
    setGuide({ transitionZoomPercent: 400 });
    // Zoom 2 is now BELOW the reference: 1.5 · (2/4) / 2 world units.
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 2);
    expect(inkOf(container).width).toBeCloseTo(0.375, 10);
    // At the reference itself the ink is a screen-constant 1.5px again.
    const at = renderGuide(makeGuide({ id: 'g', offset: 0 }), 4);
    expect(inkOf(at.container).width * 4).toBeCloseTo(1.5, 10);
  });

  it('degrades to invisible ink rather than NaN attributes at a zeroed thickness', () => {
    // Both dials bottom out at 0, and 0/0 in the floor ratio would reach the
    // DOM as stroke-width="NaN" — a dial turned all the way down should just
    // stop drawing.
    setGuide({ thickness: 0, minThickness: 0 });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    const line = container.querySelector('[data-guide-ink]')!;
    expect(Number(line.getAttribute('stroke-width'))).toBe(0);
    for (const attr of ['stroke-width', 'stroke-dasharray', 'stroke-dashoffset']) {
      expect(line.getAttribute(attr)).not.toMatch(/NaN/);
    }
    // The casing carries its own pattern and phase through the same unfloored
    // scale, so it needs the same guard. It keeps DRAWING at a zeroed core —
    // an independent dial holding its width is the dial working, not a bug —
    // so the one thing to pin is that it stays a number.
    const casing = container.querySelector('[data-guide-casing]')!;
    expect(Number(casing.getAttribute('stroke-width'))).toBeCloseTo(1, 10);
    for (const attr of ['stroke-width', 'stroke-dasharray', 'stroke-dashoffset']) {
      expect(casing.getAttribute(attr)).not.toMatch(/NaN/);
    }
  });

  it('repaints the idle core and the casing from the color dials', () => {
    setGuide({ color: '#ff00ff', casingColor: '#00ff00' });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    expect(container.querySelector('[data-guide-ink]')!.getAttribute('stroke')).toBe('#ff00ff');
    expect(container.querySelector('[data-guide-casing]')!.getAttribute('stroke')).toBe('#00ff00');
  });

  it('hands both strokes back to the theme when a color dial is cleared', () => {
    // The recipe ships explicit colors, so the theme's own guide indigo and
    // paper tone are what a null dial falls through to — the state a recipe
    // stored before the colors were baked rehydrates into.
    setGuide({ color: null, casingColor: null });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1);
    expect(container.querySelector('[data-guide-ink]')!.getAttribute('stroke')).toBe('#888');
    expect(container.querySelector('[data-guide-casing]')!.getAttribute('stroke')).toBe('#fff');
  });

  it('leaves the state restrokes alone — an override is the IDLE color', () => {
    setGuide({ color: '#ff00ff' });
    const { container } = renderGuide(makeGuide({ id: 'g', offset: 0 }), 1, -500, -500, {
      selected: true,
    });
    expect(container.querySelector('[data-guide-ink]')!.getAttribute('stroke')).toBe('#a80');
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
    expect(inkOf(container).width).toBeCloseTo(0.5, 10);
    act(() => useLiveViewportStore.getState().setPending({ x: 0, y: 0, zoom: 4 }));
    expect(inkOf(container).width).toBeCloseTo(0.375, 10);
    act(() => useLiveViewportStore.getState().setPending(null));
    expect(inkOf(container).width).toBeCloseTo(0.5, 10);
  });
});
