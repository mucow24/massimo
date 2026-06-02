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
  container.querySelector('polygon[data-polygon-id="p0"]') as Element;

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

  it('falls back to the light colors in dark mode when no override is set', () => {
    useViewportStore.setState({ darkMode: true });
    const { container } = renderBody(makePolygon({ id: 'p0', fill: '#112233', stroke: '#445566' }));
    expect(body(container).getAttribute('fill')).toBe('#112233');
    expect(body(container).getAttribute('stroke')).toBe('#445566');
  });
});
