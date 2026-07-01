import { useEffect, useRef, useState } from 'react';
import type { StopOrientation } from '../../model/types';
import { STOP_SIZE, type Rotation } from '../../geometry/orientation';
import type { RowCol, LatticeBasis } from '../../geometry/lattice';
import { lineWidthOf } from '../../model/lineWidth';
import {
  computeGhosts,
  findDropTarget,
  nearestNode,
  sameCell,
  CELL_EPS as EPS,
  PITCH,
} from './stopGridDrag';
export { PITCH } from './stopGridDrag';

type GridStation = {
  rotation: number;
  stops: { lineId: string; row: number; col: number; orientation: StopOrientation }[];
  label: { row: number; col: number; rotation: number };
};

type GridLines = Record<string, { color: string; service: string; width?: number }>;

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

// Padding (in row/col units) so the viewBox always has room for any
// reachable ghost regardless of drag mode. The diagonal lattice's farthest
// points are at GRID_RADIUS · √2 along the cardinal axes.
const VIEW_PAD = Math.ceil(GRID_RADIUS * Math.SQRT2);

// Cursor-to-ghost snap radius (in row/col units). Inside this radius the
// nearest ghost wins; outside, no drop target. NOT scaled with line width:
// at pair-tangency factors above ~2 (a textbox width beyond 42 against a
// default-width anchor) the midpoint between ring-1 ghosts falls outside
// this radius, leaving small dead zones — accepted; the ghosts themselves
// remain reachable.
const GHOST_SNAP_RADIUS = 1.0;
// Cursor-to-stop swap radius for a DEFAULT-width stop — must be physically
// on the stop circle to register a swap (so a tangent ghost right next to a
// stop doesn't get hijacked by a distant cursor). Wider stops scale this via
// findDropTarget's swapRadiusFor (their circles draw bigger).
const STOP_SWAP_RADIUS = 0.6;

