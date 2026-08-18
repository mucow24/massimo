import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRectSelect, type RectSelectApi } from './useRectSelect';
import { useDoc, useSelection, dragState } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import {
  makeLine,
  makeLineCircle,
  makePolygon,
  makeTextLabel,
  stationWithStop,
} from '../../test/fixtures';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';
import type { Pt } from '../../geometry/polygonUnion';
import type { StationId } from '../../model/types';

// Identity screen→world so a pointer at client (x, y) lands at world (x, y).
const identity = (mx: number, my: number): Pt => ({ x: mx, y: my });

type Result = { current: RectSelectApi };

// Hook handlers call React setState, so each invocation is wrapped in act() to
// flush before the test reads `result.current` (rect / preview ids).
const down = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerDown(e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));

function resetSelection(over: Record<string, unknown> = {}) {
  useSelection.setState({
    ...useSelection.getState(),
    toolMode: 'arrow',
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedAnchorIds: [],
    selectedGuideIds: [],
    ...over,
  });
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  resetSelection();
  useViewportStore.setState({
    showNetwork: true,
    showPolygons: true,
    showTextLabels: true,
    showSvgImages: true,
    showRouteBullets: true,
    showLineCircles: true,
  });
  dragState.suppressClick = false;
});

function render() {
  const { ref, svg } = fakeSvgRef();
  const { result } = renderHook(() => useRectSelect(ref, identity));
  return { result, ref, svg };
}

describe('useRectSelect — activation guards', () => {
  it('ignores non-left buttons', () => {
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, button: 2, target: ref.current }));
    move(result, pointerEvent({ clientX: 100, clientY: 100 }));
    expect(result.current.rect).toBeNull();
  });

  it('ignores pointerdowns that did not land on the background', () => {
    const { result } = render();
    const notBg = { hasAttribute: () => false } as unknown as Element;
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: notBg }));
    move(result, pointerEvent({ clientX: 100, clientY: 100 }));
    expect(result.current.rect).toBeNull();
  });

  it('is disabled in hand mode', () => {
    resetSelection({ toolMode: 'hand' });
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    move(result, pointerEvent({ clientX: 100, clientY: 100 }));
    expect(result.current.rect).toBeNull();
  });

  it('is disabled in a sticky non-idle ui mode', () => {
    resetSelection({ uiMode: { kind: 'placing-station' } });
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    move(result, pointerEvent({ clientX: 100, clientY: 100 }));
    expect(result.current.rect).toBeNull();
  });
});

describe('useRectSelect — can begin over a locked element', () => {
  // A locked item can't be dragged, so a drag starting over one should
  // rubber-band instead of doing nothing. Locked elements carry `data-locked`,
  // and the activation gate treats them as background for marquee purposes.
  it('starts a marquee when the pointerdown lands inside a [data-locked] element', () => {
    const { result } = render();
    const lockedTarget = {
      hasAttribute: () => false,
      closest: (sel: string) => (sel === '[data-locked]' ? ({} as Element) : null),
    } as unknown as Element;
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: lockedTarget }));
    move(result, pointerEvent({ clientX: 50, clientY: 50 }));
    expect(result.current.rect).toEqual({ x0: 10, y0: 10, x1: 50, y1: 50 });
  });
});

