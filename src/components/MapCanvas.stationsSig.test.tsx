import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import * as interlining from '../geometry/interlining';
import type { Line, Station } from '../model/types';
import { makeLine } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const label: Station['label'] = {
  row: 0,
  col: -1,
  rotation: 0,
  offset: 0,
  align: 'auto',
  valign: 'middle',
};

// Two stations joined by two interlined horizontal lines — enough for real
// band merging, stop markers, and ordered renderables to exist.
const seedInterlinedPair = () => {
  const stops: Station['stops'] = [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
    { lineId: 'L2', row: 1, col: 0, orientation: 'auto-horizontal' },
  ];
  const s1: Station = { id: 's1', name: 'S1', x: 0, y: 0, rotation: 0, stops, label };
  const s2: Station = { id: 's2', name: 'S2', x: 200, y: 0, rotation: 0, stops, label };
  const mkLine = (id: string, color: string): Line =>
    makeLine({
      id,
      service: id,
      name: `${id} line`,
      color,
      stations: ['s1', 's2'],
    });
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1, s2 },
      lines: { L1: mkLine('L1', '#0039A6'), L2: mkLine('L2', '#EE352E') },
      lineOrder: ['L1', 'L2'],
    });
  });
};

describe('MapCanvas — station edits and the geometry memos', () => {
  // buildBandGeometry reads only station x/y/rotation and each stop's
  // lineId/row/col/orientation; buildStopMarkers reads the same set. Label
  // and dot presentation edits write the stations record without touching
  // any of those fields, so the geometry memos must HOLD across them —
  // otherwise every Alt keyboard fine-nudge (App.tsx writes
  // setLabelOffset/setLabelOffsetPerp) runs full band routing on a busy map.
  // This is the stations-side twin of the linesGeometrySig tests
  // in MapCanvas.width.test.tsx.
  it('a label-offset edit does NOT rebuild bands or stop markers', () => {
    const bandSpy = vi.spyOn(interlining, 'buildBandGeometry');
    const markerSpy = vi.spyOn(interlining, 'buildStopMarkers');
    render(<App />);
    seedInterlinedPair();

    const bandCalls = bandSpy.mock.calls.length;
    const markerCalls = markerSpy.mock.calls.length;
    expect(bandCalls).toBeGreaterThan(0);

    act(() => {
      useDoc.getState().setLabelOffset('s1', 5);
      useDoc.getState().setLabelOffsetPerp('s1', -3);
    });

    expect(bandSpy.mock.calls.length).toBe(bandCalls);
    expect(markerSpy.mock.calls.length).toBe(markerCalls);
  });

  it('a per-stop dot-size edit does NOT rebuild bands or stop markers', () => {
    const bandSpy = vi.spyOn(interlining, 'buildBandGeometry');
    const markerSpy = vi.spyOn(interlining, 'buildStopMarkers');
    render(<App />);
    seedInterlinedPair();

    const bandCalls = bandSpy.mock.calls.length;
    const markerCalls = markerSpy.mock.calls.length;

    act(() => {
      useDoc.getState().setDotSize('s1', 'L1', 20);
    });

    expect(bandSpy.mock.calls.length).toBe(bandCalls);
    expect(markerSpy.mock.calls.length).toBe(markerCalls);
  });

  it('a stop (row/col) move DOES rebuild band geometry', () => {
    const bandSpy = vi.spyOn(interlining, 'buildBandGeometry');
    render(<App />);
    seedInterlinedPair();

    const bandCalls = bandSpy.mock.calls.length;

    act(() => {
      useDoc.getState().moveStop('s1', 'L1', 1, 0);
    });

    expect(bandSpy.mock.calls.length).toBeGreaterThan(bandCalls);
  });

  it('a station move DOES rebuild band geometry', () => {
    const bandSpy = vi.spyOn(interlining, 'buildBandGeometry');
    render(<App />);
    seedInterlinedPair();

    const bandCalls = bandSpy.mock.calls.length;

    act(() => {
      useDoc.getState().moveStation('s1', 10, 10);
    });

    expect(bandSpy.mock.calls.length).toBeGreaterThan(bandCalls);
  });

  it('a station rotation DOES rebuild band geometry', () => {
    const bandSpy = vi.spyOn(interlining, 'buildBandGeometry');
    render(<App />);
    seedInterlinedPair();

    const bandCalls = bandSpy.mock.calls.length;

    act(() => {
      useDoc.getState().rotateStation('s1');
    });

    expect(bandSpy.mock.calls.length).toBeGreaterThan(bandCalls);
  });

  it('closing a loop (toggleEdgeOnLine) DOES rebuild band geometry immediately', () => {
    // Regression: linesGeometrySig must key on `edges`, not `stations`.
    // toggleEdgeOnLine changes `edges` only, so before the fix the band memo
    // held and the wrap corridor didn't render until some other edit fired.
    const bandSpy = vi.spyOn(interlining, 'buildBandGeometry');
    render(<App />);
    const stop = { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' as const };
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: {
          s1: { id: 's1', name: 'S1', x: 0, y: 0, rotation: 0, stops: [stop], label },
          s2: { id: 's2', name: 'S2', x: 100, y: 0, rotation: 0, stops: [stop], label },
          s3: { id: 's3', name: 'S3', x: 100, y: 100, rotation: 0, stops: [stop], label },
        },
        lines: { L1: makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] }) },
        lineOrder: ['L1'],
      });
    });
    const bandCalls = bandSpy.mock.calls.length;
    expect(bandCalls).toBeGreaterThan(0);

    act(() => {
      useDoc.getState().toggleEdgeOnLine('L1', 's1', 's3'); // close the loop
    });
    expect(bandSpy.mock.calls.length).toBeGreaterThan(bandCalls);
  });
});
