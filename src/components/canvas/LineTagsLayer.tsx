import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LineTag, MapDoc } from '../../model/types';
import type { SegmentBandSpec } from '../../geometry/interlining';
import {
  lineTraversesForwardCanon,
  offsetPathLength,
  sampleOffsetPathByArcLength,
} from '../../geometry/lineTagGeometry';
import { dragState, useDoc, useSelection } from '../../state/store';
import { useThemeColors } from '../../state/theme';
import { legibleTextOn } from '../../util/color';
import { angleDeg, scale, type Vec2 } from '../../geometry/vec';
import { pairKeyOf } from '../../model/pairKey';
import { useLineTagDrag } from './useLineTagDrag';

const ALONG_FONT_SIZE = 12;
const TEXT_PAD = 1;

// Chevron geometry: a solid ">" band (drawn pointing +x before rotation) that
// fills its stripe's full height (the line's width — half-height comes from
// ResolvedTag.stripeWidth at render time), so each arm runs out to the line
// edge and ends in a flat segment parallel to it. Sharp corners — no rounding.
const CHEVRON_DEPTH = 6; // how far the V point juts forward
const CHEVRON_THICK = 4; // band thickness measured along the line
// Bleed the arms a hair past the line edge so the chevron overlaps the stripe
// instead of abutting it — two coincident antialiased edges otherwise leak a
// hairline of the line color through the seam. Expressed in *screen* pixels and
// divided by zoom at render time so the overlap stays a constant sub-pixel
// sliver at every zoom: big enough to cover the seam, too small to visibly
// spill onto a touching interlined neighbor.
const CHEVRON_EDGE_BLEED_PX = 0.33;
// Front face left x, chosen so the band's bounding box is centered on x=0.
const CHEVRON_FRONT_X = (CHEVRON_THICK - CHEVRON_DEPTH) / 2;
// Along-line half-extent of the chevron's hit/selection box. The cross-line
// half-extent is the stripe's half-width (so the box tracks the scaled arms).
const CHEVRON_BOX_HALF_W = (CHEVRON_DEPTH + CHEVRON_THICK) / 2;
// Closed polygon: front V (top→tip→bottom) then back V (bottom→tip→top); the
// connecting top/bottom edges are the flat segments along the line edges.
// `armH` is the half-height including the zoom-aware bleed.
function chevronPoints(armH: number): string {
  return [
    [CHEVRON_FRONT_X, -armH],
    [CHEVRON_FRONT_X + CHEVRON_DEPTH, 0],
    [CHEVRON_FRONT_X, armH],
    [CHEVRON_FRONT_X - CHEVRON_THICK, armH],
    [CHEVRON_FRONT_X - CHEVRON_THICK + CHEVRON_DEPTH, 0],
    [CHEVRON_FRONT_X - CHEVRON_THICK, -armH],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
}

const SELECTION_WASH_COLOR = '#f0ff00';
const SELECTION_WASH_OPACITY = 0.3;
const SELECTION_STROKE_WIDTH = 1.5;

interface Props {
  bands: SegmentBandSpec[];
  zoom: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/**
 * Resolve a tag to its renderable position by looking up the band whose
 * pairKey matches and which contains the tag's line. Returns null if the
 * tag is orphaned (line gone or corridor no longer an edge).
 */
export interface ResolvedTag {
  tag: LineTag;
  service: string;
  color: string;
  kind: 'text' | 'chevron';
  p: Vec2;
  // Tangent in line-traversal frame (already flipped if the line traverses
  // the corridor reverse-canonically). Unit vector.
  tangent: Vec2;
  // The stripe's baked stroke width — sizes the chevron arms (and their
  // hit/selection box) to the line's painted body.
  stripeWidth: number;
}

export function resolveTag(
  tag: LineTag,
  doc: Pick<MapDoc, 'lines'>,
  bands: SegmentBandSpec[],
): ResolvedTag | null {
  const line = doc.lines[tag.lineId];
  if (!line) return null;
  const pairKey = pairKeyOf(tag.fromStationId, tag.toStationId);
  const band = bands.find((b) => b.pairKey === pairKey && b.lines.some((l) => l.id === tag.lineId));
  if (!band) return null;
  const k = band.lines.findIndex((l) => l.id === tag.lineId);
  const offset = band.stripeOffsets[k];
  // band.radius is the effective centerline radius the router used — already
  // bumped above doc.curveRadius for interlined bands so the inner stripes
  // respect the min radius. Sample against the same radius or geometry desyncs.
  const stripeTotal = offsetPathLength(band.centerline, band.radius, offset);
  // Walk from anchor endpoint by `distance` along the stripe. Clamps inside
  // sampleOffsetPathByArcLength when the corridor has shrunk below distance.
  const arcLenOnStripe =
    tag.anchorEnd === 'from' ? tag.distance : Math.max(0, stripeTotal - tag.distance);
  const sample = sampleOffsetPathByArcLength(band.centerline, band.radius, offset, arcLenOnStripe);
  const forward = lineTraversesForwardCanon(line, tag.fromStationId, tag.toStationId);
  const tangent = forward ? sample.tangent : scale(sample.tangent, -1);
  return {
    tag,
    service: line.service,
    color: line.color,
    kind: tag.kind ?? 'text',
    p: sample.p,
    tangent,
    stripeWidth: band.stripeWidths[k],
  };
}

const ORIENTATION_OFFSET_DEG: Record<0 | 1 | 2 | 3, number> = {
  0: 0, // along line-forward
  1: -90, // perpendicular CCW (visually, in y-down screen)
  2: 180, // along line-reverse
  3: 90, // perpendicular CW
};

export function LineTagsLayer({ bands, zoom, svgRef }: Props) {
  const lines = useDoc((s) => s.lines);
  const lineTags = useDoc((s) => s.lineTags);
  const cycleLineTagOrientation = useDoc((s) => s.cycleLineTagOrientation);
  const deleteLineTag = useDoc((s) => s.deleteLineTag);
  const selection = useSelection();
  const drag = useLineTagDrag(svgRef);

  const resolved = useMemo(() => {
    const list: ResolvedTag[] = [];
    for (const id of Object.keys(lineTags)) {
      const r = resolveTag(lineTags[id], { lines }, bands);
      if (r) list.push(r);
    }
    return list;
  }, [lineTags, lines, bands]);

  // Measure each unique service string once at fontSize=12 bold to know how
  // wide it is. Used to shrink perpendicular text so it fits in the band.
  const services = useMemo(() => {
    const set = new Set<string>();
    for (const r of resolved) set.add(r.service);
    if (selection.lineTagHoverPreview) set.add(selection.lineTagHoverPreview.service);
    return Array.from(set);
  }, [resolved, selection.lineTagHoverPreview]);
  const widths = useMeasureTextWidths(services);

  // Suppress click after a drag, mirroring station drag.
  const onTagPointerDown = (e: React.PointerEvent, tagId: string) => {
    if (e.button !== 0) return;
    drag.onStartDrag(tagId, e);
  };

  const onTagClick = (e: React.MouseEvent, tagId: string) => {
    if (dragState.suppressClick) return;
    e.stopPropagation();
    selection.selectLineTag(tagId);
  };

  const onTagContextMenu = (e: React.MouseEvent, tagId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Right-click on an unselected tag: select + cycle in one action.
    if (selection.selectedLineTagId !== tagId) selection.selectLineTag(tagId);
    cycleLineTagOrientation(tagId);
  };

  // Hover/ghost preview is cleared by the mode-setters, not on unmount.

  // Delete is wired in App.tsx for keyboard.
  void deleteLineTag;

  return (
    <g>
      {/* Hidden measurer: invisible but rendered so getBBox works. */}
      <Measurer services={services} />

      {/* Selection wash for the selected tag (painted first, before tag text). */}
      {selection.selectedLineTagId &&
        (() => {
          const r = resolved.find((x) => x.tag.id === selection.selectedLineTagId);
          if (!r) return null;
          return (
            <TagShape
              r={r}
              widths={widths}
              layer="wash"
              zoom={zoom}
              onPointerDown={(e) => onTagPointerDown(e, r.tag.id)}
              onClick={(e) => onTagClick(e, r.tag.id)}
              onContextMenu={(e) => onTagContextMenu(e, r.tag.id)}
            />
          );
        })()}

      {/* All tag texts. */}
      {resolved.map((r) => (
        <TagShape
          key={r.tag.id}
          r={r}
          widths={widths}
          layer="text"
          zoom={zoom}
          onPointerDown={(e) => onTagPointerDown(e, r.tag.id)}
          onClick={(e) => onTagClick(e, r.tag.id)}
          onContextMenu={(e) => onTagContextMenu(e, r.tag.id)}
        />
      ))}

      {/* Selection stroke for the selected tag (on top of text). */}
      {selection.selectedLineTagId &&
        (() => {
          const r = resolved.find((x) => x.tag.id === selection.selectedLineTagId);
          if (!r) return null;
          return (
            <TagShape
              r={r}
              widths={widths}
              layer="stroke"
              zoom={zoom}
              onPointerDown={(e) => onTagPointerDown(e, r.tag.id)}
              onClick={(e) => onTagClick(e, r.tag.id)}
              onContextMenu={(e) => onTagContextMenu(e, r.tag.id)}
            />
          );
        })()}

      {/* Ghost preview while in add-line-tag mode and hovering a stripe. */}
      {selection.uiMode.kind === 'creating-line-tag' && selection.lineTagHoverPreview && (
        <GhostPreview
          preview={selection.lineTagHoverPreview}
          color={lines[selection.lineTagHoverPreview.lineId]?.color ?? '#000'}
          widths={widths}
        />
      )}
    </g>
  );
}

interface TagShapeProps {
  r: ResolvedTag;
  widths: Map<string, number>;
  layer: 'wash' | 'text' | 'stroke';
  zoom: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function TagShape({
  r,
  widths,
  layer,
  zoom,
  onPointerDown,
  onClick,
  onContextMenu,
}: TagShapeProps) {
  const themeColors = useThemeColors();
  const orientation = r.tag.orientation;
  const tangentAngleDeg = angleDeg(r.tangent);
  const rotateDeg = tangentAngleDeg + ORIENTATION_OFFSET_DEG[orientation];
  const isChevron = r.kind === 'chevron';
  const { textWidth, textHeight } = sizingFor(r.service, orientation, widths);
  // Half-extents of the hit/selection box, per kind. A chevron's cross-line
  // extent is its stripe's half-width so the box tracks the scaled arms.
  const halfW = isChevron ? CHEVRON_BOX_HALF_W : textWidth / 2 + TEXT_PAD;
  const halfH = isChevron ? r.stripeWidth / 2 : textHeight / 2 + TEXT_PAD;

  if (layer === 'text') {
    return (
      <g transform={`translate(${r.p.x} ${r.p.y}) rotate(${rotateDeg})`} style={{ cursor: 'move' }}>
        {/* Invisible hit rect that picks up pointer events even where the glyphs/chevron are sparse. */}
        <rect
          x={-halfW}
          y={-halfH}
          width={2 * halfW}
          height={2 * halfH}
          fill="transparent"
          pointerEvents="all"
          onPointerDown={onPointerDown}
          onClick={onClick}
          onContextMenu={onContextMenu}
        />
        {isChevron ? (
          <polygon
            points={chevronPoints(r.stripeWidth / 2 + CHEVRON_EDGE_BLEED_PX / zoom)}
            fill={legibleTextOn(r.color)}
            pointerEvents="none"
          />
        ) : (
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={ALONG_FONT_SIZE}
            fontWeight={700}
            fill={legibleTextOn(r.color)}
            pointerEvents="none"
          >
            {r.service}
          </text>
        )}
      </g>
    );
  }

  // Wash + stroke share the same rounded-rect outline.
  const w = 2 * halfW;
  const h = 2 * halfH;
  return (
    <g transform={`translate(${r.p.x} ${r.p.y}) rotate(${rotateDeg})`} pointerEvents="none">
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={2}
        ry={2}
        fill={layer === 'wash' ? SELECTION_WASH_COLOR : 'none'}
        fillOpacity={layer === 'wash' ? SELECTION_WASH_OPACITY : undefined}
        stroke={layer === 'stroke' ? themeColors.selectionStroke : undefined}
        strokeWidth={layer === 'stroke' ? SELECTION_STROKE_WIDTH : undefined}
      />
    </g>
  );
}

function GhostPreview({
  preview,
  color,
  widths,
}: {
  preview: NonNullable<ReturnType<typeof useSelection.getState>['lineTagHoverPreview']>;
  color: string;
  widths: Map<string, number>;
}) {
  const orientation: 0 | 1 | 2 | 3 = 0; // ghost defaults to along-forward
  // Re-orient tangent to line-traversal frame (preview already gives canonical;
  // we flip if reverse-canonical).
  const tangent = preview.lineForwardMatchesCanon ? preview.tangent : scale(preview.tangent, -1);
  const tangentAngleDeg = angleDeg(tangent);
  const rotateDeg = tangentAngleDeg + ORIENTATION_OFFSET_DEG[orientation];
  const { fontSize } = sizingFor(preview.service, orientation, widths);
  return (
    <g
      transform={`translate(${preview.p.x} ${preview.p.y}) rotate(${rotateDeg})`}
      pointerEvents="none"
    >
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={700}
        fill={legibleTextOn(color)}
        opacity={0.5}
      >
        {preview.service}
      </text>
    </g>
  );
}

/**
 * Measurer: renders each unique service string at fontSize=ALONG_FONT_SIZE
 * with bold weight, invisible, so we can read .getBBox() in a layout effect.
 * Results live in a shared module-level cache so multiple LineTagsLayer
 * instances share work and the cache survives re-renders.
 */
const widthCache = new Map<string, number>();
// Subscribers fire when the cache mutates; useSyncExternalStore-style.
const widthCacheListeners = new Set<() => void>();
function subscribeWidthCache(fn: () => void): () => void {
  widthCacheListeners.add(fn);
  return () => {
    widthCacheListeners.delete(fn);
  };
}
function notifyWidthCache() {
  for (const fn of widthCacheListeners) fn();
}

function Measurer({ services }: { services: string[] }) {
  const refs = useRef(new Map<string, SVGTextElement | null>());
  useLayoutEffect(() => {
    let dirty = false;
    for (const s of services) {
      if (widthCache.has(s)) continue;
      const el = refs.current.get(s);
      if (el) {
        try {
          widthCache.set(s, el.getBBox().width);
          dirty = true;
        } catch {
          widthCache.set(s, s.length * 7);
          dirty = true;
        }
      }
    }
    if (dirty) notifyWidthCache();
  }, [services]);
  return (
    <g style={{ visibility: 'hidden' }} pointerEvents="none">
      {services.map((s) => (
        <text
          key={s}
          ref={(el) => {
            refs.current.set(s, el);
          }}
          fontSize={ALONG_FONT_SIZE}
          fontWeight={700}
        >
          {s}
        </text>
      ))}
    </g>
  );
}

function useMeasureTextWidths(services: string[]): Map<string, number> {
  // Subscribe to cache notifications so newly-measured strings trigger a
  // re-render of consumers in the next React tick.
  const [, setTick] = useState(0);
  useEffect(() => subscribeWidthCache(() => setTick((x) => x + 1)), []);
  const widths = new Map<string, number>();
  for (const s of services) {
    widths.set(s, widthCache.get(s) ?? s.length * 7);
  }
  return widths;
}

/**
 * Compute font size + bounding box for a tag.
 *
 * One size for all four orientations: fontSize = 12, bbox follows the
 * measured width at that size. Perpendicular orientations may slightly
 * exceed the 14px band width on long service names (e.g. "AA"), which the
 * user prefers over the previous shrinks-on-rotation behavior.
 */
function sizingFor(
  service: string,
  _orientation: 0 | 1 | 2 | 3,
  widths: Map<string, number>,
): { fontSize: number; textWidth: number; textHeight: number } {
  const measuredAt12 = widths.get(service) ?? service.length * 7;
  return {
    fontSize: ALONG_FONT_SIZE,
    textWidth: measuredAt12,
    textHeight: ALONG_FONT_SIZE,
  };
}