describe('useRectSelect — drag threshold + capture', () => {
  it('does not start a rect until the pointer moves past 4px', () => {
    const { result, ref, svg } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    move(result, pointerEvent({ clientX: 12, clientY: 12 })); // ~2.8px
    expect(result.current.rect).toBeNull();
    expect(svg.hasPointerCapture(1)).toBe(false);
    expect(dragState.suppressClick).toBe(false);
  });

  it('starts the rect, captures the pointer, and suppresses click once past 4px', () => {
    const { result, ref, svg } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    move(result, pointerEvent({ clientX: 50, clientY: 50 }));
    expect(result.current.rect).toEqual({ x0: 10, y0: 10, x1: 50, y1: 50 });
    expect(svg.hasPointerCapture(1)).toBe(true);
    expect(dragState.suppressClick).toBe(true);
  });

  it('survives a non-capturable pointer (setPointerCapture throws)', () => {
    // Some pointers can't be captured (the pointer is already gone, synthetic
    // events). The shared trackDragMove guards this; the marquee must start
    // anyway instead of crashing mid-gesture.
    const { result, ref, svg } = render();
    svg.setPointerCapture = () => {
      throw new Error('InvalidPointerId');
    };
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    move(result, pointerEvent({ clientX: 50, clientY: 50 }));
    expect(result.current.rect).toEqual({ x0: 10, y0: 10, x1: 50, y1: 50 });
    expect(dragState.suppressClick).toBe(true);
  });

  it('a click (down + up without crossing threshold) clears state and changes nothing', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    up(result, pointerEvent({ clientX: 11, clientY: 11 }));
    expect(result.current.rect).toBeNull();
    expect(result.current.previewStationIds).toBeNull();
    expect(useSelection.getState().selectedStationIds).toEqual(['A']);
  });
});

describe('useRectSelect — cancelled / dead gestures disarm', () => {
  // A stranded marquee is worse than a stranded item drag: the armed rect
  // follows every hover move, and a later unrelated pointerup COMMITS it —
  // silently replacing the selection with whatever the phantom rect swept.
  it('pointercancel clears the marquee and a later pointerup commits nothing', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    move(result, pointerEvent({ clientX: 50, clientY: 50 }));
    expect(result.current.rect).not.toBeNull();

    act(() => result.current.onPointerCancel());

    expect(result.current.rect).toBeNull();
    expect(result.current.previewStationIds).toBeNull();
    // 'set' mode over empty canvas would wipe the selection if the stale rect
    // were still armed.
    up(result, pointerEvent({ clientX: 200, clientY: 200 }));
    expect(useSelection.getState().selectedStationIds).toEqual(['A']);
  });

  it('a move with no buttons (lost pointerup) disarms the stranded marquee', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    move(result, pointerEvent({ clientX: 50, clientY: 50 }));
    expect(result.current.rect).not.toBeNull();

    // The pointerup was lost (released over foreign chrome / alt-tab); the
    // next hover move arrives with buttons === 0 and must disarm, not resize
    // a button-less marquee glued to the cursor.
    move(result, pointerEvent({ clientX: 120, clientY: 120, buttons: 0 }));

    expect(result.current.rect).toBeNull();
    up(result, pointerEvent({ clientX: 200, clientY: 200 }));
    expect(useSelection.getState().selectedStationIds).toEqual(['A']);
  });

  it('a sub-threshold armed press is also disarmed by a button-less move', () => {
    // Press within 4px of chrome, drift onto it, release there: the ref is
    // armed but never crossed the threshold, so there's no capture and no
    // marquee yet — the stale ref would still swallow the NEXT gesture's
    // moves. The first button-less hover move must clear it.
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 10, clientY: 10, target: ref.current }));
    move(result, pointerEvent({ clientX: 100, clientY: 100, buttons: 0 }));
    // Fresh state: a later move (new press elsewhere never happened) draws
    // nothing.
    move(result, pointerEvent({ clientX: 150, clientY: 150 }));
    expect(result.current.rect).toBeNull();
  });
});

describe('useRectSelect — preview + commit across all object types', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 50, y: 50 }) },
      routeBullets: {
        b1: { id: 'b1', x: 50, y: 50, rotation: 0, lineId: 'L1', shape: 'circle', size: 8 },
      },
      textLabels: { g1: makeTextLabel({ id: 'g1', x: 50, y: 50 }) },
      polygons: {
        p1: makePolygon({
          id: 'p1',
          vertices: [
            { x: 30, y: 30 },
            { x: 70, y: 30 },
            { x: 70, y: 70 },
            { x: 30, y: 70 },
          ],
        }),
      },
      backgroundOrder: ['p1'],
    });
  });

  it('previews every object type inside the rubber band while dragging', () => {
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 0, clientY: 0, target: ref.current }));
    move(result, pointerEvent({ clientX: 150, clientY: 150 }));
    expect(result.current.previewStationIds).toContain('S');
    expect(result.current.previewBulletIds).toContain('b1');
    expect(result.current.previewLabelIds).toContain('g1');
    expect(result.current.previewPolygonIds).toContain('p1');
  });

  it('commits the hits to the selection store and clears the preview on release', () => {
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 0, clientY: 0, target: ref.current }));
    move(result, pointerEvent({ clientX: 150, clientY: 150 }));
    up(result, pointerEvent({ clientX: 150, clientY: 150 }));

    const sel = useSelection.getState();
    expect(sel.selectedStationIds).toContain('S');
    expect(sel.selectedRouteBulletIds).toContain('b1');
    expect(sel.selectedLabelIds).toContain('g1');
    expect(sel.selectedPolygonIds).toContain('p1');
    expect(result.current.rect).toBeNull();
    expect(result.current.previewStationIds).toBeNull();
  });
});

