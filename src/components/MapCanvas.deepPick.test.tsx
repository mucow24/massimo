import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makePolygon, makeStation, makeStop, makeLine } from '../test/fixtures';

// jsdom reports clientWidth/clientHeight as 0, which collapses the viewBox to
// 0×0. Give the canvas a real size for the duration of these tests (mirrors
// MapCanvas.hitProxy.test.tsx).
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
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
    selectedLineId: null,
    editingStationId: null,
    toolMode: 'arrow',
    spaceHeld: false,
    uiMode: { kind: 'idle' },
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

// A station over a line over a polygon near the origin. The station's
// generous hit rect buries the stripe and the polygon body for plain clicks —
// the exact situation deep-pick exists for. The line needs TWO stations or
// no band stripe renders at all.
function seed() {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        s1: makeStation({ id: 's1', name: 'S1', x: 0, y: 0, stops: [makeStop('L1')] }),
        s2: makeStation({ id: 's2', name: 'S2', x: 100, y: 0, stops: [makeStop('L1')] }),
      },
      lines: { L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }) },
      lineOrder: ['L1'],
      polygons: { p0: makePolygon({ id: 'p0' }) },
      polygonOrder: ['p0'],
    });
  });
}

// The under-cursor stack, topmost-first, as document.elementsFromPoint would
// report it: station hit rect, then the line stripe, then the polygon body.
// jsdom can't hit-test (it doesn't define elementsFromPoint at all), so
// assign the snapshot; the resolver runs against these real rendered elements.
const stackEls = () => {
  const els = [
    document.querySelector('[data-station-id="s1"] rect'),
    document.querySelector('[data-band-stripe][data-line-id="L1"]'),
    document.querySelector('path[data-polygon-id="p0"]'),
  ];
  els.forEach((el, i) => {
    if (!el) throw new Error(`stack element ${i} missing from the rendered canvas`);
  });
  return els as Element[];
};
const stubStack = () => {
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () =>
    stackEls();
};

const altClick = (el: Element) =>
  act(() => {
    fireEvent.click(el, { button: 0, altKey: true, clientX: 10, clientY: 10 });
  });

