import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PolygonView } from './PolygonView';
import { makePolygon } from '../test/fixtures';
import { useLiveViewportStore, useViewportStore } from '../state/viewportStore';
import type { Polygon } from '../model/types';

const noop = () => {};

function renderBody(polygon: Polygon, opts: { selected?: boolean } = {}) {
  return render(
    <svg>
      <PolygonView
        polygon={polygon}
        layer="body"
        selected={opts.selected ?? false}
        selectedVertexIndices={new Set()}
        interactive
        onPointerDown={noop}
        onClick={noop}
        onContextMenu={noop}
        onVertexPointerDown={noop}
        onVertexClick={noop}
        onEdgeAddPointerDown={noop}
      />
    </svg>,
  );
}

const body = (container: HTMLElement) =>
  container.querySelector('path[data-polygon-id="p0"]') as Element;

describe('<PolygonView /> dark-mode colors', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false });
  });

  it('paints the light fill/stroke in light mode, ignoring dark overrides', () => {
    const { container } = renderBody(
      makePolygon({
        id: 'p0',
        fill: '#112233',
        stroke: '#445566',
        darkFill: '#778899',
        darkStroke: '#99aabb',
      }),
    );
    expect(body(container).getAttribute('fill')).toBe('#112233');
    expect(body(container).getAttribute('stroke')).toBe('#445566');
  });

  it('paints the dark fill/stroke when dark mode is on', () => {
    useViewportStore.setState({ darkMode: true });
    const { container } = renderBody(
      makePolygon({
        id: 'p0',
        fill: '#112233',
        stroke: '#445566',
        darkFill: '#778899',
        darkStroke: '#99aabb',
      }),
    );
    expect(body(container).getAttribute('fill')).toBe('#778899');
    expect(body(container).getAttribute('stroke')).toBe('#99aabb');
  });

  it('shows the light colors in dark mode when dark equals light (uncustomized)', () => {
    useViewportStore.setState({ darkMode: true });
    const { container } = renderBody(makePolygon({ id: 'p0', fill: '#112233', stroke: '#445566' }));
    expect(body(container).getAttribute('fill')).toBe('#112233');
    expect(body(container).getAttribute('stroke')).toBe('#445566');
  });
});

describe('<PolygonView /> overlay handles are a constant screen size', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false, zoom: 1 });
  });

  function renderOverlay(zoom: number) {
    useViewportStore.setState({ zoom });
    return render(
      <svg>
        <PolygonView
          polygon={makePolygon({ id: 'p0' })}
          layer="overlay"
          selected
          selectedVertexIndices={new Set()}
          interactive
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
          onVertexPointerDown={noop}
          onVertexClick={noop}
          onEdgeAddPointerDown={noop}
        />
      </svg>,
    ).container;
  }

  // makePolygon's default square has vertex 0 at (-30,-30); edge 0's midpoint is
  // (0,-30). Authored sizes: VERTEX_HANDLE_HALF=5 (10×10 box), EDGE_ADD_R=7. On
  // screen these must stay constant, so each world dimension scales by 1/zoom and
  // `dimension × zoom` is invariant across zoom levels.
  it('vertex handle: width/stroke constant on screen, stays centered on the vertex', () => {
    for (const zoom of [1, 2]) {
      const c = renderOverlay(zoom);
      const rect = c.querySelector('rect[data-polygon-vertex="0"]')!;
      const w = Number(rect.getAttribute('width'));
      expect(w * zoom).toBeCloseTo(10);
      expect(Number(rect.getAttribute('height')) * zoom).toBeCloseTo(10);
      expect(Number(rect.getAttribute('stroke-width')) * zoom).toBeCloseTo(1.5);
      // Center (x + width/2) stays on the world vertex x = -30 at every zoom.
      expect(Number(rect.getAttribute('x')) + w / 2).toBeCloseTo(-30);
    }
  });

  it('edge "+" circle radius is constant on screen', () => {
    for (const zoom of [1, 2]) {
      const c = renderOverlay(zoom);
      const circle = c.querySelector('[data-polygon-edge-add="0"] circle')!;
      expect(Number(circle.getAttribute('r')) * zoom).toBeCloseTo(7);
      // Circle stays centered on edge 0's midpoint (0,-30).
      expect(Number(circle.getAttribute('cx'))).toBeCloseTo(0);
      expect(Number(circle.getAttribute('cy'))).toBeCloseTo(-30);
    }
  });

  it('selection outline is a two-tone dashed ring: black ink core over white underlay (light), no snap', () => {
    // beforeEach sets darkMode: false → WBW.
    for (const zoom of [1, 2]) {
      const c = renderOverlay(zoom);
      const outlines = Array.from(c.querySelectorAll('g[data-polygon-overlay] > polygon'));
      expect(outlines).toHaveLength(2);
      const [edge, core] = outlines;
      expect(edge.getAttribute('stroke')).toBe('#ffffff');
      // Screen-constant via vector-effect: width does NOT scale with zoom.
      expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
      expect(core.getAttribute('stroke')).toBe('#000000');
      expect(Number(core.getAttribute('stroke-width'))).toBe(2);
      for (const o of outlines) {
        expect(o.getAttribute('vector-effect')).toBe('non-scaling-stroke');
        expect(o.getAttribute('stroke-dasharray')).toBe('4 3');
      }
    }
  });
});

