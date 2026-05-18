import { useRef, useState } from 'react';
import type { StopOrientation } from '../../model/types';

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

// Display pitch (inspector-local pixels per unit in row/col space).
// Circle radius = pitch / 2 so two nodes at unit distance in (row, col) space
// are tangent — true for all 8 compass directions, including diagonals.
const PITCH = 22;
const RADIUS = PITCH / 2;
const DRAG_THRESHOLD_PX = 4;

// 8 angular offsets at distance 1 in (row, col) space. The 4 cardinals are
// integer steps; the 4 diagonals use ±√2/2 so the center distance stays 1
// (i.e. tangent), not √2 (corner-touch).
const HALF_SQRT2 = Math.SQRT1_2;
const SLOT_OFFSETS: { dRow: number; dCol: number }[] = [
  { dRow: -1, dCol: 0 }, // N
  { dRow: -HALF_SQRT2, dCol: HALF_SQRT2 }, // NE
  { dRow: 0, dCol: 1 }, // E
  { dRow: HALF_SQRT2, dCol: HALF_SQRT2 }, // SE
  { dRow: 1, dCol: 0 }, // S
  { dRow: HALF_SQRT2, dCol: -HALF_SQRT2 }, // SW
  { dRow: 0, dCol: -1 }, // W
  { dRow: -HALF_SQRT2, dCol: -HALF_SQRT2 }, // NW
];

// Overlap epsilon — a ghost slot is rejected if it would land within
// (1 - EPS) of any existing node (other than the source / anchor itself).
// Two nodes at exact unit distance are tangent, which is allowed.
const EPS = 1e-4;

// Bounding-box padding (in row/col units) so the viewBox always has room for
// ghost slots without reflowing when a drag starts. Ghosts are at most 1
// unit out from any anchor, and the anchor is always one of the existing
// nodes, so 1-unit padding covers every reachable ghost.
const VIEW_PAD = 1;

type DragSource =
  | { kind: 'stop'; lineId: string; row: number; col: number }
  | { kind: 'label'; row: number; col: number };

type TargetKind = 'ghost' | 'stop' | 'label';

type DragTarget = { row: number; col: number; kind: TargetKind };

type DragState = {
  source: DragSource;
  startX: number;
  startY: number;
  isDragging: boolean;
  // Cursor position in (row, col) space. Tracked once isDragging crosses the
  // threshold — drives the "nearest non-source node = anchor" computation.
  cursor: { row: number; col: number } | null;
  over: DragTarget | null;
};

const dist = (a: { row: number; col: number }, b: { row: number; col: number }): number =>
  Math.hypot(a.row - b.row, a.col - b.col);

const sameCell = (a: { row: number; col: number }, b: { row: number; col: number }): boolean =>
  Math.abs(a.row - b.row) < EPS && Math.abs(a.col - b.col) < EPS;

const fmt = (n: number) => n.toFixed(6);

