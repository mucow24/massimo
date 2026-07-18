import { describe, expect, it } from 'vitest';
import {
  appendCursorRef,
  currentHitEntity,
  lockedHitsAt,
  mergeLockedIntoStack,
  nextInStack,
  resolveAppendStack,
  resolveHitStack,
  type HitEntry,
  type HitRef,
} from './hitStack';
import type { SelectionState } from '../../state/selection';
import { makePolygon, makeSvgImage, makeTextLabel, stationWithStop } from '../../test/fixtures';
import type { LineId, RouteBullet, StationId } from '../../model/types';

// A miniature canvas DOM carrying one of every identity attribute the
// resolver knows, in a representative paint order (topmost-first when read
// as an elementsFromPoint snapshot below).
function buildDom() {
  const host = document.createElement('div');
  host.innerHTML = `
    <svg>
      <rect data-bg="1" id="bg"></rect>
      <path data-polygon-id="p0" id="poly"></path>
      <g data-svg-image-id="i0"><image id="img"></image></g>
      <path data-band-stripe="" data-band-key="k" data-line-id="L1" id="stripe"></path>
      <g data-station-id="s1"><rect id="cells"></rect><rect id="labelRect"></rect></g>
      <line data-transfer-id="t1" id="transfer"></line>
      <g><circle data-stop-station="s1" data-stop-line="L1" id="dot"></circle></g>
      <g><circle data-stop-stroke="s1" data-stop-line="L1" id="dotStroke"></circle></g>
      <g data-bullet-id="b1"><circle id="bulletShape"></circle></g>
      <g data-text-label-id="g1"><rect id="labelHit"></rect></g>
      <rect data-line-tag-id="tag1" id="tagHit"></rect>
      <g data-export-exclude="1">
        <path data-polygon-hit="p0" id="proxyPoly"></path>
        <g data-station-hit="s1"><rect id="proxyStationRect"></rect></g>
      </g>
    </svg>`;
  return (id: string) => host.querySelector('#' + id)!;
}

describe('resolveHitStack', () => {
  it('maps every kind of hit surface to its entity, topmost-first, dropping non-entities', () => {
    const el = buildDom();
    const stack = resolveHitStack([
      el('dot'),
      el('stripe'),
      el('transfer'),
      el('tagHit'),
      el('bulletShape'),
      el('labelHit'),
      el('poly'),
      el('img'),
      el('bg'),
    ]);
    expect(stack.map((e) => `${e.kind}:${e.id}`)).toEqual([
      'station:s1',
      'line:L1',
      'transfer:t1',
      'lineTag:tag1',
      'bullet:b1',
      'label:g1',
      'polygon:p0',
      'svgImage:i0',
    ]);
  });

  it('dedupes an entity hit by several surfaces, keeping its topmost position and element', () => {
    const el = buildDom();
    // A station's dots paint above transfers; its hit rects sit below. The
    // station must appear once, at the dot's (topmost) position, so cycling
    // order matches what plain clicks select first.
    const stack = resolveHitStack([el('dot'), el('transfer'), el('cells'), el('labelRect')]);
    expect(stack.map((e) => `${e.kind}:${e.id}`)).toEqual(['station:s1', 'transfer:t1']);
    expect(stack[0].element).toBe(el('dot'));
  });

  it("resolves a split-border dot's stroke-pass silhouette to its station (data-stop-stroke value)", () => {
    const el = buildDom();
    // The border ring of a bordered dot is a separate stroke-pass element that
    // must not carry the canonical data-stop-station (one element per dot), so
    // it carries the station id as data-stop-stroke's VALUE instead.
    const stack = resolveHitStack([el('dotStroke'), el('transfer'), el('cells')]);
    expect(stack.map((e) => `${e.kind}:${e.id}`)).toEqual(['station:s1', 'transfer:t1']);
    expect(stack[0].element).toBe(el('dotStroke'));
  });

  it('skips drag-proxy surfaces (data-*-hit) even when fed directly', () => {
    const el = buildDom();
    const stack = resolveHitStack([el('proxyPoly'), el('proxyStationRect'), el('poly')]);
    expect(stack.map((e) => `${e.kind}:${e.id}`)).toEqual(['polygon:p0']);
  });

  it('returns an empty stack when nothing under the point is selectable', () => {
    const el = buildDom();
    expect(resolveHitStack([el('bg')])).toEqual([]);
    expect(resolveHitStack([])).toEqual([]);
  });
});