describe('<PolygonView /> overlay handles track the LIVE gesture zoom (no snap)', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false, zoom: 1 });
    useLiveViewportStore.setState({ pending: null });
  });
  afterEach(() => useLiveViewportStore.setState({ pending: null }));

  const renderOverlay = () =>
    render(
      <svg>
        <PolygonView
          polygon={makePolygon({ id: 'p0' })}
          layer="overlay"
          selected
          selectedVertexIndices={new Set()}
          interactive
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
          onVertexPointerDown={noop}
          onVertexClick={noop}
          onEdgeAddPointerDown={noop}
        />
      </svg>,
    ).container;

  // An in-flight wheel gesture writes the viewBox imperatively and publishes
  // the live viewport as `pending` WITHOUT committing zoom to the store. The
  // handles must size off that live zoom, not the stale committed one, so they
  // stay screen-constant through the gesture instead of snapping on commit.
  it('sizes a vertex handle off the pending viewport zoom, not the committed zoom', () => {
    useViewportStore.setState({ zoom: 1 });
    useLiveViewportStore.setState({ pending: { x: 0, y: 0, zoom: 2 } });
    const rect = renderOverlay().querySelector('rect[data-polygon-vertex="0"]')!;
    // 10px handle / live zoom 2 = 5 world units (committed-zoom 1 would give 10).
    expect(Number(rect.getAttribute('width'))).toBeCloseTo(5);
  });

  it('falls back to committed zoom between gestures (pending null)', () => {
    useViewportStore.setState({ zoom: 2 });
    useLiveViewportStore.setState({ pending: null });
    const rect = renderOverlay().querySelector('rect[data-polygon-vertex="0"]')!;
    expect(Number(rect.getAttribute('width'))).toBeCloseTo(5);
  });
});

describe('<PolygonView /> selected-vertex highlight', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false, zoom: 1 });
  });

  // The selected handles are filled with the accent color (every handle is
  // STROKED with the accent); unselected handles use the contrast color for
  // their fill. Reading accent off an unselected handle's own stroke avoids
  // hard-coding theme hex — the two-tone outline is no longer the accent color.
  it('fills every handle in the selected set with the accent, others with contrast', () => {
    const c = render(
      <svg>
        <PolygonView
          polygon={makePolygon({ id: 'p0' })}
          layer="overlay"
          selected
          selectedVertexIndices={new Set([0, 2])}
          interactive
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
          onVertexPointerDown={noop}
          onVertexClick={noop}
          onEdgeAddPointerDown={noop}
        />
      </svg>,
    ).container;
    const accent = c.querySelector('rect[data-polygon-vertex="1"]')!.getAttribute('stroke');
    const fillOf = (i: number) =>
      c.querySelector(`rect[data-polygon-vertex="${i}"]`)!.getAttribute('fill');
    expect(fillOf(0)).toBe(accent);
    expect(fillOf(2)).toBe(accent);
    expect(fillOf(1)).not.toBe(accent);
    expect(fillOf(3)).not.toBe(accent);
  });
});

