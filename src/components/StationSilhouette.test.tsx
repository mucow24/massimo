import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { StationSilhouette } from './StationSilhouette';
import { makeStation, makeStop } from '../test/fixtures';
import { useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine } from '../test/fixtures';

// A station carrying one stop so the silhouette has real geometry to trace.
const station = () => makeStation({ id: 's1', name: 'S1', stops: [makeStop('L1')] });

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    lines: { L1: makeLine({ id: 'L1', stations: ['s1'] }) },
    lineOrder: ['L1'],
  });
  useDoc.setState({ darkMode: false });
  useViewportStore.setState({ zoom: 1 });
});

afterEach(() => useViewportStore.setState({ zoom: 1 }));

const strokePaths = (layer: 'stroke' | 'match-stroke', strokeColor?: string) =>
  Array.from(
    render(
      <svg>
        <StationSilhouette station={station()} layer={layer} strokeColor={strokeColor} />
      </svg>,
    ).container.querySelectorAll('path'),
  );

describe('<StationSilhouette /> — selection stroke (no-snap two-tone)', () => {
  it('renders a black core over a white underlay (light), vector-effect, no zoom division', () => {
    // beforeEach sets darkMode: false → WBW.
    const [edge, core] = strokePaths('stroke');
    expect(edge.getAttribute('stroke')).toBe('#ffffff');
    expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
    expect(core.getAttribute('stroke')).toBe('#000000');
    expect(Number(core.getAttribute('stroke-width'))).toBe(2);
    for (const p of [edge, core]) {
      expect(p.getAttribute('fill')).toBe('none');
      expect(p.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    }
  });

  it('flips to a white core over a black underlay in dark mode (BWB)', () => {
    useDoc.setState({ darkMode: true });
    const [edge, core] = strokePaths('stroke');
    expect(edge.getAttribute('stroke')).toBe('#000000');
    expect(core.getAttribute('stroke')).toBe('#ffffff');
  });

  it('is zoom-independent: identical widths at committed zoom 2 (no snap)', () => {
    useViewportStore.setState({ zoom: 2 });
    const [edge, core] = strokePaths('stroke');
    expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
    expect(Number(core.getAttribute('stroke-width'))).toBe(2);
  });

  // The layout-edit focus passes an explicit white outline over the dim — a
  // single stroke, not the two-tone ring (the black rim would fight the dim).
  it('renders a single stroke in the strokeColor override case', () => {
    const paths = strokePaths('stroke', '#ffffff');
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('stroke')).toBe('#ffffff');
    expect(paths[0].getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });
});

describe('<StationSilhouette /> — Edit Stops hover-zone (map-consistent)', () => {
  const hoverZonePaths = () =>
    Array.from(
      render(
        <svg>
          <StationSilhouette station={station()} layer="hover-zone" />
        </svg>,
      ).container.querySelectorAll('[data-station-hover-zone] path'),
    );

  it('outlines the footprint with a SOLID ring (no dash), like the map hover', () => {
    // Previously dashed ("double-dotted"); now solid to match the main map's
    // station hover.
    for (const p of hoverZonePaths()) {
      expect(p.getAttribute('stroke-dasharray')).toBeNull();
    }
  });

  it('fills the footprint with a gentle light wash (was fill:none before)', () => {
    const washed = hoverZonePaths().filter((p) => (p.getAttribute('fill') ?? 'none') !== 'none');
    expect(washed).toHaveLength(1);
    const wash = washed[0];
    // A light lift that reads on the dimmed (dark) editor backdrop in both
    // themes — not the map's accent tint, which vanishes on the day-mode dim.
    expect(wash.getAttribute('fill')).toBe('#ffffff');
    const alpha = Number(wash.getAttribute('fill-opacity'));
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.3); // gentle
  });

  it('keeps the two-tone ring (white underlay + dark core) at 3/4 weight', () => {
    const strokes = hoverZonePaths().filter((p) => p.getAttribute('fill') === 'none');
    expect(strokes).toHaveLength(2);
    const widths = strokes.map((p) => Number(p.getAttribute('stroke-width')));
    expect(widths).toContain(3); // 4 × 0.75 underlay
    expect(widths).toContain(1.5); // 2 × 0.75 core
    expect(strokes.map((p) => p.getAttribute('stroke'))).toEqual(
      expect.arrayContaining(['#ffffff', '#000000']),
    );
  });
});

describe('<StationSilhouette /> — match stroke (mirror hint)', () => {
  it('is a single gray stroke held screen-constant by vector-effect', () => {
    const paths = strokePaths('match-stroke');
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('stroke')).toBe('#888');
    expect(paths[0].getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('does not divide the match stroke by zoom', () => {
    useViewportStore.setState({ zoom: 2 });
    const w1 = strokePaths('match-stroke')[0].getAttribute('stroke-width');
    useViewportStore.setState({ zoom: 4 });
    const w2 = strokePaths('match-stroke')[0].getAttribute('stroke-width');
    expect(w1).toBe(w2);
  });
});
