import { describe, it, expect } from 'vitest';
import { buildBands, buildOrderedRenderables, type SegmentBandSpec } from './interlining';
import { closestParamOnOffsetPath, sampleOffsetPath } from './lineTagGeometry';
import { lineWidthOf } from '../model/lineWidth';
import {
  casingInsetBodyWidth,
  casingSilhouetteWidth,
  lineStrokeRailWidth,
} from '../model/lineStroke';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, MapDoc } from '../model/types';
import type { Vec2 } from './vec';

// ---------------------------------------------------------------------------
// A line must not paint its OWN casing over its OWN body.
//
// With edge-set topology (loops/branches, PR #234) two bands of the SAME line
// routinely overlap OUTSIDE the stop dot: at a junction every edge leaves the
// shared stop along one axis then peels off, so the bands run down a shared
// corridor before diverging. If casing were painted per band inline (body then
// its two rails), the last-painted band's casing would land on top of an
// earlier same-line band's colored body — a white stroke splitting what should
// read as one continuous colored line.
//
// The fix (see lineStroke.ts / buildOrderedRenderables): casing paints as a
// SILHOUETTE at `priority + CASING_EPS` (just behind its own body but in front
// of lower lines) plus an INSET body — so every silhouette paints before every
// body and a same-line body always re-covers a sibling's casing in the shared
// interior. This test pins that invariant: at a point clearly inside the line's
// own colored body and clear of every stop dot, the TOP-MOST painted element is
// a body, never a casing. It models the paint list straight from
// `buildOrderedRenderables` + the shared width helpers, so it tracks the
// product rather than a hand-maintained copy of it.
// ---------------------------------------------------------------------------

// One painted, stroke-based element: an offset path of `band`, stroked `2*half`
// wide, that is either a body (colored) or a casing silhouette (white).
interface PaintEl {
  casing: boolean;
  offset: number;
  half: number;
  band: SegmentBandSpec;
}

// The ordered paint list for one solid line, straight from the product: each
// 'casing' renderable is a silhouette (body + railW) and each 'stripe' is the
// inset body (body − railW), in `buildOrderedRenderables` z-order. (Fixtures
// here are solid, i.e. opaque-interior — open styles keep inline rails and emit
// no silhouette.) Dots are excluded; every sample below is kept well clear of
// the stops the dots cover.
function paintSequence(bands: SegmentBandSpec[], line: Line): PaintEl[] {
  const els: PaintEl[] = [];
  for (const r of buildOrderedRenderables(bands, [])) {
    if (r.kind === 'marker') continue;
    const w = r.band.stripeWidths[r.stripeIndex];
    const railW = lineStrokeRailWidth(line.strokeWidth ?? 0, w);
    const offset = r.band.stripeOffsets[r.stripeIndex];
    els.push(
      r.kind === 'casing'
        ? { casing: true, offset, half: casingSilhouetteWidth(w, railW) / 2, band: r.band }
        : { casing: false, offset, half: casingInsetBodyWidth(w, railW) / 2, band: r.band },
    );
  }
  return els;
}

const distTo = (el: PaintEl, p: Vec2) =>
  closestParamOnOffsetPath(el.band.centerline, el.band.radius, el.offset, p).dist;

// The last-painted (top-most) element covering `p`, or null if none does.
function topAt(els: PaintEl[], p: Vec2): PaintEl | null {
  let top: PaintEl | null = null;
  for (const el of els) if (distTo(el, p) <= el.half + 1e-6) top = el;
  return top;
}

