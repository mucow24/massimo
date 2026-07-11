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
  useViewportStore.setState({ darkMode: false, zoom: 1 });
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
    useViewportStore.setState({ darkMode: true });
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
