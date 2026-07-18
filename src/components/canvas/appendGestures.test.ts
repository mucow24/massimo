import { describe, it, expect } from 'vitest';
import { makeLine } from '../../test/fixtures';
import {
  appendSegmentHoverPreview,
  appendStationHoverPreview,
  decideCanvasClick,
  decideDeleteKey,
  decideSegmentClick,
  decideStationClick,
  validCursor,
  NEXT_STYLE,
  type AppendCursor,
} from './appendGestures';

// The full gesture matrix for canvas line editing (Edit Stops mode). These
// pure decisions ARE the behavioral spec; the component layers only dispatch.

const line = () => makeLine({ id: 'L1', stations: ['a', 'b', 'c'] }); // a|b, b|c
const stationCursor = (stationId: string): AppendCursor => ({ kind: 'station', stationId });
const edgeCursor = (from: string, to: string): AppendCursor => ({ kind: 'edge', from, to });

describe('validCursor', () => {
  it('passes a live cursor through and degrades stale ones to null', () => {
    const ln = line();
    expect(validCursor(ln, stationCursor('a'))).toEqual(stationCursor('a'));
    expect(validCursor(ln, edgeCursor('b', 'a'))).toEqual(edgeCursor('b', 'a')); // either order
    expect(validCursor(ln, stationCursor('zzz'))).toBeNull(); // not a member
    expect(validCursor(ln, edgeCursor('a', 'c'))).toBeNull(); // not an edge
    expect(validCursor(ln, null)).toBeNull();
  });
});

describe('decideStationClick', () => {
  it('seeds an empty line with the first clicked station', () => {
    const empty = makeLine({ id: 'L1', stations: [] });
    expect(decideStationClick(empty, null, 'x')).toEqual({
      kind: 'seed',
      stationId: 'x',
      cursor: stationCursor('x'),
    });
  });

  it('null cursor: a member click arms the cursor, a non-member click is ignored', () => {
    expect(decideStationClick(line(), null, 'b')).toEqual({
      kind: 'cursor',
      cursor: stationCursor('b'),
    });
    expect(decideStationClick(line(), null, 'zzz')).toEqual({ kind: 'none' });
  });

  it('station cursor: clicking the cursor station drops the cursor', () => {
    expect(decideStationClick(line(), stationCursor('b'), 'b')).toEqual({
      kind: 'cursor',
      cursor: null,
    });
  });

  it('station cursor: any other station click connects and advances', () => {
    // A member target (loop close / link up)…
    expect(decideStationClick(line(), stationCursor('a'), 'c')).toEqual({
      kind: 'connect',
      from: 'a',
      to: 'c',
      cursor: stationCursor('c'),
    });
    // …and a non-member target (branch/extend). Membership is the transform's
    // job; the decision is the same either way.
    expect(decideStationClick(line(), stationCursor('c'), 'n')).toEqual({
      kind: 'connect',
      from: 'c',
      to: 'n',
      cursor: stationCursor('n'),
    });
  });

  it('edge cursor: an endpoint click jumps the cursor to that station', () => {
    expect(decideStationClick(line(), edgeCursor('a', 'b'), 'b')).toEqual({
      kind: 'cursor',
      cursor: stationCursor('b'),
    });
  });

  it('edge cursor: a station click splices and keeps marching toward `to`', () => {
    expect(decideStationClick(line(), edgeCursor('a', 'b'), 'n')).toEqual({
      kind: 'splice',
      from: 'a',
      to: 'b',
      stationId: 'n',
      cursor: edgeCursor('n', 'b'),
    });
  });

  it('edge cursor march: after a splice the next click splices the new half-edge', () => {
    // After splicing n into a–b the line runs a|n, b|n; the cursor is (n → b).
    const ln = makeLine({
      id: 'L1',
      stations: ['a', 'b', 'c', 'n'],
      edges: ['a|n', 'b|n', 'b|c'],
    });
    expect(decideStationClick(ln, edgeCursor('n', 'b'), 'm')).toEqual({
      kind: 'splice',
      from: 'n',
      to: 'b',
      stationId: 'm',
      cursor: edgeCursor('m', 'b'),
    });
  });

  it('a stale cursor degrades to the null-cursor rules', () => {
    // Station cursor whose station left the line: the click re-arms, not connects.
    expect(decideStationClick(line(), stationCursor('gone'), 'b')).toEqual({
      kind: 'cursor',
      cursor: stationCursor('b'),
    });
    // Edge cursor whose edge was removed: same degradation.
    expect(decideStationClick(line(), edgeCursor('a', 'c'), 'b')).toEqual({
      kind: 'cursor',
      cursor: stationCursor('b'),
    });
  });
});

