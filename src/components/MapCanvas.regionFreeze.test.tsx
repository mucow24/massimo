import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { beginHistoryGroup, useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import * as regionCache from '../geometry/regionCache';
import { mintAnchors } from '../geometry/lineRegions';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { RegionAssignment } from '../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Two crossings, far apart: H runs west-east; V1 crosses it at x=100, V2 at
 * x=500. Both crossing faces carry an override (winner H, beating the
 * verticals stacked above it), so each vertical wears an exclusion clip.
 */
const seedTwoCrossings = () => {
  const stations = {
    s1: makeStation({ id: 's1', x: 0, y: 1000, stops: [makeStop('H')] }),
    s2: makeStation({ id: 's2', x: 600, y: 1000, stops: [makeStop('H')] }),
    s3: makeStation({ id: 's3', x: 100, y: 900, stops: [makeStop('V1')] }),
    s4: makeStation({ id: 's4', x: 100, y: 1100, stops: [makeStop('V1')] }),
    s5: makeStation({ id: 's5', x: 500, y: 900, stops: [makeStop('V2')] }),
    s6: makeStation({ id: 's6', x: 500, y: 1100, stops: [makeStop('V2')] }),
  };
  const lines = {
    H: makeLine({ id: 'H', stations: ['s1', 's2'], color: '#0039a6' }),
    V1: makeLine({ id: 'V1', stations: ['s3', 's4'], color: '#ee352e' }),
    V2: makeLine({ id: 'V2', stations: ['s5', 's6'], color: '#00933c' }),
  };
  const geom = regionCache.regionsFor({ stations, lines });
  expect(geom.faces.length).toBe(2);
  const assignments: Record<string, RegionAssignment> = {};
  for (const face of geom.faces) {
    const id = `a-${face.lineIds.join('-')}`;
    assignments[id] = {
      id,
      lineId: 'H',
      lines: face.lineIds,
      anchors: mintAnchors(face, geom.bands),
    };
  }
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations,
      lines,
      lineOrder: ['V1', 'V2', 'H'],
      regionAssignments: assignments,
    });
  });
};

const clipFor = (container: HTMLElement, lineId: string) =>
  container.querySelector(`[data-region-exclude="${lineId}"] path`);

describe('MapCanvas — region freeze during a history group', () => {
  it('freezes the arrangement mid-group, drops holes near moved geometry, restores on commit', () => {
    const spy = vi.spyOn(regionCache, 'regionsFor');
    const { container } = render(<App />);
    seedTwoCrossings();

    expect(clipFor(container, 'V1')).toBeTruthy();
    expect(clipFor(container, 'V2')).toBeTruthy();
    const dV2Before = clipFor(container, 'V2')!.getAttribute('d');
    const callsBefore = spy.mock.calls.length;

    // A drag: group opens, geometry streams. The arrangement must NOT
    // recompute per frame; V1's hole (its corridor moved) must drop; V2's
    // must survive byte-identical. The moves stay INSIDE the map's extent —
    // only an extremal station dragged outward may grow the clip outer ring
    // (correctness backstop), which legitimately rewrites every clip's d.
    let group!: ReturnType<typeof beginHistoryGroup>;
    act(() => {
      group = beginHistoryGroup();
    });
    act(() => {
      useDoc.getState().moveStation('s3', 112, 906);
    });
    act(() => {
      useDoc.getState().moveStation('s3', 126, 913);
    });
    expect(spy.mock.calls.length).toBe(callsBefore);
    expect(clipFor(container, 'V1')).toBeNull();
    const v2Mid = clipFor(container, 'V2');
    expect(v2Mid).toBeTruthy();
    expect(v2Mid!.getAttribute('d')).toBe(dV2Before);

    // Commit: one fresh build, V1's hole comes back for the new geometry.
    act(() => {
      group.commit();
    });
    expect(spy.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(clipFor(container, 'V1')).toBeTruthy();
  });

  it('a cancelled gesture restores the original holes untouched', () => {
    const { container } = render(<App />);
    seedTwoCrossings();
    const dV1Before = clipFor(container, 'V1')!.getAttribute('d');

    let group!: ReturnType<typeof beginHistoryGroup>;
    act(() => {
      group = beginHistoryGroup();
    });
    act(() => {
      useDoc.getState().moveStation('s3', 140, 916);
    });
    expect(clipFor(container, 'V1')).toBeNull();
    act(() => {
      group.rollback();
    });
    expect(clipFor(container, 'V1')!.getAttribute('d')).toBe(dV1Before);
  });

  it('a pure click-group (no geometry change) never disturbs the clips', () => {
    const { container } = render(<App />);
    seedTwoCrossings();
    const v1Before = clipFor(container, 'V1');
    const dV1 = v1Before!.getAttribute('d');

    let group!: ReturnType<typeof beginHistoryGroup>;
    act(() => {
      group = beginHistoryGroup();
    });
    expect(clipFor(container, 'V1')!.getAttribute('d')).toBe(dV1);
    act(() => {
      group.cancel();
    });
    expect(clipFor(container, 'V1')!.getAttribute('d')).toBe(dV1);
  });
});
