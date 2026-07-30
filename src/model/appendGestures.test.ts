import { describe, it, expect } from 'vitest';
import { makeLine } from '../test/fixtures';
import {
  appendRoutePreviewEdges,
  appendSegmentHoverPreview,
  appendSpawnSource,
  appendStationCursor,
  appendStationHoverPreview,
  decideCanvasClick,
  decideDeleteKey,
  decideSegmentClick,
  decideStationClick,
  sameAppendHover,
  validCursor,
  NEXT_STYLE,
  nextSegmentStyle,
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

describe('appendStationCursor', () => {
  // The cursor IS the click matrix, re-voiced: 'copy' (arrow-with-plus) for a
  // click that puts the station on the line, 'pointer' for arm/jump/disarm,
  // 'default' for a click that means nothing.
  it("'copy' whenever the click would seed/connect/splice", () => {
    const empty = makeLine({ id: 'L1', stations: [] });
    expect(appendStationCursor(empty, null, 'x')).toBe('copy'); // seed
    expect(appendStationCursor(line(), stationCursor('a'), 'c')).toBe('copy'); // connect (member)
    expect(appendStationCursor(line(), stationCursor('a'), 'n')).toBe('copy'); // connect (new)
    expect(appendStationCursor(line(), edgeCursor('a', 'b'), 'n')).toBe('copy'); // splice
  });

  it("'pointer' whenever the click would arm/jump/disarm the pen", () => {
    expect(appendStationCursor(line(), null, 'b')).toBe('pointer'); // arm
    expect(appendStationCursor(line(), stationCursor('b'), 'b')).toBe('pointer'); // disarm
    expect(appendStationCursor(line(), edgeCursor('a', 'b'), 'a')).toBe('pointer'); // endpoint jump
  });

  it("'default' when the click means nothing (non-member, nothing armed)", () => {
    expect(appendStationCursor(line(), null, 'zzz')).toBe('default');
  });

  it('a stale cursor degrades first, so the cursor matches what the click would really do', () => {
    // The armed station left the line (undo): a member hover arms → pointer,
    // a non-member hover is inert → default. Never 'copy' off a dead cursor.
    expect(appendStationCursor(line(), stationCursor('gone'), 'b')).toBe('pointer');
    expect(appendStationCursor(line(), stationCursor('gone'), 'zzz')).toBe('default');
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

describe('decideStationClick — shift cycles the armed segment', () => {
  // Shift's ONLY job in Edit Stops is to cycle the ARMED segment's pattern, and
  // only when the click lands over that segment — i.e. on one of its endpoint
  // stations. The endpoints occlude a short segment's band, so this is how a
  // segment sandwiched between two stations stays editable. Shift must NEVER
  // add to the line (seed/connect/splice) — that's the whole reason the old
  // shift-click-the-band gesture was unreachable for short segments.

  it('shift-clicking either endpoint of the armed edge cycles that segment', () => {
    expect(decideStationClick(line(), edgeCursor('a', 'b'), 'a', true)).toEqual({
      kind: 'cycle-style',
      from: 'a',
      to: 'b',
    });
    // Same edge whichever endpoint is clicked, and whatever the stored order.
    expect(decideStationClick(line(), edgeCursor('a', 'b'), 'b', true)).toEqual({
      kind: 'cycle-style',
      from: 'a',
      to: 'b',
    });
    expect(decideStationClick(line(), edgeCursor('b', 'a'), 'a', true)).toEqual({
      kind: 'cycle-style',
      from: 'b',
      to: 'a',
    });
  });

  it('shift is inert anywhere that is not an endpoint of the armed segment', () => {
    // A non-endpoint station while an edge is armed: NOT a splice.
    expect(decideStationClick(line(), edgeCursor('a', 'b'), 'c', true)).toEqual({ kind: 'none' });
    // A station cursor (no SEGMENT armed): NOT a connect.
    expect(decideStationClick(line(), stationCursor('a'), 'c', true)).toEqual({ kind: 'none' });
    // No cursor: NOT an arm.
    expect(decideStationClick(line(), null, 'b', true)).toEqual({ kind: 'none' });
    // Empty line: NOT a seed.
    expect(decideStationClick(makeLine({ id: 'L1', stations: [] }), null, 'x', true)).toEqual({
      kind: 'none',
    });
    // A stale armed edge degrades to null first, so shift is inert.
    expect(decideStationClick(line(), edgeCursor('a', 'c'), 'a', true)).toEqual({ kind: 'none' });
  });

  it('without shift, an endpoint click is unchanged (jumps the cursor)', () => {
    expect(decideStationClick(line(), edgeCursor('a', 'b'), 'b', false)).toEqual({
      kind: 'cursor',
      cursor: stationCursor('b'),
    });
  });
});

// sameAppendHover backs setAppendHover's no-churn gate: a per-frame pointermove
// stream over one target must NOT re-render. Each variant compares only its own
// identifying field, and different kinds are never equal.
describe('sameAppendHover', () => {
  it('same station is same, different station is not', () => {
    expect(
      sameAppendHover({ kind: 'station', stationId: 'a' }, { kind: 'station', stationId: 'a' }),
    ).toBe(true);
    expect(
      sameAppendHover({ kind: 'station', stationId: 'a' }, { kind: 'station', stationId: 'b' }),
    ).toBe(false);
  });

  it('same segment is same, different segment is not', () => {
    expect(
      sameAppendHover({ kind: 'segment', pairKey: 'a|b' }, { kind: 'segment', pairKey: 'a|b' }),
    ).toBe(true);
    expect(
      sameAppendHover({ kind: 'segment', pairKey: 'a|b' }, { kind: 'segment', pairKey: 'b|c' }),
    ).toBe(false);
  });

  it('same foreign line is same, different foreign line is not', () => {
    // The 'line' branch — a foreign stripe under the cursor. If it compared the
    // wrong field, hovering a stripe would either churn re-renders every frame
    // or freeze on a stale line highlight.
    expect(sameAppendHover({ kind: 'line', lineId: 'L1' }, { kind: 'line', lineId: 'L1' })).toBe(
      true,
    );
    expect(sameAppendHover({ kind: 'line', lineId: 'L1' }, { kind: 'line', lineId: 'L2' })).toBe(
      false,
    );
  });

  it('different kinds are never equal, even sharing an id', () => {
    expect(
      sameAppendHover({ kind: 'station', stationId: 'x' }, { kind: 'line', lineId: 'x' }),
    ).toBe(false);
    expect(sameAppendHover({ kind: 'segment', pairKey: 'x' }, { kind: 'line', lineId: 'x' })).toBe(
      false,
    );
  });

  it('null handling: two nulls match, a target vs null does not', () => {
    expect(sameAppendHover(null, null)).toBe(true);
    expect(sameAppendHover({ kind: 'line', lineId: 'L1' }, null)).toBe(false);
    expect(sameAppendHover(null, { kind: 'station', stationId: 'a' })).toBe(false);
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

  // Alt-click on a segment splices a new station INTO it at the click point —
  // the same create decideCanvasClick makes over empty canvas, but reachable by
  // clicking the segment directly (the natural "drop a stop mid-segment"
  // gesture). It only fires once the segment is the ARMED edge: alt-clicking a
  // not-yet-armed segment arms it first, so cycling to reach a buried segment
  // (alt-pick) can land on it before a second alt-click splices.
  it('alt-click on the armed segment splices, preserving the armed direction', () => {
    expect(
      decideSegmentClick(line(), edgeCursor('a', 'b'), 'a|b', { x: 50, y: 0 }, posOf, true),
    ).toEqual({ kind: 'create-splice', from: 'a', to: 'b' });
    // Direction is the armed cursor's, NOT re-derived from the click point —
    // so a click-click-click run keeps marching, exactly like the canvas splice.
    expect(
      decideSegmentClick(line(), edgeCursor('b', 'a'), 'a|b', { x: 10, y: 0 }, posOf, true),
    ).toEqual({ kind: 'create-splice', from: 'b', to: 'a' });
  });

  it('alt-click on a not-yet-armed segment arms it (cycling reaches a buried segment before it splices)', () => {
    expect(decideSegmentClick(line(), null, 'a|b', { x: 10, y: 0 }, posOf, true)).toEqual({
      kind: 'cursor',
      cursor: edgeCursor('a', 'b'),
    });
    // A different edge is armed: alt-click arms the clicked one (nearest-endpoint
    // order), it does not splice into the wrong edge.
    expect(
      decideSegmentClick(line(), edgeCursor('b', 'c'), 'a|b', { x: 90, y: 0 }, posOf, true),
    ).toEqual({ kind: 'cursor', cursor: edgeCursor('b', 'a') });
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

// The route preview's gate: which corridors a click on the hovered station
// would ADD. Non-empty ⇒ the station is a "second station" (the click puts it
// on the line), which is also what promotes its name to the starter treatment.
describe('appendRoutePreviewEdges', () => {
  it('station cursor: one new corridor, cursor → hovered', () => {
    expect(appendRoutePreviewEdges(line(), stationCursor('a'), 'n')).toEqual(['a|n']);
  });

  it('station cursor onto a far MEMBER: the loop/branch corridor it would close', () => {
    expect(appendRoutePreviewEdges(line(), stationCursor('a'), 'c')).toEqual(['a|c']);
  });

  it('nothing onto an ALREADY-connected neighbour — the click only walks the pen', () => {
    // a–b is already drawn, so connectStationsOnLine no-ops on the doc and the
    // click's whole effect is to advance the cursor. Promising a route here
    // would be a route that never appears.
    expect(appendRoutePreviewEdges(line(), stationCursor('a'), 'b')).toEqual([]);
  });

  it('edge cursor: BOTH halves of the splice, not just the near one', () => {
    // Splicing n into a–b replaces it with a–n and n–b; previewing only a–n
    // would promise a dogleg that keeps the original straight run.
    expect(appendRoutePreviewEdges(line(), edgeCursor('a', 'b'), 'n').sort()).toEqual([
      'a|n',
      'b|n',
    ]);
  });

  it('nothing for a click that only moves the pen (arm / jump / disarm)', () => {
    expect(appendRoutePreviewEdges(line(), null, 'b')).toEqual([]); // arms
    expect(appendRoutePreviewEdges(line(), stationCursor('b'), 'b')).toEqual([]); // disarms
    expect(appendRoutePreviewEdges(line(), edgeCursor('a', 'b'), 'a')).toEqual([]); // jumps
  });

  it('nothing for a dead click, and nothing for the empty-line seed', () => {
    expect(appendRoutePreviewEdges(line(), null, 'zzz')).toEqual([]);
    // A seed draws no corridor — there is no first station to route from.
    expect(appendRoutePreviewEdges(makeLine({ id: 'L1', stations: [] }), null, 'x')).toEqual([]);
  });
});

// The station a click's new stop inherits its ring lane from — the same
// `from` the connect/splice transform will hand spawnStopCellAt, so the hover
// ring and the committed stop can never land on different lanes.
describe('appendSpawnSource', () => {
  it('is the pen for a connect and the near endpoint for a splice', () => {
    expect(appendSpawnSource(line(), stationCursor('a'), 'n')).toBe('a');
    expect(appendSpawnSource(line(), edgeCursor('a', 'b'), 'n')).toBe('a');
    expect(appendSpawnSource(line(), edgeCursor('b', 'a'), 'n')).toBe('b');
  });

  it('is null for a click that adds no corridor', () => {
    expect(appendSpawnSource(line(), null, 'b')).toBeNull(); // arms
    expect(appendSpawnSource(line(), stationCursor('b'), 'b')).toBeNull(); // disarms
    expect(appendSpawnSource(line(), edgeCursor('a', 'b'), 'a')).toBeNull(); // jumps
    expect(appendSpawnSource(line(), null, 'zzz')).toBeNull(); // dead
    expect(appendSpawnSource(makeLine({ id: 'L1', stations: [] }), null, 'x')).toBeNull(); // seed
  });

  it('still names the pen when the connect only walks it forward', () => {
    // a–b already exists, so the doc no-ops — but `b` is a member with a stop
    // already, so nothing spawns either. Naming the pen is harmless and keeps
    // this a pure read of the decision's `from`.
    expect(appendSpawnSource(line(), stationCursor('a'), 'b')).toBe('a');
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

describe('nextSegmentStyle', () => {
  it('advances an unstyled (default solid) segment one step to dashed', () => {
    // a|b has no override → resolves to solid → next is dashed.
    expect(nextSegmentStyle(line(), 'a|b')).toBe('dashed');
  });

  it("advances from the segment's stored style, not the line default", () => {
    const ln = makeLine({
      id: 'L1',
      stations: ['a', 'b', 'c'],
      segmentStyles: { 'a|b': 'dashed', 'b|c': 'dotted' },
    });
    expect(nextSegmentStyle(ln, 'a|b')).toBe('hatched'); // dashed → hatched
    expect(nextSegmentStyle(ln, 'b|c')).toBe('dashed-open'); // dotted → dashed-open
  });
});
