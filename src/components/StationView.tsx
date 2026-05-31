import { useMemo } from 'react';
import { Line, LineId, Station } from '../model/types';
import { dragState, useDoc, useSelection } from '../state/store';
import { STOP_DOT_RADIUS, stopCenterAt } from '../geometry/orientation';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { cellsAABBLocal } from '../geometry/stationBoundary';
import { pathBetweenStations } from '../model/pathSelect';
import {
  buildRotateMembers,
  bumpWeightByIndex,
  resolveDotShape,
  resolveStationLabelWeight,
} from '../model/transforms';
import { legibleTextOn } from '../util/color';
import { useThemeColors } from '../state/theme';
import { StopGlyph } from './StopGlyph';
import { StationNameEditor } from './StationNameEditor';
import { StationSilhouette } from './StationSilhouette';
import { stopPosWorld } from '../geometry/interlining';
import { renderStationLabelText } from './stationLabelText';

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
  let bestId = station.stops[0].lineId;
  let bestDist = Infinity;
  for (const cell of station.stops) {
    const { x: sx, y: sy } = stopPosWorld(cell, station);
    const d = Math.hypot(wx - sx, wy - sy);
    if (d < bestDist) {
      bestDist = d;
      bestId = cell.lineId;
    }
  }
  return bestId;
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
  const themeColors = useThemeColors();
  const labelColor = themeColors.label;
  const rotateStation = useDoc((s) => s.rotateStation);
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
      const members = buildRotateMembers(ids, bulletIds, labelIds);
      rotateItemsAround({ type: 'station', id: station.id }, members);
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

  const isWp = !!station.isWaypoint;
  // Empty stations get a single phantom dot one cell to the right of the
  // label, so there's something visible and the name has an anchor.
  // Waypoints never show a phantom (the whole point is "no visible station").
  const label = station.label;
  const phantomDot = !isWp && stops.length === 0 ? { row: label.row, col: label.col + 1 } : null;

  // Label layout — anchor, text-anchor, dominant baseline, and the hit rect
  // around the painted text. Shared with stationBoundary so the wash
  // silhouette and the hit-test rect always agree with the visible text.
  const {
    anchorX: labelAnchorX,
    anchorY: labelAnchorY,
    textAnchor: labelTextAnchor,
    baseline: labelBaseline,
    firstLineDyPx: labelFirstLineDyPx,
    firstLineCenterY: labelFirstLineCenterY,
    hitX: labelHitX,
    hitY: labelHitY,
    hitW: labelHitW,
    hitH: labelHitH,
  } = labelLayoutLocal(station, {
    fontSize: labelFontSize,
    weight: stationWeight,
    italic: labelItalic,
  });

  // Cells AABB hit rect — shared with the selection silhouette via
  // stationBoundary so the two can't drift.
  const cellsBox = cellsAABBLocal(station);
  const labelHitTransform = `rotate(${label.rotation * 45} ${labelAnchorX} ${labelAnchorY})`;

  // The inline rename editor overlays the painted label 1:1: it reuses the
  // label hit rect for its box and the same rotation transform, so it tracks
  // the label's anchor, measured size, and rotation instead of floating over
  // the L cell. textAnchor maps to CSS text-align so the glyphs land on the
  // same side of the anchor the label paints them.
  const editorTextAlign: 'left' | 'center' | 'right' =
    labelTextAnchor === 'start' ? 'left' : labelTextAnchor === 'end' ? 'right' : 'center';

  const isEditing = selection.editingStationId === station.id;

  // When editing, the textarea shows the raw "<CODE>" tokens, which are wider
  // than the bullets they render as. Re-measure the box against that literal
  // text so a bullet-heavy name doesn't overflow its collapsed hit rect. Only
  // the width grows — anchor, rotation, and height match the painted label, so
  // the box still tracks where the label sits. Gated on isEditing so the
  // second layout pass only runs for the one station being renamed.
  const editorHit = isEditing
    ? labelLayoutLocal(station, {
        fontSize: labelFontSize,
        weight: stationWeight,
        italic: labelItalic,
        literalBullets: true,
      })
    : null;

  if (layer === 'wash' || layer === 'stroke' || layer === 'match-stroke') {
    return <StationSilhouette station={station} layer={layer} />;
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
        <rect x={cellsBox.x} y={cellsBox.y} width={cellsBox.w} height={cellsBox.h} {...hitProps} />
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
          firstLineDyPx: labelFirstLineDyPx,
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
          firstLineDyPx: labelFirstLineDyPx,
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
          <StationNameEditor
            x={editorHit ? editorHit.hitX : labelHitX}
            y={editorHit ? editorHit.hitY : labelHitY}
            width={editorHit ? editorHit.hitW : labelHitW}
            minHeight={editorHit ? editorHit.hitH : labelHitH}
            transform={labelHitTransform}
            fontSize={labelFontSize}
            fontWeight={stationWeight}
            italic={stationItalic}
            textAlign={editorTextAlign}
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
            fill: labelColor,
            anchorX: labelAnchorX,
            anchorY: labelAnchorY,
            textAnchor: labelTextAnchor,
            baseline: labelBaseline,
            firstLineDyPx: labelFirstLineDyPx,
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
