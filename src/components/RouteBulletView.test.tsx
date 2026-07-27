import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RouteBulletView } from './RouteBulletView';
import { useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import type { RouteBullet } from '../model/types';
import { capCenterDy } from '../geometry/textMeasure';

const noop = () => {};

const makeBullet = (overrides: Partial<RouteBullet> & { id: string }): RouteBullet => ({
  x: 0,
  y: 0,
  rotation: 0,
  lineId: null,
  shape: 'circle',
  size: 14,
  ...overrides,
});

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.setState({ darkMode: false });
});

describe('<RouteBulletView /> hit proxy (selected-on-top drag target)', () => {
  const renderHit = (bullet: RouteBullet, onPointerDown: (id: string) => void = noop) =>
    render(
      <svg>
        <RouteBulletView
          bullet={bullet}
          lines={{}}
          selected
          layer="hit"
          onPointerDown={onPointerDown}
          onClick={noop}
          onContextMenu={noop}
        />
      </svg>,
    ).container;

  const hit = (c: HTMLElement) => c.querySelector('[data-bullet-hit="b1"]');

  it('a selected, unlocked bullet renders a transparent shape proxy with the bullet transform', () => {
    const c = renderHit(makeBullet({ id: 'b1', x: 30, y: 60 }));
    const g = hit(c)!;
    expect(g).not.toBeNull();
    expect(g.getAttribute('transform')).toBe('translate(30 60) rotate(0)');
    // Distinct from the body's data-bullet-id (avoids strict-mode locator clashes).
    expect(g.getAttribute('data-bullet-id')).toBeNull();
    // The shape copy is transparent and carries no rendered text.
    const shape = g.querySelector('circle')!;
    expect(shape.getAttribute('fill')).toBe('transparent');
    expect(g.querySelector('text')).toBeNull();
  });

  it('mirrors the bullet shape (square / diamond) so the grab footprint matches', () => {
    expect(
      hit(renderHit(makeBullet({ id: 'b1', shape: 'square' })))!.querySelector('rect'),
    ).not.toBeNull();
    expect(
      hit(renderHit(makeBullet({ id: 'b1', shape: 'diamond' })))!.querySelector('polygon'),
    ).not.toBeNull();
  });

  it('routes a pointer-down to the bullet move handler with the id', () => {
    const onPointerDown = vi.fn();
    const c = renderHit(makeBullet({ id: 'b1' }), onPointerDown);
    fireEvent.pointerDown(hit(c)!);
    expect(onPointerDown).toHaveBeenCalledWith('b1', expect.anything());
  });

  it('renders no proxy when not selected', () => {
    const c = render(
      <svg>
        <RouteBulletView
          bullet={makeBullet({ id: 'b1' })}
          lines={{}}
          selected={false}
          layer="hit"
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
        />
      </svg>,
    ).container;
    expect(hit(c)).toBeNull();
  });

  it('renders no proxy when locked (a locked bullet is not draggable)', () => {
    expect(hit(renderHit(makeBullet({ id: 'b1', locked: true })))).toBeNull();
  });
});

describe('<RouteBulletView /> — locked bullets are click-through unless selected', () => {
  const renderBody = (bullet: RouteBullet, selected = false) =>
    render(
      <svg>
        <RouteBulletView
          bullet={bullet}
          lines={{}}
          selected={selected}
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
        />
      </svg>,
    ).container;
  const group = (c: HTMLElement) => c.querySelector('[data-bullet-id="b1"]') as HTMLElement;

  it('a locked, unselected bullet ignores pointer events (clicks land on what is beneath)', () => {
    const c = renderBody(makeBullet({ id: 'b1', locked: true }));
    expect(group(c).getAttribute('pointer-events')).toBe('none');
  });

  it('a locked bullet stays clickable while selected (popover unlock stays reachable)', () => {
    const c = renderBody(makeBullet({ id: 'b1', locked: true }), true);
    expect(group(c).getAttribute('pointer-events')).toBeNull();
  });

  it('an unlocked, unselected bullet keeps normal hit-testing', () => {
    const c = renderBody(makeBullet({ id: 'b1' }));
    expect(group(c).getAttribute('pointer-events')).toBeNull();
  });
});

