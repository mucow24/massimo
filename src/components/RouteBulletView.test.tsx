import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RouteBulletView } from './RouteBulletView';
import { useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import type { RouteBullet } from '../model/types';

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
  useViewportStore.setState({ darkMode: false });
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
  const ring = (c: HTMLElement) => c.querySelector('circle[stroke-dasharray]')!;

  it('renders the documented weight at zoom 1', () => {
    const r = ring(renderSelected());
    expect(Number(r.getAttribute('stroke-width'))).toBe(2);
    expect(r.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(Number(r.getAttribute('r'))).toBe(14 + 3);
    // Editor chrome, not content: bullets render in a non-excluded pass, so
    // the ring itself must opt out of SVG/PNG exports (it's also camera-
    // dependent now, which would bake an arbitrary size into the file).
    expect(r.getAttribute('data-export-exclude')).toBe('1');
  });

  // Constant SCREEN weight: stroke, dash, and pad divide by the committed
  // zoom (1/zoom idiom) — a world-unit ring turns into a sub-pixel ghost at
  // fit-map zooms and a fat slab zoomed in.
  it('divides stroke, dash, and pad by zoom', () => {
    useViewportStore.setState({ zoom: 2 });
    const r = ring(renderSelected());
    expect(Number(r.getAttribute('stroke-width'))).toBe(1);
    expect(r.getAttribute('stroke-dasharray')).toBe('2 1.5');
    expect(Number(r.getAttribute('r'))).toBe(14 + 1.5);
  });
});
