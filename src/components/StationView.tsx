import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Line, LineId, Station } from '../model/types';
import { beginHistoryGroup, dragState, useDoc, useSelection } from '../state/store';
import { STOP_DOT_RADIUS, STOP_SIZE, stopCenterAt } from '../geometry/orientation';
import { polygonsToPath, unionConvex } from '../geometry/polygonUnion';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { stationBoundaryRectsLocal } from '../geometry/stationBoundary';
import { pathBetweenStations } from '../model/pathSelect';
import { bumpWeightByIndex, resolveDotShape, resolveStationLabelWeight } from '../model/transforms';
import { legibleTextOn } from '../util/color';
import { useViewportStore } from '../state/viewportStore';
import { StopGlyph } from './StopGlyph';
import { stopPosWorld } from '../geometry/interlining';
import { BASELINE_FRACTION, LINE_HEIGHT, measureTextLabel } from '../geometry/textMeasure';
import { InlineBullet } from './InlineBullet';

// Map a click on a station to the closest dot's lineId. Used to pin a
// transfer endpoint to the specific stop the user clicked on, rather than
// the station's anchor center.
function closestStopLineId(station: Station, e: React.MouseEvent): LineId | null {
  if (station.stops.length === 0) return null;
  const svg = document.querySelector('.canvas-host svg') as SVGSVGElement | null;
  if (!svg) return station.stops[0].lineId;
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const wx = vb.x + ((e.clientX - r.left) / r.width) * vb.width;
  const wy = vb.y + ((e.clientY - r.top) / r.height) * vb.height;
  const a = (station.rotation * Math.PI) / 4;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  let bestId = station.stops[0].lineId;
  let bestDist = Infinity;
  for (const cell of station.stops) {
    const local = stopCenterAt(cell.row, cell.col);
    const sx = station.x + local.x * cs - local.y * sn;
    const sy = station.y + local.x * sn + local.y * cs;
    const d = Math.hypot(wx - sx, wy - sy);
    if (d < bestDist) {
      bestDist = d;
      bestId = cell.lineId;
    }
  }
  return bestId;
}

const SELECTION_WASH_COLOR = '#f0ff00';
const SELECTION_WASH_OPACITY = 0.2;
const SELECTION_STROKE_COLOR = '#000000';
const SELECTION_STROKE_WIDTH = 2;
const SELECTION_CORNER_RADIUS = 5;
const MATCH_STROKE_COLOR = '#888';
const MATCH_STROKE_WIDTH = 1.5;

interface RenderLabelTextArgs {
  text: string;
  fontSize: number;
  fontWeight: number;
  fontStyle?: 'italic';
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  paintOrder?: string;
  // Always written to the rendered <text> as an explicit value (never
  // omitted). Chromium leaves stale underline pixels behind when the
  // `text-decoration` SVG attribute toggles from "underline" back to absent
  // on a rotated <text>; rendering 'none' forces a proper paint
  // invalidation as hover clears.
  textDecoration: 'underline' | 'none';
  anchorX: number;
  anchorY: number;
  textAnchor: 'start' | 'middle' | 'end';
  baseline: 'central' | 'text-before-edge' | 'text-after-edge';
  firstLineDy: string;
  // Visual center y of the first text line in the rotated label frame.
  // The bullet path anchors each line with dominantBaseline='central' at
  // firstLineCenterY + i*lineSpacing so it lines up exactly with the
  // non-bullet path (also central-anchored). Without this, labels with
  // inline bullets render their first line a few pixels above their
  // bullet-free counterparts (SVG's 'hanging' anchor sits at the cap-line,
  // not the EM-box top).
  firstLineCenterY: number;
  rotationDeg: number;
  lineByService: Map<string, Line>;
}

const BULLET_TOKEN_RE = /<[^<>]+>/;

/**
 * Render a station label's text content. For plain text (no <CODE> bullet
 * tokens) this falls back to the historical single-`<text>` + `<tspan>`
 * pattern with its existing dominantBaseline/firstLineDy positioning, so
 * the wash silhouette / hit rect / unit tests stay byte-for-byte the same.
 * Labels that contain inline bullets switch to per-segment positioning:
 * each line is laid out explicitly via the segment-aware measurement, and
 * bullets render as a small circle with their service code (gray "?" when
 * the code doesn't resolve). Bullets always render in their own line
 * color and skip the contrast stroke — they're filled and self-legible.
 */