// The selection ring is a two-tone circle: a 2px ink CORE over a 4px UNDERLAY
// (1px of underlay on each edge), both at radius r + SELECTION_RING_PAD (a
// WORLD pad, so it scales with the map). It flips with the theme — black core /
// white halo (white-black-white) on the light canvas, white core / black halo
// (black-white-black) on the dark one — so it stays legible around a bullet of
// any color. Screen weight held by vector-effect="non-scaling-stroke", so the
// ring tracks in-flight pan/zoom natively instead of snapping on commit.
describe('<RouteBulletView /> — service code baseline', () => {
  // `dominantBaseline="central"` centers the font's ascent..descent box, which
  // Chrome sources per-platform (usWin on Windows, hhea on macOS) — the code
  // rendered ~0.09em lower on a Mac. Centered on the alphabetic baseline instead.
  it('centers the code on the alphabetic baseline, not via dominant-baseline', () => {
    const { container } = render(
      <svg>
        <RouteBulletView
          bullet={makeBullet({ id: 'b1', x: 30, y: 60 })}
          lines={{}}
          selected={false}
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
        />
      </svg>,
    );
    const text = container.querySelector('[data-bullet-id="b1"] text')!;
    // The bullet's <g> carries the translate + rotate, so the text is local-origin.
    const fontSize = Number(text.getAttribute('font-size'));
    expect(Number(text.getAttribute('y'))).toBeCloseTo(capCenterDy(fontSize), 6);
    expect(text.getAttribute('dominant-baseline')).toBeNull();
  });
});

describe('<RouteBulletView /> — selection ring', () => {
  afterEach(() => useViewportStore.setState({ zoom: 1 }));

  const renderSelected = () =>
    render(
      <svg>
        <RouteBulletView
          bullet={makeBullet({ id: 'b1' })}
          lines={{}}
          selected
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
        />
      </svg>,
    ).container;
  const rings = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('[data-bullet-id="b1"] > circle[fill="none"]'));

  it('renders a black core over a white underlay on the light canvas (WBW)', () => {
    // beforeEach sets darkMode: false.
    const els = rings(renderSelected());
    expect(els.length).toBe(2);
    const [edge, core] = els;
    expect(edge.getAttribute('stroke')).toBe('#ffffff');
    expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
    expect(core.getAttribute('stroke')).toBe('#000000');
    expect(Number(core.getAttribute('stroke-width'))).toBe(2);
    for (const el of els) {
      // World pad, NOT divided by zoom (bullet size 14 + pad 3).
      expect(Number(el.getAttribute('r'))).toBe(14 + 3);
      expect(el.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(el.getAttribute('stroke-dasharray')).toBe('4 3');
      // Editor chrome: bullets render in a non-excluded pass, so the ring must
      // opt out of SVG/PNG exports.
      expect(el.getAttribute('data-export-exclude')).toBe('1');
    }
  });

  it('flips to a white core over a black underlay in dark mode (BWB)', () => {
    useDoc.setState({ darkMode: true });
    const [edge, core] = rings(renderSelected());
    expect(edge.getAttribute('stroke')).toBe('#000000');
    expect(core.getAttribute('stroke')).toBe('#ffffff');
  });

  // No zoom subscription at all: identical markup at any committed zoom, so a
  // gesture commit never re-renders the ring (nothing to snap).
  it('is zoom-independent: identical markup at committed zoom 2', () => {
    useViewportStore.setState({ zoom: 2 });
    const els = rings(renderSelected());
    const [edge, core] = els;
    expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
    expect(Number(core.getAttribute('stroke-width'))).toBe(2);
    for (const el of els) expect(Number(el.getAttribute('r'))).toBe(14 + 3);
  });
});