describe('decideSegmentClick', () => {
  const pos: Record<string, { x: number; y: number }> = {
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
  };
  const posOf = (sid: string) => pos[sid] ?? null;

  it('arms an ordered edge cursor: the near endpoint is `from`, the far one `to`', () => {
    expect(decideSegmentClick(line(), null, 'a|b', { x: 10, y: 0 }, posOf)).toEqual({
      kind: 'cursor',
      cursor: edgeCursor('a', 'b'),
    });
    expect(decideSegmentClick(line(), null, 'a|b', { x: 90, y: 0 }, posOf)).toEqual({
      kind: 'cursor',
      cursor: edgeCursor('b', 'a'),
    });
  });

  it('re-clicking the armed segment drops the cursor (whatever its stored order)', () => {
    expect(decideSegmentClick(line(), edgeCursor('b', 'a'), 'a|b', { x: 10, y: 0 }, posOf)).toEqual(
      { kind: 'cursor', cursor: null },
    );
  });

  it('re-arms from any other cursor state', () => {
    expect(decideSegmentClick(line(), stationCursor('c'), 'a|b', { x: 10, y: 0 }, posOf)).toEqual({
      kind: 'cursor',
      cursor: edgeCursor('a', 'b'),
    });
  });

  it('ignores a pair-key the line does not run', () => {
    expect(decideSegmentClick(line(), null, 'a|c', { x: 10, y: 0 }, posOf)).toEqual({
      kind: 'none',
    });
  });

  it('falls back to canonical order when positions are unavailable', () => {
    expect(decideSegmentClick(line(), null, 'a|b', null, () => null)).toEqual({
      kind: 'cursor',
      cursor: edgeCursor('a', 'b'),
    });
  });
});

describe('decideCanvasClick', () => {
  it('plain click backs out one level: drop the cursor, else exit', () => {
    expect(decideCanvasClick(line(), stationCursor('a'), false)).toEqual({
      kind: 'cursor',
      cursor: null,
    });
    expect(decideCanvasClick(line(), edgeCursor('a', 'b'), false)).toEqual({
      kind: 'cursor',
      cursor: null,
    });
    expect(decideCanvasClick(line(), null, false)).toEqual({ kind: 'exit' });
  });

  it('alt-click creates a station as the second click of the pending action', () => {
    expect(decideCanvasClick(line(), stationCursor('a'), true)).toEqual({
      kind: 'create-connect',
      from: 'a',
    });
    expect(decideCanvasClick(line(), edgeCursor('a', 'b'), true)).toEqual({
      kind: 'create-splice',
      from: 'a',
      to: 'b',
    });
  });

  it('alt-click with no pending action never creates an orphan station', () => {
    expect(decideCanvasClick(line(), null, true)).toEqual({ kind: 'none' });
  });

  it('alt-click seeds an empty line', () => {
    const empty = makeLine({ id: 'L1', stations: [] });
    expect(decideCanvasClick(empty, null, true)).toEqual({ kind: 'create-seed' });
  });

  it('a stale cursor degrades before deciding', () => {
    expect(decideCanvasClick(line(), stationCursor('gone'), false)).toEqual({ kind: 'exit' });
  });
});