function renderStationLabelText({
  text,
  fontSize,
  fontWeight,
  fontStyle,
  fill,
  stroke,
  strokeWidth,
  paintOrder,
  textDecoration,
  anchorX,
  anchorY,
  textAnchor,
  baseline,
  firstLineDy,
  firstLineCenterY,
  rotationDeg,
  lineByService,
}: RenderLabelTextArgs): React.ReactNode {
  const hasBullet = BULLET_TOKEN_RE.test(text);
  const lines = text.split('\n');
  // Underline as explicit <line> geometry instead of the SVG `text-decoration`
  // attribute. Chromium leaves one-pixel residue on rotated <text> when
  // text-decoration toggles, and remounting via `key` breaks the cap-line
  // paint on the fresh element. Real <line> elements invalidate correctly
  // on mount AND unmount, so this sidesteps both bugs at once.
  const showUnderline = textDecoration === 'underline';
  // Measure ink widths so the explicit underline matches the visible text
  // extent (the same width SVG's text-decoration would have drawn). The
  // measurement is cached, so calling it here for the plain path is cheap.
  const measured = showUnderline
    ? measureTextLabel({ text, fontSize, weight: fontWeight, italic: fontStyle === 'italic' })
    : null;
  // Distance from the central-baseline anchor down to the text baseline.
  // Reuses the constant the bullet path already relies on.
  const centralToBaseline = fontSize * (BASELINE_FRACTION - 0.5);
  // Underline geometry, in unrotated label-local px.
  const UNDERLINE_OFFSET = 4;
  const UNDERLINE_STROKE = 2;
  // Compute the y position of the FIRST line's baseline given the active
  // dominant-baseline mode. Subsequent lines stack 1.2em below.
  const firstLineBaselineY =
    baseline === 'central'
      ? anchorY + centralToBaseline + parseEm(firstLineDy, fontSize)
      : baseline === 'text-before-edge'
        ? anchorY + fontSize * BASELINE_FRACTION + parseEm(firstLineDy, fontSize)
        : anchorY - fontSize * (1 - BASELINE_FRACTION) + parseEm(firstLineDy, fontSize);
  const lineSpacingPx = fontSize * LINE_HEIGHT;
  if (!hasBullet) {
    return (
      <g transform={`rotate(${rotationDeg} ${anchorX} ${anchorY})`} pointerEvents="none">
        <text
          x={anchorX}
          y={anchorY}
          textAnchor={textAnchor}
          dominantBaseline={baseline}
          fontSize={fontSize}
          fontWeight={fontWeight}
          fontStyle={fontStyle}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          paintOrder={paintOrder}
          xmlSpace="preserve"
        >
          {lines.map((line, i) => (
            <tspan key={i} x={anchorX} dy={i === 0 ? firstLineDy : '1.2em'}>
              {line}
            </tspan>
          ))}
        </text>
        {showUnderline &&
          measured &&
          measured.lines.map((lm, i) => {
            if (lm.inkWidth <= 0) return null;
            const x1 = lineStartX(textAnchor, anchorX, lm.bearingLeft, lm.bearingRight);
            const x2 = x1 + lm.inkWidth;
            const y = firstLineBaselineY + i * lineSpacingPx + UNDERLINE_OFFSET;
            return (
              <line
                key={i}
                x1={x1}
                x2={x2}
                y1={y}
                y2={y}
                stroke={fill}
                strokeWidth={UNDERLINE_STROKE}
              />
            );
          })}
      </g>
    );
  }

  // Bullet path: measure segment-aware and emit explicit per-segment
  // elements. Each line is anchored at its visual center with
  // dominantBaseline='central' so it lines up with the non-bullet path
  // (also central-anchored). firstLineCenterY comes from the layout and
  // already encodes the valign semantics; line i sits lineSpacing below
  // the previous one.
  const m =
    measured ??
    measureTextLabel({
      text,
      fontSize,
      weight: fontWeight,
      italic: fontStyle === 'italic',
    });
  const lineSpacing = fontSize * LINE_HEIGHT;

  return (
    <g transform={`rotate(${rotationDeg} ${anchorX} ${anchorY})`} pointerEvents="none">
      {m.lines.map((lm, i) => {
        if (lm.segments.length === 0) return null;
        const yCenter = firstLineCenterY + i * lineSpacing;
        const baselineY = yCenter + centralToBaseline;
        const lineLeftX = lineStartX(textAnchor, anchorX, lm.bearingLeft, lm.bearingRight);
        let cursor = lineLeftX;
        const nodes: React.ReactNode[] = [];
        lm.segments.forEach((seg, j) => {
          const segCursor = cursor;
          cursor += seg.advance;
          if (seg.kind === 'text') {
            nodes.push(
              <text
                key={`${i}-${j}-t`}
                x={segCursor}
                y={yCenter}
                textAnchor="start"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight={fontWeight}
                fontStyle={fontStyle}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                paintOrder={paintOrder}
                xmlSpace="preserve"
              >
                {seg.value}
              </text>,
            );
          } else {
            const r = seg.diameter / 2;
            nodes.push(
              <InlineBullet
                key={`${i}-${j}-b`}
                code={seg.code}
                diameter={seg.diameter}
                cx={segCursor + r}
                // Bullet center at the text's optical midpoint (≈0.3em above
                // baseline) so the badge looks visually centered on mixed
                // upper/lowercase. Older convention sat the bullet's bottom on
                // the baseline, which left it riding above the cap-line.
                cy={baselineY - fontSize * 0.3}
                lineByService={lineByService}
              />,
            );
          }
        });
        // Explicit underline for this line (only when hover requests it).
        // Spans the full line including any inline bullets so the visual
        // result matches the plain-text path.
        if (showUnderline && lm.inkWidth > 0) {
          nodes.push(
            <line
              key={`${i}-u`}
              x1={lineLeftX}
              x2={lineLeftX + lm.inkWidth}
              y1={baselineY + UNDERLINE_OFFSET}
              y2={baselineY + UNDERLINE_OFFSET}
              stroke={fill}
              strokeWidth={UNDERLINE_STROKE}
            />,
          );
        }
        return <g key={i}>{nodes}</g>;
      })}
    </g>
  );
}

