import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Profiler } from 'react';
import App from '../App';
import { DEFAULT_DOC } from '../model/transforms';
import type { LineId, StationId } from '../model/types';
import { useSelection } from '../state/selection';
import { dragState, useDoc } from '../state/store';
import { useLiveViewportStore } from '../state/viewportStore';
import { makeLine, stationWithStop } from '../test/fixtures';

// Arming a pan must not re-render the canvas, and must not restyle it.
//
// The canvas is one composited layer of ~15k nodes on a real drawing, and
// Blink re-runs the compositing update over the whole thing for ANY change
// inside it — at roughly 4µs a node. So the cost of starting a pan was never
// about what starting a pan does; it was about how many nodes got touched.
// Middle-press latency on a 464-station map, against a ~0.5ms floor: 49ms
// baseline -> 21.7ms, from two changes. `panning` left React state (a
// re-render of this tree), and the "grabbing" cursor moved off the svg —
// `cursor` is inherited, so a rule whose subject is the svg restyles every
// descendant — onto a childless overlay toggled by `pointer-events`, which
// paints nothing.
//
// A third change, holding the layer's `will-change` for the session, would
// take this to ~8ms and is deliberately NOT here: it taxes every station-drag
// frame instead. See styles.css.
//
// Both shipped changes are one line away from coming back, and neither would
// fail an existing test. These are the pins.

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    toolMode: 'arrow',
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    appendHover: null,
  });
  useLiveViewportStore.setState({ pending: null, panning: false });
  dragState.suppressClick = false;
});

const seed = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1' as LineId, { x: 200, y: 0 }),
      },
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
    });
  });
};

const middlePressBackground = () => {
  const bg = document.querySelector('[data-bg]')!;
  fireEvent.pointerDown(bg, { button: 1, buttons: 4, clientX: 300, clientY: 300, pointerId: 7 });
  return bg;
};

describe('MapCanvas — arming a pan', () => {
  it('does not re-render the canvas', () => {
    let commits = 0;
    render(
      <Profiler id="probe" onRender={() => commits++}>
        <App />
      </Profiler>,
    );
    seed();

    commits = 0;
    act(() => {
      middlePressBackground();
    });

    // The pan IS armed — otherwise this asserts nothing.
    expect(useLiveViewportStore.getState().panning).toBe(true);
    // ...and arming it re-rendered nothing. A `panning` boolean read anywhere
    // in this tree's JSX puts this straight back to a full canvas render.
    expect(commits).toBe(0);
  });

  it('marks the host, never the svg — the svg would restyle every descendant', () => {
    render(<App />);
    seed();
    act(() => {
      middlePressBackground();
    });

    expect(document.querySelector('.canvas-host.panning')).not.toBeNull();
    // `cursor` is inherited: a class on the svg makes Blink recompute inherited
    // style for the whole map. It must stay off the svg.
    expect(document.querySelector('svg.panning')).toBeNull();
  });

  it('keeps a childless overlay mounted to carry the grabbing cursor', () => {
    render(<App />);
    seed();

    // Always mounted, at rest and mid-pan: only its hit-testability changes
    // (pointer-events, which paints nothing). Mounting it on demand would be a
    // paint change, and a paint change re-composites the whole map.
    const overlay = document.querySelector('.pan-cursor-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.children.length).toBe(0);

    act(() => {
      middlePressBackground();
    });
    expect(document.querySelector('.pan-cursor-overlay')).not.toBeNull();
  });
});
