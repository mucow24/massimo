import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { useDoc, useSelection } from '../../state/store';
import { useThemeColors } from '../../state/theme';
import type { LineId, LineStyle } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { resolveSegmentStyle } from '../../geometry/interlining';
import { ColorPalette } from './ColorPalette';
import { ColorField } from '../ColorField';
import { useFieldHistory } from '../useFieldHistory';
import { StationShapePicker } from '../StationShapePicker';
import { blendOver, legibleTextOn, withAlpha, withHexAlpha } from '../../util/color';
import { NumericFieldRow } from '../NumericFieldRow';
import { StyleRow } from '../StyleRow';
import {
  LINE_WIDTH_MAX,
  LINE_WIDTH_MIN,
  LINE_WIDTH_SLIDER_MIN,
  lineWidthOf,
} from '../../model/lineWidth';
import {
  LINE_CURVE_RADIUS_MAX,
  LINE_CURVE_RADIUS_MIN,
  lineCurveRadiusOf,
} from '../../model/lineCurve';
import { DOT_SIZE_MAX, DOT_SIZE_MIN, lineDefaultDotSizeOf } from '../../model/dotSize';
import {
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_MAX,
  LINE_STROKE_WIDTH_MIN,
  lineSeamColorOf,
  lineSeamWidthOf,
  lineStrokeColorOf,
  lineStrokeRailWidth,
  lineStrokeWidthOf,
} from '../../model/lineStroke';
import { StationGraph } from './StationGraph';
import { BranchGlyph } from './BranchGlyph';

// Clear the line editor's pointer-hover highlights (the white dot casing and
// the segment-corridor wash). Call this whenever a hovered row/divider is
// orphaned without an onMouseLeave/onBlur firing — the row is removed or
// reordered out from under the cursor, or the inspector itself unmounts
// (line deleted, a station selected, the panel collapsed). Otherwise the
// highlight dangles on a now-stale stop/segment and re-appears on the canvas
// if the action is undone. Reads the store imperatively so it needs no deps.
function clearInspectorHovers() {
  const s = useSelection.getState();
  s.setHoveredLineStop(null);
  s.setHoveredStation(null);
  s.setHoveredInspectorSegment(null);
}

const INSERT_ROW_H = 16;

const NEXT_STYLE: Record<LineStyle, LineStyle> = {
  solid: 'dashed',
  dashed: 'hatched',
  hatched: 'hatched-mirror',
  'hatched-mirror': 'dotted',
  dotted: 'dashed-open',
  'dashed-open': 'solid',
};

// One small insert-zone button (the active state fills with the line color).
function ZoneButton({
  active,
  color,
  title,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const tintAlpha = hovered ? 0.6 : 0.4;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      aria-label={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        height: '100%',
        padding: '0 7px',
        margin: 0,
        background: active ? color : withAlpha(color, tintAlpha),
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12,
        lineHeight: 1,
        color: active ? legibleTextOn(color) : legibleTextOn(blendOver(color, tintAlpha)),
        boxSizing: 'border-box',
      }}
    >
      {children}
    </button>
  );
}

// The insert-zone affordances shown while appending: a left-justified pair of
// small buttons. "Insert after" (+↓) arms the linear insert cursor at this
// position; "Branch" (+ junction) starts a NEW branch drawn from the predecessor
// stop. `canBranch` is false at the very start of the line (no stop to branch
// from).
function InsertZoneButtons({
  color,
  height,
  insertActive,
  branchActive,
  canBranch,
  onInsert,
  onBranch,
  onHoverChange,
}: {
  color: string;
  height: number;
  insertActive: boolean;
  branchActive: boolean;
  canBranch: boolean;
  onInsert: () => void;
  onBranch: () => void;
  onHoverChange?: (hovered: boolean) => void;
}) {
  return (
    <div
      style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, height }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <ZoneButton
        active={insertActive}
        color={color}
        title="Insert stops after this stop (in-line)"
        onClick={onInsert}
      >
        <span>+</span>
        <ChevronDownIcon />
      </ZoneButton>
      {canBranch && (
        <ZoneButton
          active={branchActive}
          color={color}
          title="Start a new branch from this stop"
          onClick={onBranch}
        >
          <span>+</span>
          <BranchGlyph />
        </ZoneButton>
      )}
    </div>
  );
}