describe('useRectSelect — free transfer anchors', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      transferAnchors: { an1: { id: 'an1', x: 50, y: 50 } },
    });
    // Anchors are marquee-able only while visible (the showAnchors toggle, or a
    // reveal mode) — anchorsForRectVisible gates on anchorsVisibleNow().
    useViewportStore.setState({ showNetwork: true, showAnchors: true });
  });

  it('previews and commits a free anchor swept by the band', () => {
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 0, clientY: 0, target: ref.current }));
    move(result, pointerEvent({ clientX: 150, clientY: 150 }));
    expect(result.current.previewAnchorIds).toContain('an1');
    up(result, pointerEvent({ clientX: 150, clientY: 150 }));
    expect(useSelection.getState().selectedAnchorIds).toContain('an1');
    expect(result.current.previewAnchorIds).toBeNull();
  });

  it('shift+ctrl removes an already-selected anchor (xor), like every other kind', () => {
    useSelection.setState({ ...useSelection.getState(), selectedAnchorIds: ['an1'] });
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 0, clientY: 0, target: ref.current }));
    move(result, pointerEvent({ clientX: 150, clientY: 150, shiftKey: true, ctrlKey: true }));
    up(result, pointerEvent({ clientX: 150, clientY: 150, shiftKey: true, ctrlKey: true }));
    expect(useSelection.getState().selectedAnchorIds).toEqual([]);
  });

  it('leaves hidden anchors out of the marquee', () => {
    // Same opt-out as a hidden network: an anchor you can't see must not be
    // silently swept into a selection that then answers Delete and the nudge keys.
    useViewportStore.setState({ showAnchors: false });
    resetSelection(); // idle uiMode: nothing reveals the anchors
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: 0, clientY: 0, target: ref.current }));
    move(result, pointerEvent({ clientX: 150, clientY: 150 }));
    expect(result.current.previewAnchorIds).toEqual([]);
    up(result, pointerEvent({ clientX: 150, clientY: 150 }));
    expect(useSelection.getState().selectedAnchorIds).toEqual([]);
  });
});

describe('useRectSelect — a hidden network stays out of the marquee', () => {
  // The lines/stations toggle exists so the art buried under the network can be
  // worked on. Station hits come from doc geometry, not the DOM, so hiding them
  // doesn't take them out of a marquee by itself: without this opt-out, throwing
  // a band around that art would also grab every station it crossed — an
  // invisible selection that then answers Delete and the nudge keys.
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 50, y: 50 }) },
      // Sits right under the station, which is the whole scenario.
      polygons: {
        p1: makePolygon({
          id: 'p1',
          vertices: [
            { x: 30, y: 30 },
            { x: 70, y: 30 },
            { x: 70, y: 70 },
            { x: 30, y: 70 },
          ],
        }),
      },
      backgroundOrder: ['p1'],
    });
  });

  const bandOverBoth = (result: Result, ref: ReturnType<typeof render>['ref']) => {
    down(result, pointerEvent({ clientX: 0, clientY: 0, target: ref.current }));
    move(result, pointerEvent({ clientX: 150, clientY: 150 }));
  };

  it('grabs both when the network is shown (baseline)', () => {
    const { result, ref } = render();
    bandOverBoth(result, ref);
    expect(result.current.previewStationIds).toContain('S');
    expect(result.current.previewPolygonIds).toContain('p1');
  });

  it('grabs the polygon underneath but not the hidden station', () => {
    useViewportStore.setState({ showNetwork: false });
    const { result, ref } = render();
    bandOverBoth(result, ref);
    expect(result.current.previewStationIds).toEqual([]);
    expect(result.current.previewPolygonIds).toContain('p1');
    up(result, pointerEvent({ clientX: 150, clientY: 150 }));
    expect(useSelection.getState().selectedStationIds).toEqual([]);
    expect(useSelection.getState().selectedPolygonIds).toContain('p1');
  });
});