const isValidTarget = (sourceKind: 'stop' | 'label', target: TargetKind): boolean => {
  if (target === 'ghost') return true;
  if (target === 'label') return false;
  return sourceKind === 'stop';
};

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
  const stops = station.stops;
  const label = station.label;

  const sourceCell = drag ? { row: drag.source.row, col: drag.source.col } : null;

  const nodesAll: { row: number; col: number; kind: 'stop' | 'label' }[] = [
    ...stops.map((s) => ({ row: s.row, col: s.col, kind: 'stop' as const })),
    { row: label.row, col: label.col, kind: 'label' as const },
  ];
  // Non-source nodes — these are the candidates for "the anchor" and the
  // things ghost slots must not overlap.
  const otherNodes = sourceCell ? nodesAll.filter((n) => !sameCell(n, sourceCell)) : nodesAll;

  // Anchor = nearest non-source node to the cursor (only while dragging).
  // Nothing renders ghosts when not dragging.
  let anchor: { row: number; col: number; kind: 'stop' | 'label' } | null = null;
  if (drag?.isDragging && drag.cursor && otherNodes.length > 0) {
    let best = Infinity;
    for (const n of otherNodes) {
      const d = dist(drag.cursor, n);
      if (d < best) {
        best = d;
        anchor = n;
      }
    }
  }

  // 8 ghost slots around the anchor, minus ones that would overlap another
  // non-source non-anchor node. Tangent positions (distance == 1) are allowed.
  const ghosts: { row: number; col: number }[] = [];
  if (anchor) {
    for (const o of SLOT_OFFSETS) {
      const g = { row: anchor.row + o.dRow, col: anchor.col + o.dCol };
      let overlap = false;
      for (const n of otherNodes) {
        if (sameCell(n, anchor)) continue;
        if (dist(g, n) < 1 - EPS) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      ghosts.push(g);
    }
  }

  // ViewBox: padded bounding box of the static nodes (not ghosts). Constant
  // 1-unit padding means viewBox never changes during drag → no jitter.
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

  // Rotation-tolerant outer wrapper — keeps the inspector controls below from
  // reflowing when station.rotation changes (every 45° step).
  const wrapSize = Math.max(vbW, vbH, (vbW + vbH) * Math.SQRT1_2);
  const angleDeg = station.rotation * 45;

  // Convert client (screen) coords to (row, col) in our SVG's local frame.
  // Uses getScreenCTM so the wrapper's CSS rotate(...) is accounted for.
  const cursorRowCol = (clientX: number, clientY: number): { row: number; col: number } | null => {
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
    setDrag({
      source,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      cursor: null,
      over: null,
    });
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const isDragging = drag.isDragging || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
    const cursor = isDragging ? cursorRowCol(e.clientX, e.clientY) : null;
    let over: DragTarget | null = null;
    if (isDragging) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
      const cellEl = el?.closest('[data-cell-row]') as Element | null;
      if (cellEl) {
        const ds = (cellEl as HTMLElement).dataset;
        const tRow = Number(ds.cellRow);
        const tCol = Number(ds.cellCol);
        const tKind = ds.cellKind as TargetKind | undefined;
        if (tKind && isValidTarget(drag.source.kind, tKind)) {
          const isSelf =
            drag.source.kind === 'stop'
              ? tKind === 'stop' && ds.lineId === drag.source.lineId
              : tKind === 'label';
          if (!isSelf) over = { row: tRow, col: tCol, kind: tKind };
        }
      }
    }
    if (
      isDragging !== drag.isDragging ||
      cursor?.row !== drag.cursor?.row ||
      cursor?.col !== drag.cursor?.col ||
      over?.row !== drag.over?.row ||
      over?.col !== drag.over?.col ||
      over?.kind !== drag.over?.kind
    ) {
      setDrag({ ...drag, isDragging, cursor, over });
    }
  };

  const onSvgPointerUp = () => {
    if (!drag) return;
    if (drag.isDragging) {
      if (drag.over) {
        const dRow = drag.over.row - drag.source.row;
        const dCol = drag.over.col - drag.source.col;
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

        {/* Ghost slots — only rendered while dragging, around the anchor. */}
        {ghosts.map((g) => {
          const isOver =
            drag?.over?.kind === 'ghost' &&
            Math.abs(drag.over.row - g.row) < EPS &&
            Math.abs(drag.over.col - g.col) < EPS;
          return (
            <circle
              key={`g-${fmt(g.row)},${fmt(g.col)}`}
              data-cell-row={g.row}
              data-cell-col={g.col}
              data-cell-kind="ghost"
              cx={g.col * PITCH}
              cy={g.row * PITCH}
              r={RADIUS - 1}
              fill={isOver ? 'rgba(26,78,168,0.18)' : 'rgba(255,255,255,0.75)'}
              stroke={isOver ? '#1a4ea8' : 'rgba(0,0,0,0.35)'}
              strokeWidth={isOver ? 2 : 1.25}
              strokeDasharray={isOver ? undefined : '3 2'}
            />
          );
        })}

        {/* Stops */}
        {stops.map((s) => {
          const line = lines[s.lineId];
          const selected = selectedLineId === s.lineId;
          const isSource = drag?.source.kind === 'stop' && drag.source.lineId === s.lineId;
          const isSwapTarget =
            drag?.over?.kind === 'stop' &&
            Math.abs(drag.over.row - s.row) < EPS &&
            Math.abs(drag.over.col - s.col) < EPS;
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
            it. Stroke-only (no fill) so the anchor's color stays visible
            underneath the ring. Dark thin pair around the white ring keeps it
            legible on both light and dark backgrounds. */}
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