// --- Camera (pan / zoom) ---
// The editor is a local mini-canvas: content is drawn at the fixed PITCH and
// the camera is applied as a CSS transform on the SVG. getScreenCTM() (already
// used by cursorRowCol) folds pan + zoom + rotation into one matrix, so the
// drag/ghost/snap math needs no changes — only the view does.
const EDITOR_HEIGHT = 240;
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 16;
// Don't over-zoom a tiny station when fitting (a lone stop shouldn't fill the
// pane).
const FIT_MAX = 4;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

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
  lines: GridLines;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [shiftHeld, setShiftHeld] = useShiftHeld(!!drag?.isDragging);
  // Camera: panX/panY are screen pixels, zoom is a multiplier on the fixed
  // PITCH rendering. Applied as a CSS transform on the SVG below.
  const [cam, setCam] = useState({ panX: 0, panY: 0, zoom: 1 });
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{
    sx: number;
    sy: number;
    px: number;
    py: number;
    moved: boolean;
  } | null>(null);
  const stops = station.stops;
  const label = station.label;

  // Effective world width of a node: a stop's is its line's width; the label
  // cell stays unit-sized. Drives node circle radii, ghost tangency, and
  // overlap filtering so the editor mirrors the canvas's touching-stripes
  // semantics.
  const nodeW = (n: { kind: 'stop' | 'label'; lineId?: string }): number =>
    n.kind === 'label' ? STOP_SIZE : lineWidthOf(lines[n.lineId!]);
  const nodeR = (n: { kind: 'stop' | 'label'; lineId?: string }): number =>
    (nodeW(n) / STOP_SIZE) * RADIUS;

  const sourceCell = drag ? { row: drag.source.row, col: drag.source.col } : null;

  const nodesAll: { row: number; col: number; kind: 'stop' | 'label'; lineId?: string }[] = [
    ...stops.map((s) => ({ row: s.row, col: s.col, kind: 'stop' as const, lineId: s.lineId })),
    { row: label.row, col: label.col, kind: 'label' as const },
  ];
  // Non-source nodes — candidates for "anchor" and the things ghost slots
  // must not collide with.
  const otherNodes = sourceCell ? nodesAll.filter((n) => !sameCell(n, sourceCell)) : nodesAll;

  // Anchor = nearest non-source node to the cursor (only while dragging).
  const anchor = drag?.isDragging && drag.cursor ? nearestNode(drag.cursor, otherNodes) : null;

  // The dragged node's own width (label drags as a unit cell).
  const wSrc = drag?.source.kind === 'stop' ? lineWidthOf(lines[drag.source.lineId]) : STOP_SIZE;
  // Radius the dragged node will draw at, so the blue drop-preview matches the
  // size (line width) of the item that will actually land there.
  const dragR = (wSrc / STOP_SIZE) * RADIUS;

  // Ghost lattice generated in SCREEN frame and projected into the SVG's
  // local frame (see computeGhosts): orthogonal basis paints as on-screen
  // cardinals + integer diagonals; diagonal basis as on-screen tangent-
  // diagonals. The two lattices are disjoint in SCREEN frame — the user
  // picks the complementary placement set they need by toggling Shift.
  const stationRotation = (station.rotation % 8) as Rotation;
  const basis: LatticeBasis = shiftHeld ? 'diagonal' : 'orthogonal';
  const ghosts: RowCol[] = anchor
    ? computeGhosts({
        wSrc,
        anchor: { row: anchor.row, col: anchor.col, w: nodeW(anchor) },
        otherNodes: otherNodes.map((n) => ({ row: n.row, col: n.col, w: nodeW(n) })),
        basis,
        stationRotation,
        gridRadius: GRID_RADIUS,
      })
    : [];

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
          {
            swapRadius: STOP_SWAP_RADIUS,
            snapRadius: GHOST_SNAP_RADIUS,
            // Wider stops draw bigger circles; "on the circle" scales with
            // them (default-width stops reproduce STOP_SWAP_RADIUS exactly:
            // 14/(2·14) + 0.1 = 0.6).
            swapRadiusFor: (s) => lineWidthOf(lines[s.lineId]) / (2 * STOP_SIZE) + 0.1,
          },
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
    // Keep the press from bubbling to the container's pan handler — grabbing a
    // stop is a drag, not a pan.
    e.stopPropagation();
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
    // cursor is a continuous float (px / PITCH); compare with the same EPS
    // tolerance as sameCell so same-cell sub-pixel moves short-circuit instead
    // of re-rendering on every pointermove. (Guard the null<->set transitions.)
    const cursorChanged =
      !cursor !== !drag.cursor || (!!cursor && !!drag.cursor && !sameCell(cursor, drag.cursor));
    if (isDragging !== drag.isDragging || cursorChanged) {
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

  // --- Camera helpers (fit / wheel-zoom / pan) ---
  // Frame all content with a small margin, clamped so a tiny station doesn't
  // balloon. `wrapSize` already accounts for the rotation-tolerant bounding
  // square, so the fit holds at any station rotation.
  const fitView = () => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const z = clampZoom(Math.min((Math.min(r.width, r.height) / wrapSize) * 0.9, FIT_MAX));
    setCam({ panX: 0, panY: 0, zoom: z });
  };

  // Fit on mount. StationInspector keys StopGrid by station id, so the camera
  // resets per station. Retries a few frames in case layout isn't measured yet.
  useEffect(() => {
    let raf = 0;
    const attempt = (n: number) => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        fitView();
        return;
      }
      if (n < 5 && typeof requestAnimationFrame !== 'undefined') {
        raf = requestAnimationFrame(() => attempt(n + 1));
      }
    };
    attempt(0);
    return () => {
      if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wheel zooms toward the cursor: keep the world point under the pointer fixed
  // by re-deriving pan from the zoom ratio. Pure screen-pixel math — rotation
  // cancels because the cursor's screen position is held constant.
  //
  // Attached as a NON-PASSIVE native listener rather than React's onWheel:
  // React registers wheel at the root passively, so preventDefault() there is a
  // no-op and the surrounding sidebar/station list scrolls. A native
  // { passive: false } listener lets preventDefault actually take effect.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const relX = e.clientX - (r.left + r.width / 2);
      const relY = e.clientY - (r.top + r.height / 2);
      const factor = Math.exp(-e.deltaY * 0.0015);
      setCam((c) => {
        const zoom = clampZoom(c.zoom * factor);
        const k = zoom / c.zoom;
        return { zoom, panX: relX * (1 - k) + c.panX * k, panY: relY * (1 - k) + c.panY * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Pan starts on an empty-space press: stop/label presses stopPropagation, so
  // this only fires off the background. Capture on the container so the pan
  // keeps tracking when the cursor leaves the editor.
  const onContainerPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (drag) return;
    if (e.button === 1) e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
    panRef.current = { sx: e.clientX, sy: e.clientY, px: cam.panX, py: cam.panY, moved: false };
    setPanning(true);
  };

  const onContainerPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (!p.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) p.moved = true;
    setCam((c) => ({ ...c, panX: p.px + dx, panY: p.py + dy }));
  };

  const onContainerPointerUp = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    const moved = p.moved;
    panRef.current = null;
    setPanning(false);
    try {
      containerRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    // A press-release with no movement on empty space deselects. (The captured
    // gesture retargets the trailing click to the container, so the inner bg
    // <rect> onClick only fires for synthetic clicks — e.g. in unit tests.)
    if (!moved) onSelectStop(null);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      onPointerCancel={onContainerPointerUp}
      style={{
        position: 'relative',
        width: '100%',
        height: EDITOR_HEIGHT,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(128, 128, 128, 0.3)',
        borderRadius: 6,
        touchAction: 'none',
        cursor: panning ? 'grabbing' : 'grab',
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        width={vbW}
        height={vbH}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onPointerCancel={onSvgPointerCancel}
        style={{
          flex: 'none',
          transform: `translate(${cam.panX}px, ${cam.panY}px) scale(${cam.zoom}) rotate(${angleDeg}deg)`,
          transformOrigin: 'center center',
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
                r={dragR}
                fill="rgba(26,78,168,0.18)"
                stroke="#1a4ea8"
                strokeWidth={2}
                pointerEvents="none"
              />
            );
          }
          // The unsnapped dots are pure UI markers, not content — divide
          // their radius/stroke by the camera zoom so they stay a constant
          // size on screen regardless of how far the view is zoomed.
          return (
            <circle
              key={`g-${fmt(g.row)},${fmt(g.col)}`}
              cx={g.col * PITCH}
              cy={g.row * PITCH}
              r={3 / cam.zoom}
              fill="rgba(255,255,255,0.85)"
              stroke="rgba(0,0,0,0.4)"
              strokeWidth={1.25 / cam.zoom}
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
          const r = nodeR({ kind: 'stop', lineId: s.lineId });
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
                r={r}
                fill={line?.color ?? '#888'}
                stroke={selected ? '#000' : isSwapTarget ? '#1a4ea8' : 'rgba(0,0,0,0.2)'}
                strokeWidth={selected || isSwapTarget ? 2 : 1}
              />
              <text
                x={s.col * PITCH}
                y={s.row * PITCH}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={r}
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
              r={nodeR(anchor) + 1.5}
              fill="none"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={3}
            />
            <circle
              cx={anchor.col * PITCH}
              cy={anchor.row * PITCH}
              r={nodeR(anchor) + 1.5}
              fill="none"
              stroke="#fff"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          fitView();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Fit to contents"
        aria-label="Fit to contents"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          padding: '2px 7px',
          fontSize: 11,
          lineHeight: 1.4,
          color: 'inherit',
          background: 'rgba(127, 127, 127, 0.18)',
          border: '1px solid rgba(128, 128, 128, 0.35)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Fit
      </button>
    </div>
  );
}
