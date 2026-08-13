import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useItemDrag, type ItemDragApi } from './useItemDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { clearHistory } from '../../state/history';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { textLabelAlignCorners } from '../../geometry/stationBoundary';
import { polygonSnapAnchor } from '../../geometry/polygon';
import { makeGuide, makeTextLabel } from '../../test/fixtures';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';

type Result = { current: ItemDragApi };
const labelDown = (r: Result, id: string, e: React.PointerEvent) =>
  act(() => r.current.onLabelPointerDown(id, e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  clearHistory();
  useSelection.getState().clearAllSelections();
  useViewportStore.setState({ zoom: 1, gridSize: 10, showGuides: true });
  // EVERY toggle off: guides must attract regardless.
  setModes({ line: false, all: 'off', grid: 'off', tens: false });
  dragState.suppressClick = false;
});

describe('useItemDrag — canvas labels vs alignment guides', () => {
  it('a label drag locks its snap anchor onto a horizontal guide with all modes off', () => {
    const label = makeTextLabel({ id: 'g1', x: 300, y: 300 });
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: label },
      guides: { gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100 }) },
    });
    // The label's primary snap reference is the topmost-then-leftmost corner
    // of its ALIGNMENT box (cap line → baseline), offset from (x, y).
    const anchorOffY = polygonSnapAnchor(textLabelAlignCorners(label)).y - label.y;

    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    // Drag so the label's CORNER lands 4 world units below the guide.
    const dy = 100 + 4 - anchorOffY - label.y;
    move(result, pointerEvent({ clientX: 0, clientY: dy }));
    // The corner locks onto the guide line…
    expect(useDoc.getState().textLabels.g1.y + anchorOffY).toBeCloseTo(100, 5);
    // …and the feedback is the engagement MARKER, not a distance chip.
    expect(result.current.itemSnapGuides.map((g) => g.alignGuideId)).toEqual(['gh']);
    up(result, pointerEvent({ clientX: 0, clientY: dy }));
    expect(useDoc.getState().textLabels.g1.y + anchorOffY).toBeCloseTo(100, 5);
  });

  it('the BOTTOM corner of the alignment box engages a guide too (four-corner snap)', () => {
    const label = makeTextLabel({ id: 'g1', x: 300, y: 300 });
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: label },
      guides: { gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100 }) },
    });
    // BL corner ([3] of the unrotated box) — the baseline edge, far from the
    // primary top-left anchor.
    const bottomOffY = textLabelAlignCorners(label)[3].y - label.y;

    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    // Drag so the BOTTOM corner lands 4 world units below the guide.
    const dy = 100 + 4 - bottomOffY - label.y;
    move(result, pointerEvent({ clientX: 0, clientY: dy }));
    // The baseline edge locks onto the guide line…
    expect(useDoc.getState().textLabels.g1.y + bottomOffY).toBeCloseTo(100, 5);
    expect(result.current.itemSnapGuides.map((g) => g.alignGuideId)).toEqual(['gh']);
    up(result, pointerEvent({ clientX: 0, clientY: dy }));
    expect(useDoc.getState().textLabels.g1.y + bottomOffY).toBeCloseTo(100, 5);
  });

  it('Shift declines the guide', () => {
    const label = makeTextLabel({ id: 'g1', x: 300, y: 300 });
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: label },
      guides: { gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100 }) },
    });
    const anchorOffY = polygonSnapAnchor(textLabelAlignCorners(label)).y - label.y;
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    const dy = 100 + 4 - anchorOffY - label.y;
    move(result, pointerEvent({ clientX: 0, clientY: dy, shiftKey: true }));
    expect(useDoc.getState().textLabels.g1.y + anchorOffY).toBeCloseTo(104, 5);
  });

  it('a hidden Guides layer drops the pool (no snapping to invisible targets)', () => {
    const label = makeTextLabel({ id: 'g1', x: 300, y: 300 });
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: label },
      guides: { gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100 }) },
    });
    useViewportStore.setState({ showGuides: false });
    const anchorOffY = polygonSnapAnchor(textLabelAlignCorners(label)).y - label.y;
    const { ref } = fakeSvgRef();
    const { result } = renderHook(() => useItemDrag(ref, 1, false));
    labelDown(result, 'g1', pointerEvent({ clientX: 0, clientY: 0 }));
    const dy = 100 + 4 - anchorOffY - label.y;
    move(result, pointerEvent({ clientX: 0, clientY: dy }));
    expect(useDoc.getState().textLabels.g1.y + anchorOffY).toBeCloseTo(104, 5);
  });
});
