import { useEffect, useMemo, useRef, useState } from 'react';

// Pick black or white text for legibility against an arbitrary hex bg.
// Uses the W3C relative-luminance formula.
function legibleTextOn(hex: string): string {
  const m = hex.replace('#', '');
  const v = m.length === 3
    ? [m[0] + m[0], m[1] + m[1], m[2] + m[2]]
    : [m.slice(0, 2), m.slice(2, 4), m.slice(4, 6)];
  const [r, g, b] = v.map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.5 ? '#000' : '#fff';
}
import { dragState, useDoc, useSelection } from '../state/store';
import { Station, StationId, StopCell } from '../state/types';
import { buildBands, buildStopMarkers, SegmentBandSpec, StopMarkerSpec } from '../geometry/interlining';
import { SegmentBand } from './SegmentBand';
import { StationView } from './StationView';
import { Vec2 } from '../geometry/vec';
import { STOP_SIZE, rotateBy, stopCenterAt, travelDirLocal, Rotation } from '../geometry/orientation';

const SQRT2_2 = Math.SQRT2 / 2;
const SNAP_PERP_TOLERANCE = 10;

// The "axis" a station's input/output line lies on. Two stations share an
// axis iff their rotation values are equal mod 4.
function axisForRotation(rot: number): Vec2 {
  switch (rot % 4) {
    case 0:
      return { x: 0, y: 1 };
    case 1:
      return { x: SQRT2_2, y: -SQRT2_2 }; // NE–SW
    case 2:
      return { x: 1, y: 0 };
    default:
      return { x: SQRT2_2, y: SQRT2_2 }; // NW–SE
  }
}

const TIGHT_PERP_TOLERANCE = 0.5;

// Build alignment pairs between the dragged station and a target. Each pair
// carries:
//   dOff/tOff: world-rotation offsets (anchor → stop center) on each station
//   axis:      world unit vector along which the line through both stops runs
//
// For shared-line pairs the axis is the world travel direction at that stop —
// derived from per-stop orientation rotated by station rotation. The two stops
// must share a world axis (parallel travel directions) to qualify.
//
// When neither station has stops, fall back to anchor-to-anchor on the
// dragged station's rotation axis. When only one side has stops or no line
// is shared, no pairs are emitted and that target won't snap.
type AlignmentPair = { dOff: Vec2; tOff: Vec2; axis: Vec2 };

function alignmentPairs(
  draggedRotation: Rotation,
  draggedStops: StopCell[],
  target: Station,
): AlignmentPair[] {
  if (draggedStops.length === 0 && target.stops.length === 0) {
    return [
      { dOff: { x: 0, y: 0 }, tOff: { x: 0, y: 0 }, axis: axisForRotation(draggedRotation) },
    ];
  }
  const out: AlignmentPair[] = [];
  for (const dCell of draggedStops) {
    const tCell = target.stops.find((c) => c.lineId === dCell.lineId);
    if (!tCell) continue;
    const dWorldDir = rotateBy(travelDirLocal(dCell.orientation), draggedRotation);
    const tWorldDir = rotateBy(travelDirLocal(tCell.orientation), target.rotation);
    if (!parallel(dWorldDir, tWorldDir)) continue;
    out.push({
      dOff: rotateBy(stopCenterAt(dCell.row, dCell.col), draggedRotation),
      tOff: rotateBy(stopCenterAt(tCell.row, tCell.col), target.rotation),
      axis: dWorldDir,
    });
  }
  return out;
}

function parallel(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x * b.y - a.y * b.x) < 1e-3;
}

interface SnapGuide {
  from: Vec2;
  to: Vec2;
}

