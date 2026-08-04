import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import App from '../App';
import { SelectionPopover } from './SelectionPopover';
import { StationInspector } from './inspector';
import { beginHistoryGroup, useDoc, useSelection } from '../state/store';
import { setRenderDocOverlay, type DragFrameDoc } from '../state/renderDoc';
import { DEFAULT_DOC } from '../model/transforms';
import type { Station, StationId } from '../model/types';
import { makeLine } from '../test/fixtures';

// Everything that PAINTS map content reads through the render source, so that
// an armed drag frame renders coherently while the live doc runs a frame
// ahead. These tests pin the two ends of that contract at the DOM: the canvas
// itself, and the inspector's coordinate readout (the number must never lead
// the picture). The store-level semantics (mirror-at-rest, zero notifications
// while armed) are pinned in renderDoc.test.ts.

beforeEach(() => {
  setRenderDocOverlay(null);
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

afterEach(() => {
  setRenderDocOverlay(null);
});

const label: Station['label'] = {
  row: 0,
  col: -1,
  rotation: 0,
  offset: 0,
  align: 'auto',
  valign: 'middle',
};

const seedPair = () => {
  const stops: Station['stops'] = [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
  ];
  const s1: Station = { id: 's1', name: 'S1', x: 0, y: 0, rotation: 0, stops, label };
  const s2: Station = { id: 's2', name: 'S2', x: 200, y: 0, rotation: 0, stops, label };
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1, s2 },
      lines: { L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }) },
      lineOrder: ['L1'],
    });
  });
};

/** The seven towed collections as of now — what the pipeline would arm. */
const frameOf = (): DragFrameDoc => {
  const d = useDoc.getState();
  return {
    stations: d.stations,
    lineCircles: d.lineCircles,
    polygons: d.polygons,
    svgImages: d.svgImages,
    routeBullets: d.routeBullets,
    textLabels: d.textLabels,
    transferAnchors: d.transferAnchors,
  };
};

const stationTransform = (c: HTMLElement, id: string) =>
  c.querySelector(`g[data-station-id="${id}"]`)?.getAttribute('transform');

describe('the canvas paints the render source, not the live doc', () => {
  it('an armed frame holds the painted position while the live doc runs ahead', () => {
    const { container } = render(<App />);
    seedPair();
    expect(stationTransform(container, 's1')).toBe('translate(0 0) rotate(0)');

    // Drag begins: arm with the pre-drag frame, then the gesture keeps
    // writing the live doc ahead of it.
    act(() => setRenderDocOverlay(frameOf()));
    act(() => useDoc.getState().moveStation('s1', 500, 300));
    expect(useDoc.getState().stations['s1'].x).toBe(500);
    expect(stationTransform(container, 's1')).toBe('translate(0 0) rotate(0)');

    // Frame N's result arrives: the pipeline re-arms with the newer slice,
    // and the paint advances as one piece.
    act(() => setRenderDocOverlay(frameOf()));
    expect(stationTransform(container, 's1')).toBe('translate(500 300) rotate(0)');

    // Gesture exit disarms; the paint stays converged with the doc.
    act(() => setRenderDocOverlay(null));
    expect(stationTransform(container, 's1')).toBe('translate(500 300) rotate(0)');
  });

  // The other half of the freeze contract: not only must the paint hold
  // still, but a live doc write at input cadence (60-125Hz) must not re-run
  // any component at all — a "no-op" render pass across the canvas, the
  // sidebar's 464-station re-sort, and the popover chrome is exactly the
  // per-event tax that starves frame landings on slow machines. Nothing may
  // hold a reactive subscription to the towed collections; input handlers
  // ask the store at event time instead. Shared by the app-wide pin and the
  // direct SelectionPopover mount below.
  const expectZeroCommitsWhileArmed = (ui: React.ReactElement, prepare?: () => void) => {
    let commits = 0;
    render(
      <Profiler id="probe" onRender={() => commits++}>
        {ui}
      </Profiler>,
    );
    seedPair();
    if (prepare) act(prepare);
    // Mirror a real pipelined gesture: grouped history (paused), armed frame.
    const history = beginHistoryGroup({ deferPersist: true });
    act(() => setRenderDocOverlay(frameOf()));
    commits = 0;
    act(() => useDoc.getState().moveStation('s1', 500, 300));
    expect(commits).toBe(0);
    act(() => {
      history.cancel();
      setRenderDocOverlay(null);
    });
  };

  it('an armed frame absorbs a mid-drag doc write with ZERO React commits', () => {
    // Covers MapCanvas (via the drag hooks), the sidebar, and ItemPopovers'
    // own subscriptions. Its PANELS never mount here — the jsdom host
    // measures 0×0, so ItemPopovers bails before choosing one — which is why
    // SelectionPopover gets its own direct-mount pin below.
    expectZeroCommitsWhileArmed(<App />, () =>
      useSelection.getState().selectStation('s1' as StationId),
    );
  });

  it('the multi-selection group popover holds too (its own subscriptions)', () => {
    // The panel a group drag runs under, mounted directly since ItemPopovers
    // cannot mount it under jsdom's 0×0 host.
    expectZeroCommitsWhileArmed(
      <SelectionPopover
        ids={{
          stations: ['s1', 's2'] as StationId[],
          bullets: [],
          labels: [],
          polygons: [],
          svgImages: [],
          anchors: [],
          lineCircles: [],
        }}
        hostW={800}
      />,
    );
  });

  it("the inspector's X/Y readout shows the frame, never ahead of it", () => {
    seedPair();
    render(<StationInspector id={'s1' as StationId} />);
    const x = screen.getByLabelText('X') as HTMLInputElement;
    expect(x.value).toBe('0');

    act(() => setRenderDocOverlay(frameOf()));
    act(() => useDoc.getState().moveStation('s1', 500, 300));
    // The live doc says 500; the canvas is still painting 0 — the readout
    // must agree with the picture, not the doc.
    expect(x.value).toBe('0');

    act(() => setRenderDocOverlay(frameOf()));
    expect(x.value).toBe('500');
  });
});
