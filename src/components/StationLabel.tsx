import { useMemo } from 'react';
import { Line, Station } from '../model/types';
import { useDoc, useSelection } from '../state/store';
import { useThemeColors } from '../state/theme';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { stopHalfOf } from '../model/lineWidth';
import { bumpWeightByIndex, resolveStationLabelWeight } from '../model/transforms';
import { legibleTextOn } from '../util/color';
import { renderStationLabelText } from './stationLabelText';
import { StationNameEditor } from './StationNameEditor';

/**
 * The common text-positioning bundle shared by all three station-label passes
 * (starter / highlight / normal). Mirrors the derivation StationView used to
 * do inline so the rendered <text>/<tspan> geometry is byte-for-byte the same:
 * the label layout (anchor, text-anchor, baseline, hit rect) is measured at
 * the doc-level weight/italic, while the painted text uses the per-station
 * rendered weight (with hover bump) and per-station italic.
 */
function useStationLabelLayout(station: Station, lines: Record<string, Line>) {
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const labelWeight = useDoc((s) => s.labelWeight);
  const labelItalic = useDoc((s) => s.labelItalic);
  const labelLeading = useDoc((s) => s.labelLeading);
  const labelTracking = useDoc((s) => s.labelTracking);
  const hovered = useSelection((s) => s.hoveredStationId === station.id);
  // Resolve the rendered weight: doc default → +2 indices if the station's
  // own bold flag is on → +2 more indices when the station is hovered. Each
  // bump saturates at Black (900).
  const stationWeight = resolveStationLabelWeight(labelWeight, station.labelBold);
  // Per-station italic ORs with the doc-wide default.
  const stationItalic = labelItalic || !!station.labelItalic;
  const renderedWeight = hovered ? bumpWeightByIndex(stationWeight, 2) : stationWeight;
  // Service-code lookup for inline bullets. Only walked when a label's text
  // contains a <CODE> token; building once per render keeps it cheap.
  const lineByService = useMemo(() => {
    const map = new Map<string, Line>();
    for (const ln of Object.values(lines)) map.set(ln.service, ln);
    return map;
  }, [lines]);
  // Label layout uses the doc-level italic (matching the hit rect /
  // silhouette) and the same per-stop width lookup, so the painted anchor
  // agrees with the boundary geometry next to wide stops.
  const lay = labelLayoutLocal(
    station,
    {
      fontSize: labelFontSize,
      weight: stationWeight,
      italic: labelItalic,
      leading: labelLeading,
      tracking: labelTracking,
    },
    undefined,
    stopHalfOf(lines),
  );
  return {
    angle: station.rotation * 45,
    rotationDeg: station.label.rotation * 45,
    hovered,
    labelFontSize,
    labelItalic,
    labelLeading,
    labelTracking,
    stationWeight,
    renderedWeight,
    stationItalic,
    lineByService,
    lay,
  };
}

/**
 * Append-mode "starter" station label: the name in the line color with a
 * contrasting 1px stroke for legibility against the dim layer, always bold so
 * the eye lands on it as the insertion anchor.
 */
export function StationStarterLabel({
  station,
  lines,
  highlightColor,
}: {
  station: Station;
  lines: Record<string, Line>;
  highlightColor: string;
}) {
  const { angle, rotationDeg, hovered, labelLeading, labelTracking, lineByService, lay } =
    useStationLabelLayout(station, lines);
  if (station.isWaypoint) return null;
  const strokeColor = legibleTextOn(highlightColor);
  return (
    <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
      {renderStationLabelText({
        text: station.name,
        fontSize: 12,
        fontWeight: 700,
        leading: labelLeading,
        tracking: labelTracking,
        fill: highlightColor,
        stroke: strokeColor,
        strokeWidth: 2,
        paintOrder: 'stroke',
        textDecoration: hovered ? 'underline' : 'none',
        anchorX: lay.anchorX,
        anchorY: lay.anchorY,
        textAnchor: lay.textAnchor,
        baseline: lay.baseline,
        firstLineDyPx: lay.firstLineDyPx,
        firstLineCenterY: lay.firstLineCenterY,
        rotationDeg,
        lineByService,
      })}
    </g>
  );
}

/**
 * Same positioning as the normal label but always renders text (never the
 * inline editor), in `highlightColor`. Used above the dim overlay so the
 * selected line's station names stay legible.
 */
