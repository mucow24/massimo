import { Fragment, memo } from 'react';
import { resolveSegmentStyle, SegmentBandSpec } from '../geometry/interlining';
import {
  casingInsetBodyWidth,
  casingSilhouetteWidth,
  lineCasingColor,
  lineSeamColor,
  lineSeamWidthOf,
  lineStrokeRailWidth,
  lineStrokeWidthOf,
  seamRenderWidth,
} from '../model/lineStroke';
import { CasingRails } from './CasingRails';
import { seamClipId } from './canvas/SeamClips';
import type { Line, LineId, LineStyle, SeamEdges } from '../model/types';
import { leftNormal, midpoint, norm, sub } from '../geometry/vec';
import { offsetFilletPath } from '../geometry/router';
import { lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from './HatchPatterns';

// A style's interior is "opaque" when its body fully covers its own footprint
// (solid, or dashed/hatched whose gaps read as opaque underlay/pattern): a
// solid casing silhouette painted behind such a body is hidden except at the
// railW rim, so casing renders as SILHOUETTE + INSET BODY and a line's own
// overlapping bands merge into one outer casing. The two "open" styles have
// transparent gaps a silhouette would bleed through, so they keep the centered
// rails (unchanged, and still self-overlap at junctions — a rare combination).
export const styleHasOpaqueInterior = (style: LineStyle): boolean =>
  style !== 'dashed-open' && style !== 'dotted';

interface Props {
  spec: SegmentBandSpec;
  // Which stripe within `spec.paths`/`spec.lines` to render. Bands are
  // emitted as one renderable per stripe so each can paint at its own line's
  // z-priority — see buildOrderedRenderables.
  stripeIndex: number;
  // Which pass to paint (mirrors StopGlyph's `pass`). A band emits three
  // renderables per stripe: the 'casing' silhouette just behind its body
  // (priority + CASING_EPS), the 'stripe' body, and the branch 'seam' just in
  // front (priority − SEAM_EPS). The 'silhouette' pass paints the fat
  // under-stroke that becomes the casing; the 'body' pass paints the (inset)
  // colored body; the 'seam' pass paints the interior overlap indicator.
  //
  // 'hit' paints NO ink: just this stripe's pointer surface, so a caller can
  // mount it at a z of its own (see the Edit Stops lift in MapCanvas). It is a
  // `data-band-hitbox` like the gappy-style one below, additionally tagged
  // `data-band-lift` because it is a SECOND surface for a stripe that already
  // has one.
  pass: 'silhouette' | 'body' | 'seam' | 'hit';
  // When `interactive` is true, the stripe captures pointer events on its
  // stroke and forwards them via the per-line callbacks. Used to wire up
  // hover-to-preview and click-to-insert in add-line-tag mode. (Body pass only;
  // the silhouette is always inert.)
  interactive?: boolean;
  // Cursor for the interactive stripe: tag mode keeps 'crosshair' (precise
  // placement along the stripe), Edit Stops passes 'pointer' (a stripe click
  // arms/disarms or switches lines — a selection, not a placement).
  interactiveCursor?: 'crosshair' | 'pointer';
  onLineHover?: (lineId: LineId, e: React.PointerEvent<SVGPathElement>) => void;
  onLineLeave?: (lineId: LineId, e: React.PointerEvent<SVGPathElement>) => void;
  onLineClick?: (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => void;
  // Default-mode click handler: selects a line by clicking its stripe. Also
  // receives this band's corridor pairKey so shift-click can address the
  // segment (style cycling) without a per-band closure.
  onLineSelect?: (lineId: LineId, e: React.MouseEvent<SVGPathElement>, pairKey?: string) => void;
  // Live line map. Color and per-segment style are resolved from here at
  // render time (the spec is presentation-free), so edits repaint without a
  // geometry rebuild.
  lines: Record<LineId, Line>;
  // Optional per-line color override (e.g. for desaturating non-selected lines).
  colorMap?: Record<LineId, string>;
  // Gap/underlay color for non-solid styles; matches the canvas background.
  underlayColor?: string;
  // Decorative render (the selected-line highlight overlay): repaint the band
  // with NO DOM identity — drops every `data-band-*`/`data-line-id` tag and
  // forces the paths inert (pointer-events: none, no handlers), regardless of
  // the interactive/onLineSelect props. The overlay repaints the selected
  // line's stripes on top of a pointer-events:none wash, so its copies must not
  // be found a second time by hit-testing (see hitStack) or the `[data-band-*]`
  // DOM-query tests — those key on the tags the base paint stamps here.
  decorative?: boolean;
  // Global branch-seam inner-edge mode; only consulted on the seam pass. 'both'
  // paints the whole seam, 'straight'/'curved' keep only the straight or fillet
  // pieces of each edge so a branch reads as a single hint. Default 'both'.
  seamEdges?: SeamEdges;
}

// Memoized: a band emits one stripe renderable per line (and one casing
// renderable), so SegmentBand is one of the highest-instance-count components
// on the canvas. Across a viewport pan every prop is referentially stable (spec
// is from a doc-keyed memo; lines is an immutable store ref; colorMap is
// memoized; onLineSelect is a stable useCallback; interactive is constant
// outside line-tag/layering modes), so React skips re-rendering when only the
// viewBox moves.
export const SegmentBand = memo(function SegmentBand({
  spec,
  stripeIndex,
  pass,
  interactive = false,
  interactiveCursor = 'crosshair',
  onLineHover,
  onLineLeave,
  onLineClick,
  onLineSelect,
  lines,
  colorMap,
  underlayColor,
  decorative = false,
  seamEdges = 'both',
}: Props) {
  const lineId = spec.lines[stripeIndex].id;
  const d = spec.paths[stripeIndex];
  const live = lines[lineId];
  // Resolve presentation live (spec carries only the id): desaturation
  // override wins for color, then the line's own color; style is the
  // per-segment resolution keyed on this band's pairKey. Width, by contrast,
  // is GEOMETRY — baked into the spec alongside the paths it shaped.
  const color = colorMap?.[lineId] ?? live.color;
  const style = resolveSegmentStyle(live, spec.pairKey);
  const fullWidth = spec.stripeWidths[stripeIndex];
  const railW = lineStrokeRailWidth(lineStrokeWidthOf(live), fullWidth);
  const opaque = styleHasOpaqueInterior(style);
  // A decorative copy is fully inert: it never wires pointer handlers nor
  // becomes selectable, whatever interactive/onLineSelect say.
  const active = interactive && !decorative;
  const selectable = !interactive && !decorative && !!onLineSelect;
  // Pointer wiring, shared VERBATIM by the painted stripe, the gappy-style hit
  // box, and the lifted 'hit' pass, so they can never disagree about what a
  // click on this stripe does.
  const pointer: React.SVGProps<SVGPathElement> = {
    style: active ? { cursor: interactiveCursor } : selectable ? { cursor: 'pointer' } : undefined,
    onPointerMove: active && onLineHover ? (e) => onLineHover(lineId, e) : undefined,
    onPointerLeave: active && onLineLeave ? (e) => onLineLeave(lineId, e) : undefined,
    onClick:
      active && onLineClick
        ? (e) => onLineClick(lineId, e)
        : selectable
          ? (e) => onLineSelect!(lineId, e, spec.pairKey)
          : undefined,
  };

  // Hit pass: this stripe's pointer surface alone, as one continuous
  // transparent stroke over its whole PAINTED extent — the casing silhouette's
  // width, not the inset body's, so the rim the casing paints is grabbable too.
  // The caller mounts it wherever it wants the stripe to hit-test from; the
  // stripe's own surface below stays where it is.
  if (pass === 'hit') {
    if (!active && !selectable) return null;
    return (
      <path
        d={d}
        data-band-hitbox=""
        data-band-lift=""
        data-band-key={spec.bandKey}
        data-pair-key={spec.pairKey}
        data-line-id={lineId}
        data-export-exclude="1"
        fill="none"
        stroke="transparent"
        strokeWidth={casingSilhouetteWidth(fullWidth, railW)}
        strokeLinecap="butt"
        strokeLinejoin="round"
        pointerEvents="stroke"
        {...pointer}
      />
    );
  }

  // Seam pass: the interior branch/loop overlap indicator — two strokes CENTERED
  // on the body edges (exactly where the casing sits, so the seam aligns with
  // it), in the seam color, CLIPPED to the line's OTHER band corridors (see
  // SeamClips) so it shows only where this band overlaps another of the line's
  // own bands and vanishes on a plain segment and the outer boundary. Width is
  // independent (seamWidth), inheriting the casing width when unset.
  if (pass === 'seam') {
    const seamColor = lineSeamColor(live, color);
    const seamW = seamRenderWidth(lineSeamWidthOf(live), railW, fullWidth);
    if (!seamColor || seamW <= 0) return null;
    const off = spec.stripeOffsets[stripeIndex];
    const edge = fullWidth / 2;
    // Keep both edge kinds, or just the straight (`line`) / curved (`arc`)
    // pieces per the global setting — so a branch can be hinted with one edge.
    const keep = seamEdges === 'straight' ? 'line' : seamEdges === 'curved' ? 'arc' : 'both';
    return (
      <g clipPath={`url(#${seamClipId(lineId, spec.bandKey)})`} pointerEvents="none">
        {[-1, 1].map((side) => {
          // Filtering ('straight'/'curved') can leave an edge with no retained
          // pieces (e.g. a curved-only seam on a fully straight band). Skip the
          // empty path rather than emit `d=""` — inert on-canvas, but an empty
          // path is a needless snag for the PDF exporter.
          const d = offsetFilletPath(spec.centerline, spec.radius, off + side * edge, keep);
          if (!d) return null;
          return (
            <path
              key={side}
              d={d}
              data-band-seam={decorative ? undefined : ''}
              data-line-id={decorative ? undefined : lineId}
              fill="none"
              stroke={seamColor}
              strokeWidth={seamW}
              strokeLinecap="butt"
              strokeLinejoin="round"
            />
          );
        })}
      </g>
    );
  }

  // Silhouette pass: the fat under-stroke that becomes the casing. Opaque
  // styles only — an open style has no silhouette (its rails paint inline in
  // the body pass). Nothing to paint when the line has no casing.
  if (pass === 'silhouette') {
    if (railW <= 0 || !opaque) return null;
    return (
      <path
        d={d}
        data-band-casing={decorative ? undefined : ''}
        data-line-id={decorative ? undefined : lineId}
        fill="none"
        stroke={lineCasingColor(live, color)}
        strokeWidth={casingSilhouetteWidth(fullWidth, railW)}
        strokeLinecap="butt"
        strokeLinejoin="round"
        pointerEvents="none"
      />
    );
  }

  // Body pass. Opaque styles inset the body by railW so the silhouette beneath
  // shows exactly railW of casing at each edge; open styles keep the full body
  // width and carry their casing as inline centered rails (unchanged).
  const bodyWidth = opaque ? casingInsetBodyWidth(fullWidth, railW) : fullWidth;
  const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(style, color, bodyWidth);
  const underlay = lineStyleUnderlayAttrs(style, underlayColor);
  // A "gappy" style (the dasharray ones: dashed, dotted, dashed-open) paints a
  // run of separate pieces, and `pointer-events: stroke` hit-tests that same
  // dashed geometry — the gaps between the pieces were dead to the pointer, so
  // clicking such a segment was a coin flip. Give it ONE continuous transparent
  // stroke over its full footprint as its hit surface instead, and take the
  // painted pieces out of hit-testing. Continuous styles (solid, hatched — the
  // hatch is a pattern PAINT on an unbroken stroke) need none of this and keep
  // the single path they always had.
  const hitBox = !decorative && (active || selectable) && strokeDasharray !== undefined;
  return (
    <Fragment>
      {underlay && (
        <path
          d={d}
          fill="none"
          stroke={underlay.stroke}
          strokeWidth={bodyWidth}
          strokeLinecap={underlay.strokeLinecap}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      <path
        d={d}
        data-band-stripe={decorative ? undefined : true}
        data-band-key={decorative ? undefined : spec.bandKey}
        data-pair-key={decorative ? undefined : spec.pairKey}
        data-line-id={decorative ? undefined : lineId}
        fill="none"
        stroke={stroke}
        strokeWidth={bodyWidth}
        strokeLinecap={strokeLinecap}
        strokeLinejoin="round"
        strokeDasharray={strokeDasharray}
        // The handlers stay wired even when the hit box takes over hit-testing:
        // pointer-events blocks HIT-TESTING, not dispatch, so a synthetic click
        // aimed at the stripe still runs them (same contract locked items rely
        // on — see lockedDispatchTarget).
        pointerEvents={decorative || hitBox ? 'none' : active || selectable ? 'stroke' : undefined}
        {...pointer}
      />
      {/* Open styles keep centered casing rails inline (a silhouette would
          bleed through their transparent gaps); opaque styles get the merged
          casing from the silhouette pass instead. */}
      {!opaque && (
        <CasingRails
          centerline={spec.centerline}
          radius={spec.radius}
          offset={spec.stripeOffsets[stripeIndex]}
          bodyWidth={fullWidth}
          railW={railW}
          color={lineCasingColor(live, color)}
          lineId={decorative ? undefined : lineId}
        />
      )}
      {/* The gappy styles' hit box (see `hitBox`): the stripe's full painted
          footprint — same path, same width, so it never spills onto a neighbor
          stripe — as one unbroken invisible stroke, on top of this band's own
          paint. It carries the stripe's identity attributes because it, not the
          dashes, is what `elementsFromPoint` reports (hitStack.ts resolves both),
          and it is editing chrome: `data-export-exclude` keeps it out of SVG/PDF. */}
      {hitBox && (
        <path
          d={d}
          data-band-hitbox=""
          data-band-key={spec.bandKey}
          data-pair-key={spec.pairKey}
          data-line-id={lineId}
          data-export-exclude="1"
          fill="none"
          stroke="transparent"
          strokeWidth={bodyWidth}
          strokeLinecap="butt"
          strokeLinejoin="round"
          pointerEvents="stroke"
          {...pointer}
        />
      )}
    </Fragment>
  );
});

// Warning decoration for a band the router couldn't route cleanly. When a
// band warns, its centerline collapses to a straight start→end segment (see
// route()), which we paint as a crude straight line. Here we frame that bad
// segment with a 2px red outline and drop a ⚠ glyph over its exact center.
//
// Rendered in a dedicated top-most layer (see MapCanvas) — not interleaved
// with the stripes — so the glyph sits above every stripe, dot, and label and
// can never be occluded.
//
// `iconColor` is the glyph fill — the caller passes whichever of black/white
// is more legible against the stripe beneath the glyph's center (via
// legibleTextOn). Defaults to black for standalone/test renders.
export function BandWarning({
  spec,
  iconColor = '#000',
}: {
  spec: SegmentBandSpec;
  iconColor?: string;
}) {
  const verts = spec.centerline;
  if (!spec.warning || verts.length < 2) return null;
  const a = verts[0];
  const b = verts[verts.length - 1];
  // Unit vector along the segment and its left-perpendicular. The band's
  // envelope runs from the first stripe's near edge to the last stripe's far
  // edge — for mixed widths that's ASYMMETRIC about the (mean) centerline,
  // so the edges come from the baked offsets ± half-widths rather than a
  // symmetric ±Σw/2.
  const { x: px, y: py } = leftNormal(norm(sub(b, a)));
  const n = spec.lines.length;
  const lo = spec.stripeOffsets[0] - spec.stripeWidths[0] / 2;
  const hi = spec.stripeOffsets[n - 1] + spec.stripeWidths[n - 1] / 2;
  const corner = (p: { x: number; y: number }, off: number) =>
    `${p.x + px * off} ${p.y + py * off}`;
  // Rectangle tracing the band's perimeter; the 2px stroke straddles the edge.
  const outline = `M ${corner(a, hi)} L ${corner(b, hi)} L ${corner(b, lo)} L ${corner(a, lo)} Z`;
  const { x: cx, y: cy } = midpoint(a, b);
  return (
    <g pointerEvents="none">
      {/* 1px white core over a 3px red stroke: paint the red stroke first,
          then the white stroke centered on top. */}
      <path d={outline} fill="none" stroke="#d00" strokeWidth={3} strokeLinejoin="round" />
      <path d={outline} fill="none" stroke="#fff" strokeWidth={1} strokeLinejoin="round" />
      <text
        x={cx}
        y={cy}
        fontSize={14}
        fill={iconColor}
        textAnchor="middle"
        dominantBaseline="central"
      >
        ⚠
      </text>
    </g>
  );
}