describe('<PolygonView /> open polygons (closed: false)', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false, zoom: 1 });
  });

  function renderOverlay(polygon: Polygon) {
    return render(
      <svg>
        <PolygonView
          polygon={polygon}
          layer="overlay"
          selected
          selectedVertexIndices={new Set()}
          interactive
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
          onVertexPointerDown={noop}
          onVertexClick={noop}
          onEdgeAddPointerDown={noop}
        />
      </svg>,
    ).container;
  }

  it('renders the body stroke-only: no fill, no closing edge, stroke hit-testing', () => {
    const { container } = renderBody(
      makePolygon({ id: 'p0', fill: '#112233', stroke: '#445566', closed: false }),
    );
    const el = body(container);
    expect(el.getAttribute('fill')).toBe('none');
    expect(el.getAttribute('d') ?? '').not.toContain('Z');
    expect(el.getAttribute('stroke')).toBe('#445566');
    expect(el.getAttribute('pointer-events')).toBe('stroke');
    expect(el.getAttribute('data-polygon-open')).toBe('true');
  });

  it('a closed body keeps its fill, closing edge, and whole-body hit-testing', () => {
    const { container } = renderBody(makePolygon({ id: 'p0', fill: '#112233' }));
    const el = body(container);
    expect(el.getAttribute('fill')).toBe('#112233');
    expect(el.getAttribute('d') ?? '').toContain('Z');
    expect(el.getAttribute('pointer-events')).toBeNull();
    expect(el.getAttribute('data-polygon-open')).toBeNull();
  });

  it('keeps corner rounding on interior vertices only (endpoints stay sharp)', () => {
    const { container } = renderBody(makePolygon({ id: 'p0', closed: false, curveRadius: 10 }));
    const d = body(container).getAttribute('d') ?? '';
    expect((d.match(/Q/g) ?? []).length).toBe(2); // 4 vertices → 2 interior corners
    expect(d).not.toContain('Z');
  });

  it('the overlay drops the closing edge: polyline outline + n-1 edge "+" buttons', () => {
    const c = renderOverlay(makePolygon({ id: 'p0', closed: false }));
    expect(c.querySelector('g[data-polygon-overlay] > polyline')).not.toBeNull();
    expect(c.querySelector('g[data-polygon-overlay] > polygon')).toBeNull();
    expect(c.querySelectorAll('[data-polygon-edge-add]')).toHaveLength(3);
    expect(c.querySelector('[data-polygon-edge-add="3"]')).toBeNull();
    // All vertices keep their handles — only the closing edge is gone.
    expect(c.querySelectorAll('[data-polygon-vertex]')).toHaveLength(4);
  });

  it('a closed overlay keeps the polygon outline and an edge "+" per edge', () => {
    const c = renderOverlay(makePolygon({ id: 'p0' }));
    expect(c.querySelector('g[data-polygon-overlay] > polygon')).not.toBeNull();
    expect(c.querySelectorAll('[data-polygon-edge-add]')).toHaveLength(4);
  });

  // Density gate: an edge too short on screen to comfortably host the 14px
  // "+" disc skips it — a detailed traced shape (30-50 vertices) otherwise
  // disappears under a chain of overlapping discs when zoomed out. The discs
  // come back as you zoom in (vertex handles always stay).
  it('skips edge "+" discs on edges too short on screen, and restores them with zoom', () => {
    // A 100×20 rectangle: the two short edges (20px at zoom 1) are under the
    // ~42px floor; the two long ones (100px) are not.
    const thin = makePolygon({
      id: 'p0',
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 20 },
        { x: 0, y: 20 },
      ],
    });
    const atZoom1 = renderOverlay(thin);
    expect(atZoom1.querySelectorAll('[data-polygon-edge-add]')).toHaveLength(2);
    expect(atZoom1.querySelectorAll('[data-polygon-vertex]')).toHaveLength(4);
    // 'crosshair', not the old 'copy' (the OS drag-duplicate cursor) — the
    // disc inserts a vertex, it doesn't copy anything.
    const disc = atZoom1.querySelector('[data-polygon-edge-add]') as SVGGElement;
    expect(disc.style.cursor).toBe('crosshair');
    atZoom1.remove();

    useViewportStore.setState({ zoom: 4 }); // short edges now 80px on screen
    try {
      const zoomedIn = renderOverlay(thin);
      expect(zoomedIn.querySelectorAll('[data-polygon-edge-add]')).toHaveLength(4);
    } finally {
      useViewportStore.setState({ zoom: 1 });
    }
  });
});

describe('<PolygonView /> locked body is click-through unless selected', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false, zoom: 1 });
  });

  it('a locked, unselected body ignores pointer events (clicks land on what is beneath)', () => {
    const { container } = renderBody(makePolygon({ id: 'p0', locked: true }));
    expect(body(container).getAttribute('pointer-events')).toBe('none');
  });

  it('a locked body stays clickable while selected (popover unlock stays reachable)', () => {
    const { container } = renderBody(makePolygon({ id: 'p0', locked: true }), { selected: true });
    // Closed-body default: whole-shape hit-testing (no pointer-events override).
    expect(body(container).getAttribute('pointer-events')).toBeNull();
  });

  it('a locked OPEN body keeps stroke hit-testing while selected', () => {
    const { container } = renderBody(makePolygon({ id: 'p0', closed: false, locked: true }), {
      selected: true,
    });
    expect(body(container).getAttribute('pointer-events')).toBe('stroke');
  });

  it('an unlocked, unselected body keeps whole-body hit-testing', () => {
    const { container } = renderBody(makePolygon({ id: 'p0' }));
    expect(body(container).getAttribute('pointer-events')).toBeNull();
  });
});