export function StationHighlightLabel({
  station,
  lines,
  highlightColor,
}: {
  station: Station;
  lines: Record<string, Line>;
  highlightColor: string;
}) {
  const {
    angle,
    rotationDeg,
    hovered,
    labelFontSize,
    labelLeading,
    labelTracking,
    renderedWeight,
    stationItalic,
    lineByService,
    lay,
  } = useStationLabelLayout(station, lines);
  if (station.isWaypoint) return null;
  return (
    <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
      {renderStationLabelText({
        text: station.name,
        fontSize: labelFontSize,
        fontWeight: renderedWeight,
        fontStyle: stationItalic ? 'italic' : undefined,
        leading: labelLeading,
        tracking: labelTracking,
        textDecoration: hovered ? 'underline' : 'none',
        fill: highlightColor,
        anchorX: lay.anchorX,
        anchorY: lay.anchorY,
        textAnchor: lay.textAnchor,
        baseline: lay.baseline,
        firstLineDyPx: lay.firstLineDyPx,
        firstLineCenterY: lay.firstLineCenterY,
        rotationDeg,
        lineByService,
      })}
    </g>
  );
}

/**
 * The normal station label pass — rendered after all bg washes so that a
 * selected station's wash can never cover a neighboring station's label. Shows
 * the inline rename editor when this station is being edited; otherwise paints
 * the name in the theme label color. When a line is selected, the highlight
 * pass re-renders its stations' labels above the dim, so they are skipped here
 * to avoid the (dimmed) black underdraw bleeding through.
 */
export function StationLabel({
  station,
  lines,
}: {
  station: Station;
  lines: Record<string, Line>;
}) {
  const themeColors = useThemeColors();
  const renameStation = useDoc((s) => s.renameStation);
  const selectedLineId = useSelection((s) => s.selectedLineId);
  const uiMode = useSelection((s) => s.uiMode);
  const editingStationId = useSelection((s) => s.editingStationId);
  const setEditingStationId = useSelection((s) => s.setEditingStationId);
  const {
    angle,
    rotationDeg,
    hovered,
    labelFontSize,
    labelItalic,
    labelLeading,
    labelTracking,
    stationWeight,
    renderedWeight,
    stationItalic,
    lineByService,
    lay,
  } = useStationLabelLayout(station, lines);

  if (station.isWaypoint) return null;

  if (selectedLineId) {
    const isAppending = uiMode.kind === 'appending-to-line' && uiMode.lineId === selectedLineId;
    // Append mode re-renders every station's label above the dim.
    if (isAppending) return null;
    const ln = lines[selectedLineId];
    if (ln && ln.stations.includes(station.id)) return null;
  }

  const isEditing = editingStationId === station.id;
  const labelHitTransform = `rotate(${station.label.rotation * 45} ${lay.anchorX} ${lay.anchorY})`;
  // textAnchor maps to CSS text-align so the editor's glyphs land on the same
  // side of the anchor the label paints them.
  const editorTextAlign: 'left' | 'center' | 'right' =
    lay.textAnchor === 'start' ? 'left' : lay.textAnchor === 'end' ? 'right' : 'center';
  // When editing, the textarea shows the raw "<CODE>" tokens, which are wider
  // than the bullets they render as. Re-measure the box against that literal
  // text so a bullet-heavy name doesn't overflow its collapsed hit rect.
  const editorHit = isEditing
    ? labelLayoutLocal(
        station,
        {
          fontSize: labelFontSize,
          weight: stationWeight,
          italic: labelItalic,
          literalBullets: true,
          leading: labelLeading,
          tracking: labelTracking,
        },
        undefined,
        stopHalfOf(lines),
      )
    : null;

  return (
    <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
      {isEditing ? (
        <StationNameEditor
          x={editorHit ? editorHit.hitX : lay.hitX}
          y={editorHit ? editorHit.hitY : lay.hitY}
          width={editorHit ? editorHit.hitW : lay.hitW}
          minHeight={editorHit ? editorHit.hitH : lay.hitH}
          transform={labelHitTransform}
          fontSize={labelFontSize}
          fontWeight={stationWeight}
          italic={stationItalic}
          textAlign={editorTextAlign}
          value={station.name}
          onChange={(v) => renameStation(station.id, v)}
          onCommit={() => setEditingStationId(null)}
        />
      ) : (
        renderStationLabelText({
          text: station.name,
          fontSize: labelFontSize,
          fontWeight: renderedWeight,
          fontStyle: stationItalic ? 'italic' : undefined,
          leading: labelLeading,
          tracking: labelTracking,
          textDecoration: hovered ? 'underline' : 'none',
          fill: themeColors.label,
          anchorX: lay.anchorX,
          anchorY: lay.anchorY,
          textAnchor: lay.textAnchor,
          baseline: lay.baseline,
          firstLineDyPx: lay.firstLineDyPx,
          firstLineCenterY: lay.firstLineCenterY,
          rotationDeg,
          lineByService,
        })
      )}
    </g>
  );
}
