import type { Line, LineId, Station } from '../../model/types';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import { STOP_SIZE, stopCenterAt } from '../../geometry/orientation';
import { anchorOvershootLocal, cellsAABBLocal } from '../../geometry/stationBoundary';
import { labelLayoutLocal } from '../../geometry/labelLayout';
import { capCenterDy } from '../../geometry/textMeasure';
import { lineWidthOf } from '../../model/lineWidth';
import { useStopMetrics } from '../useStopMetrics';
import { lineDisplayName } from '../../model/lineNaming';
import { useThemeColors } from '../../state/theme';
import { resolveDotSize } from '../../model/dotSize';
import {
  effectiveStationLabelStyle,
  LABEL_FONT_SIZE_DEFAULT,
  stationIsSingleton,
} from '../../model/transforms';
import { sameCell } from '../inspector/stopGridDrag';
import { OrientationArrow } from '../StationOrientationArrows';
import { AnchorMark, ANCHOR_ICON_BOX } from '../AnchorGlyph';
import type { LayoutDragSource } from './useStationLayoutDrag';

// Every handle is sized in WORLD units — geometry AND stroke weight — so it
// grows and shrinks with the map, like the station it wraps, and reads exactly
// the same at every zoom. Sizing off the COMMITTED zoom (`X / zoom`) held a
// screen size that went stale mid-gesture and snapped when the camera
// committed; holding only the WEIGHT screen-constant (vector-effect, the
// selection ring's recipe) leaves the weight fighting world-sized geometry as
// you zoom. Read the number against the ring it draws, not against a screen
// weight: 0.5 on the default r=7 ring is a fine hairline.
const RING_WIDTH = 0.5;
// The active (selected / swap-target) ring reads a half-step heavier.
const RING_ACTIVE_WIDTH = RING_WIDTH * 1.5;

// Arrow length as a fraction of its ring's DIAMETER. In here the arrow has to
// live inside the ring, so it takes its size from the ring — not from the dot
// like the map's hover badge, where a service-code disc (12) scaled the arrow
// past the ring it would have to fit in.
const ARROW_FIT = 0.88;

// Scrim inside each stop ring. A dot carrying the line's service code puts text
// directly under the orientation glyph, where the two compete and neither
// reads; a wash over the dot settles it in the arrow's favor.
const RING_SCRIM = 'rgba(0, 0, 0, 0.8)';

// The editor dims the whole map behind it (see MapCanvas), so its rings read
// against a DARK backdrop in BOTH themes: a light ring for idle stops, a
// bright accent for the active/swap stop. High contrast on the dim is the
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
 * capture-phase canceller stands down). The shield is TWO zones split at the
 * painted white border, so the visible outline is exactly the stay/exit
 * boundary: inside it a plain click clears the sub-selection and stays in
 * the mode; in the padded HALO ring outside it (invisible — clicking there
 * reads as clicking empty canvas) a plain click EXITS the mode like a canvas
 * click would, while presses/right-clicks/double-clicks stay swallowed so a
 * far-miss right-click still can't rotate the station beneath. In hand/space
 * mode both zones let presses through so drag-to-pan keeps working.
 */
