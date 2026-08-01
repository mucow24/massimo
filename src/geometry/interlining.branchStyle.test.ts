import { describe, it, expect } from 'vitest';
import {
  buildBands,
  buildStopMarkers,
  buildOrderedRenderables,
  resolveSegmentStyle,
} from './interlining';
import { makeStation, makeStop, makeLine } from '../test/fixtures';
import { pairKeyOf } from '../model/pairKey';
import type { Line, LineId, LineStyle, Station, StationId } from '../model/types';

// A station's marker style is derived from the line's segment styles at the
// edges incident to it. The rule is PLURALITY: the most common incident style
// wins, ties broken by the canonical LineStyle order (so 'solid' wins any tie
// it is part of).
//
// That resolved style then enforces one invariant: A STOP DOT'S STYLE IS THE
// STYLE OF THE TOPMOST SEGMENT OF THAT LINE AT THAT STATION. Segments matching
// the square stay on top, so the through-route reads continuous wherever a
// line's own stripes coincide — at a branch, and equally at a degree-2 station
// where the line doubles back on itself.

/** One line over `stations`, with the given edges and per-edge styles. */
function scene(
  coords: Record<StationId, { x: number; y: number }>,
  edges: string[],
  segmentStyles: Record<string, LineStyle> = {},
) {
  const stations: Record<StationId, Station> = {};
  for (const [id, p] of Object.entries(coords)) {
    stations[id] = makeStation({ id, x: p.x, y: p.y, stops: [makeStop('l1')] });
  }
  const lines: Record<LineId, Line> = {
    l1: makeLine({
      id: 'l1',
      stations: Object.keys(coords),
      edges,
      ...(Object.keys(segmentStyles).length ? { segmentStyles } : {}),
    }),
  };
  const bands = buildBands(stations, lines, ['l1']);
  const markers = buildStopMarkers(stations, lines, ['l1'], bands);
  return { stations, lines, bands, markers };
}

/** The resolved marker style for `l1` at `stationId`. */
function markerStyleAt(
  coords: Record<StationId, { x: number; y: number }>,
  edges: string[],
  segmentStyles: Record<string, LineStyle>,
  stationId: StationId,
): LineStyle {
  const { markers } = scene(coords, edges, segmentStyles);
  return markers.find((m) => m.stationId === stationId && m.lineId === 'l1')!.style;
}

// Vertical trunk s1—s2—s3 with a branch s2—s4 whose octilinear route runs UP
// the trunk corridor before turning right: the two stripes coincide between s2
// and the corner, which is the overlap this whole rule exists to order.
const BRANCH_COORDS = {
  s1: { x: 410, y: 1008 },
  s2: { x: 410, y: 697 },
  s3: { x: 410, y: 146 },
  s4: { x: 768, y: 407 },
};
const TRUNK_LOWER = pairKeyOf('s1', 's2');
const TRUNK_UPPER = pairKeyOf('s2', 's3');
const BRANCH = pairKeyOf('s2', 's4');
// Edge order deliberately puts the branch LAST, which is what makes it paint on
// top today — so a test asserting the trunk wins fails on behaviour, not setup.
const BRANCH_EDGES = [TRUNK_LOWER, TRUNK_UPPER, BRANCH];