describe('decideDeleteKey', () => {
  it('removes the armed station', () => {
    expect(decideDeleteKey(line(), stationCursor('b'))).toEqual({
      kind: 'remove-station',
      stationId: 'b',
    });
  });

  it('removes the armed edge (whatever its stored order)', () => {
    expect(decideDeleteKey(line(), edgeCursor('b', 'a'))).toEqual({
      kind: 'remove-edge',
      from: 'b',
      to: 'a',
    });
  });

  it('does nothing with no cursor or a stale one', () => {
    expect(decideDeleteKey(line(), null)).toEqual({ kind: 'none' });
    expect(decideDeleteKey(line(), stationCursor('gone'))).toEqual({ kind: 'none' });
    expect(decideDeleteKey(line(), edgeCursor('a', 'c'))).toEqual({ kind: 'none' });
  });
});

// The hover-preview gates mirror the click matrix above: a preview shows iff a
// click there would act (and it isn't the already-armed target). These ARE the
// affordance's behavioral spec — HighlightedLineLayer only paints what they OK.
describe('appendStationHoverPreview', () => {
  it('previews any station on an empty line (a click seeds it)', () => {
    const empty = makeLine({ id: 'L1', stations: [] });
    expect(appendStationHoverPreview(empty, null, 'x')).toBe(true);
  });

  it('null cursor: previews a member (arms), not a non-member (dead click)', () => {
    expect(appendStationHoverPreview(line(), null, 'b')).toBe(true);
    expect(appendStationHoverPreview(line(), null, 'zzz')).toBe(false);
  });

  it('suppresses the armed station cursor itself — it already wears the full ring', () => {
    expect(appendStationHoverPreview(line(), stationCursor('b'), 'b')).toBe(false);
  });

  it('station cursor: previews any OTHER station (a click connects to it)', () => {
    expect(appendStationHoverPreview(line(), stationCursor('a'), 'c')).toBe(true); // member
    expect(appendStationHoverPreview(line(), stationCursor('a'), 'n')).toBe(true); // non-member
  });

  it('edge cursor: previews an endpoint (jump) and a splice target', () => {
    expect(appendStationHoverPreview(line(), edgeCursor('a', 'b'), 'b')).toBe(true); // endpoint
    expect(appendStationHoverPreview(line(), edgeCursor('a', 'b'), 'n')).toBe(true); // splice
  });

  it('a stale cursor degrades to the null-cursor rules', () => {
    expect(appendStationHoverPreview(line(), stationCursor('gone'), 'b')).toBe(true); // member arms
    expect(appendStationHoverPreview(line(), stationCursor('gone'), 'zzz')).toBe(false); // dead
  });
});

describe('appendSegmentHoverPreview', () => {
  it('previews any corridor the edited line runs', () => {
    expect(appendSegmentHoverPreview(line(), null, 'a|b')).toBe(true);
    expect(appendSegmentHoverPreview(line(), null, 'b|c')).toBe(true);
  });

  it('previews nothing on a corridor the line does not run', () => {
    expect(appendSegmentHoverPreview(line(), null, 'a|c')).toBe(false);
  });

  it('suppresses the already-armed edge, whatever its stored order', () => {
    expect(appendSegmentHoverPreview(line(), edgeCursor('a', 'b'), 'a|b')).toBe(false);
    expect(appendSegmentHoverPreview(line(), edgeCursor('b', 'a'), 'a|b')).toBe(false);
  });

  it('still previews a DIFFERENT armed-elsewhere corridor', () => {
    expect(appendSegmentHoverPreview(line(), edgeCursor('a', 'b'), 'b|c')).toBe(true);
  });

  it('a stale edge cursor no longer suppresses (its edge is gone)', () => {
    expect(appendSegmentHoverPreview(line(), edgeCursor('a', 'c'), 'a|b')).toBe(true);
  });
});

describe('NEXT_STYLE', () => {
  it('cycles through every line style and returns to solid', () => {
    const seen = new Set<string>();
    let s: keyof typeof NEXT_STYLE = 'solid';
    do {
      seen.add(s);
      s = NEXT_STYLE[s];
    } while (s !== 'solid');
    expect(seen.size).toBe(Object.keys(NEXT_STYLE).length);
  });
});
