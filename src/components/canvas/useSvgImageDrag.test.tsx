import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSvgImageDrag, type SvgImageDragApi } from './useSvgImageDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makePolygon, makeStation, makeSvgImage, makeTextLabel } from '../../test/fixtures';
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
    backgroundOrder: ['i0'],
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

// A stopless station — its anchor is a bare alignment point in the pool.
const stationAt = (id: string, x: number, y: number) => makeStation({ id, x, y });

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

  it('a group-drag master still aligns to stationary targets, towing by the snapped delta', () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    seed({ width: 60, height: 60 }); // anchor TL (-30,-30)
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0', vertices: [{ x: 100, y: 55 }] }) },
      backgroundOrder: ['p0'],
      textLabels: { t0: makeTextLabel({ id: 't0', x: 300, y: 300 }) },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedSvgImageIds: ['i0'],
      selectedLabelIds: ['t0'],
    });
    const r = render();
    // Δscreen (127,10) proposes the anchor at (97,-20): 3 from the stationary
    // polygon vertex's vertical axis x=100 → snaps → center (130, 10).
    act(() => r.current.onSvgImagePointerDown('i0', pointerEvent({ clientX: 100, clientY: 100 })));
    move(r, pointerEvent({ clientX: 227, clientY: 110 }));
    up(r, pointerEvent({ clientX: 227, clientY: 110 }));

    const doc = useDoc.getState();
    expect(doc.svgImages.i0.x).toBeCloseTo(130, 5);
    expect(doc.svgImages.i0.y).toBeCloseTo(10, 5);
    // The co-selected label tows by the post-snap delta (130, 10).
    expect(doc.textLabels['t0'].x).toBeCloseTo(430, 5);
    expect(doc.textLabels['t0'].y).toBeCloseTo(310, 5);
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

  it('an edge resize never engages (or shows) a perpendicular-only alignment', () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    seed({ rotation: 0 });
    // A stopless station at (999, 5): horizontal alignment only — an edge
    // resize along X cannot consume it, so it must not snap or draw a guide.
    useDoc.setState({
      ...useDoc.getState(),
      stations: { S: stationAt('S', 999, 5) },
    });
    const r = render();
    act(() => r.current.onSvgEdgePointerDown('i0', 1, pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 73, clientY: 3 }));

    expect(useDoc.getState().svgImages.i0.width).toBeCloseTo(123, 5);
    // Only the ever-present dimension readout — no alignment guide.
    expect(r.current.svgImageSnapGuides.filter((g) => !g.labelOnly)).toHaveLength(0);
    up(r, pointerEvent({ clientX: 73, clientY: 3 }));
  });

  it('an edge resize still aligns along its own axis, with a guide', () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    seed({ rotation: 0 });
    // A stopless station at (70, 999): vertical alignment — locks X, which the
    // right-edge drag consumes directly.
    useDoc.setState({
      ...useDoc.getState(),
      stations: { S: stationAt('S', 70, 999) },
    });
    const r = render();
    act(() => r.current.onSvgEdgePointerDown('i0', 1, pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 73, clientY: 3 }));

    expect(useDoc.getState().svgImages.i0.width).toBeCloseTo(120, 5); // |70 - (-50)|
    expect(r.current.svgImageSnapGuides.filter((g) => !g.labelOnly)).toHaveLength(1);
    up(r, pointerEvent({ clientX: 73, clientY: 3 }));
  });

  it('corner-resize guides drop when the aspect lock overrides the snapped point', () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    seed(); // 100×60 → BR corner at (50, 30), aspect locked to 5:3
    // Corner-snap bait at (120, 40): X drives (width 170), but the derived
    // height puts the corner at y=72 — the guide would point at a position
    // the corner never reaches, so no guides may render.
    useDoc.setState({
      ...useDoc.getState(),
      stations: { V: stationAt('V', 120, 999), H: stationAt('H', 999, 40) },
    });
    const r = render();
    act(() => r.current.onSvgCornerPointerDown('i0', 2, pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 118, clientY: 42 }));

    expect(useDoc.getState().svgImages.i0.width).toBeCloseTo(170, 5);
    expect(r.current.svgImageSnapGuides.filter((g) => !g.labelOnly)).toHaveLength(0);
    up(r, pointerEvent({ clientX: 118, clientY: 42 }));
  });
});

