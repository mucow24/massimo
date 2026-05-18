import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Line, LineId, Station } from '../model/types';
import { beginHistoryGroup, dragState, useDoc, useSelection } from '../state/store';
import { STOP_DOT_RADIUS, STOP_SIZE, stopCenterAt } from '../geometry/orientation';
import { polygonsToPath, unionConvex } from '../geometry/polygonUnion';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { stationBoundaryRectsLocal } from '../geometry/stationBoundary';
import { pathBetweenStations } from '../model/pathSelect';
import { legibleTextOn } from '../util/color';
import { StopGlyph } from './StopGlyph';
import type { RenderedStopPositions } from '../geometry/stopPositions';
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
  textDecoration?: 'underline';
  anchorX: number;
  anchorY: number;
  textAnchor: 'start' | 'middle' | 'end';
  baseline: 'central' | 'text-before-edge' | 'text-after-edge';
  firstLineDy: string;
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
  rotationDeg,
  lineByService,
}: RenderLabelTextArgs): React.ReactNode {
  const hasBullet = BULLET_TOKEN_RE.test(text);
  const lines = text.split('\n');
  if (!hasBullet) {
    return (
      <text
        x={anchorX}
        y={anchorY}
        textAnchor={textAnchor}
        dominantBaseline={baseline}
        fontSize={fontSize}
        fontWeight={fontWeight}
        fontStyle={fontStyle}
        textDecoration={textDecoration}
        pointerEvents="none"
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        paintOrder={paintOrder}
        xmlSpace="preserve"
        transform={`rotate(${rotationDeg} ${anchorX} ${anchorY})`}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={anchorX} dy={i === 0 ? firstLineDy : '1.2em'}>
            {line}
          </tspan>
        ))}
      </text>
    );
  }

  // Bullet path: measure segment-aware and emit explicit per-segment
  // elements. measureTextLabel accepts StyledText, so station labels can
  // pass their style props directly without fabricating a TextLabel.
  const m = measureTextLabel({
    text,
    fontSize,
    weight: fontWeight,
    italic: fontStyle === 'italic',
  });
  const lineSpacing = fontSize * LINE_HEIGHT;
  const blockHeight = m.lineCount * lineSpacing;
  let blockTopY: number;
  if (baseline === 'text-before-edge') blockTopY = anchorY;
  else if (baseline === 'text-after-edge') blockTopY = anchorY - blockHeight;
  else blockTopY = anchorY - blockHeight / 2;

  const lineStartX = (bL: number, bR: number): number => {
    if (textAnchor === 'start') return anchorX + bL;
    if (textAnchor === 'end') return anchorX - bR;
    return anchorX + (bL - bR) / 2;
  };

  return (
    <g transform={`rotate(${rotationDeg} ${anchorX} ${anchorY})`} pointerEvents="none">
      {m.lines.map((lm, i) => {
        if (lm.segments.length === 0) return null;
        const yTop = blockTopY + i * lineSpacing;
        const baselineY = yTop + fontSize * BASELINE_FRACTION;
        let cursor = lineStartX(lm.bearingLeft, lm.bearingRight);
        const nodes: React.ReactNode[] = [];
        lm.segments.forEach((seg, j) => {
          const segCursor = cursor;
          cursor += seg.advance;
          if (seg.kind === 'text') {
            nodes.push(
              <text
                key={`${i}-${j}-t`}
                x={segCursor}
                y={yTop}
                textAnchor="start"
                dominantBaseline="hanging"
                fontSize={fontSize}
                fontWeight={fontWeight}
                fontStyle={fontStyle}
                textDecoration={textDecoration}
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
                cy={baselineY - r}
                lineByService={lineByService}
              />,
            );
          }
        });
        return <g key={i}>{nodes}</g>;
      })}
    </g>
  );
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
  // World-frame stop positions (compression-aware). Used for the 'dots' and
  // 'highlight-dots' layers so the colored dot lands on the band stripe for
  // stops in a diagonal interline group. Phantom dots (drag previews) stay
  // at cell positions — they reflect the logical layout the editor is about
  // to commit, not the visual band.
  renderedPos?: RenderedStopPositions;
}