describe('<PolygonView /> locked polygons (E5c)', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false, zoom: 1 });
  });

  function renderOverlay(polygon: Polygon) {
    return render(
      <svg>
        <PolygonView
          polygon={polygon}
          layer="overlay"
          selected
          selectedVertexIndices={new Set()}
          interactive
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
          onVertexPointerDown={noop}
          onVertexClick={noop}
          onEdgeAddPointerDown={noop}
        />
      </svg>,
    ).container;
  }

  it('a locked, selected polygon keeps the outline and renders its adornments GHOSTED (inactive)', () => {
    const c = renderOverlay(makePolygon({ id: 'p0', locked: true }));
    // Outline stays so the selection (and the popover's unlock toggle) is visible.
    expect(c.querySelector('g[data-polygon-overlay] > polygon')).not.toBeNull();
    // Handles + edge "+" render — a re-selected locked polygon would otherwise
    // only show a thin dashed line, far too easy to miss — but inert: no
    // pointer events, reduced opacity.
    const wrap = c.querySelector('[data-polygon-adornments]')!;
    expect(wrap.getAttribute('data-polygon-adornments')).toBe('inactive');
    expect(wrap.getAttribute('pointer-events')).toBe('none');
    expect(Number(wrap.getAttribute('opacity'))).toBeLessThan(1);
    expect(c.querySelectorAll('[data-polygon-vertex]')).toHaveLength(4);
    expect(c.querySelectorAll('[data-polygon-edge-add]')).toHaveLength(4);
  });

  it('an UNlocked, selected polygon shows the handles fully active (contrast — same fixture, lock off)', () => {
    const c = renderOverlay(makePolygon({ id: 'p0' }));
    const wrap = c.querySelector('[data-polygon-adornments]')!;
    expect(wrap.getAttribute('data-polygon-adornments')).toBe('active');
    expect(wrap.getAttribute('pointer-events')).toBeNull();
    expect(wrap.getAttribute('opacity')).toBeNull();
    expect(c.querySelectorAll('[data-polygon-vertex]')).toHaveLength(4);
    expect(c.querySelectorAll('[data-polygon-edge-add]')).toHaveLength(4);
  });

  it('a translucent fill hex renders directly as the fill attr (no separate fill-opacity)', () => {
    // Transparency now lives in the color's alpha channel, not a fill-opacity attr.
    const { container } = renderBody(makePolygon({ id: 'p0', fill: '#11223380' }));
    const el = body(container);
    expect(el.getAttribute('fill')).toBe('#11223380');
    expect(el.getAttribute('fill-opacity')).toBeNull();
  });

  it('an opaque fill renders as 6-digit hex with no fill-opacity attr', () => {
    const { container } = renderBody(makePolygon({ id: 'p0', fill: '#112233' }));
    const el = body(container);
    expect(el.getAttribute('fill')).toBe('#112233');
    expect(el.getAttribute('fill-opacity')).toBeNull();
  });
});