describe('stationMarkerStyle — plurality', () => {
  it('takes the majority style at a branch, not solid', () => {
    // dashed x2 vs solid x1 — today this resolves to solid because the junction
    // is mixed; under plurality the dashed trunk wins.
    expect(
      markerStyleAt(
        BRANCH_COORDS,
        BRANCH_EDGES,
        { [TRUNK_LOWER]: 'dashed', [TRUNK_UPPER]: 'dashed' },
        's2',
      ),
    ).toBe('dashed');
  });

  it('never invents a style that no incident edge has', () => {
    // hatched x2 vs dotted x1 — no solid anywhere, so solid is not an answer.
    expect(
      markerStyleAt(
        BRANCH_COORDS,
        BRANCH_EDGES,
        { [TRUNK_LOWER]: 'hatched', [TRUNK_UPPER]: 'hatched', [BRANCH]: 'dotted' },
        's2',
      ),
    ).toBe('hatched');
  });

  it('breaks a tie containing solid in favour of solid', () => {
    // 1-1-1: solid, dashed, dotted. Solid is first in the canonical order.
    expect(
      markerStyleAt(
        BRANCH_COORDS,
        BRANCH_EDGES,
        { [TRUNK_UPPER]: 'dashed', [BRANCH]: 'dotted' },
        's2',
      ),
    ).toBe('solid');
  });

  it('breaks a solid-free tie by canonical order', () => {
    // Degree-2 station s3 is not involved; at s2 the three styles are all
    // distinct and none is solid, so the earliest in the union order wins.
    expect(
      markerStyleAt(
        BRANCH_COORDS,
        BRANCH_EDGES,
        { [TRUNK_LOWER]: 'dotted', [TRUNK_UPPER]: 'dashed', [BRANCH]: 'hatched' },
        's2',
      ),
    ).toBe('dashed');
  });

  it('leaves a unanimous junction alone', () => {
    expect(
      markerStyleAt(
        BRANCH_COORDS,
        BRANCH_EDGES,
        { [TRUNK_LOWER]: 'dashed', [TRUNK_UPPER]: 'dashed', [BRANCH]: 'dashed' },
        's2',
      ),
    ).toBe('dashed');
  });

  it('leaves a plain through-stop and a terminus alone', () => {
    const styles = { [TRUNK_UPPER]: 'dashed' as LineStyle };
    // s3 is a terminus of a dashed edge -> dashed (unchanged from today).
    expect(markerStyleAt(BRANCH_COORDS, BRANCH_EDGES, styles, 's3')).toBe('dashed');
    // s1 is a terminus of a solid edge -> solid.
    expect(markerStyleAt(BRANCH_COORDS, BRANCH_EDGES, styles, 's1')).toBe('solid');
  });
});

/** pairKeys of `l1`'s stripes in paint order, back to front. */
function stripeOrder(
  coords: Record<StationId, { x: number; y: number }>,
  edges: string[],
  segmentStyles: Record<string, LineStyle>,
): string[] {
  const { bands, markers, lines } = scene(coords, edges, segmentStyles);
  return buildOrderedRenderables(bands, markers, lines)
    .filter((r) => r.kind === 'stripe')
    .map((r) => r.band.pairKey);
}