export function StationView({
  station,
  lines,
  onStartDrag,
  layer,
  highlightColor = '#fff',
  renderedPos,
}: Props) {
  const selection = useSelection();
  const rotateStation = useDoc((s) => s.rotateStation);
  const rotateStationsAround = useDoc((s) => s.rotateStationsAround);
  const rotateItemsAround = useDoc((s) => s.rotateItemsAround);
  const renameStation = useDoc((s) => s.renameStation);
  const toggleStationOnLine = useDoc((s) => s.toggleStationOnLine);
  const redistributeBetween = useDoc((s) => s.redistributeBetween);
  const addTransfer = useDoc((s) => s.addTransfer);
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const labelBold = useDoc((s) => s.labelBold);
  const labelItalic = useDoc((s) => s.labelItalic);
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
    if (selection.creatingTransfer) {
      const lineId = closestStopLineId(station, e);
      if (!selection.transferAnchor) {
        selection.setTransferAnchor({ stationId: station.id, lineId });
        // Clear the first-pick hover highlight — the dot is now committed
        // as the anchor, no longer just hovered.
        selection.setHoveredLineStop(null);
      } else {
        // Same station + same dot is a no-op self-transfer; same station
        // + a DIFFERENT dot (interlined station) is allowed.
        const sameStation = selection.transferAnchor.stationId === station.id;
        const sameLine = selection.transferAnchor.lineId === lineId;
        if (!(sameStation && sameLine)) {
          addTransfer(selection.transferAnchor, { stationId: station.id, lineId });
          selection.setCreatingTransfer(false);
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
    if (selection.creatingLineTag) {
      // "Click anywhere that isn't a valid place for line tags" exits the mode.
      selection.setCreatingLineTag(false);
      return;
    }
    if (selection.appendingToLineId) {
      const ln = lines[selection.appendingToLineId];
      const wasInLine = ln?.stations.includes(station.id) ?? false;
      const cursor = selection.insertAfterIndex;
      // No cursor: refuse to add a new stop. Removing an existing stop is
      // still allowed since it doesn't depend on an insertion point.
      if (!wasInLine && cursor === null) return;
      const effectiveCursor = cursor ?? -1;
      toggleStationOnLine(selection.appendingToLineId, station.id, effectiveCursor);
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

  if (layer === 'bg') {
    // In add-line-tag mode, station hit rects (which extend past the visible
    // footprint) would block hover/click on bands passing nearby. Make them
    // pass-through so the cursor goes straight to the band stripes.
    const inTagMode = selection.creatingLineTag;
    const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;
    // While picking the FIRST endpoint of a transfer, surface a 3px white
    // stroke on whichever dot the cursor is closest to so the user knows
    // exactly which dot they'll attach the transfer to.
    const inTransferPickFirst = selection.creatingTransfer && !selection.transferAnchor;
    const onTransferPointerMove = (e: React.PointerEvent) => {
      const lineId = closestStopLineId(station, e);
      if (!lineId) return;
      const cur = selection.hoveredLineStop;
      if (cur && cur.stationId === station.id && cur.lineId === lineId) return;
      selection.setHoveredLineStop({ stationId: station.id, lineId });
    };
    const onTransferPointerLeave = () => {
      const cur = selection.hoveredLineStop;
      if (cur && cur.stationId === station.id) selection.setHoveredLineStop(null);
    };
    const hitProps = {
      fill: 'transparent',
      pointerEvents: inTagMode ? ('none' as const) : ('all' as const),
      onPointerDown: inTagMode ? undefined : onPointerDown,
      onClick: inTagMode || inHandMode ? undefined : onClick,
      onDoubleClick: inTagMode || inHandMode ? undefined : onDoubleClick,
      onContextMenu: inTagMode ? undefined : onContextMenu,
      onPointerMove: inTransferPickFirst ? onTransferPointerMove : undefined,
      onPointerLeave: inTransferPickFirst ? onTransferPointerLeave : undefined,
    };
    const cursor = inHandMode ? 'grab' : 'move';
    return (
      <g
        data-station-id={station.id}
        transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
        style={{ cursor }}
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
          textDecoration:
            selection.hoveredStationId === station.id ? 'underline' : undefined,
          anchorX: labelAnchorX,
          anchorY: labelAnchorY,
          textAnchor: labelTextAnchor,
          baseline: labelBaseline,
          firstLineDy: labelFirstLineDy,
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
          fontWeight: labelBold || selection.hoveredStationId === station.id ? 700 : 400,
          fontStyle: labelItalic ? 'italic' : undefined,
          textDecoration:
            selection.hoveredStationId === station.id ? 'underline' : undefined,
          fill: highlightColor,
          anchorX: labelAnchorX,
          anchorY: labelAnchorY,
          textAnchor: labelTextAnchor,
          baseline: labelBaseline,
          firstLineDy: labelFirstLineDy,
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
      const isAppending = selection.appendingToLineId === highlightLineId;
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
            fontWeight: labelBold || selection.hoveredStationId === station.id ? 700 : 400,
            fontStyle: labelItalic ? 'italic' : undefined,
            textDecoration:
              selection.hoveredStationId === station.id ? 'underline' : undefined,
            fill: '#111',
            anchorX: labelAnchorX,
            anchorY: labelAnchorY,
            textAnchor: labelTextAnchor,
            baseline: labelBaseline,
            firstLineDy: labelFirstLineDy,
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
        {/* Real stop dots use rendered (compression-aware) world positions so
            they sit on band stripes within diagonal interline groups. */}
        {stops.map((cell) => {
          const w = renderedPos
            ? renderedPos(station.id, cell.lineId)
            : worldFromCell(station, cell.row, cell.col);
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
    <g pointerEvents="none">
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
      {/* Real stop dots use rendered (compression-aware) world positions so
          they sit on band stripes within diagonal interline groups. */}
      {stops.map((cell) => {
        const w = renderedPos
          ? renderedPos(station.id, cell.lineId)
          : worldFromCell(station, cell.row, cell.col);
        const isHovered =
          hoveredStop?.stationId === station.id && hoveredStop?.lineId === cell.lineId;
        return (
          <StopGlyph
            key={cell.lineId}
            cx={w.x}
            cy={w.y}
            shape={cell.dotShape}
            isHovered={isHovered}
            stationId={station.id}
            lineId={cell.lineId}
          />
        );
      })}
    </g>
  );
}

// Fallback cell-grid world position when no rendered-position lookup is
// threaded through. Equivalent to `stopPosWorld` in interlining.ts but
// inlined here to avoid a cross-module import.
function worldFromCell(station: Station, row: number, col: number) {
  const local = stopCenterAt(row, col);
  const a = (station.rotation * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: station.x + local.x * c - local.y * s,
    y: station.y + local.x * s + local.y * c,
  };
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
          background: '#fff',
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