export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const updateLine = useDoc((s) => s.updateLine);
  const setLineSegmentStyle = useDoc((s) => s.setLineSegmentStyle);
  const toggleEdgeOnLine = useDoc((s) => s.toggleEdgeOnLine);
  const setDotStyle = useDoc((s) => s.setDotStyle);
  const removeStationFromLine = useDoc((s) => s.removeStationFromLine);
  const setLineDefaultDotStyle = useDoc((s) => s.setLineDefaultDotStyle);
  const setLineDefaultDotSize = useDoc((s) => s.setLineDefaultDotSize);
  const setLineWidth = useDoc((s) => s.setLineWidth);
  const setLineCurveRadius = useDoc((s) => s.setLineCurveRadius);
  const setLineStrokeWidth = useDoc((s) => s.setLineStrokeWidth);
  const setLineStrokeColor = useDoc((s) => s.setLineStrokeColor);
  const setLineSeamColor = useDoc((s) => s.setLineSeamColor);
  const setLineSeamWidth = useDoc((s) => s.setLineSeamWidth);
  const selection = useSelection();
  // Gap color matches the canvas so the band preview mirrors the on-canvas look.
  const underlayColor = useThemeColors().underlay;
  const nameField = useFieldHistory();
  const serviceField = useFieldHistory();

  // When this inspector unmounts (line deleted, a station selected, the panel
  // collapsed, or a different line opened), any row/divider hovered at that
  // moment never gets its onMouseLeave — so drop the hovers here.
  useEffect(() => clearInspectorHovers, []);

  if (!line) return null;

  const cycleSegmentStyle = (fromStationId: string, toStationId: string) => {
    const key = pairKeyOf(fromStationId, toStationId);
    const cur = resolveSegmentStyle(line, key);
    setLineSegmentStyle(line.id, fromStationId, toStationId, NEXT_STYLE[cur]);
  };

  const isAppending =
    selection.uiMode.kind === 'appending-to-line' && selection.uiMode.lineId === line.id;
  const appendInsertAfterIndex =
    selection.uiMode.kind === 'appending-to-line' ? selection.uiMode.insertAfterIndex : null;
  const appendDraw =
    selection.uiMode.kind === 'appending-to-line' ? !!selection.uiMode.draw : false;

  // Arming an insert/branch button is a TOGGLE: clicking the one already armed
  // (same stop AND same mode) clears the cursor to null, so nothing is "added
  // after" — the way to deselect the insert point without leaving append mode.
  // Any other click (re)arms this stop in the requested mode.
  const armCursor = (idx: number, draw: boolean) => {
    const alreadyArmed = appendInsertAfterIndex === idx && appendDraw === draw;
    if (alreadyArmed) selection.setInsertAfterIndex(null, false);
    else selection.setInsertAfterIndex(idx, draw);
  };

  return (
    <section className="inspector">
      <div className="field">
        <label>Line name</label>
        <input
          type="text"
          value={line.name}
          onChange={(e) => updateLine(line.id, { name: e.target.value })}
          {...nameField}
        />
      </div>
      <div className="field">
        <label>Service code</label>
        <input
          type="text"
          maxLength={3}
          value={line.service}
          onChange={(e) => updateLine(line.id, { service: e.target.value.toUpperCase() })}
          {...serviceField}
        />
      </div>
      <div className="field">
        <label>Color</label>
        <ColorPalette value={line.color} onChange={(c) => updateLine(line.id, { color: c })} />
      </div>
      {/* Name/service/color above are identity, not style — the style row
          heads the covered formatting controls (dot, width, stroke). */}
      <StyleRow key={line.id} kind="line" itemId={line.id} styleId={line.styleId} />
      <div className="field dot-field">
        <label>Default stop dot type and size</label>
        <NumericFieldRow
          id={`line-dot-size-${line.id}`}
          label="Dot size"
          leading={
            <StationShapePicker
              disabled={false}
              currentStyle={line.defaultDotStyle ?? DEFAULT_DOT_STYLE}
              lineColor={line.color}
              serviceCode={line.service}
              onPick={(shape) => setLineDefaultDotStyle(line.id, DOT_SHAPE_PRESETS[shape])}
            />
          }
          min={DOT_SIZE_MIN}
          max={DOT_SIZE_MAX}
          step={1}
          value={lineDefaultDotSizeOf(line)}
          onChange={(n) => setLineDefaultDotSize(line.id, n)}
          getCurrent={() => lineDefaultDotSizeOf(useDoc.getState().lines[id])}
          textboxAllowAboveMax
        />
      </div>
      <NumericFieldRow
        id={`line-width-${line.id}`}
        label="Line width"
        min={LINE_WIDTH_SLIDER_MIN}
        max={LINE_WIDTH_MAX}
        step={1}
        value={lineWidthOf(line)}
        onChange={(n) => setLineWidth(line.id, n)}
        getCurrent={() => lineWidthOf(useDoc.getState().lines[id])}
        textboxAllowAboveMax
        textboxMin={LINE_WIDTH_MIN}
      />
      <NumericFieldRow
        id={`line-curve-${line.id}`}
        label="Curve radius"
        min={LINE_CURVE_RADIUS_MIN}
        max={LINE_CURVE_RADIUS_MAX}
        step={1}
        value={lineCurveRadiusOf(line)}
        onChange={(n) => setLineCurveRadius(line.id, n)}
        getCurrent={() => lineCurveRadiusOf(useDoc.getState().lines[id])}
        textboxAllowAboveMax
      />
      <NumericFieldRow
        id={`line-stroke-${line.id}`}
        label="Stroke width"
        min={LINE_STROKE_WIDTH_MIN}
        max={LINE_STROKE_WIDTH_MAX}
        step={LINE_STROKE_STEP}
        value={lineStrokeWidthOf(line)}
        onChange={(n) => setLineStrokeWidth(line.id, n)}
        getCurrent={() => lineStrokeWidthOf(useDoc.getState().lines[id])}
        textboxAllowAboveMax
      />
      <div className="options-popover-row">
        <label htmlFor={`line-stroke-color-${line.id}`} className="options-popover-label">
          Stroke color
        </label>
        <ColorField
          id={`line-stroke-color-${line.id}`}
          ariaLabel="Stroke color"
          value={lineStrokeColorOf(line)}
          onChange={(c) => setLineStrokeColor(line.id, c)}
        />
      </div>
      <NumericFieldRow
        id={`line-seam-${line.id}`}
        label="Seam width"
        min={LINE_STROKE_WIDTH_MIN}
        max={LINE_STROKE_WIDTH_MAX}
        step={LINE_STROKE_STEP}
        // Unset inherits the casing width (so a seam-color-only line shows a
        // seam matched to its casing); the slider overrides.
        value={
          lineSeamWidthOf(line) ?? lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line))
        }
        onChange={(n) => setLineSeamWidth(line.id, n)}
        getCurrent={() => {
          const l = useDoc.getState().lines[id];
          return lineSeamWidthOf(l) ?? lineStrokeRailWidth(lineStrokeWidthOf(l), lineWidthOf(l));
        }}
        textboxAllowAboveMax
      />
      <div className="options-popover-row">
        <label htmlFor={`line-seam-color-${line.id}`} className="options-popover-label">
          Seam color
        </label>
        {/* Interior branch/loop overlap indicator, shown where a line overlaps
            itself. Off by default: seeded at the casing hue with zero alpha, so
            the swatch reads transparent ("off") and dragging the picker's alpha
            up enables a translucent seam. Needs a seam width (inherits the
            casing width when unset). */}
        <ColorField
          id={`line-seam-color-${line.id}`}
          ariaLabel="Seam color"
          value={lineSeamColorOf(line) ?? withHexAlpha(lineStrokeColorOf(line), 0)}
          onChange={(c) => setLineSeamColor(line.id, c)}
        />
      </div>
      <div className="field">
        <button
          type="button"
          onClick={() => {
            if (isAppending) {
              selection.setAppending(null);
            } else {
              selection.setAppending(line.id);
              selection.setInsertAfterIndex(null);
            }
          }}
          title={
            isAppending
              ? 'Done editing. Reorder, remove, or pick stations on the map to add stops.'
              : 'Edit this line: reorder, remove, or add stops.'
          }
          style={{
            width: '100%',
            marginBottom: 3,
            padding: '8px 12px',
            border: 'none',
            borderRadius: 0,
            background: isAppending ? line.color : '#000',
            color: isAppending ? legibleTextOn(line.color) : '#fff',
            fontFamily: 'inherit',
            fontWeight: 500,
            fontSize: 13,
            letterSpacing: '0.04em',
            cursor: 'pointer',
          }}
        >
          {isAppending ? 'Done' : 'Edit Stops'}
        </button>
        {/* The column-based graph is the layout in BOTH view and edit mode, so
            hitting "Edit Stops" doesn't rearrange anything — the rows just grow
            insert/branch/remove controls. This top affordance arms inserting
            before the first stop (and starts an empty line). */}
        {isAppending && (
          <div style={{ display: 'flex', height: INSERT_ROW_H, marginBottom: 2 }}>
            <InsertZoneButtons
              color={line.color}
              height={INSERT_ROW_H}
              insertActive={appendInsertAfterIndex === -1 && !appendDraw}
              branchActive={false}
              canBranch={false}
              onInsert={() => armCursor(-1, false)}
              onBranch={() => {}}
            />
          </div>
        )}
        {line.stations.length > 0 && (
          <StationGraph
            line={line}
            stations={stations}
            color={line.color}
            underlayColor={underlayColor}
            isAppending={isAppending}
            cursorStationId={
              appendInsertAfterIndex != null && appendInsertAfterIndex >= 0
                ? line.stations[appendInsertAfterIndex]
                : null
            }
            appendDraw={appendDraw}
            hovered={
              selection.hoveredInspectorSegment?.lineId === line.id
                ? selection.hoveredInspectorSegment
                : null
            }
            onSelectStation={(sid) => selection.selectStation(sid)}
            onRemoveStation={(sid) => {
              clearInspectorHovers();
              removeStationFromLine(line.id, line.stations.indexOf(sid));
            }}
            onCycleSegment={(a, b) => cycleSegmentStyle(a, b)}
            onRemoveSegment={(a, b) => toggleEdgeOnLine(line.id, a, b)}
            onSetDotStyle={(sid, style) => setDotStyle(sid, line.id, style)}
            onInsertAfter={(sid) => armCursor(line.stations.indexOf(sid), false)}
            onBranchFrom={(sid) => armCursor(line.stations.indexOf(sid), true)}
            onHoverSegment={(edge) =>
              selection.setHoveredInspectorSegment(
                edge ? { lineId: line.id, fromStationId: edge.from, toStationId: edge.to } : null,
              )
            }
            onHoverStation={(sid) => {
              if (sid) {
                selection.setHoveredLineStop({ lineId: line.id, stationId: sid });
                selection.setHoveredStation(sid);
              } else {
                selection.setHoveredLineStop(null);
                selection.setHoveredStation(null);
              }
            }}
          />
        )}
      </div>
    </section>
  );
}