function tryAxisSnap(
  draggedId: StationId,
  proposedX: number,
  proposedY: number,
  draggedRotation: Rotation,
  draggedStops: StopCell[],
  stations: Record<StationId, Station>,
  tolerance: number,
): {
  x: number;
  y: number;
  guides: SnapGuide[];
} {
  type Cand = {
    target: Station;
    dOff: Vec2;
    tOff: Vec2;
    axis: Vec2;
    perpDist: number;
    targetStopX: number;
    targetStopY: number;
  };

  // Collect every alignment pair within perp tolerance.
  const all: Cand[] = [];
  for (const t of Object.values(stations)) {
    if (t.id === draggedId) continue;
    for (const pair of alignmentPairs(draggedRotation, draggedStops, t)) {
      const perpX = -pair.axis.y;
      const perpY = pair.axis.x;
      const tStopX = t.x + pair.tOff.x;
      const tStopY = t.y + pair.tOff.y;
      const dStopX = proposedX + pair.dOff.x;
      const dStopY = proposedY + pair.dOff.y;
      const dx = tStopX - dStopX;
      const dy = tStopY - dStopY;
      const perpDist = Math.abs(dx * perpX + dy * perpY);
      if (perpDist > tolerance) continue;
      all.push({
        target: t,
        dOff: pair.dOff,
        tOff: pair.tOff,
        axis: pair.axis,
        perpDist,
        targetStopX: tStopX,
        targetStopY: tStopY,
      });
    }
  }

  if (all.length === 0) {
    return { x: proposedX, y: proposedY, guides: [] };
  }

  // Consolidate interlined candidates: lines that share the same target
  // station AND the same axis (e.g., all the lines of an interlined band)
  // get merged into a single band-level candidate using the mean of their
  // dOffs/tOffs. Without this, each shared line individually crosses the
  // perp tolerance at a slightly different drag position and the user sees
  // several alignment "clicks" instead of one band-wide snap.
  const targetAxisGroups: Cand[][] = [];
  for (const c of all) {
    const g = targetAxisGroups.find(
      (grp) => grp[0].target.id === c.target.id && parallel(grp[0].axis, c.axis),
    );
    if (g) g.push(c);
    else targetAxisGroups.push([c]);
  }
  const consolidated: Cand[] = targetAxisGroups.map((g) => {
    if (g.length === 1) return g[0];
    const meanDOff = {
      x: g.reduce((s, c) => s + c.dOff.x, 0) / g.length,
      y: g.reduce((s, c) => s + c.dOff.y, 0) / g.length,
    };
    const meanTOff = {
      x: g.reduce((s, c) => s + c.tOff.x, 0) / g.length,
      y: g.reduce((s, c) => s + c.tOff.y, 0) / g.length,
    };
    const axis = g[0].axis;
    const perpX = -axis.y;
    const perpY = axis.x;
    const tStopX = g[0].target.x + meanTOff.x;
    const tStopY = g[0].target.y + meanTOff.y;
    const dStopX = proposedX + meanDOff.x;
    const dStopY = proposedY + meanDOff.y;
    const dx = tStopX - dStopX;
    const dy = tStopY - dStopY;
    const perpDist = Math.abs(dx * perpX + dy * perpY);
    return {
      target: g[0].target,
      dOff: meanDOff,
      tOff: meanTOff,
      axis,
      perpDist,
      targetStopX: tStopX,
      targetStopY: tStopY,
    };
  });

  // Group consolidated candidates by axis (parallel) and keep best per group.
  const groups: Cand[][] = [];
  for (const c of consolidated) {
    const g = groups.find((grp) => parallel(grp[0].axis, c.axis));
    if (g) g.push(c);
    else groups.push([c]);
  }
  const bests = groups.map((g) => g.reduce((a, b) => (a.perpDist <= b.perpDist ? a : b)));
  bests.sort((a, b) => a.perpDist - b.perpDist);

  const primary = bests[0];
  // Find a non-parallel secondary (so the two constraints solve uniquely).
  let secondary: Cand | null = null;
  for (let i = 1; i < bests.length; i++) {
    const cz = primary.axis.x * bests[i].axis.y - primary.axis.y * bests[i].axis.x;
    if (Math.abs(cz) > 0.1) {
      secondary = bests[i];
      break;
    }
  }

  let sx: number;
  let sy: number;

  if (secondary) {
    // Two-axis snap: solve the 2x2 system that puts the dragged stop on each
    // target axis line simultaneously. Each constraint is
    //   (anchor + dOff_i - targetStop_i) · perp_i = 0
    // ⇒  anchor · perp_i = (targetStop_i - dOff_i) · perp_i
    const p1 = { x: -primary.axis.y, y: primary.axis.x };
    const p2 = { x: -secondary.axis.y, y: secondary.axis.x };
    const k1 =
      (primary.targetStopX - primary.dOff.x) * p1.x +
      (primary.targetStopY - primary.dOff.y) * p1.y;
    const k2 =
      (secondary.targetStopX - secondary.dOff.x) * p2.x +
      (secondary.targetStopY - secondary.dOff.y) * p2.y;
    const det = p1.x * p2.y - p1.y * p2.x;
    sx = (k1 * p2.y - k2 * p1.y) / det;
    sy = (p1.x * k2 - p2.x * k1) / det;
  } else {
    // Single-axis snap: project the dragged stop onto the primary's axis
    // line through its target stop.
    const c = primary;
    const proposedDStopX = proposedX + c.dOff.x;
    const proposedDStopY = proposedY + c.dOff.y;
    const dxp = proposedDStopX - c.targetStopX;
    const dyp = proposedDStopY - c.targetStopY;
    const along = dxp * c.axis.x + dyp * c.axis.y;
    const snappedDStopX = c.targetStopX + along * c.axis.x;
    const snappedDStopY = c.targetStopY + along * c.axis.y;
    sx = snappedDStopX - c.dOff.x;
    sy = snappedDStopY - c.dOff.y;
  }

  // Build guides for every active axis (so the user sees that both snaps
  // are engaged on a perpendicular transfer station, etc.).
  const guides: SnapGuide[] = [];
  const pushGuide = (c: Cand) => {
    guides.push({
      from: { x: sx + c.dOff.x, y: sy + c.dOff.y },
      to: { x: c.targetStopX, y: c.targetStopY },
    });
  };
  pushGuide(primary);
  if (secondary) pushGuide(secondary);

  // Same-axis opposite-direction tight neighbor (the existing "in-line third
  // station" feature) — emitted per active axis. Does nothing when there's
  // no third station already aligned.
  const addOppositeGuide = (c: Cand) => {
    const px = -c.axis.y;
    const py = c.axis.x;
    const dStopX = sx + c.dOff.x;
    const dStopY = sy + c.dOff.y;
    const primaryAlong =
      (c.targetStopX - dStopX) * c.axis.x + (c.targetStopY - dStopY) * c.axis.y;
    const oppositeSign = -Math.sign(primaryAlong) || 0;
    if (oppositeSign === 0) return;
    let candidate: { from: Vec2; to: Vec2; alongAbs: number } | null = null;
    // Use consolidated (one entry per target+axis) so a third interlined
    // station doesn't get a separate guide per shared line.
    for (const o of consolidated) {
      if (o.target.id === c.target.id) continue;
      if (!parallel(o.axis, c.axis)) continue;
      const oDStopX = sx + o.dOff.x;
      const oDStopY = sy + o.dOff.y;
      const ddx = o.targetStopX - oDStopX;
      const ddy = o.targetStopY - oDStopY;
      const perpDistOpp = Math.abs(ddx * px + ddy * py);
      if (perpDistOpp > TIGHT_PERP_TOLERANCE) continue;
      const alongFromD = ddx * c.axis.x + ddy * c.axis.y;
      if (Math.sign(alongFromD) !== oppositeSign) continue;
      const alongAbs = Math.abs(alongFromD);
      if (!candidate || alongAbs < candidate.alongAbs) {
        candidate = {
          from: { x: oDStopX, y: oDStopY },
          to: { x: o.targetStopX, y: o.targetStopY },
          alongAbs,
        };
      }
    }
    if (candidate) guides.push({ from: candidate.from, to: candidate.to });
  };
  addOppositeGuide(primary);
  if (secondary) addOppositeGuide(secondary);

  return { x: sx, y: sy, guides };
}

