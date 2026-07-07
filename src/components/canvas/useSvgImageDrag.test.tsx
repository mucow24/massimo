import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSvgImageDrag, type SvgImageDragApi } from './useSvgImageDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makeSvgImage, makeTextLabel } from '../../test/fixtures';
import { measureTextLabel } from '../../geometry/textMeasure';
import { fakeSvgRef, pointerEvent } from '../../test/interaction';

type Result = { current: SvgImageDragApi };
const identity = (mx: number, my: number) => ({ x: mx, y: my });
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));
const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

const seed = (over = {}) =>
  useDoc.setState({
    ...useDoc.getState(),
    svgImages: { i0: makeSvgImage({ id: 'i0', x: 0, y: 0, width: 100, height: 60, ...over }) },
    svgImageOrder: ['i0'],
  });

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({ ...useSelection.getState(), selectedSvgImageIds: [] });
  useViewportStore.setState({ zoom: 1, gridSize: 10 });
  setModes({ line: false, all: 'off', grid: 'both' });
  dragState.suppressClick = false;
});

const render = () => {
  const { ref } = fakeSvgRef();
  return renderHook(() => useSvgImageDrag(ref, 1, false, identity)).result as Result;
};

describe('useSvgImageDrag — move', () => {
  it('snaps the highest-leftmost (rotated) anchor corner to the grid', () => {
    seed({ width: 60, height: 60 }); // corners at ±30 → anchor TL (-30,-30)
    const r = render();
    act(() => r.current.onSvgImagePointerDown('i0', pointerEvent({ clientX: 100, clientY: 100 })));
    // Δscreen (43,43) → anchor proposed (13,13) → grid-snap (10,10) → center +40.
    move(r, pointerEvent({ clientX: 143, clientY: 143 }));
    up(r, pointerEvent({ clientX: 143, clientY: 143 }));
    expect(useDoc.getState().svgImages.i0.x).toBeCloseTo(40, 5);
    expect(useDoc.getState().svgImages.i0.y).toBeCloseTo(40, 5);
  });

  it("'Snap to all' aligns the anchor corner to a text label's upper-left corner", () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    seed({ width: 60, height: 60 }); // anchor TL (-30,-30)
    const label = makeTextLabel({ id: 't0', x: 300, y: 300, fontSize: 40 });
    useDoc.setState({ ...useDoc.getState(), textLabels: { t0: label } });
    const m = measureTextLabel(label);
    const ulx = 300 - m.width / 2;

    const r = render();
    act(() => r.current.onSvgImagePointerDown('i0', pointerEvent({ clientX: 100, clientY: 100 })));
    // Propose the anchor 3 right of the label's UL-corner vertical axis, far
    // below the label so only that axis engages → snaps x to the corner's.
    const dx = ulx + 3 - -30;
    move(r, pointerEvent({ clientX: 100 + dx, clientY: 230 }));
    up(r, pointerEvent({ clientX: 100 + dx, clientY: 230 }));

    // Center = snapped anchor + (30,30).
    expect(useDoc.getState().svgImages.i0.x).toBeCloseTo(ulx + 30, 5);
    expect(useDoc.getState().svgImages.i0.y).toBeCloseTo(130, 5);
  });
});

describe('useSvgImageDrag — resize snap gate', () => {
  it('snaps the moving edge to the grid while axis-aligned', () => {
    seed({ rotation: 0 }); // left edge fixed at x=-50
    const r = render();
    act(() => r.current.onSvgEdgePointerDown('i0', 1, pointerEvent({ clientX: 0, clientY: 0 })));
    // Pointer world (73,0) → grid-snap (70,0) → width = |70 - (-50)| = 120.
    move(r, pointerEvent({ clientX: 73, clientY: 0 }));
    up(r, pointerEvent({ clientX: 73, clientY: 0 }));
    expect(useDoc.getState().svgImages.i0.width).toBeCloseTo(120, 5);
  });

  it('Shift bypasses the snap (free resize) even when axis-aligned', () => {
    seed({ rotation: 0 });
    const r = render();
    act(() => r.current.onSvgEdgePointerDown('i0', 1, pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 73, clientY: 0, shiftKey: true }));
    up(r, pointerEvent({ clientX: 73, clientY: 0, shiftKey: true }));
    // Unsnapped width = |73 - (-50)| = 123.
    expect(useDoc.getState().svgImages.i0.width).toBeCloseTo(123, 5);
  });

  it('does NOT snap when the image is rotated off-axis', () => {
    seed({ rotation: 45 });
    const r = render();
    act(() => r.current.onSvgEdgePointerDown('i0', 1, pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 73, clientY: 0 }));
    up(r, pointerEvent({ clientX: 73, clientY: 0 }));
    // Free resize in the rotated local frame → ~101.62, not the grid-snapped 120.
    expect(useDoc.getState().svgImages.i0.width).toBeCloseTo(101.62, 1);
  });
});

describe('useSvgImageDrag — rotate', () => {
  it('snaps rotation to 22.5° only when Shift is held', () => {
    seed();
    const r = render();
    // Pointer 30° clockwise from up, at radius 100: (sin30, -cos30)*100 = (50, -86.6).
    act(() => r.current.onSvgRotatePointerDown('i0', pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 50, clientY: -86.6, shiftKey: true }));
    up(r, pointerEvent({ clientX: 50, clientY: -86.6, shiftKey: true }));
    expect(useDoc.getState().svgImages.i0.rotation).toBe(22.5);
  });

  it('rotates freely without Shift', () => {
    seed();
    const r = render();
    act(() => r.current.onSvgRotatePointerDown('i0', pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 50, clientY: -86.6 }));
    up(r, pointerEvent({ clientX: 50, clientY: -86.6 }));
    expect(useDoc.getState().svgImages.i0.rotation).toBeCloseTo(30, 1);
  });
});
