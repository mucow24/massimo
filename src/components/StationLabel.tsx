import { useMemo, type ReactNode } from 'react';
import { Line, Station } from '../model/types';
import { useDoc, useSelection } from '../state/store';
import { useThemeColors } from '../state/theme';
import { useViewportStore } from '../state/viewportStore';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { stopGapOf, stopHalfOf } from '../model/lineWidth';
import { stopDashOf } from '../model/dashSize';
import { bumpWeightByIndex, effectiveStationStyleProps } from '../model/transforms';
import { legibleTextOn } from '../util/color';
import { waypointLabelRectLocal } from '../geometry/waypointLozenge';
import { renderStationLabelText, type RenderLabelTextArgs } from './stationLabelText';
import { StationNameEditor } from './StationNameEditor';
import { WaypointLozenge } from './WaypointLozenge';

/**
 * A revealed waypoint's label: the "WP" lozenge painted IN PLACE OF the station
 * name. It occupies the same box the name would (anchored per `textAnchor` at
 * the label anchor, vertically centered on the block) and shares the label's
 * rotation, so it tracks the label through rotations/offsets — and the hit rect
 * / selection ring (which use the same `waypointLabelRectLocal`) wrap it. Every
 * call site is a revealed waypoint (each pass returns first for a hidden one),
 * so there's no overlay guard here.
 */
function WaypointLozengeLabel({
  lay,
  rotationDeg,
  fontSize,
}: {
  lay: {
    textAnchor: 'start' | 'middle' | 'end';
    anchorX: number;
    anchorY: number;
    hitY: number;
    hitH: number;
  };
  rotationDeg: number;
  fontSize: number;
}) {
  const box = waypointLabelRectLocal(lay, fontSize);
  // Tagged data-export-exclude: Show-waypoints is a view aid, so the "WP" pill
  // (painted in place of the name) must never bake into a PNG/SVG/PDF export.
  return (
    <g data-export-exclude="1" transform={`rotate(${rotationDeg} ${lay.anchorX} ${lay.anchorY})`}>
      <WaypointLozenge rightX={box.x + box.w} centerY={box.y + box.h / 2} fontSize={fontSize} />
    </g>
  );
}

/**
 * The positioning half of a label paint: the anchor, the anchoring mode, the
 * first-line metrics, and the label rotation — everything that says WHERE the
 * name lands, straight off the shared layout. All three passes paint the same
 * name in the same place and differ only in HOW (fill, size, weight, stroke),
 * so each spreads this and adds its own paint instead of re-listing the seven
 * positioning fields. The highlight pass is drawn OVER the normal one, so a
 * drifted copy would read as a doubled label.
 */
function labelTextPosition(
  lay: ReturnType<typeof labelLayoutLocal>,
  rotationDeg: number,
  lineByService: Map<string, Line>,
): Pick<
  RenderLabelTextArgs,
  | 'anchorX'
  | 'anchorY'
  | 'textAnchor'
  | 'baseline'
  | 'firstLineDyPx'
  | 'firstLineCenterY'
  | 'rotationDeg'
  | 'lineByService'
> {
  return {
    anchorX: lay.anchorX,
    anchorY: lay.anchorY,
    textAnchor: lay.textAnchor,
    baseline: lay.baseline,
    firstLineDyPx: lay.firstLineDyPx,
    firstLineCenterY: lay.firstLineCenterY,
    rotationDeg,
    lineByService,
  };
}

/**
 * The frame the two above-the-dim passes (starter / highlight) paint into:
 * the hidden-waypoint skip, the station-rotated `<g>`, and the "WP" lozenge
 * that replaces the name on a revealed waypoint. Identical for both — only
 * `text` differs — so it is written once here. (The normal pass keeps its own
 * frame: its inline rename editor must win over the lozenge, so its branch
 * order isn't this one.)
 */
function OverlayLabelFrame({
  station,
  lay,
  angle,
  rotationDeg,
  fontSize,
  text,
}: {
  station: Station;
  lay: ReturnType<typeof labelLayoutLocal>;
  angle: number;
  rotationDeg: number;
  fontSize: number;
  text: ReactNode;
}) {
  const showWaypoints = useViewportStore((s) => s.showWaypoints);
  if (station.isWaypoint && !showWaypoints) return null;
  return (
    <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
      {station.isWaypoint ? (
        <WaypointLozengeLabel lay={lay} rotationDeg={rotationDeg} fontSize={fontSize} />
      ) : (
        text
      )}
    </g>
  );
}

/**
 * The common layout + typography bundle behind all three station-label passes
 * (starter / highlight / normal). Mirrors the derivation StationView used to
 * do inline so the rendered <text>/<tspan> geometry is byte-for-byte the same:
 * the label layout (anchor, text-anchor, baseline, hit rect) and the painted
 * text both read the station's OWN effective typography (`effStyle`), and the
 * rendered weight adds the hover bump on top of the station's stored weight.
 */
