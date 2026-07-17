import type { Line, LineId, Station } from '../../model/types';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import { STOP_SIZE, stopCenterAt } from '../../geometry/orientation';
import { cellsAABBLocal } from '../../geometry/stationBoundary';
import { labelLayoutLocal } from '../../geometry/labelLayout';
import { stopHalfOf, lineWidthOf } from '../../model/lineWidth';
import { stopDashOf } from '../../model/dashSize';
import { useThemeColors } from '../../state/theme';
import { legibleTextOn } from '../../util/color';
import { dotSizeOverride, resolveDotSize } from '../../model/dotSize';
import { resolveDotRender } from '../../model/dotStyle';
import { effectiveStationLabelStyle, resolveDotStyle } from '../../model/transforms';
import { ORIENTATION_GLYPH, sameCell } from '../inspector/stopGridDrag';
import type { LayoutDragSource } from './useStationLayoutDrag';

// Handles never shrink below this screen size, however far out the view is
// zoomed — the mini-canvas's "grab targets scale away" failure mode is the
// exact thing this editor exists to fix.
const MIN_HANDLE_PX = 10;

// The editor dims the whole map behind it (see MapCanvas), so its rings read
// against a DARK backdrop in BOTH themes: a light dashed ring for idle stops,
// a bright accent for the active/swap stop. High contrast on the dim is the
// whole point — the old thin, theme-accent (dark-blue in light mode) ring is
// exactly what the redesign replaces.
const LAYOUT_RING = 'rgba(255, 255, 255, 0.92)';
const LAYOUT_RING_ACTIVE = '#5b9dff';

/**
 * The on-canvas station layout editor (editing-station-layout mode): a grab
 * ring over each REAL stop dot + the label cell, at world scale, above the
 * drag-proxy layer. Gestures are the StopGrid's: drag between ghost slots,
 * right-click (or R) to rotate, click to select — wired through
 * useStationLayoutDrag / dispatchMirrored.
 *
 * A transparent SHIELD over the station's own hit footprint swallows
 * presses/clicks/right-clicks/double-clicks between handles — without it, a
 * near-miss right-click would rotate the WHOLE station through the hit rect
 * beneath (this mode is in RIGHT_CLICK_PASSTHROUGH_MODES, so App's
 * capture-phase canceller stands down). In hand/space mode the shield lets
 * presses through so drag-to-pan keeps working.
 */