describe('resolveAppendStack (Edit Stops alt-pick)', () => {
  // A miniature Edit-Stops DOM: two segments of the edited line L1, one segment
  // of another line L2, plus stations and free items painted over them. Read as
  // an elementsFromPoint snapshot (topmost-first) below.
  function buildAppendDom() {
    const host = document.createElement('div');
    host.innerHTML = `
      <svg>
        <path data-band-stripe="" data-band-key="k1" data-line-id="L1" data-pair-key="a|b" id="segAB"></path>
        <path data-band-stripe="" data-band-key="k2" data-line-id="L1" data-pair-key="b|c" id="segBC"></path>
        <path data-band-stripe="" data-band-key="k3" data-line-id="L2" data-pair-key="a|b" id="otherLine"></path>
        <g data-station-id="s1"><rect id="cellsS1"></rect></g>
        <g><circle data-stop-station="s2" id="dotS2"></circle></g>
        <g data-bullet-id="bl1"><circle id="bullet"></circle></g>
        <g data-text-label-id="g1"><rect id="label"></rect></g>
        <line data-transfer-id="t1" id="transfer"></line>
      </svg>`;
    return (id: string) => host.querySelector('#' + id)!;
  }

  it('cycles stations and the edited line’s segments; drops free items + other lines', () => {
    const el = buildAppendDom();
    // A station's dot on top, then the buried segment, then irrelevant surfaces.
    const stack = resolveAppendStack(
      [
        el('dotS2'), // a station over the segment — part of the cycle
        el('segAB'), // the buried edited-line segment
        el('otherLine'), // a different line's stripe — irrelevant
        el('bullet'),
        el('label'),
        el('transfer'),
        el('cellsS1'), // a second station (its cells hit rect)
      ],
      'L1',
    );
    expect(stack).toEqual([
      { kind: 'station', id: 's2' },
      { kind: 'segment', id: 'a|b' },
      { kind: 'station', id: 's1' },
    ]);
  });

  it('cycles multiple overlapping edited-line segments, topmost-first, deduped', () => {
    const el = buildAppendDom();
    expect(resolveAppendStack([el('segBC'), el('segAB'), el('segBC')], 'L1')).toEqual([
      { kind: 'segment', id: 'b|c' },
      { kind: 'segment', id: 'a|b' },
    ]);
  });

  it('drops a different line’s stripe but keeps stations under the cursor', () => {
    const el = buildAppendDom();
    expect(resolveAppendStack([el('dotS2'), el('otherLine'), el('label')], 'L1')).toEqual([
      { kind: 'station', id: 's2' },
    ]);
  });
});

describe('appendCursorRef', () => {
  it('maps the append cursor to an alt-pick ref (edge → its canonical pair key)', () => {
    expect(appendCursorRef(null)).toBeNull();
    expect(appendCursorRef({ kind: 'station', stationId: 's1' })).toEqual({
      kind: 'station',
      id: 's1',
    });
    // Whatever the stored order, the ref is the canonical pair key.
    expect(appendCursorRef({ kind: 'edge', from: 'b', to: 'a' })).toEqual({
      kind: 'segment',
      id: 'a|b',
    });
  });
});

describe('nextInStack', () => {
  const stack: (HitRef & { element: null })[] = [
    { kind: 'station', id: 's1', element: null },
    { kind: 'line', id: 'L1', element: null },
    { kind: 'polygon', id: 'p0', element: null },
  ];

  it('returns null for an empty stack', () => {
    expect(nextInStack([], null)).toBeNull();
  });

  it('starts at the top when nothing is current', () => {
    expect(nextInStack(stack, null)).toBe(stack[0]);
  });

  it('advances to the entry after the current one', () => {
    expect(nextInStack(stack, { kind: 'station', id: 's1' })).toBe(stack[1]);
    expect(nextInStack(stack, { kind: 'line', id: 'L1' })).toBe(stack[2]);
  });

  it('wraps from the bottom back to the top', () => {
    expect(nextInStack(stack, { kind: 'polygon', id: 'p0' })).toBe(stack[0]);
  });

  it('restarts at the top when the current entity is not in the stack', () => {
    expect(nextInStack(stack, { kind: 'bullet', id: 'nope' })).toBe(stack[0]);
  });
});