describe('MapCanvas — Alt+click deep-picks through the under-cursor stack', () => {
  it('with nothing selected, alt+click selects the topmost entity (same as a plain click)', () => {
    render(<App />);
    seed();
    stubStack();
    altClick(stackEls()[0]);
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
  });

  it('with the topmost (station) selected, alt+click selects the line beneath', () => {
    render(<App />);
    seed();
    stubStack();
    act(() => useSelection.getState().selectStation('s1'));
    altClick(stackEls()[0]);
    const sel = useSelection.getState();
    expect(sel.selectedLineId).toBe('L1');
    expect(sel.selectedStationIds).toEqual([]);
  });

  it('with the line selected, alt+click reaches the polygon beneath it (line editor pre-cleared)', () => {
    render(<App />);
    seed();
    stubStack();
    act(() => useSelection.getState().selectLine('L1'));
    altClick(stackEls()[0]);
    const sel = useSelection.getState();
    // Without the pre-clear, exitLineEditorOnItemClick would consume this
    // click ("click off the line to exit") and nothing would get selected.
    expect(sel.selectedPolygonIds).toEqual(['p0']);
    expect(sel.selectedLineId).toBeNull();
  });

  it('wraps from the bottom of the stack back to the top', () => {
    render(<App />);
    seed();
    stubStack();
    act(() => useSelection.getState().selectPolygon('p0'));
    altClick(stackEls()[0]);
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
  });

  it('a plain click never consults elementsFromPoint (deep-pick is alt-only)', () => {
    render(<App />);
    seed();
    // No stub installed: a call would throw, failing this test.
    act(() => {
      fireEvent.click(stackEls()[0], { button: 0, clientX: 10, clientY: 10 });
    });
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
  });

  it('does not deep-pick the trailing click of a drag (suppressClick)', () => {
    render(<App />);
    seed();
    stubStack();
    act(() => useSelection.getState().selectStation('s1'));
    dragState.suppressClick = true;
    altClick(stackEls()[0]);
    // Unchanged: neither cycled nor re-selected.
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
    expect(useSelection.getState().selectedLineId).toBeNull();
  });

  it('is inert in hand mode (alt+click neither selects nor cycles)', () => {
    render(<App />);
    seed();
    stubStack();
    act(() => useSelection.setState({ ...useSelection.getState(), toolMode: 'hand' }));
    altClick(stackEls()[0]);
    expect(useSelection.getState().selectedStationIds).toEqual([]);
    expect(useSelection.getState().selectedLineId).toBeNull();
  });

  it('is inert in non-idle modes (never consults elementsFromPoint)', () => {
    render(<App />);
    seed();
    // No stub installed: a call would throw, failing this test.
    act(() => useSelection.getState().setUiMode({ kind: 'creating-line-tag' }));
    act(() => {
      fireEvent.click(stackEls()[0], { button: 0, altKey: true, clientX: 10, clientY: 10 });
    });
    expect(useSelection.getState().uiMode.kind).toBe('creating-line-tag');
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });

  it('does not deep-pick under an open station rename editor', () => {
    render(<App />);
    seed();
    // No stub installed: a call would throw, failing this test.
    act(() => {
      useSelection.getState().selectStation('s1');
      useSelection.getState().setEditingStationId('s1');
    });
    altClick(stackEls()[0]);
    // The editor stays open and the selection was not cycled away.
    expect(useSelection.getState().editingStationId).toBe('s1');
    expect(useSelection.getState().selectedLineId).toBeNull();
  });

  it('alt+double-click never opens the rename editor (dblclick is two cycling clicks)', () => {
    render(<App />);
    seed();
    stubStack();
    const rect = stackEls()[0];
    altClick(rect); // → station
    altClick(rect); // → line
    // The browser synthesizes a native dblclick from two rapid clicks at the
    // same point regardless of per-click stopPropagation.
    act(() => {
      fireEvent.dblClick(rect, { button: 0, altKey: true, clientX: 10, clientY: 10 });
    });
    expect(useSelection.getState().editingStationId).toBeNull();
    // The deep-picked selection survives.
    expect(useSelection.getState().selectedLineId).toBe('L1');
  });

  it('a plain double-click still opens the rename editor (the dblclick gate is alt-only)', () => {
    render(<App />);
    seed();
    act(() => {
      fireEvent.dblClick(stackEls()[0], { button: 0, clientX: 10, clientY: 10 });
    });
    expect(useSelection.getState().editingStationId).toBe('s1');
  });

  it('preserves shift on the re-dispatch: the deep-picked station joins the multi-selection', () => {
    render(<App />);
    seed();
    stubStack();
    // s2 is sole-selected but not in the stack → next is the topmost (s1);
    // shift must reach s1's own handler as a membership TOGGLE, not a replace.
    act(() => useSelection.getState().selectStation('s2'));
    act(() => {
      fireEvent.click(stackEls()[0], {
        button: 0,
        altKey: true,
        shiftKey: true,
        clientX: 10,
        clientY: 10,
      });
    });
    expect(useSelection.getState().selectedStationIds).toEqual(['s2', 's1']);
  });

  // Locked items are click-through (pointer-events: none), so elementsFromPoint
  // never reports them — the deep-pick point-tests them geometrically and
  // appends them below the live stack. jsdom's zero-size getBoundingClientRect
  // breaks screenToWorld, so give the svg a real rect and click its center
  // (client 400,300 → world 0,0 at zoom 1 — inside the default polygon).
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
  const altClickCenter = (el: Element) =>
    act(() => {
      fireEvent.click(el, { button: 0, altKey: true, clientX: 400, clientY: 300 });
    });

  it('cycles into a locked polygon that elementsFromPoint cannot see, then wraps', () => {
    render(<App />);
    seed();
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        polygons: { p0: makePolygon({ id: 'p0', locked: true }) },
      });
    });
    stubSvgRect();
    // The under-cursor DOM stack holds only the live surfaces — the locked
    // polygon is pointer-events:none and absent.
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [
      document.querySelector('[data-station-id="s1"] rect')!,
      document.querySelector('[data-band-stripe][data-line-id="L1"]')!,
    ];
    act(() => useSelection.getState().selectLine('L1'));
    altClickCenter(document.querySelector('[data-station-id="s1"] rect')!);
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p0']);
    // Wrap: from the locked bottom entry back to the top of the stack.
    altClickCenter(document.querySelector('[data-station-id="s1"] rect')!);
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
  });

  it('alt+click over nothing but locked art selects it directly', () => {
    render(<App />);
    seed();
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        polygons: { p0: makePolygon({ id: 'p0', locked: true }) },
      });
    });
    stubSvgRect();
    const bg = document.querySelector('[data-bg]')!;
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [bg];
    altClickCenter(bg);
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p0']);
  });

  it('drops ctrl on the re-dispatch (a deep-pick must never trigger redistribute)', () => {
    render(<App />);
    seed();
    stubStack();
    const redistributeBetween = vi.fn();
    act(() =>
      useDoc.setState({ redistributeBetween } as unknown as Partial<
        ReturnType<typeof useDoc.getState>
      >),
    );
    act(() => useSelection.getState().selectStation('s2'));
    act(() => {
      fireEvent.click(stackEls()[0], {
        button: 0,
        altKey: true,
        ctrlKey: true,
        clientX: 10,
        clientY: 10,
      });
    });
    expect(redistributeBetween).not.toHaveBeenCalled();
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
  });
});