function useStationLabelLayout(station: Station, lines: Record<string, Line>) {
  const hovered = useSelection((s) => s.hoveredStationId === station.id);
  // The station's own effective typography (stored ?? LABEL_* default) — the
  // single source the hit rect / silhouette (via effectiveStationLabelStyle,
  // the same object) and the painted text share. `weight` is a shipped-ladder
  // value, so the hover bump resolves against it.
  const effStyle = effectiveStationStyleProps(station);
  const stationWeight = effStyle.weight;
  const stationItalic = effStyle.italic;
  // Rendered weight: the station's weight, +2 indices when hovered (saturating
  // at Black 900).
  const renderedWeight = hovered ? bumpWeightByIndex(stationWeight, 2) : stationWeight;
  // Service-code lookup for inline bullets. Only walked when a label's text
  // contains a <CODE> token; building once per render keeps it cheap.
  const lineByService = useMemo(() => {
    const map = new Map<string, Line>();
    for (const ln of Object.values(lines)) map.set(ln.service, ln);
    return map;
  }, [lines]);
  // Label layout goes through the same effective style (a StationStyleProps is
  // structurally a LabelStyle) and per-stop width lookup as the hit rect /
  // silhouette, so the painted anchor agrees with the boundary geometry next to
  // wide stops.
  const lay = labelLayoutLocal(
    station,
    effStyle,
    undefined,
    stopHalfOf(lines),
    stopDashOf(lines),
    stopGapOf(lines),
  );
  return {
    angle: station.rotation * 45,
    rotationDeg: station.label.rotation * 45,
    hovered,
    effStyle,
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
  const { angle, rotationDeg, hovered, effStyle, lineByService, lay } = useStationLabelLayout(
    station,
    lines,
  );
  return (
    <OverlayLabelFrame
      station={station}
      lay={lay}
      angle={angle}
      rotationDeg={rotationDeg}
      fontSize={effStyle.fontSize}
      text={renderStationLabelText({
        ...labelTextPosition(lay, rotationDeg, lineByService),
        text: station.name,
        // The station's OWN size — `lay` was computed at it, so a hardcoded
        // 12 halves the glyphs while keeping the 24px line pitch. Matches
        // StationHighlightLabel and the waypoint branch above; only the
        // always-bold weight is deliberate starter styling.
        fontSize: effStyle.fontSize,
        fontWeight: 700,
        leading: effStyle.leading,
        tracking: effStyle.tracking,
        fill: highlightColor,
        stroke: legibleTextOn(highlightColor),
        strokeWidth: 2,
        paintOrder: 'stroke',
        textDecoration: hovered ? 'underline' : 'none',
      })}
    />
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
    effStyle,
    renderedWeight,
    stationItalic,
    lineByService,
    lay,
  } = useStationLabelLayout(station, lines);
  return (
    <OverlayLabelFrame
      station={station}
      lay={lay}
      angle={angle}
      rotationDeg={rotationDeg}
      fontSize={effStyle.fontSize}
      text={renderStationLabelText({
        ...labelTextPosition(lay, rotationDeg, lineByService),
        text: station.name,
        fontSize: effStyle.fontSize,
        fontWeight: renderedWeight,
        fontStyle: stationItalic ? 'italic' : undefined,
        leading: effStyle.leading,
        tracking: effStyle.tracking,
        textDecoration: hovered ? 'underline' : 'none',
        fill: highlightColor,
      })}
    />
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
  const showWaypoints = useViewportStore((s) => s.showWaypoints);
  const {
    angle,
    rotationDeg,
    hovered,
    effStyle,
    stationWeight,
    renderedWeight,
    stationItalic,
    lineByService,
    lay,
  } = useStationLabelLayout(station, lines);

  // A hidden waypoint paints nothing; a revealed one flows through the normal
  // path below (selection-skip, inline rename, theme color) exactly like a
  // regular station — its only differences are the black/white dots (StationDots)
  // and the "WP" lozenge added to the return below.
  if (station.isWaypoint && !showWaypoints) return null;

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
        { ...effStyle, literalBullets: true },
        undefined,
        stopHalfOf(lines),
        stopDashOf(lines),
        stopGapOf(lines),
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
          fontSize={effStyle.fontSize}
          fontWeight={stationWeight}
          italic={stationItalic}
          textAlign={editorTextAlign}
          value={station.name}
          onChange={(v) => renameStation(station.id, v)}
          onCommit={() => setEditingStationId(null)}
        />
      ) : station.isWaypoint ? (
        <WaypointLozengeLabel lay={lay} rotationDeg={rotationDeg} fontSize={effStyle.fontSize} />
      ) : (
        renderStationLabelText({
          ...labelTextPosition(lay, rotationDeg, lineByService),
          text: station.name,
          fontSize: effStyle.fontSize,
          fontWeight: renderedWeight,
          fontStyle: stationItalic ? 'italic' : undefined,
          leading: effStyle.leading,
          tracking: effStyle.tracking,
          textDecoration: hovered ? 'underline' : 'none',
          fill: themeColors.label,
        })
      )}
    </g>
  );
}