export function MapCanvas() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const curveRadius = useDoc((s) => s.curveRadius);
  const viewport = useDoc((s) => s.viewport);
  const setViewport = useDoc((s) => s.setViewport);
  const moveStation = useDoc((s) => s.moveStation);
  const selection = useSelection();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{ mx: number; my: number; vx: number; vy: number } | null>(null);
  const dragStationRef = useRef<{
    id: StationId;
    startWX: number;
    startWY: number;
    startMX: number;
    startMY: number;
    moved: boolean;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const lineOrder = useDoc((s) => s.lineOrder);
  const bands = useMemo(
    () => buildBands(stations, lines, curveRadius, lineOrder),
    [stations, lines, curveRadius, lineOrder],
  );
  // Bands and stop markers merged into one pass, sorted by per-line z-priority
  // so a back-stack stop square doesn't paint over a front-stack band passing
  // through that station.
  const renderables = useMemo(() => {
    const markers = buildStopMarkers(stations, lines, lineOrder);
    type R =
      | { kind: 'band'; spec: SegmentBandSpec; priority: number }
      | { kind: 'marker'; spec: StopMarkerSpec; priority: number };
    const list: R[] = [
      ...bands.map((b) => ({ kind: 'band' as const, spec: b, priority: b.priority })),
      ...markers.map((m) => ({ kind: 'marker' as const, spec: m, priority: m.priority })),
    ];
    list.sort((a, b) => b.priority - a.priority);
    return list;
  }, [bands, stations, lines, lineOrder]);

  // viewBox: world coords; center of screen = (viewport.x, viewport.y), zoom scales.
  const vbW = size.w / viewport.zoom;
  const vbH = size.h / viewport.zoom;
  const vbX = viewport.x - vbW / 2;
  const vbY = viewport.y - vbH / 2;

  const screenToWorld = (mx: number, my: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const relX = (mx - rect.left) / rect.width;
    const relY = (my - rect.top) / rect.height;
    return { x: vbX + relX * vbW, y: vbY + relY * vbH };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const before = screenToWorld(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newZoom = Math.max(0.1, Math.min(8, viewport.zoom * factor));
    // adjust viewport so cursor stays at same world point
    const after = (() => {
      const rect = svgRef.current!.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const newVbW = size.w / newZoom;
      const newVbH = size.h / newZoom;
      // we want: vbX + relX * vbW = before.x  and similar for y
      // vbX = before.x - relX * vbW
      const newVbX = before.x - relX * newVbW;
      const newVbY = before.y - relY * newVbH;
      return { x: newVbX + newVbW / 2, y: newVbY + newVbH / 2, zoom: newZoom };
    })();
    setViewport(after);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Don't start panning while in place-station mode — clicks should place.
    if (selection.placingStation) return;
    if (e.target === svgRef.current || (e.target as Element).tagName === 'rect' && (e.target as Element).hasAttribute('data-bg')) {
      // start panning
      panStartRef.current = { mx: e.clientX, my: e.clientY, vx: viewport.x, vy: viewport.y };
      setPanning(true);
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panStartRef.current) {
      const dx = (e.clientX - panStartRef.current.mx) / viewport.zoom;
      const dy = (e.clientY - panStartRef.current.my) / viewport.zoom;
      setViewport({
        x: panStartRef.current.vx - dx,
        y: panStartRef.current.vy - dy,
        zoom: viewport.zoom,
      });
    }
    if (dragStationRef.current) {
      const ds = dragStationRef.current;
      const dxScreen = e.clientX - ds.startMX;
      const dyScreen = e.clientY - ds.startMY;
      // Use a screen-space threshold so it's forgiving regardless of zoom.
      const wasMoved = ds.moved;
      if (!ds.moved && Math.hypot(dxScreen, dyScreen) > 4) {
        ds.moved = true;
        dragState.suppressClick = true;
        // Capture the pointer now that we're sure it's a drag, so the user can
        // slide off the station/SVG without losing it.
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      if (ds.moved) {
        const dx = dxScreen / viewport.zoom;
        const dy = dyScreen / viewport.zoom;
        let nx = ds.startWX + dx;
        let ny = ds.startWY + dy;
        const draggedSt = stations[ds.id];
        const draggedRot = (draggedSt?.rotation ?? 0) as Rotation;
        const draggedStops = draggedSt?.stops ?? [];
        // Snap is on by default; Shift bypasses it.
        const shouldSnap = !e.shiftKey;
        const tol = SNAP_PERP_TOLERANCE;
        if (shouldSnap) {
          const snap = tryAxisSnap(
            ds.id,
            nx,
            ny,
            draggedRot,
            draggedStops,
            stations,
            tol,
          );
          nx = snap.x;
          ny = snap.y;
          setSnapGuides(snap.guides);
        } else if (snapGuides.length > 0) {
          setSnapGuides([]);
        }
        moveStation(ds.id, nx, ny);
      }
      void wasMoved;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (panStartRef.current) {
      panStartRef.current = null;
      setPanning(false);
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
    if (dragStationRef.current) {
      const wasMoved = dragStationRef.current.moved;
      dragStationRef.current = null;
      setSnapGuides([]);
      if (wasMoved) {
        try {
          svgRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // pointer may not have been captured if release happened too early
        }
        // Suppress the click that fires after pointerup.
        setTimeout(() => {
          dragState.suppressClick = false;
        }, 0);
      }
    }
  };

  const addStation = useDoc((s) => s.addStation);

  const onCanvasClick = (e: React.MouseEvent) => {
    const onBackground =
      e.target === svgRef.current || (e.target as Element).hasAttribute('data-bg');
    if (!onBackground) return;
    if (selection.placingStation) {
      const w = screenToWorld(e.clientX, e.clientY);
      addStation(w.x, w.y);
      // Stay in place-station mode; user clicks again or hits Esc / the
      // toolbar button to exit. Don't auto-select the new station — that
      // would close the placing-mode banner via the inspector swap.
      return;
    }
    selection.selectStation(null);
  };

  const onStationDragStart = (id: StationId, e: React.PointerEvent) => {
    const st = stations[id];
    if (!st) return;
    dragStationRef.current = {
      id,
      startWX: st.x,
      startWY: st.y,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
    };
    // Don't capture the pointer here — capture would redirect the synthesized
    // click event away from the station's rect to the SVG, breaking onClick.
    // We capture below on first significant movement (in onPointerMove) instead.
  };

  return (
    <div className="canvas-host">
      {selection.placingStation && (
        <div className="append-banner placing">
          Click on the canvas to place a new station. Press Esc to cancel.
        </div>
      )}
      {selection.appendingToLineId && !selection.placingStation && (() => {
        const line = lines[selection.appendingToLineId];
        if (!line) return null;
        const text = legibleTextOn(line.color);
        return (
          <div
            className="append-banner"
            style={{ background: line.color, color: text }}
          >
            Appending to line {line.service} — click stations to add or remove. Esc to stop.
          </div>
        );
      })()}
      <svg
        ref={svgRef}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className={panning ? 'panning' : ''}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onCanvasClick}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* background hit target for panning */}
        <rect data-bg="1" x={vbX} y={vbY} width={vbW} height={vbH} fill="#fafafa" />

        {/* grid (subtle, helps spatial sense) */}
        <Grid vbX={vbX} vbY={vbY} vbW={vbW} vbH={vbH} zoom={viewport.zoom} />

        {/* bands and stop squares interleaved by per-line z-priority */}
        {renderables.map((r, i) =>
          r.kind === 'band' ? (
            <SegmentBand
              key={'b:' + r.spec.pairKey + ':' + r.spec.lines.map((l) => l.id).join(',')}
              spec={r.spec}
            />
          ) : (
            <rect
              key={'m:' + i}
              x={-STOP_SIZE / 2}
              y={-STOP_SIZE / 2}
              width={STOP_SIZE}
              height={STOP_SIZE}
              fill={r.spec.color}
              transform={`translate(${r.spec.cx} ${r.spec.cy}) rotate(${r.spec.rotationDeg})`}
              pointerEvents="none"
            />
          ),
        )}

        {/* station backgrounds: hit areas, names, colored stop squares */}
        {Object.values(stations).map((st) => (
          <StationView
            key={st.id + ':bg'}
            station={st}
            lines={lines}
            zoom={viewport.zoom}
            onStartDrag={onStationDragStart}
            layer="bg"
          />
        ))}

        {/* snap guides — one per active alignment axis (plus optional
            same-axis third-station markers). Halo behind + dashed teal on top. */}
        {snapGuides.length > 0 && (
          <g pointerEvents="none">
            <defs>
              <filter
                id="snap-halo-blur"
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation={2 / viewport.zoom} />
              </filter>
            </defs>
            <g filter="url(#snap-halo-blur)">
              {snapGuides.map((g, i) => (
                <g key={'halo' + i}>
                  <line
                    x1={g.from.x}
                    y1={g.from.y}
                    x2={g.to.x}
                    y2={g.to.y}
                    stroke="rgb(185, 218, 255)"
                    strokeWidth={5 / viewport.zoom}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={g.from.x}
                    cy={g.from.y}
                    r={STOP_SIZE * 0.28 + 1 / viewport.zoom}
                    fill="none"
                    stroke="rgb(185, 218, 255)"
                    strokeWidth={5 / viewport.zoom}
                  />
                  <circle
                    cx={g.to.x}
                    cy={g.to.y}
                    r={STOP_SIZE * 0.28 + 1 / viewport.zoom}
                    fill="none"
                    stroke="rgb(185, 218, 255)"
                    strokeWidth={5 / viewport.zoom}
                  />
                </g>
              ))}
            </g>
            {snapGuides.map((g, i) => (
              <line
                key={'dash' + i}
                x1={g.from.x}
                y1={g.from.y}
                x2={g.to.x}
                y2={g.to.y}
                stroke="#1488a0"
                strokeWidth={2 / viewport.zoom}
                strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`}
              />
            ))}
          </g>
        )}

        {/* station dots: rendered last so the snap guide passes under them */}
        {Object.values(stations).map((st) => (
          <StationView
            key={st.id + ':dots'}
            station={st}
            lines={lines}
            zoom={viewport.zoom}
            onStartDrag={onStationDragStart}
            layer="dots"
          />
        ))}
      </svg>

      <WarningToasts />
    </div>
  );
}

function Grid({
  vbX,
  vbY,
  vbW,
  vbH,
  zoom,
}: {
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  zoom: number;
}) {
  const step = zoom < 0.5 ? 80 : zoom < 1.5 ? 40 : 20;
  const x0 = Math.floor(vbX / step) * step;
  const y0 = Math.floor(vbY / step) * step;
  const lines: React.ReactElement[] = [];
  for (let x = x0; x <= vbX + vbW; x += step) {
    lines.push(
      <line key={'vx' + x} x1={x} y1={vbY} x2={x} y2={vbY + vbH} stroke="#eee" strokeWidth={1 / zoom} />,
    );
  }
  for (let y = y0; y <= vbY + vbH; y += step) {
    lines.push(
      <line key={'hy' + y} x1={vbX} y1={y} x2={vbX + vbW} y2={y} stroke="#eee" strokeWidth={1 / zoom} />,
    );
  }
  return <g pointerEvents="none">{lines}</g>;
}

function WarningToasts() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const curveRadius = useDoc((s) => s.curveRadius);
  const setViewport = useDoc((s) => s.setViewport);
  const viewport = useDoc((s) => s.viewport);
  const lineOrder = useDoc((s) => s.lineOrder);
  const bands = useMemo(
    () => buildBands(stations, lines, curveRadius, lineOrder),
    [stations, lines, curveRadius, lineOrder],
  );
  const warnings = bands.filter((b) => b.warning);
  if (warnings.length === 0) return null;
  return (
    <div className="warning-toasts">
      {warnings.map((w, i) => {
        const a = stations[w.fromId]?.name ?? '?';
        const b = stations[w.toId]?.name ?? '?';
        return (
          <div
            key={i}
            className="toast"
            onClick={() => {
              const c = w.centerline[Math.floor(w.centerline.length / 2)];
              if (c) setViewport({ x: c.x, y: c.y, zoom: viewport.zoom });
            }}
          >
            ⚠ Routing warning: {a} ↔ {b}
          </div>
        );
      })}
    </div>
  );
}
