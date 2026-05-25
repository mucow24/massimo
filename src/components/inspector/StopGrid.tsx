import { useEffect, useRef, useState } from 'react';
import type { StopOrientation } from '../../model/types';
import type { Rotation } from '../../geometry/orientation';
import {
  latticeOffsets,
  projectScreenToLocal,
  type RowCol,
  type LatticeBasis,
} from '../../geometry/lattice';
import { findDropTarget, nearestNode, PITCH } from './stopGridDrag';
export { PITCH } from './stopGridDrag';

type GridStation = {
  rotation: number;
  stops: { lineId: string; row: number; col: number; orientation: StopOrientation }[];
  label: { row: number; col: number; rotation: number };
};

const ORIENTATION_GLYPH: Record<StopOrientation, string> = {
  'auto-vertical': '↕',
  'auto-ne-sw': '⤢',
  'auto-horizontal': '↔',
  'auto-nw-se': '⤡',
};

const RADIUS = PITCH / 2;
const DRAG_THRESHOLD_PX = 4;

// How far the lattice extends from the anchor in each axis. 24 candidate
// positions per mode at GRID_RADIUS = 2.
const GRID_RADIUS = 2;

// Floating-point epsilon for cell-equality comparisons (row/col are not
// integer — diagonals use ±√2/2).
const EPS = 1e-4;

// Padding (in row/col units) so the viewBox always has room for any
// reachable ghost regardless of drag mode. The diagonal lattice's farthest
// points are at GRID_RADIUS · √2 along the cardinal axes.
const VIEW_PAD = Math.ceil(GRID_RADIUS * Math.SQRT2);

// Cursor-to-ghost snap radius (in row/col units). Inside this radius the
// nearest ghost wins; outside, no drop target.
const GHOST_SNAP_RADIUS = 1.0;
// Cursor-to-stop swap radius — must be physically on the stop circle to
// register a swap (so a tangent ghost right next to a stop doesn't get
// hijacked by a distant cursor).
const STOP_SWAP_RADIUS = 0.6;

type DragSource =
  | { kind: 'stop'; lineId: string; row: number; col: number }
  | { kind: 'label'; row: number; col: number };

type DragState = {
  source: DragSource;
  startX: number;
  startY: number;
  isDragging: boolean;
  // Cursor in (row, col) space — populated once the drag threshold is crossed.
  cursor: RowCol | null;
};

const sameCell = (a: RowCol, b: RowCol): boolean =>
  Math.abs(a.row - b.row) < EPS && Math.abs(a.col - b.col) < EPS;

const fmt = (n: number) => n.toFixed(6);

/**
 * Track whether Shift is held, gated on an `active` flag (typically
 * `drag.isDragging`). Listens at the window level so toggles register even
 * when the cursor leaves the editor. Returns the live state and a setter so
 * callers can also seed it from pointer events (`e.shiftKey`) — important
 * because if Shift was already held when the drag started, no fresh
 * keydown fires after the listeners attach.
 */
function useShiftHeld(active: boolean): [boolean, (v: boolean) => void] {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) return;
    const sync = (e: KeyboardEvent) => setHeld(e.shiftKey);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      setHeld(false);
    };
  }, [active]);
  return [held, setHeld];
}