export function StationLayoutEditor({
  station,
  lines,
  onStartNodeDrag,
  swapTarget,
}: {
  station: Station;
  lines: Record<string, Line>;
  onStartNodeDrag: (id: string, source: LayoutDragSource, e: React.PointerEvent) => void;
  /** The stop currently resolved as a swap drop target, if any. */
  swapTarget: { row: number; col: number } | null;
}) {
  const selection = useSelection();
  const rotateStop = useDoc((s) => s.rotateStop);
  const rotateLabel = useDoc((s) => s.rotateLabel);

  // Theme drives the label-handle stroke. Nothing here reads the dot's COLOR
  // any more — the ring scrim darkens every dot, so the arrow is always white.
  const theme = useThemeColors();
  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;
  const angle = station.rotation * 45;
  // Singleton vs. shared picks each stop's split default (dot style + size);
  // it's a per-station property, so resolve it once for this editor.
  const isSingleton = stationIsSingleton(station);
  const metrics = useStopMetrics(lines);
  const cellsBox = cellsAABBLocal(station, metrics);
  // Halo reach past the cells AABB: at least one cell, and at least the
  // biggest dot's painted radius — an oversized per-stop dotSize override is
  // a live station click target, and any exposed ring would re-enable the
  // near-miss whole-station right-click the shield exists to swallow.
  const maxDotR =
    station.stops.reduce(
      (m, s) => Math.max(m, resolveDotSize(lines[s.lineId], s, isSingleton)),
      0,
    ) / 2;
  // The halo must also reach every transfer anchor: an anchor parked outside
  // the cells box would otherwise sit beyond the swallowing zone, and a
  // near-miss right-click there would rotate the WHOLE station through the hit
  // rect beneath — the exact gap the shield exists to close. Extending the PAD
  // (not cellsAABBLocal) keeps the painted border as the stay/exit boundary.
  const anchorReach = anchorOvershootLocal(cellsBox, station.transferAnchors);
  const shieldPad = Math.max(STOP_SIZE, maxDotR, anchorReach + STOP_SIZE / 2);
  const {
    anchorX: labelAnchorX,
    anchorY: labelAnchorY,
    hitX,
    hitY,
    hitW,
    hitH,
  } = labelLayoutLocal(station, effectiveStationLabelStyle(station), undefined, metrics);

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
          selection.setSelectedAnchorCellId(null);
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
  // The halo shares the shield's press/right-click/double-click swallowing,
  // but a plain click out there is a far miss — outside the painted border —
  // and means "done": exit the mode exactly like the canvas click in
  // usePlacementDispatch (uiMode → idle, selection kept so the inspector
  // stays open).
  const haloHandlers = inHandMode
    ? {}
    : {
        ...shieldHandlers,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          selection.setUiMode({ kind: 'idle' });
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
      // Both rotatable kinds named explicitly. The label arm used to be a bare
      // `else`, so a source kind with no orientation of its own would have
      // rotated the station's LABEL on right-click — and nothing about that
      // would fail to compile. A source that isn't listed here has nothing to
      // rotate, which is the correct no-op.
      if (source.kind === 'stop') {
        selection.setSelectedStopLineId(source.lineId);
        dispatchMirrored(station.id, (sid) => rotateStop(sid, source.lineId));
      } else if (source.kind === 'label') {
        selection.setLabelSelected(true);
        dispatchMirrored(station.id, (sid) => rotateLabel(sid));
      }
    },
  });

  return (
    <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`}>
      {/* Halo first (beneath): document order is hit-test priority, so the
          inner shields below win everywhere inside the painted border and the
          halo only catches the invisible pad ring outside it. */}
      <rect
        data-layout-shield="halo"
        x={cellsBox.x - shieldPad}
        y={cellsBox.y - shieldPad}
        width={cellsBox.w + 2 * shieldPad}
        height={cellsBox.h + 2 * shieldPad}
        fill="transparent"
        pointerEvents={inHandMode ? 'none' : 'all'}
        {...haloHandlers}
      />
      {/* Shield: swallow station-level interactions under the editor. The
          cells rect matches the painted border (cellsAABBLocal is what the
          white stroke outlines), so the visible outline IS the stay/exit
          boundary. */}
      <rect
        data-layout-shield="1"
        x={cellsBox.x}
        y={cellsBox.y}
        width={cellsBox.w}
        height={cellsBox.h}
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

      {/* Stop handles: a ring around each real dot, sized in world units, with
          the drawn orientation arrow as a badge. */}
      {station.stops.map((s) => {
        const c = stopCenterAt(s.row, s.col);
        const selected = selection.selectedStopLineId === s.lineId;
        const isSwap = !!swapTarget && sameCell(swapTarget, s);
        const line = lines[s.lineId];
        // The ring wraps the stop cell: half the stripe width, never inside an
        // oversized dot (same reason the shield pads by maxDotR), never below
        // the lattice cell a thin line's stop still occupies.
        const r = Math.max(
          lineWidthOf(line) / 2,
          resolveDotSize(line, s, isSingleton) / 2,
          STOP_SIZE / 2,
        );
        // Native tooltip naming the line this stop serves — the shared
        // user-facing line name, same as the sidebar row and the inspector badge.
        const lineLabel = lineDisplayName(line);
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
            <title>{lineLabel}</title>
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill={RING_SCRIM}
              pointerEvents={inHandMode ? 'none' : 'all'}
              stroke={selected || isSwap ? LAYOUT_RING_ACTIVE : LAYOUT_RING}
              strokeWidth={selected || isSwap ? RING_ACTIVE_WIDTH : RING_WIDTH}
            />
            <OrientationArrow
              x={c.x}
              y={c.y}
              size={r * 2 * ARROW_FIT}
              orientation={s.orientation}
              lineId={s.lineId}
              fill="#fff"
            />
          </g>
        );
      })}

      {/* Transfer-anchor handles: the same grab ring as a stop, carrying the
          anchor mark instead of an orientation arrow (an anchor has no axis).
          Drags on the same ghost lattice as the label — a body-less point. */}
      {(station.transferAnchors ?? []).map((a) => {
        const c = stopCenterAt(a.row, a.col);
        const r = STOP_SIZE / 2;
        const selected = selection.selectedAnchorCellId === a.id;
        return (
          <g
            key={`a-${a.id}`}
            data-cell-kind="anchor"
            data-cell-row={a.row}
            data-cell-col={a.col}
            data-anchor-cell-id={a.id}
            data-selected={selected || undefined}
            style={{ cursor: inHandMode ? undefined : 'grab' }}
            {...handleFor({ kind: 'anchor', anchorId: a.id })}
          >
            <title>Transfer anchor</title>
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill={RING_SCRIM}
              pointerEvents={inHandMode ? 'none' : 'all'}
              stroke={selected ? LAYOUT_RING_ACTIVE : LAYOUT_RING}
              strokeWidth={selected ? RING_ACTIVE_WIDTH : RING_WIDTH}
            />
            <g
              transform={`translate(${c.x - r} ${c.y - r}) scale(${(r * 2) / ANCHOR_ICON_BOX})`}
              color="#fff"
              pointerEvents="none"
            >
              <AnchorMark strokeWidth={1.6} />
            </g>
          </g>
        );
      })}

      {/* Label-cell handle. Marks the CELL anchor — the painted text may sit
          offset from it via offset/offsetPerp/align. */}
      {(() => {
        const c = stopCenterAt(station.label.row, station.label.col);
        const r = STOP_SIZE / 2;
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
              strokeWidth={RING_WIDTH}
            />
            <text
              x={c.x}
              // Cap-centered on the alphabetic baseline — NOT dominantBaseline="central",
              // which resolves from platform-specific font metrics (see capCenterDy).
              y={c.y + capCenterDy(LABEL_FONT_SIZE_DEFAULT)}
              transform={`rotate(${station.label.rotation * 45} ${c.x} ${c.y})`}
              textAnchor="middle"
              fontSize={LABEL_FONT_SIZE_DEFAULT}
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