describe('useSvgImageDrag — resize dimension readout', () => {
  const readouts = (r: Result) => r.current.svgImageSnapGuides.filter((g) => g.labelOnly);

  it('shows the live width and height while an edge resize is in flight', () => {
    seed({ rotation: 0 }); // 100×60, left edge fixed at x=-50
    const r = render();
    act(() => r.current.onSvgEdgePointerDown('i0', 1, pointerEvent({ clientX: 0, clientY: 0 })));
    // Pointer world (73,0) → grid-snap (70,0) → width 120, height unchanged.
    move(r, pointerEvent({ clientX: 73, clientY: 0 }));
    const dims = readouts(r);
    expect(dims.map((g) => g.label)).toEqual(['120.0', '60.0']);
    // Ambient register: it rides every frame whether or not a snap engaged.
    expect(dims.every((g) => g.quiet)).toBe(true);
    // Width rides the top edge (TL→TR of the resized box, center x=10),
    // height the right edge (BR→TR) — both labels land outside the box.
    expect(dims[0].from).toEqual({ x: -50, y: -30 });
    expect(dims[0].to).toEqual({ x: 70, y: -30 });
    expect(dims[1].from).toEqual({ x: 70, y: 30 });
    expect(dims[1].to).toEqual({ x: 70, y: -30 });
    up(r, pointerEvent({ clientX: 73, clientY: 0 }));
    expect(r.current.svgImageSnapGuides).toHaveLength(0);
  });

  it('shows both dimensions during a corner resize (aspect-locked)', () => {
    setModes({ line: false, all: 'off', grid: 'off' });
    seed(); // 100×60, BR corner at (50,30), anchor TL (-50,-30)
    const r = render();
    act(() => r.current.onSvgCornerPointerDown('i0', 2, pointerEvent({ clientX: 0, clientY: 0 })));
    // rawW 170 drives (rawH only 30) → 170 × 102.
    move(r, pointerEvent({ clientX: 120, clientY: 0 }));
    expect(readouts(r).map((g) => g.label)).toEqual(['170.0', '102.0']);
    up(r, pointerEvent({ clientX: 120, clientY: 0 }));
    expect(r.current.svgImageSnapGuides).toHaveLength(0);
  });

  it('a whole-image move shows no dimension readout', () => {
    seed();
    const r = render();
    act(() => r.current.onSvgImagePointerDown('i0', pointerEvent({ clientX: 100, clientY: 100 })));
    move(r, pointerEvent({ clientX: 143, clientY: 143 }));
    expect(readouts(r)).toHaveLength(0);
    up(r, pointerEvent({ clientX: 143, clientY: 143 }));
  });
});

describe('useSvgImageDrag — rotate', () => {
  it('snaps rotation to 22.5° by default (Shift NOT held)', () => {
    seed();
    const r = render();
    // Pointer 30° clockwise from up, at radius 100: (sin30, -cos30)*100 = (50, -86.6).
    act(() => r.current.onSvgRotatePointerDown('i0', pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 50, clientY: -86.6 }));
    up(r, pointerEvent({ clientX: 50, clientY: -86.6 }));
    expect(useDoc.getState().svgImages.i0.rotation).toBe(22.5);
  });

  it('Shift frees the rotation (matches Shift = bypass everywhere else)', () => {
    seed();
    const r = render();
    act(() => r.current.onSvgRotatePointerDown('i0', pointerEvent({ clientX: 0, clientY: 0 })));
    move(r, pointerEvent({ clientX: 50, clientY: -86.6, shiftKey: true }));
    up(r, pointerEvent({ clientX: 50, clientY: -86.6 }));
    expect(useDoc.getState().svgImages.i0.rotation).toBeCloseTo(30, 1);
  });
});