describe('lockedHitsAt', () => {
  // Locked items are click-through (pointer-events: none), so they never
  // appear in an elementsFromPoint snapshot — the deep-pick reaches them via
  // this geometric point-test instead.
  const bullet = (id: string, locked = true): RouteBullet => ({
    id,
    x: 0,
    y: 0,
    rotation: 0,
    lineId: null,
    shape: 'circle',
    size: 14,
    locked,
  });
  const doc = (over: Partial<Parameters<typeof lockedHitsAt>[1]> = {}) => ({
    stations: {},
    lines: {},
    polygons: {},
    svgImages: {},
    backgroundOrder: [] as string[],
    textLabels: {},
    routeBullets: {},
    ...over,
  });

  it('reports a locked polygon under the point, and ignores unlocked ones', () => {
    // makePolygon's default square spans (-30,-30)..(30,30).
    const d = doc({
      polygons: { a: makePolygon({ id: 'a', locked: true }), b: makePolygon({ id: 'b' }) },
      backgroundOrder: ['a', 'b'],
    });
    expect(lockedHitsAt({ x: 0, y: 0 }, d, 0)).toEqual([{ kind: 'polygon', id: 'a' }]);
    expect(lockedHitsAt({ x: 500, y: 500 }, d, 0)).toEqual([]);
  });

  it('reports every locked kind, topmost-first by paint band (labels > bullets > stations > background)', () => {
    const d = doc({
      stations: {
        S: { ...stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 }), locked: true },
      },
      polygons: { p: makePolygon({ id: 'p', locked: true }) },
      svgImages: { i: makeSvgImage({ id: 'i', locked: true }) },
      backgroundOrder: ['p', 'i'], // image over polygon
      textLabels: { g: makeTextLabel({ id: 'g', x: 0, y: 0, text: 'Hi', locked: true }) },
      routeBullets: { b: bullet('b') },
    });
    expect(lockedHitsAt({ x: 0, y: 0 }, d, 0).map((r) => `${r.kind}:${r.id}`)).toEqual([
      'label:g',
      'bullet:b',
      'station:S',
      'svgImage:i',
      'polygon:p',
    ]);
  });

  it('orders overlapping locked polygons by render order, topmost first', () => {
    const d = doc({
      polygons: {
        low: makePolygon({ id: 'low', locked: true }),
        high: makePolygon({ id: 'high', locked: true }),
      },
      backgroundOrder: ['low', 'high'], // later = painted on top
    });
    expect(lockedHitsAt({ x: 0, y: 0 }, d, 0).map((r) => r.id)).toEqual(['high', 'low']);
  });

  it('interleaves locked polygons and images by the one shared background order', () => {
    // A polygon stacked ABOVE an image must be reported above it — the two
    // kinds share one stack, so they can't be reported as kind-grouped blocks.
    const d = doc({
      polygons: { p: makePolygon({ id: 'p', locked: true }) },
      svgImages: { i: makeSvgImage({ id: 'i', locked: true }) },
      backgroundOrder: ['i', 'p'], // polygon on top
    });
    expect(lockedHitsAt({ x: 0, y: 0 }, d, 0).map((r) => `${r.kind}:${r.id}`)).toEqual([
      'polygon:p',
      'svgImage:i',
    ]);
  });

  it('the pad makes an OPEN locked polygon reachable near its stroke', () => {
    const chain = makePolygon({
      id: 'open',
      locked: true,
      closed: false,
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });
    const d = doc({ polygons: { open: chain }, backgroundOrder: ['open'] });
    expect(lockedHitsAt({ x: 50, y: 1 }, d, 2)).toEqual([{ kind: 'polygon', id: 'open' }]);
    expect(lockedHitsAt({ x: 50, y: 5 }, d, 2)).toEqual([]);
  });
});

describe('mergeLockedIntoStack', () => {
  const entry = (kind: HitRef['kind'], id: string): HitEntry => ({
    kind,
    id,
    element: null as unknown as Element,
  });

  it('appends locked entries below the live stack', () => {
    const merged = mergeLockedIntoStack(
      [entry('station', 's1'), entry('line', 'L1')],
      [entry('polygon', 'p0')],
    );
    expect(merged.map((e) => `${e.kind}:${e.id}`)).toEqual(['station:s1', 'line:L1', 'polygon:p0']);
  });

  it('drops locked entries already present in the live stack (locked-but-selected items)', () => {
    const merged = mergeLockedIntoStack(
      [entry('polygon', 'p0'), entry('line', 'L1')],
      [entry('polygon', 'p0')],
    );
    expect(merged.map((e) => `${e.kind}:${e.id}`)).toEqual(['polygon:p0', 'line:L1']);
  });
});

describe('currentHitEntity', () => {
  const sel = (over: Partial<Record<string, unknown>> = {}): SelectionState =>
    ({
      selectedStationIds: [],
      selectedRouteBulletIds: [],
      selectedLabelIds: [],
      selectedPolygonIds: [],
      selectedSvgImageIds: [],
      selectedLineId: null,
      selectedTransferId: null,
      selectedLineTagId: null,
      ...over,
    }) as unknown as SelectionState;

  it('returns the sole selected item', () => {
    expect(currentHitEntity(sel({ selectedStationIds: ['s1'] }))).toEqual({
      kind: 'station',
      id: 's1',
    });
    expect(currentHitEntity(sel({ selectedPolygonIds: ['p0'] }))).toEqual({
      kind: 'polygon',
      id: 'p0',
    });
  });

  it('covers the single-id primaries soleSelection does not: line, transfer, line tag', () => {
    expect(currentHitEntity(sel({ selectedLineId: 'L1' }))).toEqual({ kind: 'line', id: 'L1' });
    expect(currentHitEntity(sel({ selectedTransferId: 't1' }))).toEqual({
      kind: 'transfer',
      id: 't1',
    });
    expect(currentHitEntity(sel({ selectedLineTagId: 'tag1' }))).toEqual({
      kind: 'lineTag',
      id: 'tag1',
    });
  });

  it('returns null for a multi-selection (cycling restarts at the top)', () => {
    expect(currentHitEntity(sel({ selectedStationIds: ['a', 'b'] }))).toBeNull();
    expect(
      currentHitEntity(sel({ selectedStationIds: ['a'], selectedLabelIds: ['g'] })),
    ).toBeNull();
  });

  it('returns null when nothing is selected', () => {
    expect(currentHitEntity(sel())).toBeNull();
  });
});