describe('useRectSelect — a hidden KIND stays out of the marquee', () => {
  // Same rule as the hidden network above, one kind at a time: hits come from
  // doc geometry, so a hidden polygon would still join a band thrown over it —
  // an invisible selection that then answers Delete.
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        p1: makePolygon({
          id: 'p1',
          vertices: [
            { x: 30, y: 30 },
            { x: 70, y: 30 },
            { x: 70, y: 70 },
            { x: 30, y: 70 },
          ],
        }),
      },
      backgroundOrder: ['p1'],
      textLabels: { g1: makeTextLabel({ id: 'g1', x: 60, y: 60 }) },
      lineCircles: { c1: makeLineCircle({ id: 'c1', x: 60, y: 60, radius: 30 }) },
    });
  });

  const band = (result: Result, ref: ReturnType<typeof render>['ref']) => {
    down(result, pointerEvent({ clientX: 0, clientY: 0, target: ref.current }));
    move(result, pointerEvent({ clientX: 150, clientY: 150 }));
  };

  it('grabs every kind when all are shown (baseline)', () => {
    const { result, ref } = render();
    band(result, ref);
    expect(result.current.previewPolygonIds).toContain('p1');
    expect(result.current.previewLabelIds).toContain('g1');
    expect(result.current.previewLineCircleIds).toContain('c1');
  });

  it('leaves a hidden polygon out, on both the preview and the commit', () => {
    useViewportStore.setState({ showPolygons: false });
    const { result, ref } = render();
    band(result, ref);
    expect(result.current.previewPolygonIds).toEqual([]);
    // The commit path builds its own hit lists — a gate applied only to the
    // preview would look right mid-drag and select the invisible thing anyway.
    up(result, pointerEvent({ clientX: 150, clientY: 150 }));
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
    expect(useSelection.getState().selectedLabelIds).toContain('g1');
  });

  it('leaves a hidden canvas label out', () => {
    useViewportStore.setState({ showTextLabels: false });
    const { result, ref } = render();
    band(result, ref);
    expect(result.current.previewLabelIds).toEqual([]);
    expect(result.current.previewPolygonIds).toContain('p1');
  });

  it('leaves a hidden line circle out', () => {
    useViewportStore.setState({ showLineCircles: false });
    const { result, ref } = render();
    band(result, ref);
    expect(result.current.previewLineCircleIds).toEqual([]);
    expect(result.current.previewPolygonIds).toContain('p1');
  });
});

describe('useRectSelect — alt-marquee includes locked items (recovery path)', () => {
  // Locked items are click-through on the canvas, so an Alt-marquee is the
  // way to re-select one (to reach its popover's unlock toggle).
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p1: makePolygon({ id: 'p1', locked: true }) },
      backgroundOrder: ['p1'],
      textLabels: { g1: makeTextLabel({ id: 'g1', x: 0, y: 0, locked: true }) },
    });
  });

  it('a plain marquee still excludes locked items', () => {
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: -50, clientY: -50, target: ref.current }));
    move(result, pointerEvent({ clientX: 50, clientY: 50 }));
    up(result, pointerEvent({ clientX: 50, clientY: 50 }));
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
    expect(useSelection.getState().selectedLabelIds).toEqual([]);
  });

  it('an alt-marquee previews and selects locked items', () => {
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: -50, clientY: -50, target: ref.current }));
    move(result, pointerEvent({ clientX: 50, clientY: 50, altKey: true }));
    expect(result.current.previewPolygonIds).toContain('p1');
    expect(result.current.previewLabelIds).toContain('g1');
    up(result, pointerEvent({ clientX: 50, clientY: 50, altKey: true }));
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p1']);
    expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
  });

  it('releasing alt before pointerup commits WITHOUT locked items (release modifiers win)', () => {
    // Same contract as shift/ctrl: the commit reads the pointerup event's
    // modifiers, so mid-drag changes update the outcome.
    const { result, ref } = render();
    down(result, pointerEvent({ clientX: -50, clientY: -50, target: ref.current }));
    move(result, pointerEvent({ clientX: 50, clientY: 50, altKey: true }));
    expect(result.current.previewPolygonIds).toContain('p1');
    up(result, pointerEvent({ clientX: 50, clientY: 50 }));
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
    expect(useSelection.getState().selectedLabelIds).toEqual([]);
  });
});