export function StopGrid({
  station,
  lines,
  selectedLineId,
  labelSelected,
  onSelectStop,
  onSelectLabel,
  onRotateStop,
  onRotateLabel,
  onMoveStop,
  onMoveLabel,
}: {
  station: GridStation;
  lines: Record<string, { color: string; service: string }>;
  selectedLineId: string | null;
  labelSelected: boolean;
  onSelectStop: (lineId: string | null) => void;
  onSelectLabel: () => void;
  onRotateStop: (lineId: string) => void;
  onRotateLabel: () => void;
  onMoveStop: (lineId: string, dRow: number, dCol: number) => void;
  onMoveLabel: (dRow: number, dCol: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [shiftHeld, setShiftHeld] = useShiftHeld(!!drag?.isDragging);
  const stops = station.stops;
  const label = station.label;

  const sourceCell = drag ? { row: drag.source.row, col: drag.source.col } : null;

  const nodesAll: { row: number; col: number; kind: 'stop' | 'label' }[] = [
    ...stops.map((s) => ({ row: s.row, col: s.col, kind: 'stop' as const })),
    { row: label.row, col: label.col, kind: 'label' as const },
  ];
  // Non-source nodes — candidates for "anchor" and the things ghost slots
  // must not collide with.
  const otherNodes = sourceCell ? nodesAll.filter((n) => !sameCell(n, sourceCell)) : nodesAll;

  // Anchor = nearest non-source node to the cursor (only while dragging).
  const anchor = drag?.isDragging && drag.cursor ? nearestNode(drag.cursor, otherNodes) : null;

  // Generate the ghost lattice in SCREEN frame and project into the SVG's
  // local frame via the inverse of the station's rotation.
  //
  // Orthogonal basis paints as on-screen cardinals + integer diagonals
  // (corner-touch with a √2 gap); diagonal basis paints as on-screen
  // tangent-diagonals + √2-distance cardinals. The two lattices are
  // disjoint in SCREEN frame — the user picks the complementary placement
  // set they need by toggling Shift.
  //
  // Generating in screen frame (and projecting to local) keeps the user-
  // facing behavior identical at any station rotation; the alternative —
  // picking the basis based on rotation parity — was a hack that only
  // worked for multiples of 45°.
  const stationRotation = (station.rotation % 8) as Rotation;
  const basis: LatticeBasis = shiftHeld ? 'diagonal' : 'orthogonal';
  const ghosts: RowCol[] = [];
  if (anchor) {
    const localOffsets = projectScreenToLocal(latticeOffsets(basis, GRID_RADIUS), stationRotation);
    for (const o of localOffsets) {
      const g = { row: anchor.row + o.row, col: anchor.col + o.col };
      let overlap = false;
      for (const n of otherNodes) {
        if (sameCell(n, anchor)) continue;
        // Ghosts at distance < 1 from any other node overlap visually.
        // Tangent (distance == 1) is allowed.
        if (Math.hypot(g.row - n.row, g.col - n.col) < 1 - EPS) {
          overlap = true;
          break;
        }
      }
      if (!overlap) ghosts.push(g);
    }
  }

  // Resolve cursor → snap/swap target via the shared rule (swap on a non-
  // source stop inside swapRadius wins; otherwise nearest ghost inside
  // snapRadius wins).
  const over =
    drag?.isDragging && drag.cursor
      ? findDropTarget(
          drag.cursor,
          drag.source.kind === 'stop'
            ? { kind: 'stop', lineId: drag.source.lineId }
            : { kind: 'label' },
          stops,
          ghosts,
          { swapRadius: STOP_SWAP_RADIUS, snapRadius: GHOST_SNAP_RADIUS },
        )
      : null;

  // ViewBox padding handles every reachable ghost regardless of mode.
  const rows = nodesAll.map((c) => c.row);
  const cols = nodesAll.map((c) => c.col);
  const minRow = Math.min(...rows) - VIEW_PAD;
  const maxRow = Math.max(...rows) + VIEW_PAD;
  const minCol = Math.min(...cols) - VIEW_PAD;
  const maxCol = Math.max(...cols) + VIEW_PAD;
  const vbX = (minCol - 0.5) * PITCH;
  const vbY = (minRow - 0.5) * PITCH;
  const vbW = (maxCol - minCol + 1) * PITCH;
  const vbH = (maxRow - minRow + 1) * PITCH;

  // Rotation-tolerant outer wrapper — controls below the editor don't reflow
  // when station.rotation changes (every 45° step).
  const wrapSize = Math.max(vbW, vbH, (vbW + vbH) * Math.SQRT1_2);
  const angleDeg = station.rotation * 45;

  // Convert screen coords → SVG user-coords → (row, col). Accounts for the
  // CSS rotation on the SVG wrapper via getScreenCTM.
  const cursorRowCol = (clientX: number, clientY: number): RowCol | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const sp = pt.matrixTransform(ctm.inverse());
    return { row: sp.y / PITCH, col: sp.x / PITCH };
  };

  const startDrag = (e: React.PointerEvent, source: DragSource) => {
    svgRef.current?.setPointerCapture(e.pointerId);
    // Seed shiftHeld from the pointer event — if Shift is already held when
    // the drag begins, no keydown fires after our listeners attach, so we'd
    // otherwise miss it.
    setShiftHeld(e.shiftKey);
    setDrag({
      source,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      cursor: null,
    });
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const isDragging = drag.isDragging || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
    const cursor = isDragging ? cursorRowCol(e.clientX, e.clientY) : null;
    // Re-read shift on every move — handles the case where the user pressed
    // Shift before starting the drag (no keydown to catch).
    if (e.shiftKey !== shiftHeld) setShiftHeld(e.shiftKey);
    if (
      isDragging !== drag.isDragging ||
      cursor?.row !== drag.cursor?.row ||
      cursor?.col !== drag.cursor?.col
    ) {
      setDrag({ ...drag, isDragging, cursor });
    }
  };

  const onSvgPointerUp = () => {
    if (!drag) return;
    if (drag.isDragging) {
      if (over) {
        const dRow = over.row - drag.source.row;
        const dCol = over.col - drag.source.col;
        if (Math.abs(dRow) > EPS || Math.abs(dCol) > EPS) {
          if (drag.source.kind === 'stop') onMoveStop(drag.source.lineId, dRow, dCol);
          else onMoveLabel(dRow, dCol);
        }
      }
    } else {
      if (drag.source.kind === 'stop') onSelectStop(drag.source.lineId);
      else onSelectLabel();
    }
    setDrag(null);
  };

  const onSvgPointerCancel = () => setDrag(null);

  return (
    <div style={{ position: 'relative', width: wrapSize, height: wrapSize }}>
      <svg
        ref={svgRef}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        width={vbW}
        height={vbH}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onPointerCancel={onSvgPointerCancel}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
          overflow: 'visible',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* Background — clicks deselect. */}
        <rect
          x={vbX}
          y={vbY}
          width={vbW}
          height={vbH}
          fill="transparent"
          onClick={() => {
            if (!drag) onSelectStop(null);
          }}
        />

        {/* Ghost slots. Same small-dot style in both modes; the snapped one
            (cursor's nearest) gets a prominent ring with fill so the user
            sees exactly where the drop will land. */}
        {ghosts.map((g) => {
          const isOver =
            over?.kind === 'ghost' &&
            Math.abs(over.row - g.row) < EPS &&
            Math.abs(over.col - g.col) < EPS;
          if (isOver) {
            return (
              <circle
                key={`g-${fmt(g.row)},${fmt(g.col)}`}
                cx={g.col * PITCH}
                cy={g.row * PITCH}
                r={RADIUS - 1}
                fill="rgba(26,78,168,0.18)"
                stroke="#1a4ea8"
                strokeWidth={2}
                pointerEvents="none"
              />
            );
          }
          return (
            <circle
              key={`g-${fmt(g.row)},${fmt(g.col)}`}
              cx={g.col * PITCH}
              cy={g.row * PITCH}
              r={3}
              fill="rgba(255,255,255,0.85)"
              stroke="rgba(0,0,0,0.4)"
              strokeWidth={1.25}
              pointerEvents="none"
            />
          );
        })}

        {/* Stops */}
        {stops.map((s) => {
          const line = lines[s.lineId];
          const selected = selectedLineId === s.lineId;
          const isSource = drag?.source.kind === 'stop' && drag.source.lineId === s.lineId;
          const isSwapTarget =
            over?.kind === 'stop' &&
            Math.abs(over.row - s.row) < EPS &&
            Math.abs(over.col - s.col) < EPS;
          return (
            <g
              key={`s-${s.lineId}`}
              data-cell-row={s.row}
              data-cell-col={s.col}
              data-cell-kind="stop"
              data-line-id={s.lineId}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                startDrag(e, { kind: 'stop', lineId: s.lineId, row: s.row, col: s.col });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelectStop(s.lineId);
                onRotateStop(s.lineId);
              }}
              style={{
                cursor: isSource && drag?.isDragging ? 'grabbing' : 'grab',
                opacity: isSource && drag?.isDragging ? 0.4 : 1,
              }}
            >
              <circle
                cx={s.col * PITCH}
                cy={s.row * PITCH}
                r={RADIUS}
                fill={line?.color ?? '#888'}
                stroke={selected ? '#000' : isSwapTarget ? '#1a4ea8' : 'rgba(0,0,0,0.2)'}
                strokeWidth={selected || isSwapTarget ? 2 : 1}
              />
              <text
                x={s.col * PITCH}
                y={s.row * PITCH}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fontWeight={700}
                fill="#fff"
                style={{
                  pointerEvents: 'none',
                  userSelect: 'none',
                  textShadow: '0 0 2px rgba(0,0,0,0.6)',
                }}
              >
                {ORIENTATION_GLYPH[s.orientation]}
              </text>
              <title>{`${line?.service ?? ''} at (${s.row.toFixed(3)}, ${s.col.toFixed(3)}) ${s.orientation}`}</title>
            </g>
          );
        })}

        {/* Label */}
        {(() => {
          const isSource = drag?.source.kind === 'label';
          return (
            <g
              data-cell-row={label.row}
              data-cell-col={label.col}
              data-cell-kind="label"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                startDrag(e, { kind: 'label', row: label.row, col: label.col });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelectLabel();
                onRotateLabel();
              }}
              transform={`rotate(${label.rotation * 45} ${label.col * PITCH} ${label.row * PITCH})`}
              style={{
                cursor: isSource && drag?.isDragging ? 'grabbing' : 'grab',
                opacity: isSource && drag?.isDragging ? 0.4 : 1,
              }}
            >
              <circle
                cx={label.col * PITCH}
                cy={label.row * PITCH}
                r={RADIUS}
                fill="#fff"
                stroke={labelSelected ? '#000' : 'rgba(0,0,0,0.4)'}
                strokeWidth={labelSelected ? 2 : 1}
              />
              <text
                x={label.col * PITCH}
                y={label.row * PITCH}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fontWeight={700}
                fill="#222"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                L
              </text>
              <title>{`Label at (${label.row.toFixed(3)}, ${label.col.toFixed(3)}) rot ${label.rotation * 45}°`}</title>
            </g>
          );
        })()}

        {/* Anchor highlight — rendered LAST so it sits on top of any
            neighboring stops/labels that would otherwise overlap and obscure
            it. Stroke-only ring (no fill) keeps the anchor's color visible. */}
        {anchor && (
          <g pointerEvents="none">
            <circle
              cx={anchor.col * PITCH}
              cy={anchor.row * PITCH}
              r={RADIUS + 1.5}
              fill="none"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={3}
            />
            <circle
              cx={anchor.col * PITCH}
              cy={anchor.row * PITCH}
              r={RADIUS + 1.5}
              fill="none"
              stroke="#fff"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