// Where the line's leftmost ink lives, in unrotated label-local coords. The
// underline geometry pivots off this same point so the painted underline
// hugs the visible text on both ends regardless of text-anchor.
function lineStartX(
  textAnchor: 'start' | 'middle' | 'end',
  anchorX: number,
  bearingLeft: number,
  bearingRight: number,
): number {
  if (textAnchor === 'start') return anchorX + bearingLeft;
  if (textAnchor === 'end') return anchorX - bearingRight;
  return anchorX + (bearingLeft - bearingRight) / 2;
}

// SVG `dy="0.5em"` style strings, converted to absolute pixels at the given
// font size. Empty / "0" returns 0. Used to align the explicit underline
// geometry with the same first-line shift the renderer applies to <tspan>.
function parseEm(value: string, fontSize: number): number {
  if (!value || value === '0') return 0;
  const m = /^(-?\d*\.?\d+)em$/.exec(value);
  if (!m) return 0;
  return parseFloat(m[1]) * fontSize;
}

interface Props {
  station: Station;
  lines: Record<string, Line>;
  zoom: number;
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void;
  layer:
    | 'wash'
    | 'bg'
    | 'label'
    | 'highlight-label'
    | 'starter-label'
    | 'dots'
    | 'highlight-dots'
    | 'stroke'
    | 'match-stroke';
  // Override fill for the highlight-* layers (default white).
  highlightColor?: string;
}

