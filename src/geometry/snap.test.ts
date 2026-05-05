import { describe, it, expect } from 'vitest';
import {
  alignmentPairs,
  axisForRotation,
  parallel,
  snapDraggedStation,
} from './snap';
import { makeStation, makeStop } from '../test/fixtures';
import type { Station, StationId, StopCell } from '../state/types';

describe('parallel', () => {
  it('flags vectors with the same direction', () => {
    expect(parallel({ x: 1, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });
  it('flags anti-parallel vectors', () => {
    expect(parallel({ x: 1, y: 0 }, { x: -1, y: 0 })).toBe(true);
  });
  it('rejects perpendicular vectors', () => {
    expect(parallel({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(false);
  });
});

describe('axisForRotation', () => {
  it('returns +y axis for rotation 0', () => {
    expect(axisForRotation(0)).toEqual({ x: 0, y: 1 });
  });
  it('returns +x axis for rotation 2', () => {
    expect(axisForRotation(2)).toEqual({ x: 1, y: 0 });
  });
  it('cycles every 4 rotations', () => {
    expect(axisForRotation(4)).toEqual(axisForRotation(0));
    expect(axisForRotation(5)).toEqual(axisForRotation(1));
  });
});

describe('alignmentPairs', () => {
  it('returns the rotation-axis fallback when neither side has stops', () => {
    const target = makeStation({ id: 't', x: 0, y: 0 });
    const pairs = alignmentPairs(0, [], target);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].axis).toEqual({ x: 0, y: 1 });
  });

  it('emits a pair for each shared line with parallel travel directions', () => {
    const target = makeStation({
      id: 't',
      x: 0,
      y: 100,
      stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L2', { row: 0, col: 1 })],
    });
    const draggedStops: StopCell[] = [
      makeStop('L1', { row: 0, col: 0 }),
      makeStop('L2', { row: 0, col: 1 }),
    ];
    const pairs = alignmentPairs(0, draggedStops, target);
    expect(pairs).toHaveLength(2);
  });

  it('emits no pairs when no line is shared with the target', () => {
    const target = makeStation({
      id: 't',
      x: 0,
      y: 100,
      stops: [makeStop('LX', { row: 0, col: 0 })],
    });
    const draggedStops: StopCell[] = [makeStop('LY', { row: 0, col: 0 })];
    expect(alignmentPairs(0, draggedStops, target)).toEqual([]);
  });
});

describe('snapDraggedStation', () => {
  const stations = (...sts: Station[]): Record<StationId, Station> => {
    const m: Record<StationId, Station> = {};
    for (const s of sts) m[s.id] = s;
    return m;
  };

  it('passes through unchanged when no snap candidates exist', () => {
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 50,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: [makeStop('L1')],
      stations: stations(makeStation({ id: 'd', x: 0, y: 0 })),
    });
    expect(r.x).toBe(50);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it('single-axis snap projects the dragged stop onto the target axis line', () => {
    // Target at world (100, 0) with one stop on L1 (auto-vertical, axis +y).
    // Dragging dragged station near (105, 50): it should snap to x=100.
    const target = makeStation({
      id: 't',
      x: 100,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 105,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(50, 5);
    expect(r.guides).toHaveLength(1);
  });

  it('two-axis snap places drag at the unique intersection', () => {
    // Target T1 at (100, 0) provides a vertical (axis +y) line through x=100.
    // Target T2 at (0, 200) provides a horizontal (axis +x) line through
    // y=200. A station with stops on both should snap to (100, 200).
    const t1 = makeStation({
      id: 't1',
      x: 100,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const t2 = makeStation({
      id: 't2',
      x: 0,
      y: 200,
      // rotation=2 turns local +y into world +x → 'auto-vertical' becomes
      // a horizontal axis in world coords.
      rotation: 2,
      stops: [makeStop('L2', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        // L2 stop must produce a HORIZONTAL world axis, matching t2 — set
        // orientation to auto-horizontal at rotation 0.
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-horizontal' }),
      ],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 102,
      proposedY: 198,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, t1, t2),
    });
    expect(r.x).toBeCloseTo(100, 3);
    expect(r.y).toBeCloseTo(200, 3);
    expect(r.guides.length).toBeGreaterThanOrEqual(2);
  });

  it('shifts within tolerance, leaves alone beyond it', () => {
    const target = makeStation({
      id: 't',
      x: 100,
      y: 0,
      stops: [makeStop('L1')],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1')],
    });
    // Within tolerance: snaps.
    const inTol = snapDraggedStation({
      draggedId: 'd',
      proposedX: 105,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      tolerance: 10,
    });
    expect(inTol.guides).toHaveLength(1);
    // Beyond tolerance: no snap.
    const outTol = snapDraggedStation({
      draggedId: 'd',
      proposedX: 200,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      tolerance: 10,
    });
    expect(outTol.guides).toEqual([]);
    expect(outTol.x).toBe(200);
  });

  it('consolidates an interlined band so only one snap engages, not N', () => {
    // 3 lines on a shared corridor → 1 guide, not 3.
    const target = makeStation({
      id: 't',
      x: 100,
      y: 0,
      stops: [
        makeStop('L1', { col: 0 }),
        makeStop('L2', { col: 1 }),
        makeStop('L3', { col: 2 }),
      ],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [
        makeStop('L1', { col: 0 }),
        makeStop('L2', { col: 1 }),
        makeStop('L3', { col: 2 }),
      ],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 102,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
    });
    expect(r.guides).toHaveLength(1);
  });

  it('falls back to anchor-to-anchor when neither side has stops', () => {
    // No stops on either station: snap engages on the dragged station's
    // rotation axis (rotation 0 → +y axis). Drag near the target's column
    // → snaps to that column.
    const target = makeStation({ id: 't', x: 100, y: 0, rotation: 0 });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, rotation: 0 });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 102,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
    });
    expect(r.x).toBeCloseTo(100, 3);
    expect(r.y).toBeCloseTo(50, 3);
  });

  it('emits an opposite-direction guide when a third in-line station exists', () => {
    // Three stations on a vertical corridor: target above (100, 0), third
    // below (100, 200), drag near (102, 100). Should emit a primary guide
    // up to target and an opposite-direction guide down to the third.
    const target = makeStation({
      id: 'a',
      x: 100,
      y: 0,
      stops: [makeStop('L1')],
    });
    const third = makeStation({
      id: 'c',
      x: 100,
      y: 200,
      stops: [makeStop('L1')],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1')],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 102,
      proposedY: 100,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target, third),
    });
    // 1 primary guide + 1 opposite-direction guide.
    expect(r.guides.length).toBeGreaterThanOrEqual(2);
  });
});