describe('useRectSelect — modifier semantics', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A', 'B'] }) },
      lineOrder: ['L1'],
      stations: {
        A: stationWithStop('A' as StationId, 'L1', { x: 50, y: 50 }),
        B: stationWithStop('B' as StationId, 'L1', { x: 200, y: 200 }),
      },
    });
  });

  // Drag a rect from `from` to `to` with the given modifiers, then commit.
  function dragRect(
    result: Result,
    ref: { current: SVGSVGElement | null },
    from: Pt,
    to: Pt,
    mods: { shiftKey?: boolean; ctrlKey?: boolean } = {},
  ) {
    down(result, pointerEvent({ clientX: from.x, clientY: from.y, target: ref.current }));
    move(result, pointerEvent({ clientX: to.x, clientY: to.y, ...mods }));
    up(result, pointerEvent({ clientX: to.x, clientY: to.y, ...mods }));
  }

  it('no modifier replaces the selection (set)', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const { result, ref } = render();
    dragRect(result, ref, { x: 160, y: 160 }, { x: 260, y: 260 }); // over B only
    expect(useSelection.getState().selectedStationIds).toEqual(['B']);
  });

  it('no modifier also drops a selected alignment guide (set means set)', () => {
    // Guides are not marquee-sweepable — a rect can neither hit one nor miss
    // one — but "no modifier" means REPLACE the selection, and the seven
    // set*Selection actions between them don't touch selectedGuideIds. A guide
    // selected just before the marquee otherwise rides along into it: Delete
    // takes it out with the rest, a group drag tows it, and the sole-selection
    // popover never opens because the selection is two items.
    useSelection.getState().selectGuide('g1');
    const { result, ref } = render();
    dragRect(result, ref, { x: 160, y: 160 }, { x: 260, y: 260 }); // over B only
    expect(useSelection.getState().selectedStationIds).toEqual(['B']);
    expect(useSelection.getState().selectedGuideIds).toEqual([]);
  });

  it('shift keeps a selected guide, like every other kind it adds to', () => {
    useSelection.getState().selectGuide('g1');
    const { result, ref } = render();
    dragRect(result, ref, { x: 160, y: 160 }, { x: 260, y: 260 }, { shiftKey: true });
    expect(useSelection.getState().selectedGuideIds).toEqual(['g1']);
  });

  it('shift adds rect hits to the selection (add)', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const { result, ref } = render();
    dragRect(result, ref, { x: 160, y: 160 }, { x: 260, y: 260 }, { shiftKey: true });
    expect(useSelection.getState().selectedStationIds).toEqual(['A', 'B']);
  });

  it('shift+ctrl removes an already-selected hit (xor)', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const { result, ref } = render();
    dragRect(result, ref, { x: 0, y: 0 }, { x: 100, y: 100 }, { shiftKey: true, ctrlKey: true }); // over A
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });

  it('shift+ctrl adds a novel hit (xor)', () => {
    const { result, ref } = render();
    dragRect(
      result,
      ref,
      { x: 160, y: 160 },
      { x: 260, y: 260 },
      { shiftKey: true, ctrlKey: true },
    );
    expect(useSelection.getState().selectedStationIds).toEqual(['B']);
  });
});