describe('paint order follows the stop square', () => {
  it('keeps a solid trunk in front of a dashed branch', () => {
    const order = stripeOrder(BRANCH_COORDS, BRANCH_EDGES, { [BRANCH]: 'dashed' });
    // Marker at s2 = solid (2 solid vs 1 dashed), so the branch is demoted
    // behind both trunk segments regardless of its position in `edges`.
    expect(order.indexOf(BRANCH)).toBeLessThan(order.indexOf(TRUNK_UPPER));
    expect(order.indexOf(BRANCH)).toBeLessThan(order.indexOf(TRUNK_LOWER));
  });

  it('keeps a DASHED trunk in front of a solid branch', () => {
    // The case the "match the stop square" idea used to get backwards: with a
    // patterned trunk, the lone solid spur must NOT be promoted over it.
    const order = stripeOrder(BRANCH_COORDS, BRANCH_EDGES, {
      [TRUNK_LOWER]: 'dashed',
      [TRUNK_UPPER]: 'dashed',
    });
    expect(order.indexOf(BRANCH)).toBeLessThan(order.indexOf(TRUNK_UPPER));
  });

  it('leaves a unanimous branch in edge order', () => {
    const order = stripeOrder(BRANCH_COORDS, BRANCH_EDGES, {});
    expect(order).toEqual(BRANCH_EDGES);
  });

  // A line can double back on itself WITHOUT branching: ec—ub—kg is a plain
  // 3-station path, but the router sends the ub—kg edge UP the ec—ub corridor
  // before turning right, so ub's two edges leave it in the SAME direction and
  // their stripes coincide. Degree is 2, so a degree>=3 gate misses this
  // entirely — yet it is the same artifact and wants the same answer.
  const HAIRPIN_COORDS = {
    ec: { x: 370, y: 118 },
    ub: { x: 370, y: 750 },
    kg: { x: 643, y: 417 },
  };
  const HAIRPIN_TRUNK = pairKeyOf('ec', 'ub');
  const HAIRPIN_SPUR = pairKeyOf('kg', 'ub');

  it('keeps a solid trunk in front where the line doubles back at a degree-2 stop', () => {
    // ub's adjacencies are solid + dashed: a 1-1 tie, and solid wins any tie it
    // is part of, so the spur is the one that differs and gets demoted.
    const styles = { [HAIRPIN_SPUR]: 'dashed' as LineStyle };
    expect(markerStyleAt(HAIRPIN_COORDS, [HAIRPIN_TRUNK, HAIRPIN_SPUR], styles, 'ub')).toBe(
      'solid',
    );
    const order = stripeOrder(HAIRPIN_COORDS, [HAIRPIN_TRUNK, HAIRPIN_SPUR], styles);
    expect(order.indexOf(HAIRPIN_SPUR)).toBeLessThan(order.indexOf(HAIRPIN_TRUNK));
  });

  // THE invariant, stated directly: a stop dot's style is the style of the
  // topmost segment of that line at that station. Everything above is a
  // consequence of it.
  const expectDotMatchesTopSegment = (
    coords: Record<StationId, { x: number; y: number }>,
    edges: string[],
    segmentStyles: Record<string, LineStyle>,
  ) => {
    const { bands, markers, lines } = scene(coords, edges, segmentStyles);
    const list = buildOrderedRenderables(bands, markers, lines);
    for (const marker of markers) {
      const line = lines[marker.lineId];
      // Back-to-front, so the LAST incident stripe of this line is the one on
      // top at this station.
      const top = list
        .filter(
          (r) =>
            r.kind === 'stripe' &&
            r.band.lines[r.stripeIndex].id === marker.lineId &&
            (r.band.fromId === marker.stationId || r.band.toId === marker.stationId),
        )
        .pop();
      if (!top || top.kind !== 'stripe') continue; // stopless / edgeless
      expect({
        at: marker.stationId,
        style: resolveSegmentStyle(line, top.band.pairKey),
      }).toEqual({ at: marker.stationId, style: marker.style });
    }
  };

  it('holds the dot-matches-top-segment invariant on the branch map', () => {
    expectDotMatchesTopSegment(BRANCH_COORDS, BRANCH_EDGES, { [BRANCH]: 'dashed' });
    expectDotMatchesTopSegment(BRANCH_COORDS, BRANCH_EDGES, {
      [TRUNK_LOWER]: 'dashed',
      [TRUNK_UPPER]: 'dashed',
    });
    expectDotMatchesTopSegment(BRANCH_COORDS, BRANCH_EDGES, {
      [TRUNK_LOWER]: 'hatched',
      [TRUNK_UPPER]: 'hatched',
      [BRANCH]: 'dotted',
    });
  });

  it('holds the dot-matches-top-segment invariant on the doubling-back map', () => {
    expectDotMatchesTopSegment(HAIRPIN_COORDS, [HAIRPIN_TRUNK, HAIRPIN_SPUR], {
      [HAIRPIN_SPUR]: 'dashed',
    });
    expectDotMatchesTopSegment(HAIRPIN_COORDS, [HAIRPIN_TRUNK, HAIRPIN_SPUR], {
      [HAIRPIN_TRUNK]: 'dotted',
    });
  });

  it('keeps every silhouette behind every body of the same line', () => {
    // The self-casing merge (CASING_EPS) must survive a within-line reorder:
    // a line's own overlapping bands merge into ONE outer casing only if every
    // casing paints before every body.
    const { bands, markers, lines } = scene(BRANCH_COORDS, BRANCH_EDGES, { [BRANCH]: 'dashed' });
    const list = buildOrderedRenderables(bands, markers, lines);
    const lastCasing = list.map((r) => r.kind).lastIndexOf('casing');
    const firstBody = list.map((r) => r.kind).indexOf('stripe');
    expect(lastCasing).toBeLessThan(firstBody);
  });
});