export function StationView({
  station,
  lines,
  onStartDrag,
  layer,
  highlightColor = '#fff',
}: Props) {
  const selection = useSelection();
  const darkMode = useViewportStore((s) => s.darkMode);
  const rotateStation = useDoc((s) => s.rotateStation);
  const rotateStationsAround = useDoc((s) => s.rotateStationsAround);
  const rotateItemsAround = useDoc((s) => s.rotateItemsAround);
  const renameStation = useDoc((s) => s.renameStation);
  const toggleStationOnLine = useDoc((s) => s.toggleStationOnLine);
  const redistributeBetween = useDoc((s) => s.redistributeBetween);
  const addTransfer = useDoc((s) => s.addTransfer);
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const labelWeight = useDoc((s) => s.labelWeight);
  const labelItalic = useDoc((s) => s.labelItalic);
  // Resolve the rendered weight: doc default → +2 indices if the station's
  // own bold flag is on → +2 more indices when the station is hovered. Each
  // bump saturates at Black (900). This way a Regular default still escalates
  // smoothly through Bold → Black as the user hovers a bolded station.
  const stationWeight = resolveStationLabelWeight(labelWeight, station.labelBold);
  // Per-station italic ORs with the doc-wide default: the label renders
  // italic when either the global toggle or this station's own flag is set.
  const stationItalic = labelItalic || !!station.labelItalic;
  const isHovered = selection.hoveredStationId === station.id;
  const renderedWeight = isHovered ? bumpWeightByIndex(stationWeight, 2) : stationWeight;
  // Service-code lookup for inline bullets. Only walked when a label's text
  // contains a <CODE> token; building once per render keeps the bullet
  // resolution path cheap.
  const lineByService = useMemo(() => {
    const map = new Map<string, Line>();
    for (const ln of Object.values(lines)) map.set(ln.service, ln);
    return map;
  }, [lines]);

  const stops = station.stops;
  const angle = station.rotation * 45;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // In hand mode, let the event bubble to the SVG so it becomes a pan.
    if (selection.toolMode === 'hand' || selection.spaceHeld) return;
    // Ctrl/Cmd+drag on a different station while exactly one is selected:
    // drag the target while continuously redistributing intervening stops
    // between the two. A pure click (no drag) still routes to onClick →
    // one-shot redistribute via the click handler. When multi-selected,
    // ctrl-drag yields to group-drag (no anchor captured).
    const ids = selection.selectedStationIds;
    const soloAnchor = ids.length === 1 ? ids[0] : null;
    const anchor =
      (e.ctrlKey || e.metaKey) && soloAnchor && soloAnchor !== station.id ? soloAnchor : undefined;
    onStartDrag(station.id, e, anchor);
  };

  const onClick = (e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    e.stopPropagation();
    // Transfer-creation flow: first click sets the anchor, second commits.
    // Capture which specific dot was closest to the click so the transfer
    // pins to that stop instead of an arbitrary station-anchor location.
    if (selection.uiMode.kind === 'creating-transfer') {
      const lineId = closestStopLineId(station, e);
      const anchor = selection.uiMode.anchor;
      if (!anchor) {
        selection.setTransferAnchor({ stationId: station.id, lineId });
        // Clear the first-pick hover highlight — the dot is now committed
        // as the anchor, no longer just hovered.
        selection.setHoveredLineStop(null);
      } else {
        // Same station + same dot is a no-op self-transfer; same station
        // + a DIFFERENT dot (interlined station) is allowed.
        const sameStation = anchor.stationId === station.id;
        const sameLine = anchor.lineId === lineId;
        if (!(sameStation && sameLine)) {
          addTransfer(anchor, { stationId: station.id, lineId });
          selection.setUiMode({ kind: 'idle' });
          selection.setHoveredLineStop(null);
        }
      }
      return;
    }
    // Ctrl/Cmd-click on a different station while exactly one is selected:
    // redistribute intervening stops on each line that connects them.
    // Multi-selection disables redistribute — group operations win.
    const selIds = selection.selectedStationIds;
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      selIds.length === 1 &&
      selIds[0] !== station.id
    ) {
      redistributeBetween(selIds[0], station.id);
      return;
    }
    if (selection.uiMode.kind === 'creating-line-tag') {
      // "Click anywhere that isn't a valid place for line tags" exits the mode.
      selection.setUiMode({ kind: 'idle' });
      return;
    }
    if (selection.uiMode.kind === 'appending-to-line') {
      const { lineId, insertAfterIndex } = selection.uiMode;
      const ln = lines[lineId];
      const wasInLine = ln?.stations.includes(station.id) ?? false;
      // No cursor: refuse to add a new stop. Removing an existing stop is
      // still allowed since it doesn't depend on an insertion point.
      if (!wasInLine && insertAfterIndex === null) return;
      const effectiveCursor = insertAfterIndex ?? -1;
      toggleStationOnLine(lineId, station.id, effectiveCursor);
      if (!wasInLine) {
        selection.setInsertAfterIndex(effectiveCursor + 1);
      }
      return;
    }
    // Ctrl/Cmd+Shift+click on a different station extends the selection
    // along the shortest shared line from the anchor to this station,
    // toggling every station in the half-open interval (anchor, this].
    // No-op if there's no anchor (no current selection) or no shared line.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      const anchor = selIds.length > 0 ? selIds[selIds.length - 1] : null;
      if (anchor && anchor !== station.id) {
        const path = pathBetweenStations({ lines }, anchor, station.id);
        if (path) selection.xorStationsToSelection(path);
      }
      return;
    }
    // Shift-click toggles membership in the multi-selection. Plain click
    // (no modifier) replaces the selection with this station.
    if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      selection.toggleStationSelection(station.id);
      return;
    }
    selection.selectStation(station.id);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Right-click on a station that's part of a multi-selection rotates
    // the whole group rigidly around this station: each member rotates
    // in place AND non-pivot members orbit 45° around the pivot. Bullets
    // and labels in the selection orbit too via `rotateItemsAround`.
    const ids = selection.selectedStationIds;
    const bulletIds = selection.selectedRouteBulletIds;
    const labelIds = selection.selectedLabelIds;
    const totalSelected = ids.length + bulletIds.length + labelIds.length;
    if (totalSelected > 1 && ids.includes(station.id)) {
      if (bulletIds.length === 0 && labelIds.length === 0) {
        rotateStationsAround(station.id, ids);
      } else {
        const members: { type: 'station' | 'bullet' | 'label'; id: string }[] = [
          ...ids.map((id) => ({ type: 'station' as const, id })),
          ...bulletIds.map((id) => ({ type: 'bullet' as const, id })),
          ...labelIds.map((id) => ({ type: 'label' as const, id })),
        ];
        rotateItemsAround({ type: 'station', id: station.id }, members);
      }
      return;
    }
    rotateStation(station.id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selection.selectStation(station.id);
    selection.setEditingStationId(station.id);
  };

  const half = STOP_SIZE / 2;
  const isWp = !!station.isWaypoint;
  // Empty stations get a single phantom dot one cell to the right of the
  // label, so there's something visible and the name has an anchor.
  // Waypoints never show a phantom (the whole point is "no visible station").
  const label = station.label;
  const phantomDot = !isWp && stops.length === 0 ? { row: label.row, col: label.col + 1 } : null;

  // For a waypoint, the cells AABB hugs only the bullet positions — the
  // label cell is excluded so the hit rect and selection wash don't extend
  // into invisible space. Regular stations include the label cell so the
  // selection silhouette covers the painted name.
  const allCells: { row: number; col: number }[] = isWp ? [...stops] : [...stops, label];
  if (phantomDot) allCells.push(phantomDot);
  // Empty waypoint (0 stops, isWp) is a degenerate edge case — fall back to
  // the label cell so we still produce a finite AABB. Not the supported case;
  // just keeps Math.min/max from returning Infinity.
  if (allCells.length === 0) allCells.push(label);
  const minRow = Math.min(...allCells.map((c) => c.row));
  const maxRow = Math.max(...allCells.map((c) => c.row));
  const minCol = Math.min(...allCells.map((c) => c.col));
  const maxCol = Math.max(...allCells.map((c) => c.col));

  // Label layout — anchor, text-anchor, dominant baseline, and the hit rect
  // around the painted text. Shared with stationBoundary so the wash
  // silhouette and the hit-test rect always agree with the visible text.
  const {
    anchorX: labelAnchorX,
    anchorY: labelAnchorY,
    textAnchor: labelTextAnchor,
    baseline: labelBaseline,
    firstLineDy: labelFirstLineDy,
    firstLineCenterY: labelFirstLineCenterY,
    hitX: labelHitX,
    hitY: labelHitY,
    hitW: labelHitW,
    hitH: labelHitH,
  } = labelLayoutLocal(station);
  const nameLines = station.name.split('\n');

  // Cells AABB hit rect.
  const HIT_PAD = 2;
  const cellsHitX = stopCenterAt(0, minCol).x - half - HIT_PAD;
  const cellsHitY = stopCenterAt(minRow, 0).y - half - HIT_PAD;
  const cellsHitW = stopCenterAt(0, maxCol).x + half + HIT_PAD - cellsHitX;
  const cellsHitH = stopCenterAt(maxRow, 0).y + half + HIT_PAD - cellsHitY;
  const labelHitTransform = `rotate(${label.rotation * 45} ${labelAnchorX} ${labelAnchorY})`;

  // Inline rename editor anchors to the label cell (not the text anchor),
  // so the textarea always opens centered on the L cell regardless of
  // alignment.
  const labelCenter = stopCenterAt(label.row, label.col);
  const longestLineLen = nameLines.reduce((m, l) => Math.max(m, l.length), 0);
  const textW = Math.max(20, longestLineLen * 7);

  const isEditing = selection.editingStationId === station.id;

  if (layer === 'wash' || layer === 'stroke' || layer === 'match-stroke') {
    // MapCanvas decides which stations get wash/stroke/match-stroke layers
    // (selected set, plus the rect-select preview, plus mirror-matching
    // stations). StationView trusts that filtering — no redundant gate.
    // Smooth the union of the cells rect + (rotated) label rect with
    // quadratic Beziers. Smoothing applies to the outer-boundary corners
    // ONLY (each vertex of the union is a corner of the actual silhouette),
    // so there are no rounded-corner artifacts where the rects meet.
    const { cells, label: labelPoly } = stationBoundaryRectsLocal(station);
    // Waypoint: no label polygon to merge, render the cells rect alone.
    const polygons = labelPoly ? unionConvex(cells, labelPoly) : [cells];
    const pathStr = polygonsToPath(polygons, SELECTION_CORNER_RADIUS);

    if (layer === 'wash') {
      return (
        <g
          data-station-wash={station.id}
          transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
          pointerEvents="none"
        >
          <path
            d={pathStr}
            fill={SELECTION_WASH_COLOR}
            fillOpacity={SELECTION_WASH_OPACITY}
            fillRule="nonzero"
          />
        </g>
      );
    }
    if (layer === 'match-stroke') {
      return (
        <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`} pointerEvents="none">
          <path
            d={pathStr}
            fill="none"
            stroke={MATCH_STROKE_COLOR}
            strokeWidth={MATCH_STROKE_WIDTH}
            strokeLinejoin="round"
          />
        </g>
      );
    }
    return (
      <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`} pointerEvents="none">
        <path
          d={pathStr}
          fill="none"
          stroke={SELECTION_STROKE_COLOR}
          strokeWidth={SELECTION_STROKE_WIDTH}
          strokeLinejoin="round"
        />
      </g>
    );
  }

  // Shared interaction state for both the bg hit-rect AND the dots layer.
  // The dots wrapper reuses these so a click on a station dot is routed to
  // the same station onClick logic the bg would have run — keeping dot
  // pixels as a "click target for the station" even though the dots layer
  // paints above transfers in z-order.
  //
  // In add-line-tag mode, station hit rects (which extend past the visible
  // footprint) would block hover/click on bands passing nearby. We pass
  // through so the cursor goes straight to the band stripes.
  //
  // While placing a transfer (either pick), surface a 3px white stroke on
  // whichever dot the cursor is closest to. Active for BOTH the first and
  // second picks; the second-pick code path also guards against highlighting
  // the same dot as the already-committed anchor (a no-op self-transfer
  // that the click handler would reject).
  const inTagMode = selection.uiMode.kind === 'creating-line-tag';
  const inLayerMode = selection.uiMode.kind === 'layering';
  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;
  const inTransferPick = selection.uiMode.kind === 'creating-transfer';
  // Layering mode disables all station interaction the same way tag mode does
  // — clicks/drags pass straight through hit areas to the underlying band
  // stripes so any pixel of a line segment is reachable, even where it sits
  // beneath a station's hitbox.
  const inHitlessMode = inTagMode || inLayerMode;
  const onTransferPointerMove = (e: React.PointerEvent) => {
    const lineId = closestStopLineId(station, e);
    if (!lineId) return;
    const anchor = selection.uiMode.kind === 'creating-transfer' ? selection.uiMode.anchor : null;
    if (anchor && anchor.stationId === station.id && anchor.lineId === lineId) {
      const cur = selection.hoveredLineStop;
      if (cur && cur.stationId === station.id) selection.setHoveredLineStop(null);
      return;
    }
    const cur = selection.hoveredLineStop;
    if (cur && cur.stationId === station.id && cur.lineId === lineId) return;
    selection.setHoveredLineStop({ stationId: station.id, lineId });
  };
  const onTransferPointerLeave = () => {
    const cur = selection.hoveredLineStop;
    if (cur && cur.stationId === station.id) selection.setHoveredLineStop(null);
  };
  const stationInteractionHandlers = {
    onPointerDown: inHitlessMode ? undefined : onPointerDown,
    onClick: inHitlessMode || inHandMode ? undefined : onClick,
    onDoubleClick: inHitlessMode || inHandMode ? undefined : onDoubleClick,
    onContextMenu: inHitlessMode ? undefined : onContextMenu,
    onPointerMove: inTransferPick ? onTransferPointerMove : undefined,
    onPointerLeave: inTransferPick ? onTransferPointerLeave : undefined,
  };
  const stationCursor = inHandMode ? 'grab' : 'move';

  if (layer === 'bg') {
    const hitProps = {
      ...stationInteractionHandlers,
      fill: 'transparent',
      pointerEvents: inHitlessMode ? ('none' as const) : ('all' as const),
    };
    return (
      <g
        data-station-id={station.id}
        transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
        style={{ cursor: stationCursor }}
      >
        <rect x={cellsHitX} y={cellsHitY} width={cellsHitW} height={cellsHitH} {...hitProps} />
        {!isWp && (
          <rect
            x={labelHitX}
            y={labelHitY}
            width={labelHitW}
            height={labelHitH}
            transform={labelHitTransform}
            {...hitProps}
          />
        )}
      </g>
    );
  }

  if (layer === 'starter-label') {
    if (isWp) return null;
    // Append-mode "starter" station: name in the line color, with a
    // contrasting 1px stroke for legibility against the dim layer. Always
    // bold so the eye lands on it as the insertion anchor.
    const strokeColor = legibleTextOn(highlightColor);
    return (
      <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
        {renderStationLabelText({
          text: station.name,
          fontSize: 12,
          fontWeight: 700,
          fill: highlightColor,
          stroke: strokeColor,
          strokeWidth: 2,
          paintOrder: 'stroke',
          textDecoration: selection.hoveredStationId === station.id ? 'underline' : 'none',
          anchorX: labelAnchorX,
          anchorY: labelAnchorY,
          textAnchor: labelTextAnchor,
          baseline: labelBaseline,
          firstLineDy: labelFirstLineDy,
          firstLineCenterY: labelFirstLineCenterY,
          rotationDeg: label.rotation * 45,
          lineByService,
        })}
      </g>
    );
  }

  if (layer === 'highlight-label') {
    if (isWp) return null;
    // Same positioning as 'label' but always renders text (never the
    // inline editor), in white. Used above the dim overlay so the selected
    // line's station names stay legible.
    return (
      <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
        {renderStationLabelText({
          text: station.name,
          fontSize: labelFontSize,
          fontWeight: renderedWeight,
          fontStyle: stationItalic ? 'italic' : undefined,
          textDecoration: selection.hoveredStationId === station.id ? 'underline' : 'none',
          fill: highlightColor,
          anchorX: labelAnchorX,
          anchorY: labelAnchorY,
          textAnchor: labelTextAnchor,
          baseline: labelBaseline,
          firstLineDy: labelFirstLineDy,
          firstLineCenterY: labelFirstLineCenterY,
          rotationDeg: label.rotation * 45,
          lineByService,
        })}
      </g>
    );
  }

  if (layer === 'label') {
    if (isWp) return null;
    // Labels render in their own pass after all bg washes so that a selected
    // station's wash can never cover a neighboring station's label. When a
    // line is selected, the highlight pass re-renders labels above the dim
    // layer; skip them here so antialiased edges of the (dimmed) black
    // underdraw don't bleed through the colored / white re-render.
    const highlightLineId = selection.selectedLineId;
    if (highlightLineId) {
      const isAppending =
        selection.uiMode.kind === 'appending-to-line' &&
        selection.uiMode.lineId === highlightLineId;
      if (isAppending) {
        // Append mode re-renders every station's label above the dim.
        return null;
      }
      const ln = lines[highlightLineId];
      if (ln && ln.stations.includes(station.id)) {
        return null;
      }
    }
    return (
      <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
        {isEditing ? (
          <NameEditor
            x={labelCenter.x - (textW + 8) / 2}
            y={labelCenter.y - 10}
            width={textW + 8}
            value={station.name}
            onChange={(v) => renameStation(station.id, v)}
            onCommit={() => selection.setEditingStationId(null)}
          />
        ) : (
          renderStationLabelText({
            text: station.name,
            fontSize: labelFontSize,
            fontWeight: renderedWeight,
            fontStyle: stationItalic ? 'italic' : undefined,
            textDecoration: selection.hoveredStationId === station.id ? 'underline' : 'none',
            fill: darkMode ? '#fff' : '#111',
            anchorX: labelAnchorX,
            anchorY: labelAnchorY,
            textAnchor: labelTextAnchor,
            baseline: labelBaseline,
            firstLineDy: labelFirstLineDy,
            firstLineCenterY: labelFirstLineCenterY,
            rotationDeg: label.rotation * 45,
            lineByService,
          })
        )}
      </g>
    );
  }

  if (layer === 'highlight-dots') {
    if (isWp) return null;
    // Dots above the dim/highlight passes, used for not-yet-on-line stations
    // during append mode. Color overridable via highlightColor.
    return (
      <g pointerEvents="none">
        {/* Phantom dot is a drag preview — render at cell position, in the
            station's local frame. */}
        {phantomDot && (
          <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
            {(() => {
              const c = stopCenterAt(phantomDot.row, phantomDot.col);
              return <circle cx={c.x} cy={c.y} r={STOP_DOT_RADIUS} fill={highlightColor} />;
            })()}
          </g>
        )}
        {stops.map((cell) => {
          const w = stopPosWorld(cell, station);
          return (
            <circle key={cell.lineId} cx={w.x} cy={w.y} r={STOP_DOT_RADIUS} fill={highlightColor} />
          );
        })}
      </g>
    );
  }

  // layer === 'dots'
  if (isWp) return null;
  const hoveredStop = selection.hoveredLineStop;
  return (
    // The dots layer paints above transfers in z-order so transfers never
    // obscure the dots they connect. To preserve dot-click-priority over
    // transfers, the wrapper itself is hit-testable: each visible dot
    // absorbs clicks per-pixel (default `visiblePainted`) and the click
    // bubbles to the wrapper, which forwards to the same station-onClick
    // logic the bg layer uses. `pointer-events: none` in tag-mode keeps
    // band-stripe hover working when the cursor passes over a dot.
    <g
      pointerEvents={inHitlessMode ? 'none' : undefined}
      style={{ cursor: stationCursor }}
      {...stationInteractionHandlers}
    >
      {/* Phantom dot is a drag preview — render at cell position, in the
          station's local frame. */}
      {phantomDot && (
        <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
          {(() => {
            const c = stopCenterAt(phantomDot.row, phantomDot.col);
            return <circle cx={c.x} cy={c.y} r={STOP_DOT_RADIUS} fill="#000" />;
          })()}
        </g>
      )}
      {stops.map((cell) => {
        const w = stopPosWorld(cell, station);
        const isHovered =
          hoveredStop?.stationId === station.id && hoveredStop?.lineId === cell.lineId;
        return (
          <StopGlyph
            key={cell.lineId}
            cx={w.x}
            cy={w.y}
            shape={resolveDotShape(lines[cell.lineId], cell)}
            isHovered={isHovered}
            stationId={station.id}
            lineId={cell.lineId}
          />
        );
      })}
    </g>
  );
}

