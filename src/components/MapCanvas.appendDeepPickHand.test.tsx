import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// hand/pan mode must be pan-only. Every other Edit Stops mutation path
// is gated on it (onCanvasClick's `if (inHandMode) return`,
// useStationInteraction's `onClick: modeInert || inHandMode ? undefined`,
// LineTagsLayer's tag pointerdown, and the sibling idle deep-pick's
// `if (inHandMode || uiMode.kind !== 'idle') return false`). appendDeepPick has
// no such guard, and since the splice-by-alt-click change it MUTATES the doc.
//
// Harness mirrors src/components/MapCanvas.appendSpliceByClick.test.tsx.
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

// Middle of the armed segment: only the edited line's own stripe is under the
// cursor. The stripe keeps pointerEvents="stroke" in hand mode (SegmentBand's
// `active` is `interactive && !decorative`; `interactive` is true for the whole
// appending-to-line mode and never consults inHandMode), so a real browser's
// elementsFromPoint reports it here exactly like this stub does.
const stubStripeOnly = () => {
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [
    ownStripe(),
  ];
};

// A no-move hand press: pointerdown starts a pan, pointerup ends it WITHOUT
// setting dragState.suppressClick (useViewport only sets it when panMoved), so
// the trailing click runs the full onClickCapture chain.
const altClickStripe = () =>
  act(() => {
    fireEvent.click(ownStripe(), { button: 0, altKey: true, clientX: 300, clientY: 300 });
  });

const stationCount = () => Object.keys(useDoc.getState().stations).length;

describe('Edit Stops alt-pick must be inert in hand/pan mode', () => {
  it('space-held: alt-click on the armed segment does NOT splice a station in', () => {
    render(<App />);
    seedAndEnter();
    stubSvgRect();
    stubStripeOnly();
    act(() => useSelection.getState().setAppendCursor({ kind: 'edge', from: 'A', to: 'B' }));
    act(() => useSelection.setState({ ...useSelection.getState(), spaceHeld: true }));

    altClickStripe();

    const line = useDoc.getState().lines.L1;
    expect(stationCount()).toBe(2);
    expect(line.stations).toEqual(['A', 'B']);
    expect(line.edges).toContain('A|B');
  });

  it('hand tool: alt-click on the armed segment does NOT splice a station in', () => {
    render(<App />);
    seedAndEnter();
    stubSvgRect();
    stubStripeOnly();
    act(() => useSelection.getState().setAppendCursor({ kind: 'edge', from: 'A', to: 'B' }));
    act(() => useSelection.setState({ ...useSelection.getState(), toolMode: 'hand' }));

    altClickStripe();

    const line = useDoc.getState().lines.L1;
    expect(stationCount()).toBe(2);
    expect(line.stations).toEqual(['A', 'B']);
    expect(line.edges).toContain('A|B');
  });

  it('hand mode alt-click records NO undo entry', () => {
    render(<App />);
    seedAndEnter();
    stubSvgRect();
    stubStripeOnly();
    act(() => useSelection.getState().setAppendCursor({ kind: 'edge', from: 'A', to: 'B' }));
    act(() => useSelection.setState({ ...useSelection.getState(), spaceHeld: true }));
    useDoc.temporal.getState().clear();

    altClickStripe();

    expect(useDoc.temporal.getState().pastStates.length).toBe(0);
  });
});
