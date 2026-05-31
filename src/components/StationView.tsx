import { useMemo } from 'react';
import { Line, Station } from '../model/types';
import { useDoc, useSelection } from '../state/store';
import { STOP_DOT_RADIUS, stopCenterAt } from '../geometry/orientation';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { bumpWeightByIndex, resolveDotShape, resolveStationLabelWeight } from '../model/transforms';
import { legibleTextOn } from '../util/color';
import { useThemeColors } from '../state/theme';
import { StopGlyph } from './StopGlyph';
import { StationNameEditor } from './StationNameEditor';
import { StationSilhouette } from './StationSilhouette';
import { StationHitArea } from './StationHitArea';
import { stopPosWorld } from '../geometry/interlining';
import { renderStationLabelText } from './stationLabelText';
import { useStationInteraction } from './useStationInteraction';

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
  const renameStation = useDoc((s) => s.renameStation);
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

  const {
    handlers: stationInteractionHandlers,
    cursor: stationCursor,
    inHitlessMode,
  } = useStationInteraction(station, onStartDrag, lines);

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

  if (layer === 'bg') {
    return <StationHitArea station={station} lines={lines} onStartDrag={onStartDrag} />;
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