function NameEditor({
  x,
  y,
  width,
  value,
  onChange,
  onCommit,
}: {
  x: number;
  y: number;
  width: number;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const darkMode = useViewportStore((s) => s.darkMode);
  const [editorHeight, setEditorHeight] = useState(20);
  // Open a history group on mount. Doing this in useEffect (rather than via
  // an onFocus handler) sidesteps any uncertainty about whether the synthetic
  // focus event fires for an input inside a foreignObject when el.focus() is
  // called programmatically. Group is committed on blur, Enter, or unmount.
  const groupRef = useRef<ReturnType<typeof beginHistoryGroup> | null>(null);
  useEffect(() => {
    groupRef.current = beginHistoryGroup();
    const el = ref.current;
    el?.focus();
    el?.select();
    return () => {
      groupRef.current?.commit();
      groupRef.current = null;
    };
  }, []);

  // Reset to 'auto' before reading scrollHeight so the textarea can shrink
  // when lines are removed, then snap to content height (with a sane floor).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.max(20, el.scrollHeight);
    el.style.height = h + 'px';
    setEditorHeight((prev) => (prev === h ? prev : h));
  }, [value]);

  const closeEditor = () => {
    groupRef.current?.commit();
    groupRef.current = null;
    onCommit();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter commits (preserves single-line muscle memory). Shift+Enter
    // inserts a newline so labels can be multiline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      closeEditor();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
      e.stopPropagation();
      return;
    }
    // Intercept Cmd/Ctrl+Z and friends. The browser's native input undo
    // would only revert one keystroke at a time AND fire onChange, creeping
    // the doc back one char per Ctrl-Z. Commit the rename group, run our
    // doc-level undo/redo, then close — one Ctrl-Z reverts the whole rename.
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      closeEditor();
      const temporal = useDoc.temporal.getState();
      if (e.shiftKey) temporal.redo();
      else temporal.undo();
      e.stopPropagation();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      closeEditor();
      useDoc.temporal.getState().redo();
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
  };

  return (
    <foreignObject x={x} y={y} width={width} height={editorHeight} style={{ overflow: 'visible' }}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={closeEditor}
        onKeyDown={onKey}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          fontSize: 11,
          fontWeight: 600,
          padding: '1px 3px',
          border: '1px solid #1a4ea8',
          borderRadius: 2,
          background: darkMode ? '#000' : '#fff',
          color: darkMode ? '#fff' : '#111',
          textAlign: 'right',
          fontFamily: 'inherit',
          lineHeight: '1.2',
          boxSizing: 'border-box',
          resize: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre',
        }}
      />
    </foreignObject>
  );
}
