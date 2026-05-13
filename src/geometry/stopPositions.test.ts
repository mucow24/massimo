import { describe, it, expect } from 'vitest';
import { computeRenderedStopPositions, withDraggedSnapshot } from './stopPositions';
import { STOP_SIZE } from './orientation';
import { makeStation, makeStop } from '../test/fixtures';
import type { Station, StationId } from '../model/types';

const dictOf = (...sts: Station[]): Record<StationId, Station> => {
  const m: Record<StationId, Station> = {};
  for (const s of sts) m[s.id] = s;
  return m;
};

const SQRT2 = Math.SQRT2;

describe('computeRenderedStopPositions', () => {
  it('returns cell position for a single stop', () => {
    const st = makeStation({
      id: 's1',
      x: 100,
      y: 200,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p = get('s1', 'L1');
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(200, 6);
  });

  it('leaves two cardinally-adjacent auto-vertical stops at their cell positions', () => {
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-vertical' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p1 = get('s1', 'L1');
    const p2 = get('s1', 'L2');
    expect(p1).toEqual({ x: 0, y: 0 });
    expect(p2).toEqual({ x: STOP_SIZE, y: 0 });
  });

  it('cardinal interline groups are byte-for-byte identical to cell positions', () => {
    // Fixture with several cardinal interline runs.
    const sA = makeStation({
      id: 'sA',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-vertical' }),
        makeStop('L3', { row: 0, col: 2, orientation: 'auto-vertical' }),
      ],
    });
    const sB = makeStation({
      id: 'sB',
      x: 500,
      y: 0,
      rotation: 2, // rotates auto-vertical local +y to world +x (horizontal axis)
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-vertical' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(sA, sB));
    // sA: row 0, cols 0..2 at rotation 0 → world (0,0), (STOP_SIZE,0), (2*STOP_SIZE,0).
    expect(get('sA', 'L1')).toEqual({ x: 0, y: 0 });
    expect(get('sA', 'L2')).toEqual({ x: STOP_SIZE, y: 0 });
    expect(get('sA', 'L3')).toEqual({ x: 2 * STOP_SIZE, y: 0 });
    // sB: col 0/1 at rotation 2 → local (0,0)→world (500,0); local (STOP_SIZE,0)→world (500,STOP_SIZE).
    const b1 = get('sB', 'L1');
    const b2 = get('sB', 'L2');
    expect(b1.x).toBeCloseTo(500, 6);
    expect(b1.y).toBeCloseTo(0, 6);
    expect(b2.x).toBeCloseTo(500, 6);
    expect(b2.y).toBeCloseTo(STOP_SIZE, 6);
  });

  it('compresses two diagonally-adjacent auto-ne-sw stops to STOP_SIZE perp spacing', () => {
    // auto-ne-sw band axis = NE-SW; perp axis = NW-SE. Perp-adjacent cells
    // differ by (dRow=+1, dCol=+1) so the world delta is (STOP_SIZE, STOP_SIZE)
    // = SE direction, along the NW-SE perp axis.
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p1 = get('s1', 'L1');
    const p2 = get('s1', 'L2');

    // Centroid of cell positions: ((0 + STOP_SIZE)/2, (0 + STOP_SIZE)/2).
    const cx = STOP_SIZE / 2;
    const cy = STOP_SIZE / 2;
    // Centroid of compressed positions must equal the cell centroid.
    expect((p1.x + p2.x) / 2).toBeCloseTo(cx, 6);
    expect((p1.y + p2.y) / 2).toBeCloseTo(cy, 6);

    // Perp axis (NW-SE = SE direction) = (√2/2, √2/2). Perp distance between p1 and p2 should be STOP_SIZE.
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const perpDist = Math.abs((dx + dy) * Math.SQRT1_2);
    expect(perpDist).toBeCloseTo(STOP_SIZE, 5);

    // Parallel axis (NE-SW) component of (p2 - p1) should be zero — compression is pure perp.
    const parDist = Math.abs((dx - dy) * Math.SQRT1_2);
    expect(parDist).toBeCloseTo(0, 5);
  });

  it('compresses three diagonally-adjacent auto-nw-se stops symmetrically', () => {
    // Cells along the NE-SW perp of a NW-SE band: (0, 0), (-1, -1), (-2, -2) at rotation 0.
    // World: (0, 0), (-STOP_SIZE, -STOP_SIZE), (-2*STOP_SIZE, -2*STOP_SIZE).
    // Travel axis NW-SE; perp axis NE-SW = (√2/2, -√2/2).
    // Each cell's perp coord = (x - y) * √2/2 → 0, 0, 0. Wait, those collapse — picked wrong cells.
    //
    // For an NW-SE band at rotation 0, the perp axis is NE-SW. Cells whose world
    // positions differ along NE-SW are perp-adjacent on this band. NE direction
    // = (√2/2, -√2/2), so cells offset by (+col, -row) lie along NE. The natural
    // diagonal-cell step along NE is the cell (1, -1) offset = world (STOP_SIZE, -STOP_SIZE),
    // magnitude STOP_SIZE·√2 — perp dist along NE = (STOP_SIZE - -STOP_SIZE)*√2/2 = STOP_SIZE·√2. ✓
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-nw-se' }),
        makeStop('L2', { row: -1, col: 1, orientation: 'auto-nw-se' }),
        makeStop('L3', { row: -2, col: 2, orientation: 'auto-nw-se' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p1 = get('s1', 'L1');
    const p2 = get('s1', 'L2');
    const p3 = get('s1', 'L3');

    // Cell-grid perp positions (projected onto NE = (√2/2, -√2/2)):
    //   L1 (0,0): 0
    //   L2 (STOP_SIZE, -STOP_SIZE): STOP_SIZE·√2
    //   L3 (2·STOP_SIZE, -2·STOP_SIZE): 2·STOP_SIZE·√2
    // Centroid perp: STOP_SIZE·√2 (= L2's position).
    // Compressed perp: centroid + {-1, 0, +1} * STOP_SIZE.

    // L2 should sit at the centroid → at the same world position as its cell position.
    expect(p2.x).toBeCloseTo(STOP_SIZE, 5);
    expect(p2.y).toBeCloseTo(-STOP_SIZE, 5);

    // Centroid of compressed positions = centroid of cell positions.
    const cx = STOP_SIZE; // (0 + STOP_SIZE + 2*STOP_SIZE) / 3
    const cy = -STOP_SIZE;
    expect((p1.x + p2.x + p3.x) / 3).toBeCloseTo(cx, 5);
    expect((p1.y + p2.y + p3.y) / 3).toBeCloseTo(cy, 5);

    // Perp gaps p2-p1 and p3-p2 = STOP_SIZE along NE.
    const dp12x = p2.x - p1.x;
    const dp12y = p2.y - p1.y;
    const perp12 = (dp12x - dp12y) * Math.SQRT1_2;
    expect(perp12).toBeCloseTo(STOP_SIZE, 5);
    const dp23x = p3.x - p2.x;
    const dp23y = p3.y - p2.y;
    const perp23 = (dp23x - dp23y) * Math.SQRT1_2;
    expect(perp23).toBeCloseTo(STOP_SIZE, 5);
  });

  it('mixed axes: compresses the diagonal pair, leaves the cardinal pair', () => {
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        // Cardinal pair on auto-vertical.
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-vertical' }),
        // Diagonal pair on auto-ne-sw at distinctly-located cells (perp-adjacent
        // cells differ by (dRow=+1, dCol=+1) for the NE-SW band's NW-SE perp axis).
        makeStop('L3', { row: 5, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L4', { row: 6, col: 1, orientation: 'auto-ne-sw' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    // Cardinals untouched.
    expect(get('s1', 'L1')).toEqual({ x: 0, y: 0 });
    expect(get('s1', 'L2')).toEqual({ x: STOP_SIZE, y: 0 });
    // Diagonals compressed: perp gap STOP_SIZE (along NW-SE perp of NE-SW band).
    const p3 = get('s1', 'L3');
    const p4 = get('s1', 'L4');
    const perpDist = Math.abs((p4.x - p3.x + (p4.y - p3.y)) * Math.SQRT1_2);
    expect(perpDist).toBeCloseTo(STOP_SIZE, 5);
  });

  it('non-adjacent diagonal stops on the same axis stay at cell positions', () => {
    // auto-ne-sw band, perp axis NW-SE. Cells (0,0) and (3,3) are 3·STOP_SIZE·√2
    // apart along the perp axis — not a run. Both remain at cell positions.
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 3, col: 3, orientation: 'auto-ne-sw' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    expect(get('s1', 'L1')).toEqual({ x: 0, y: 0 });
    expect(get('s1', 'L2')).toEqual({ x: 3 * STOP_SIZE, y: 3 * STOP_SIZE });
  });

  it('compression is independent of unrelated stops in other axis buckets', () => {
    const stA = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
      ],
    });
    const stB = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
        // Unrelated cardinal pair on the same station.
        makeStop('LX', { row: 10, col: 0, orientation: 'auto-vertical' }),
        makeStop('LY', { row: 10, col: 1, orientation: 'auto-vertical' }),
      ],
    });
    const getA = computeRenderedStopPositions(dictOf(stA));
    const getB = computeRenderedStopPositions(dictOf(stB));
    const a1 = getA('s1', 'L1');
    const a2 = getA('s1', 'L2');
    const b1 = getB('s1', 'L1');
    const b2 = getB('s1', 'L2');
    expect(b1.x).toBeCloseTo(a1.x, 6);
    expect(b1.y).toBeCloseTo(a1.y, 6);
    expect(b2.x).toBeCloseTo(a2.x, 6);
    expect(b2.y).toBeCloseTo(a2.y, 6);
  });

  it('station rotation does not break compression — it operates in world frame', () => {
    // Same logical setup as the auto-ne-sw pair test, but at rotation 2.
    // travelDirLocal('auto-ne-sw') default = NE; rotated by 2 (90° CW) = SE world.
    // Bucket 1 (NW-SE), perp axis NE-SW. Local cell delta (1, 1) [perp-adjacent
    // in local NW-SE perp axis] rotates to world delta along NE-SW — still
    // perp-adjacent (perp axes rotate in lockstep).
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 2,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p1 = get('s1', 'L1');
    const p2 = get('s1', 'L2');
    // After rotation 2, world tangent is SE, perp axis is NE-SW = (√2/2, -√2/2).
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const perpDist = Math.abs((dx - dy) * Math.SQRT1_2);
    expect(perpDist).toBeCloseTo(STOP_SIZE, 5);
  });

  it('cardinal stops at a 45°-rotated station interline without compression', () => {
    // Station rotation = 1 (45°). Auto-vertical stops at cells (0,0) and (0,1)
    // — perp-adjacent in local frame, world delta magnitude STOP_SIZE.
    // World axis is diagonal (bucket 1 or 3) but the cells are STILL at the
    // cardinal STOP_SIZE perp distance in world. Compression should be a
    // no-op — the rendered positions must equal the cell positions.
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 1,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-vertical' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    // Cell-grid world positions: (0, 0) and rotateBy({STOP_SIZE, 0}, 1) = (√2/2, √2/2)·STOP_SIZE.
    const c2 = { x: STOP_SIZE * Math.SQRT1_2, y: STOP_SIZE * Math.SQRT1_2 };
    expect(get('s1', 'L1')).toEqual({ x: 0, y: 0 });
    const p2 = get('s1', 'L2');
    expect(p2.x).toBeCloseTo(c2.x, 5);
    expect(p2.y).toBeCloseTo(c2.y, 5);
  });

  it('auto-ne-sw stops at a 45°-rotated station compress to STOP_SIZE perp spacing', () => {
    // Station rotation = 1 → auto-ne-sw world tangent rotates to +x (bucket 0).
    // The LOCAL cells are still diagonally arranged, so cell-grid perp distance
    // is STOP_SIZE·√2 in world. Compression must fire (cellStep depends on
    // LOCAL orientation, not world bucket) and pull the stops to STOP_SIZE
    // perp apart along the world +y perp axis.
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 1,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p1 = get('s1', 'L1');
    const p2 = get('s1', 'L2');
    // World tangent +x → perp +y. Perp distance after compression = STOP_SIZE.
    expect(Math.abs(p2.y - p1.y)).toBeCloseTo(STOP_SIZE, 5);
    expect(p2.x - p1.x).toBeCloseTo(0, 5); // pure-perp compression, no parallel slip
  });

  it('places a cell-adjacent trailer at the would-be next slot of the compressed band', () => {
    // Screenshot scenario: three auto-nw-se stops form a perp-adjacent run
    // (cells (1,2), (2,1), (3,0)) and get compressed. A fourth stop on a
    // different axis (auto-horizontal) sits at cell (4,-1) — one diagonal
    // king-step past the SW end of the run, AND one cellStep past green's
    // cell perp along the band's perp axis. The trailer should slot into
    // the band's rhythm at "k+1 perp", landing STOP_SIZE perp-distance past
    // green's compressed position — not STOP_SIZE·√2 (the cell-grid step).
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 1, col: 2, orientation: 'auto-nw-se' }),
        makeStop('L2', { row: 2, col: 1, orientation: 'auto-nw-se' }),
        makeStop('L3', { row: 3, col: 0, orientation: 'auto-nw-se' }),
        makeStop('L4', { row: 4, col: -1, orientation: 'auto-horizontal' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p3 = get('s1', 'L3');
    const p4 = get('s1', 'L4');
    // p4 should be exactly STOP_SIZE past p3 along the band's perp axis
    // (NW-SE band → perp axis NE-SW; the slot-extension direction is the
    // one toward larger perp in my code's perpAxis convention).
    const dist = Math.hypot(p4.x - p3.x, p4.y - p3.y);
    expect(dist).toBeCloseTo(STOP_SIZE, 5);
    // And the parallel-axis offset between them is zero — they're on the
    // same band-perp line through the station.
    // Band travel axis is NW-SE = (√2/2, √2/2); parallel projection of (p4-p3) is 0.
    const par = (p4.x - p3.x) * Math.SQRT1_2 + (p4.y - p3.y) * Math.SQRT1_2;
    expect(par).toBeCloseTo(0, 5);
  });

  it('chains trailer slot extension across multiple cell-adjacent non-group stops', () => {
    // Two-stop diagonal group at the NE end (perp-adjacent on auto-ne-sw).
    // Trailer A is king-adjacent to one of the group members; trailer B is
    // king-adjacent to trailer A only. Slot extension walks the chain:
    // A lands at "slot 2" (one perp-step past L2 at slot 1), B at "slot 3".
    // Each consecutive pair sits STOP_SIZE perp apart in world.
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
        // Trailer A at (2, 2): king-adjacent to L2 (chebyshev = 1) but not L1.
        // Same band-parallel position as L1/L2 (i.e. colinear along band's perp axis).
        makeStop('LA', { row: 2, col: 2, orientation: 'auto-horizontal' }),
        // Trailer B at (3, 3): king-adjacent to LA only, colinear.
        makeStop('LB', { row: 3, col: 3, orientation: 'auto-horizontal' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p2 = get('s1', 'L2');
    const pA = get('s1', 'LA');
    const pB = get('s1', 'LB');
    // Each successive pair is STOP_SIZE apart in world (along the perp axis).
    expect(Math.hypot(pA.x - p2.x, pA.y - p2.y)).toBeCloseTo(STOP_SIZE, 5);
    expect(Math.hypot(pB.x - pA.x, pB.y - pA.y)).toBeCloseTo(STOP_SIZE, 5);
  });

  it('pulls a non-perp-axis-aligned trailer one stripe-width in its cell-grid direction', () => {
    // Trailer (silver) is directly south of green in the local cell grid —
    // not along the band's perp axis (which is NE-SW for an NW-SE band).
    // After compression, silver should sit STOP_SIZE south of green's
    // compressed position — preserving the visual "one cell apart"
    // relationship even though the band is on a diagonal axis.
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 1, col: 2, orientation: 'auto-nw-se' }),
        makeStop('L2', { row: 2, col: 1, orientation: 'auto-nw-se' }),
        makeStop('L3', { row: 3, col: 0, orientation: 'auto-nw-se' }),
        // Silver directly south of L3 in cells.
        makeStop('L4', { row: 4, col: 0, orientation: 'auto-horizontal' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p3 = get('s1', 'L3');
    const p4 = get('s1', 'L4');
    // Silver should be exactly STOP_SIZE south of green's compressed position.
    expect(p4.x - p3.x).toBeCloseTo(0, 5);
    expect(p4.y - p3.y).toBeCloseTo(STOP_SIZE, 5);
  });

  it('leaves stops alone when they are NOT cell-adjacent to any compressed group', () => {
    // Diagonal group at the NE end; a faraway stop with no adjacency to it.
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
        // Trailer at (5, 5): chebyshev distance to L2 is 4 — not adjacent.
        makeStop('LX', { row: 5, col: 5, orientation: 'auto-horizontal' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const pX = get('s1', 'LX');
    // No shift: rendered position equals cell position.
    expect(pX).toEqual({ x: 5 * STOP_SIZE, y: 5 * STOP_SIZE });
  });

  it('returns the station anchor for an unknown (stationId, lineId)', () => {
    const st = makeStation({ id: 's1', x: 42, y: 88, stops: [makeStop('L1')] });
    const get = computeRenderedStopPositions(dictOf(st));
    // Unknown line on a known station — fall back to station anchor.
    expect(get('s1', 'GHOST')).toEqual({ x: 42, y: 88 });
    // Unknown station — fall back to (0,0) since there's nothing to anchor to.
    expect(get('GHOST', 'L1')).toEqual({ x: 0, y: 0 });
  });
});

describe('withDraggedSnapshot', () => {
  it('injects the dragged station when not already in stations', () => {
    const other = makeStation({ id: 'other', x: 0, y: 0 });
    const stations = dictOf(other);
    const stops = [makeStop('L1')];
    const out = withDraggedSnapshot(stations, 'dragged', stops, 100, 200, 3);
    expect(out.dragged).toBeDefined();
    expect(out.dragged.x).toBe(100);
    expect(out.dragged.y).toBe(200);
    expect(out.dragged.rotation).toBe(3);
    expect(out.dragged.stops).toBe(stops);
    expect(out.other).toBe(other);
  });

  it('overrides position/rotation/stops when the dragged station is already in stations', () => {
    const existing = makeStation({
      id: 'dragged',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('OLD')],
    });
    const other = makeStation({ id: 'other', x: 999, y: 999 });
    const stations = dictOf(existing, other);
    const stops = [makeStop('L1')];
    const out = withDraggedSnapshot(stations, 'dragged', stops, 100, 200, 3);
    expect(out.dragged.x).toBe(100);
    expect(out.dragged.y).toBe(200);
    expect(out.dragged.rotation).toBe(3);
    expect(out.dragged.stops).toBe(stops);
    // Other stations unchanged by reference.
    expect(out.other).toBe(other);
  });

  it('does not mutate the input dict', () => {
    const existing = makeStation({ id: 'dragged', x: 0, y: 0 });
    const stations = dictOf(existing);
    const snapshot = { ...stations };
    withDraggedSnapshot(stations, 'dragged', [makeStop('L1')], 5, 5, 1);
    expect(stations).toEqual(snapshot);
  });
});

// Cross-check: the compressed diagonal pair really does sit on the band centerline
// at ±STOP_SIZE/2 perp offsets — which is what makes interlining work.
describe('computeRenderedStopPositions — band-alignment invariant', () => {
  it('compressed diagonal pair has perp gap exactly STOP_SIZE — matches buildBands stripe pitch', () => {
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
      ],
    });
    const get = computeRenderedStopPositions(dictOf(st));
    const p1 = get('s1', 'L1');
    const p2 = get('s1', 'L2');
    // Distance equals STOP_SIZE (band stripe pitch), no SQRT2 fudge.
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    expect(dist).toBeCloseTo(STOP_SIZE, 5);
    // Sanity: cell distance would have been STOP_SIZE * √2.
    expect(SQRT2 * STOP_SIZE).toBeGreaterThan(dist);
  });
});
