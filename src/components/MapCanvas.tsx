import { useMemo, useRef } from 'react';

import { dragState, useDoc, useSelection } from '../state/store';
import {
  buildBands,
  buildStopMarkers,
  SegmentBandSpec,
  StopMarkerSpec,
} from '../geometry/interlining';
import { STOP_SIZE } from '../geometry/orientation';
import { SegmentBand } from './SegmentBand';
import { StationView } from './StationView';
import { useViewport } from './canvas/useViewport';
import { useStationDrag } from './canvas/useStationDrag';
import { Grid } from './canvas/Grid';
import { WarningToasts } from './canvas/WarningToasts';
import { EditingBanner } from './canvas/EditingBanner';
import { SnapGuides } from './canvas/SnapGuides';

export function MapCanvas() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const curveRadius = useDoc((s) => s.curveRadius);
  const lineOrder = useDoc((s) => s.lineOrder);
  const addStation = useDoc((s) => s.addStation);
  const selection = useSelection();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const view = useViewport(svgRef);
  const drag = useStationDrag(svgRef, view.viewport.zoom);

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

  const onPointerDown = (e: React.PointerEvent) => {
    view.onPointerDown(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    view.onPointerMove(e);
    drag.onPointerMove(e);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    view.onPointerUp(e);
    drag.onPointerUp(e);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    const onBackground =
      e.target === svgRef.current || (e.target as Element).hasAttribute('data-bg');
    if (!onBackground) return;
    if (dragState.suppressClick) return;
    if (selection.placingStation) {
      const w = view.screenToWorld(e.clientX, e.clientY);
      addStation(w.x, w.y);
      // Stay in place-station mode; user clicks again or hits Esc / the
      // toolbar button to exit. Don't auto-select the new station — that
      // would close the placing-mode banner via the inspector swap.
      return;
    }
    if (selection.appendingToLineId) {
      selection.setAppending(null);
      return;
    }
    selection.selectStation(null);
  };

  return (
    <div className="canvas-host">
      <EditingBanner />
      <svg
        ref={svgRef}
        viewBox={`${view.vbX} ${view.vbY} ${view.vbW} ${view.vbH}`}
        className={view.panning ? 'panning' : ''}
        onWheel={view.onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onCanvasClick}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* background hit target for panning */}
        <rect
          data-bg="1"
          x={view.vbX}
          y={view.vbY}
          width={view.vbW}
          height={view.vbH}
          fill="#fafafa"
        />

        <Grid vbX={view.vbX} vbY={view.vbY} vbW={view.vbW} vbH={view.vbH} zoom={view.viewport.zoom} />

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
            zoom={view.viewport.zoom}
            onStartDrag={drag.onStartDrag}
            layer="bg"
          />
        ))}

        <SnapGuides guides={drag.snapGuides} zoom={view.viewport.zoom} />

        {/* station dots: rendered last so the snap guide passes under them */}
        {Object.values(stations).map((st) => (
          <StationView
            key={st.id + ':dots'}
            station={st}
            lines={lines}
            zoom={view.viewport.zoom}
            onStartDrag={drag.onStartDrag}
            layer="dots"
          />
        ))}
      </svg>

      <WarningToasts />
    </div>
  );
}