describe('<PolygonView /> hit proxy (selected-on-top drag target)', () => {
  beforeEach(() => useViewportStore.setState({ darkMode: false, zoom: 1 }));

  function renderHit(
    polygon: Polygon,
    opts: { selected?: boolean; interactive?: boolean; onPointerDown?: (id: string) => void } = {},
  ) {
    return render(
      <svg>
        <PolygonView
          polygon={polygon}
          layer="hit"
          selected={opts.selected ?? true}
          selectedVertexIndices={new Set()}
          interactive={opts.interactive ?? true}
          onPointerDown={opts.onPointerDown ?? noop}
          onClick={noop}
          onContextMenu={noop}
          onVertexPointerDown={noop}
          onVertexClick={noop}
          onEdgeAddPointerDown={noop}
        />
      </svg>,
    ).container;
  }

  const hit = (c: HTMLElement) => c.querySelector('[data-polygon-hit="p0"]');

  it('a selected, unlocked, interactive CLOSED polygon renders a transparent whole-body hit path', () => {
    const c = renderHit(makePolygon({ id: 'p0', fill: '#112233' }));
    const el = hit(c)!;
    expect(el).not.toBeNull();
    expect(el.tagName.toLowerCase()).toBe('path');
    // Transparent fill + pointer-events:all so the interior is grabbable without
    // painting anything.
    expect(el.getAttribute('fill')).toBe('transparent');
    expect(el.getAttribute('pointer-events')).toBe('all');
    // Must NOT reuse data-polygon-id — that would duplicate the body's id and
    // break the e2e [data-polygon-id] document-order + strict-mode locators.
    expect(el.getAttribute('data-polygon-id')).toBeNull();
    // Same body geometry (rounded path data) so the grab footprint matches.
    expect(el.getAttribute('d')).toBe(c.querySelector('[data-polygon-hit]')!.getAttribute('d'));
    // Also covers the stroke BAND (transparent stroke of the body's width) so
    // the outer rim — grabbable on the body — stays grabbable on the proxy.
    expect(el.getAttribute('stroke')).toBe('transparent');
    // makePolygon defaults strokeWidth: 1.
    expect(Number(el.getAttribute('stroke-width'))).toBe(1);
  });

  it("the closed proxy's stroke band tracks the body's stroke width", () => {
    const c = renderHit(makePolygon({ id: 'p0', strokeWidth: 4 }));
    expect(Number(hit(c)!.getAttribute('stroke-width'))).toBe(4);
  });

  it('an OPEN polygon proxy is stroke-only and floors its hit corridor to OPEN_HIT_MIN_PX/zoom', () => {
    // Body stroke 1 < the 10px floor, so the corridor floors to 10 at zoom 1.
    const c = renderHit(makePolygon({ id: 'p0', closed: false, strokeWidth: 1 }));
    const el = hit(c)!;
    expect(el.getAttribute('fill')).toBe('none');
    expect(el.getAttribute('pointer-events')).toBe('stroke');
    expect(Number(el.getAttribute('stroke-width'))).toBe(10);
    expect(el.getAttribute('d') ?? '').not.toContain('Z');
  });

  it('the open-polygon hit corridor scales with zoom (constant on screen)', () => {
    useViewportStore.setState({ zoom: 0.5 });
    const c = renderHit(makePolygon({ id: 'p0', closed: false, strokeWidth: 1 }));
    // 10px floor / 0.5 zoom = 20 world units.
    expect(Number(hit(c)!.getAttribute('stroke-width'))).toBe(20);
  });

  it('the open-polygon corridor honors a wider body stroke over the floor', () => {
    const c = renderHit(makePolygon({ id: 'p0', closed: false, strokeWidth: 20 }));
    // max(20, 10) = 20 — the visible stroke already exceeds the floor.
    expect(Number(hit(c)!.getAttribute('stroke-width'))).toBe(20);
  });

  it('routes a pointer-down to the polygon body drag handler with the id', () => {
    const onPointerDown = vi.fn();
    const c = renderHit(makePolygon({ id: 'p0' }), { onPointerDown });
    fireEvent.pointerDown(hit(c)!);
    expect(onPointerDown).toHaveBeenCalledWith('p0', expect.anything());
  });

  it('renders no proxy when not selected', () => {
    expect(hit(renderHit(makePolygon({ id: 'p0' }), { selected: false }))).toBeNull();
  });

  it('renders no proxy when locked (a locked polygon is not draggable)', () => {
    expect(hit(renderHit(makePolygon({ id: 'p0', locked: true })))).toBeNull();
  });

  it('renders no proxy while non-interactive (placement tool active → clicks fall through)', () => {
    expect(hit(renderHit(makePolygon({ id: 'p0' }), { interactive: false }))).toBeNull();
  });
});

describe('<PolygonView /> corner rounding', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false });
  });

  it('draws straight edges (no quadratic) when curveRadius is unset', () => {
    const { container } = renderBody(makePolygon({ id: 'p0' }));
    const d = body(container).getAttribute('d') ?? '';
    expect(d).not.toContain('Q');
  });

  it('rounds the corners (quadratics) when curveRadius > 0, keeping fill/stroke', () => {
    const { container } = renderBody(
      makePolygon({ id: 'p0', fill: '#112233', stroke: '#445566', curveRadius: 12 }),
    );
    const el = body(container);
    expect(el.getAttribute('d') ?? '').toContain('Q');
    expect(el.getAttribute('fill')).toBe('#112233');
    expect(el.getAttribute('stroke')).toBe('#445566');
  });
});
