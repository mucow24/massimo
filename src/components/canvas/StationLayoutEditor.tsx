import type { Line, LineId, Station } from '../../model/types';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import { STOP_SIZE, stationFrameDeg } from '../../geometry/orientation';
import { stationCircle } from '../../geometry/lineCircle';
import { anchorOvershootLocal, cellsAABBLocal } from '../../geometry/stationBoundary';
import { labelLayoutLocal } from '../../geometry/labelLayout';
import { useStopMetrics } from '../useStopMetrics';
import { resolveDotSize } from '../../model/dotSize';
import { effectiveStationLabelStyle, stationIsSingleton } from '../../model/transforms';
import { sameCell } from '../inspector/stopGridDrag';
import { LayoutNodeHandle, type LayoutHandleState } from './LayoutNodeHandle';
import type { LayoutDragSource } from './useStationLayoutDrag';

/** Amber for the ghost lattice's origin, blue for selected — the projection
 *  anchor wins, since it says where the whole lattice came from and the blue
 *  only marks one node. */
const handleState = (isProjectionAnchor: boolean, isActive: boolean): LayoutHandleState =>
  isProjectionAnchor ? 'project' : isActive ? 'active' : 'idle';

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
  anchorCell: anchorCellProp = null,
  draggingSource = null,
}: {
  station: Station;
  lines: Record<string, Line>;
  onStartNodeDrag: (id: string, source: LayoutDragSource, e: React.PointerEvent) => void;
  /** The stop currently resolved as a swap drop target, if any. Both partners
   *  are painted by SwapPreview while it is set, so their handles stand down
   *  here. */
  swapTarget: { row: number; col: number; lineId: string } | null;
  /** The node the ghost grid is projected from, in station-local cells —
   *  highlighted so it's clear what a drop aligns to. */
  anchorCell?: { row: number; col: number } | null;
  /** The node being dragged right now — hidden here, since while the gesture is
   *  live it rides the cursor as ghosts + a true-size drop preview. */
  draggingSource?: LayoutDragSource | null;
}) {
  // Once the drop has resolved to a SWAP, the ghost lattice is gone and the
  // amber "the grid hangs off here" mark has nothing left to explain — it just
  // paints a third colour beside the two nodes actually trading places. No
  // gold anywhere in the swap case; SwapPreview says the whole story.
  const anchorCell = swapTarget ? null : anchorCellProp;
  const selection = useSelection();
  const rotateStop = useDoc((s) => s.rotateStop);
  const rotateLabel = useDoc((s) => s.rotateLabel);

  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;
  // Every handle here is drawn at a lattice CELL, so the editor turns with the
  // frame that resolves those cells — a bound station's ring, not its rounded
  // octant (see `stationFrameRad`), or the grab rings miss their own dots.
  const lineCircles = useDoc((s) => s.lineCircles);
  const angle = stationFrameDeg(station, stationCircle(station, lineCircles));
  // Singleton vs. shared picks each stop's split default (dot style + size);
  // it's a per-station property, so resolve it once for this editor.
  const isSingleton = stationIsSingleton(station);
  const metrics = useStopMetrics();
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
        // The dragged stop rides the cursor as ghosts + drop preview; hide the
        // static handle so it isn't painted in two places at once. Its swap
        // PARTNER hides for the same reason: SwapPreview paints it ghosted
        // back at the source cell, which is where it's headed.
        if (draggingSource?.kind === 'stop' && draggingSource.lineId === s.lineId) return null;
        if (swapTarget?.lineId === s.lineId) return null;
        const selected = selection.selectedStopLineId === s.lineId;
        const isAnchor = !!anchorCell && sameCell(anchorCell, s);
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
            <LayoutNodeHandle
              station={station}
              lines={lines}
              source={{ kind: 'stop', lineId: s.lineId as LineId }}
              cell={s}
              state={handleState(isAnchor, selected)}
              pointerEvents={inHandMode ? 'none' : 'all'}
            />
          </g>
        );
      })}

      {/* Transfer-anchor handles: the same grab ring as a stop, carrying the
          anchor mark instead of an orientation arrow (an anchor has no axis).
          Drags on the same ghost lattice as the label — a body-less point. */}
      {(station.transferAnchors ?? []).map((a) => {
        // The dragged anchor rides the cursor; hide its static handle.
        if (draggingSource?.kind === 'anchor' && draggingSource.anchorId === a.id) return null;
        const selected = selection.selectedAnchorCellId === a.id;
        const isAnchor = !!anchorCell && sameCell(anchorCell, a);
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
            <LayoutNodeHandle
              station={station}
              lines={lines}
              source={{ kind: 'anchor', anchorId: a.id }}
              cell={a}
              state={handleState(isAnchor, selected)}
              pointerEvents={inHandMode ? 'none' : 'all'}
            />
          </g>
        );
      })}

      {/* Label-cell handle. Marks the CELL anchor — the painted text may sit
          offset from it via offset/offsetPerp/align. */}
      {draggingSource?.kind !== 'label' &&
        (() => {
          const selected = selection.labelSelected;
          const isAnchor = !!anchorCell && sameCell(anchorCell, station.label);
          return (
            <g
              data-cell-kind="label"
              data-cell-row={station.label.row}
              data-cell-col={station.label.col}
              data-selected={selected || undefined}
              style={{ cursor: inHandMode ? undefined : 'grab' }}
              {...handleFor({ kind: 'label' })}
            >
              <LayoutNodeHandle
                station={station}
                lines={lines}
                source={{ kind: 'label' }}
                cell={station.label}
                state={handleState(isAnchor, selected)}
                pointerEvents={inHandMode ? 'none' : 'all'}
              />
            </g>
          );
        })()}
    </g>
  );
}
