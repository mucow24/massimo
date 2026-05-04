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
import { StationId } from '../state/types';
import { buildBands } from '../geometry/interlining';
import { SegmentBand } from './SegmentBand';
import { StationView } from './StationView';

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

  const bands = useMemo(
    () => buildBands(stations, lines, curveRadius),
    [stations, lines, curveRadius],
  );

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
        moveStation(ds.id, ds.startWX + dx, ds.startWY + dy);
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
      const id = addStation(w.x, w.y);
      selection.setPlacingStation(false);
      selection.selectStation(id);
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
      >
        {/* background hit target for panning */}
        <rect data-bg="1" x={vbX} y={vbY} width={vbW} height={vbH} fill="#fafafa" />

        {/* grid (subtle, helps spatial sense) */}
        <Grid vbX={vbX} vbY={vbY} vbW={vbW} vbH={vbH} zoom={viewport.zoom} />

        {/* segments */}
        {bands.map((b) => (
          <SegmentBand key={b.pairKey + ':' + b.lines.map((l) => l.id).join(',')} spec={b} />
        ))}

        {/* stations on top */}
        {Object.values(stations).map((st) => (
          <StationView
            key={st.id}
            station={st}
            lines={lines}
            zoom={viewport.zoom}
            onStartDrag={onStationDragStart}
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
  const bands = useMemo(
    () => buildBands(stations, lines, curveRadius),
    [stations, lines, curveRadius],
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
