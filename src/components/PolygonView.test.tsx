import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { PolygonView } from './PolygonView';
import { makePolygon } from '../test/fixtures';
import { useViewportStore } from '../state/viewportStore';
import type { Polygon } from '../model/types';

const noop = () => {};

function renderBody(polygon: Polygon) {
  return render(
    <svg>
      <PolygonView
        polygon={polygon}
        layer="body"
        selected={false}
        selectedVertexIndex={null}
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
          selectedVertexIndex={null}
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

  it('dashed selection outline keeps a constant stroke width + dash spacing', () => {
    for (const zoom of [1, 2]) {
      const c = renderOverlay(zoom);
      const outline = c.querySelector('g[data-polygon-overlay] > polygon')!;
      expect(Number(outline.getAttribute('stroke-width')) * zoom).toBeCloseTo(1.5);
      expect(outline.getAttribute('stroke-dasharray')).toBe(`${4 / zoom} ${3 / zoom}`);
    }
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
          selectedVertexIndex={null}
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
          selectedVertexIndex={null}
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

  it('a locked, selected polygon keeps the selection outline but drops all editing adornments', () => {
    const c = renderOverlay(makePolygon({ id: 'p0', locked: true }));
    // Outline stays so the selection (and the popover's unlock toggle) is visible.
    expect(c.querySelector('g[data-polygon-overlay] > polygon')).not.toBeNull();
    // No vertex handles, no edge "+" buttons while locked.
    expect(c.querySelectorAll('[data-polygon-vertex]')).toHaveLength(0);
    expect(c.querySelectorAll('[data-polygon-edge-add]')).toHaveLength(0);
  });

  it('an UNlocked, selected polygon shows the handles (contrast — same fixture, lock off)', () => {
    const c = renderOverlay(makePolygon({ id: 'p0' }));
    expect(c.querySelectorAll('[data-polygon-vertex]')).toHaveLength(4);
    expect(c.querySelectorAll('[data-polygon-edge-add]')).toHaveLength(4);
  });

  it('fillOpacity reaches the body fill: 60 → 0.6', () => {
    const { container } = renderBody(makePolygon({ id: 'p0', fill: '#112233', fillOpacity: 60 }));
    const el = body(container);
    expect(el.getAttribute('fill')).toBe('#112233');
    expect(Number(el.getAttribute('fill-opacity'))).toBeCloseTo(0.6, 6);
  });

  it('fillOpacity defaults to fully opaque (100 → 1) when unset', () => {
    const { container } = renderBody(makePolygon({ id: 'p0', fill: '#112233' }));
    expect(Number(body(container).getAttribute('fill-opacity'))).toBeCloseTo(1, 6);
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