// Every point where the line's casing is painted on top of its own colored
// body, clear of the stop dots — i.e. a visible white split. Returned as
// readable descriptors so a failure names the offending points.
function selfCasingOverdraw(doc: MapDoc, lineId: string): string[] {
  const bands = buildBands(doc.stations, doc.lines, doc.curveRadius, doc.lineOrder);
  const line = doc.lines[lineId];
  const w = lineWidthOf(line);
  const railW = lineStrokeRailWidth(line.strokeWidth ?? 0, w);
  expect(railW).toBeGreaterThan(0); // fixture sanity: the line actually has casing
  const els = paintSequence(bands, line);

  const stations = Object.values(doc.stations).map((s) => ({ x: s.x, y: s.y }));
  const nearAnyDot = (p: Vec2) => stations.some((s) => Math.hypot(p.x - s.x, p.y - s.y) <= w);
  // "Clearly inside a colored body": nearer than the body's colored core, whose
  // half-width is w/2 minus the railW/2 that the body's own edge casing eats.
  const coreHalf = w / 2 - railW / 2 - 0.5;

  const hits: string[] = [];
  for (const b of bands) {
    for (const side of [-1, 1]) {
      const railOffset = b.stripeOffsets[0] + (side * b.stripeWidths[0]) / 2;
      for (let i = 0; i <= 48; i++) {
        const { p } = sampleOffsetPath(b.centerline, b.radius, railOffset, i / 48);
        if (nearAnyDot(p)) continue;
        // Inside a DIFFERENT band's colored core?
        const inOther = bands.some(
          (o) =>
            o !== b &&
            closestParamOnOffsetPath(o.centerline, o.radius, o.stripeOffsets[0], p).dist < coreHalf,
        );
        if (!inOther) continue;
        // Is the top-most painted thing here a casing? Then white splits color.
        if (topAt(els, p)?.casing) {
          hits.push(`(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) on ${b.bandKey}`);
        }
      }
    }
  }
  return hits;
}

// A red 4px-casing line, default width (14). strokeWidth 4 ⇒ railW 4.
const casedLine = (edges: string[]) => makeLine({ id: 'l1', color: '#c00', strokeWidth: 4, edges });

const hStop = () => makeStop('l1', { orientation: 'auto-horizontal' });

describe('a line does not overdraw its own casing at junctions/loops', () => {
  it('degree-3 junction: through-line a-j-c plus branch j-d', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
        makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
        makeStation({ id: 'd', x: 120, y: -120, stops: [hStop()] }),
      ],
      lines: [casedLine(['a|j', 'c|j', 'd|j'])],
    });
    expect(selfCasingOverdraw(doc, 'l1')).toEqual([]);
  });

  it('3-cycle loop: triangle a-b-c', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 'b', x: 160, y: 0, stops: [hStop()] }),
        makeStation({ id: 'c', x: 80, y: 90, stops: [hStop()] }),
      ],
      lines: [casedLine(['a|b', 'b|c', 'a|c'])],
    });
    expect(selfCasingOverdraw(doc, 'l1')).toEqual([]);
  });

  // The complement of merging: casing must still SEPARATE different interlined
  // lines. A point on the shared edge between two tangent cased lines, clear of
  // the dots, must be painted casing (the silhouettes showing through the railW
  // gap between the inset bodies) — never a body. This is the invariant a naive
  // "all casing behind all bodies" reorder erased.
  it('preserves the casing separator between two interlined lines', () => {
    const stops = () => [
      makeStop('l1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
      makeStop('l2', { row: 1, col: 0, orientation: 'auto-horizontal' }),
    ];
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
        makeStation({ id: 's2', x: 200, y: 0, stops: stops() }),
      ],
      lines: [
        makeLine({ id: 'l1', color: '#c00', strokeWidth: 4, stations: ['s1', 's2'] }),
        makeLine({ id: 'l2', color: '#00c', strokeWidth: 4, stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, doc.curveRadius, doc.lineOrder);
    expect(bands).toHaveLength(1); // one interlined band, two stripes
    const band = bands[0];
    // Both lines share strokeWidth 4, so either resolves the same railW.
    const els = paintSequence(bands, doc.lines['l1']);
    const stationPts = Object.values(doc.stations).map((s) => ({ x: s.x, y: s.y }));
    let separatorPoints = 0;
    for (let i = 0; i <= 20; i++) {
      // Offset 0 = the band midline = the shared edge between the two stripes.
      const { p } = sampleOffsetPath(band.centerline, band.radius, 0, i / 20);
      if (stationPts.some((s) => Math.hypot(p.x - s.x, p.y - s.y) <= 14)) continue;
      expect(topAt(els, p)?.casing).toBe(true); // the separator shows here
      separatorPoints++;
    }
    expect(separatorPoints).toBeGreaterThan(0);
  });
});
