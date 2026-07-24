import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import { pairKeyOf } from '../model/pairKey';
import type { LineId, StationId } from '../model/types';

// Edit Stops: alt-click ON the armed segment splices a new station into it at
// the click point (the "drop a stop mid-segment" gesture). Previously the
// alt-click was intercepted by the alt-pick, which only ever RE-ARMED the
// segment under the cursor — so clicking the middle of the armed segment did
// nothing. Now the alt-pick, landing back on the already-armed segment,
// splices instead (the same create the alt-click over empty canvas makes).

// jsdom reports clientWidth/clientHeight as 0, collapsing the viewBox to 0×0.
// Give the canvas a real size (mirrors MapCanvas.deepPick.test.tsx).
const sizeProps = ['clientWidth', 'clientHeight'] as const;
const originals: Partial<Record<(typeof sizeProps)[number], PropertyDescriptor>> = {};
beforeEach(() => {
  for (const prop of sizeProps) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
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
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
  dragState.suppressClick = false;
});
afterEach(() => {
  for (const prop of sizeProps) {
    const d = originals[prop];
    if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
  delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
});

// L1 runs a single edge A-B → one band with one stripe for corridor A|B. The
// stripe needs both endpoint stations to carry an L1 stop or no band renders.
const seedAndEnter = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: makeStation({ id: 'A' as StationId, x: 0, y: 0, stops: [makeStop('L1' as LineId)] }),
        B: makeStation({ id: 'B' as StationId, x: 200, y: 0, stops: [makeStop('L1' as LineId)] }),
      },
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

const ownStripe = () =>
  document.querySelector('[data-band-stripe][data-line-id="L1"][data-pair-key="A|B"]')!;

// The svg needs a real rect for screenToWorld to resolve the drop point.
const stubSvgRect = () => {
  const svg = document.querySelector('.canvas-host svg') as SVGSVGElement;
  svg.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    }) as ReturnType<SVGSVGElement['getBoundingClientRect']>;
};

// The under-cursor stack in the MIDDLE of the segment: just the edited line's
// own stripe (no station hit rects there). jsdom can't hit-test, so feed the
// snapshot; resolveAppendStack runs against the real rendered stripe.
const stubStripeOnly = () => {
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [
    ownStripe(),
  ];
};

const altClickStripe = () =>
  act(() => {
    fireEvent.click(ownStripe(), { button: 0, altKey: true, clientX: 300, clientY: 300 });
  });

const newMember = () =>
  (useDoc.getState().lines.L1.stations as string[]).find((id) => id !== 'A' && id !== 'B');

describe('Edit Stops — alt-click on the armed segment splices a station', () => {
  it('splices a NEW member into the armed edge, rewiring A|B into A|new + new|B', () => {
    render(<App />);
    seedAndEnter();
    stubSvgRect();
    stubStripeOnly();
    act(() => useSelection.getState().setAppendCursor({ kind: 'edge', from: 'A', to: 'B' }));

    altClickStripe();

    const line = useDoc.getState().lines.L1;
    expect(line.stations).toHaveLength(3);
    const nid = newMember();
    expect(nid).toBeDefined();
    expect(line.edges).not.toContain('A|B');
    expect(line.edges).toContain(pairKeyOf('A' as StationId, nid as StationId));
    expect(line.edges).toContain(pairKeyOf(nid as StationId, 'B' as StationId));
  });

  it('advances the cursor to the far half of the split (marching toward `to`)', () => {
    render(<App />);
    seedAndEnter();
    stubSvgRect();
    stubStripeOnly();
    act(() => useSelection.getState().setAppendCursor({ kind: 'edge', from: 'A', to: 'B' }));

    altClickStripe();

    const nid = newMember();
    const mode = useSelection.getState().uiMode;
    expect(mode.kind).toBe('appending-to-line');
    expect(mode.kind === 'appending-to-line' && mode.cursor).toEqual({
      kind: 'edge',
      from: nid,
      to: 'B',
    });
  });

  it('one undo removes both the new station and its wiring (grouped)', () => {
    render(<App />);
    seedAndEnter();
    stubSvgRect();
    stubStripeOnly();
    act(() => useSelection.getState().setAppendCursor({ kind: 'edge', from: 'A', to: 'B' }));

    altClickStripe();
    const nid = newMember();
    expect(nid).toBeDefined();
    expect(useDoc.getState().stations[nid as string]).toBeDefined();

    act(() => useDoc.temporal.getState().undo());

    const line = useDoc.getState().lines.L1;
    expect(line.stations).toEqual(['A', 'B']);
    expect(line.edges).toContain('A|B');
    expect(useDoc.getState().stations[nid as string]).toBeUndefined();
  });

  it('alt-click on a NOT-yet-armed segment arms it — it does not splice yet', () => {
    render(<App />);
    seedAndEnter();
    stubSvgRect();
    stubStripeOnly();
    // Nothing armed: the alt-pick lands on the segment and arms it, exactly
    // like the plain click, so cycling can reach a buried segment first.
    expect(useSelection.getState().uiMode).toMatchObject({ cursor: null });

    altClickStripe();

    const line = useDoc.getState().lines.L1;
    expect(line.stations).toEqual(['A', 'B']); // no station created
    const mode = useSelection.getState().uiMode;
    expect(mode.kind === 'appending-to-line' && mode.cursor?.kind).toBe('edge');
  });
});
