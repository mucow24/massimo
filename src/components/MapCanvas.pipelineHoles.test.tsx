import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { beginHistoryGroup, useDoc } from '../state/store';
import { setDragFrame } from '../state/dragFrame';
import { setRenderDocOverlay } from '../state/renderDoc';
import * as regionCache from '../geometry/regionCache';
import { mintAnchors } from '../geometry/lineRegions';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { LineId, Station } from '../model/types';
import type { Ring } from '../geometry/clip';

// While the pipeline serves a frame's holes, MapCanvas's synchronous region
// build must stand down COMPLETELY — that build is the exact work the worker
// took over, and recomputing it per landed frame would undo the pipelining.
// The exclusion clips keep painting, from the pipeline's holes.

const station = (id: string, x: number, y: number, lineIds: string[]): Station =>
  makeStation({ id, x, y, stops: lineIds.map((l) => makeStop(l)) });

const seedCrossingWithAssignment = () => {
  const stations: Record<string, Station> = {};
  for (const s of [
    station('s1', 0, 0, ['l1']),
    station('s2', 400, 0, ['l1']),
    station('s3', 200, -50, ['l2']),
    station('s4', 200, 50, ['l2']),
  ]) {
    stations[s.id] = s;
  }
  const lines = {
    l1: makeLine({ id: 'l1', stations: ['s1', 's2'] }),
    l2: makeLine({ id: 'l2', stations: ['s3', 's4'] }),
  };
  const { bands, faces } = regionCache.regionsFor({ stations, lines, lineCircles: {} });
  expect(faces.length).toBeGreaterThan(0);
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations,
      lines,
      lineOrder: ['l1', 'l2'],
      regionAssignments: {
        r1: { id: 'r1', lineId: 'l2', lines: faces[0].lineIds, anchors: mintAnchors(faces[0], bands) },
      },
    });
  });
};

const fakeHoles = (): Map<LineId, Ring[]> =>
  new Map([
    [
      'l1',
      [
        [
          { x: 190, y: -10 },
          { x: 210, y: -10 },
          { x: 210, y: 10 },
          { x: 190, y: 10 },
        ],
      ],
    ],
  ]);

beforeEach(() => {
  setDragFrame(null);
  setRenderDocOverlay(null);
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

afterEach(() => {
  setDragFrame(null);
  setRenderDocOverlay(null);
  vi.restoreAllMocks();
});

describe('MapCanvas with pipelined holes armed', () => {
  it('stops calling regionsFor, paints clips from the frame, and resumes on disarm', () => {
    const spy = vi.spyOn(regionCache, 'regionsFor');
    const { container } = render(<App />);
    seedCrossingWithAssignment();
    const atRestCalls = spy.mock.calls.length;
    expect(atRestCalls).toBeGreaterThan(0);
    expect(container.querySelectorAll('clipPath').length).toBeGreaterThan(0);

    // A frame lands: holes now come from the pipeline.
    act(() => setDragFrame({ holes: fakeHoles(), guides: [] }));
    expect(spy.mock.calls.length).toBe(atRestCalls);
    // The exclude clips still paint — from the frame's holes.
    expect(container.querySelectorAll('clipPath').length).toBeGreaterThan(0);

    // Doc writes while armed must not trigger a synchronous build either.
    // Mid-drag they arrive inside a deferPersist group (which also gates the
    // store's own reconcile — writing OUTSIDE a group runs regionsFor twice
    // in the commit machinery, which is not the canvas's doing).
    const group = beginHistoryGroup({ deferPersist: true });
    act(() => useDoc.getState().moveStation('s3', 210, -50));
    expect(spy.mock.calls.length).toBe(atRestCalls);
    act(() => group.rollback());

    // Disarm: the synchronous path resumes.
    act(() => setDragFrame(null));
    expect(spy.mock.calls.length).toBeGreaterThan(atRestCalls);
  });
});