export function StationLayoutEditor({
  station,
  lines,
  zoom,
  onStartNodeDrag,
  swapTarget,
}: {
  station: Station;
  lines: Record<string, Line>;
  zoom: number;
  onStartNodeDrag: (id: string, source: LayoutDragSource, e: React.PointerEvent) => void;
  /** The stop currently resolved as a swap drop target, if any. */
  swapTarget: { row: number; col: number } | null;
}) {
  const selection = useSelection();
  const rotateStop = useDoc((s) => s.rotateStop);
  const rotateLabel = useDoc((s) => s.rotateLabel);

  // Theme still drives the label-handle stroke; darkMode resolves each dot's
  // fill so the orientation arrow can contrast it.
  const theme = useThemeColors();
  const darkMode = useDoc((s) => s.darkMode);
  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;
  const angle = station.rotation * 45;
  const stopHalf = stopHalfOf(lines);
  const cellsBox = cellsAABBLocal(station, stopHalf);
  // Shield reach past the cells AABB: at least one cell, and at least the
  // biggest dot's painted radius — an oversized per-stop dotSize override is
  // a live station click target, and any exposed ring would re-enable the
  // near-miss whole-station right-click the shield exists to swallow.
  const maxDotR =
    station.stops.reduce((m, s) => Math.max(m, resolveDotSize(lines[s.lineId], s)), 0) / 2;
  const shieldPad = Math.max(STOP_SIZE, maxDotR);
  const {
    anchorX: labelAnchorX,
    anchorY: labelAnchorY,
    hitX,
    hitY,
    hitW,
    hitH,
  } = labelLayoutLocal(
    station,
    effectiveStationLabelStyle(station),
    undefined,
    stopHalf,
    stopDashOf(lines),
  );

  const shieldHandlers = inHandMode
    ? {}
    : {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return; // middle-button pan bubbles through
          e.stopPropagation();
        },
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          selection.setSelectedStopLineId(null);
          selection.setLabelSelected(false);
        },
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
        },
        onDoubleClick: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
        },
      };

  const handleFor = (source: LayoutDragSource) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || inHandMode) return;
      e.stopPropagation();
      onStartNodeDrag(station.id, source, e);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (source.kind === 'stop') {
        selection.setSelectedStopLineId(source.lineId);
        dispatchMirrored(station.id, (sid) => rotateStop(sid, source.lineId));
      } else {
        selection.setLabelSelected(true);
        dispatchMirrored(station.id, (sid) => rotateLabel(sid));
      }
    },
  });

  const ringStroke = 2.5 / zoom;
  const glyphShadow = '0 0 2px rgba(0,0,0,0.6)';

  return (
    <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
      {/* Shield: swallow station-level interactions under the editor. */}
      <rect
        data-layout-shield="1"
        x={cellsBox.x - shieldPad}
        y={cellsBox.y - shieldPad}
        width={cellsBox.w + 2 * shieldPad}
        height={cellsBox.h + 2 * shieldPad}
        fill="transparent"
        pointerEvents={inHandMode ? 'none' : 'all'}
        {...shieldHandlers}
      />
      <rect
        data-layout-shield="1"
        x={hitX}
        y={hitY}
        width={hitW}
        height={hitH}
        transform={`rotate(${station.label.rotation * 45} ${labelAnchorX} ${labelAnchorY})`}
        fill="transparent"
        pointerEvents={inHandMode ? 'none' : 'all'}
        {...shieldHandlers}
      />

      {/* Stop handles: a ring around each real dot, floored to a constant
          screen size, with the orientation glyph as a badge. */}
      {station.stops.map((s) => {
        const c = stopCenterAt(s.row, s.col);
        const r = Math.max(lineWidthOf(lines[s.lineId]) / 2, MIN_HANDLE_PX / zoom);
        const selected = selection.selectedStopLineId === s.lineId;
        const isSwap = !!swapTarget && sameCell(swapTarget, s);
        // Resolve the dot exactly as it's painted, then flip the arrow to
        // whichever of black/white reads on its fill. An unfilled dot (open
        // ring / none / no line) leaves the arrow on the dim, where white wins.
        const line = lines[s.lineId];
        const dot = line
          ? resolveDotRender(
              resolveDotStyle(line, s),
              line.color,
              line.service,
              darkMode,
              dotSizeOverride(line, s),
            )
          : null;
        const glyphColor = dot && dot.fill !== 'none' ? legibleTextOn(dot.fill) : '#fff';
        return (
          <g
            key={`h-${s.lineId}`}
            data-cell-kind="stop"
            data-cell-row={s.row}
            data-cell-col={s.col}
            data-line-id={s.lineId}
            data-selected={selected || undefined}
            style={{ cursor: inHandMode ? undefined : 'grab' }}
            {...handleFor({ kind: 'stop', lineId: s.lineId as LineId })}
          >
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill="transparent"
              pointerEvents={inHandMode ? 'none' : 'all'}
              stroke={selected || isSwap ? LAYOUT_RING_ACTIVE : LAYOUT_RING}
              strokeWidth={selected || isSwap ? 3 / zoom : ringStroke}
              strokeDasharray={selected || isSwap ? undefined : `${5 / zoom} ${3 / zoom}`}
            />
            <text
              x={c.x}
              y={c.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.max(r * 0.9, 9 / zoom)}
              fontWeight={700}
              fill={glyphColor}
              style={{ pointerEvents: 'none', userSelect: 'none', textShadow: glyphShadow }}
            >
              {ORIENTATION_GLYPH[s.orientation]}
            </text>
          </g>
        );
      })}

      {/* Label-cell handle. Marks the CELL anchor — the painted text may sit
          offset from it via offset/offsetPerp/align. */}
      {(() => {
        const c = stopCenterAt(station.label.row, station.label.col);
        const r = Math.max(STOP_SIZE / 2, MIN_HANDLE_PX / zoom);
        const selected = selection.labelSelected;
        return (
          <g
            data-cell-kind="label"
            data-cell-row={station.label.row}
            data-cell-col={station.label.col}
            data-selected={selected || undefined}
            style={{ cursor: inHandMode ? undefined : 'grab' }}
            {...handleFor({ kind: 'label' })}
          >
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill="rgba(255,255,255,0.65)"
              pointerEvents={inHandMode ? 'none' : 'all'}
              stroke={selected ? theme.selectionStroke : 'rgba(0,0,0,0.45)'}
              strokeWidth={selected ? 2 / zoom : ringStroke}
            />
            <text
              x={c.x}
              y={c.y}
              transform={`rotate(${station.label.rotation * 45} ${c.x} ${c.y})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.max(9, 12 / zoom)}
              fontWeight={700}
              fill="#222"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              L
            </text>
          </g>
        );
      })()}
    </g>
  );
}
