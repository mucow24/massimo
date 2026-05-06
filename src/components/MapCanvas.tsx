import { useMemo, useRef } from 'react';

import { dragState, useDoc, useSelection } from '../state/store';
import {
  buildBands,
  buildStopMarkers,
  SegmentBandSpec,
  StopMarkerSpec,
} from '../geometry/interlining';
import { STOP_SIZE, stopCenterAt } from '../geometry/orientation';
import { SegmentBand } from './SegmentBand';
import { StationView } from './StationView';
import { useViewport } from './canvas/useViewport';
import { useStationDrag } from './canvas/useStationDrag';
import { Grid } from './canvas/Grid';
import { WarningToasts } from './canvas/WarningToasts';
import { EditingBanner } from './canvas/EditingBanner';
import { SnapGuides } from './canvas/SnapGuides';
import { LineTagsLayer } from './canvas/LineTagsLayer';
import {
  closestParamOnOffsetPath,
  lineTraversesForwardCanon,
  offsetPathLength,
  sampleOffsetPath,
} from '../geometry/lineTagGeometry';
import type { LineId } from '../model/types';
import { findMatchingStations } from '../model/matching';
import { useDebugHighlight } from '../state/debugHighlightStore';
import { desaturateColor } from '../util/color';

export function MapCanvas() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const curveRadius = useDoc((s) => s.curveRadius);
  const lineOrder = useDoc((s) => s.lineOrder);
  const addStation = useDoc((s) => s.addStation);
  const addLineTag = useDoc((s) => s.addLineTag);
  const selection = useSelection();
  const debug = useDebugHighlight();
  const highlightLineId = selection.selectedLineId;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const view = useViewport(svgRef);
  const drag = useStationDrag(svgRef, view.viewport.zoom);

  const bands = useMemo(
    () => buildBands(stations, lines, curveRadius, lineOrder),
    [stations, lines, curveRadius, lineOrder],
  );

  // When mirror-matching mode is on for the selected station, highlight the
  // adjacent stations whose unrotated stop layouts are identical.
  const matchingIds = useMemo(() => {
    if (!selection.mirrorMatching || !selection.selectedStationId) return [];
    return findMatchingStations({ stations, lines }, selection.selectedStationId);
  }, [selection.mirrorMatching, selection.selectedStationId, stations, lines]);
  // Color override map for non-selected lines while a line is being edited.
  // Selected line keeps its true color; others get desaturated toward greyscale.
  const colorMap = useMemo(() => {
    if (!highlightLineId || debug.desaturate >= 1) return undefined;
    const map: Record<string, string> = {};
    for (const ln of Object.values(lines)) {
      if (ln.id === highlightLineId) continue;
      map[ln.id] = desaturateColor(ln.color, debug.desaturate);
    }
    return map;
  }, [highlightLineId, debug.desaturate, lines]);

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

  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;
  const onPointerDown = (e: React.PointerEvent) => {
    // Middle-button drag pans regardless of tool mode.
    if (e.button === 1) {
      e.preventDefault();
      view.startPan(e);
      return;
    }
    if (inHandMode) view.startPan(e);
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
    if (inHandMode) return;
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
    if (selection.creatingLineTag) {
      // Click on background while in tag mode = exit the mode.
      selection.setCreatingLineTag(false);
      return;
    }
    if (selection.appendingToLineId) {
      selection.setAppending(null);
      return;
    }
    selection.selectStation(null);
    selection.selectLineTag(null);
  };

  // Hover/click handlers passed to SegmentBand when in add-line-tag mode.
  // Each band's renderer captures its own spec via closure.
  const makeBandHandlers = (spec: SegmentBandSpec) => ({
    onLineHover: (lineId: LineId, e: React.PointerEvent) => {
      const line = lines[lineId];
      if (!line) return;
      // Find this stripe's offset within the band.
      const k = spec.lines.findIndex((l) => l.id === lineId);
      const n = spec.lines.length;
      const offset = (k - (n - 1) / 2) * STOP_SIZE;
      const world = view.screenToWorld(e.clientX, e.clientY);
      const closest = closestParamOnOffsetPath(spec.centerline, curveRadius, offset, world);
      const sample = sampleOffsetPath(spec.centerline, curveRadius, offset, closest.t);
      // Determine canon vs line-traversal: the band's pairKey is canonical.
      // For this band's stations, fromCanon < toCanon. The line traverses
      // forward-canon iff line.stations contains (fromCanon, toCanon) as a
      // consecutive pair.
      const [fromCanon, toCanon] = spec.pairKey.split('|');
      const forward = lineTraversesForwardCanon(line, fromCanon, toCanon);
      selection.setLineTagHoverPreview({
        lineId,
        service: line.service,
        fromStationId: fromCanon,
        toStationId: toCanon,
        t: closest.t,
        p: sample.p,
        tangent: sample.tangent,
        lineForwardMatchesCanon: forward,
      });
    },
    onLineLeave: () => {
      selection.setLineTagHoverPreview(null);
    },
    onLineClick: (lineId: LineId, e: React.MouseEvent) => {
      e.stopPropagation();
      const line = lines[lineId];
      if (!line) return;
      const k = spec.lines.findIndex((l) => l.id === lineId);
      const n = spec.lines.length;
      const offset = (k - (n - 1) / 2) * STOP_SIZE;
      const world = view.screenToWorld(e.clientX, e.clientY);
      const closest = closestParamOnOffsetPath(spec.centerline, curveRadius, offset, world);
      const [fromCanon, toCanon] = spec.pairKey.split('|');
      const stripeTotal = offsetPathLength(spec.centerline, curveRadius, offset);
      const arcLen = closest.t * stripeTotal;
      // Anchor to whichever endpoint is nearer at insertion time.
      const anchorEnd: 'from' | 'to' = arcLen <= stripeTotal / 2 ? 'from' : 'to';
      const distance = anchorEnd === 'from' ? arcLen : stripeTotal - arcLen;
      addLineTag(lineId, fromCanon, toCanon, anchorEnd, distance, 0);
      // Stay in mode (matches + Station behavior).
    },
  });

  return (
    <div className="canvas-host">
      <EditingBanner />
      <svg
        ref={svgRef}
        viewBox={`${view.vbX} ${view.vbY} ${view.vbW} ${view.vbH}`}
        className={
          (inHandMode ? 'tool-hand' : 'tool-arrow') + (view.panning ? ' panning' : '')
        }
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

        <Grid
          vbX={view.vbX}
          vbY={view.vbY}
          vbW={view.vbW}
          vbH={view.vbH}
          zoom={view.viewport.zoom}
        />

        {/* selection wash: painted before bands so the wash sits behind
            line segments, markers, dots, and labels — all the way in the
            background. Only the selected station renders anything. */}
        {selection.selectedStationId && stations[selection.selectedStationId] && (
          <StationView
            key={selection.selectedStationId + ':wash'}
            station={stations[selection.selectedStationId]}
            lines={lines}
            zoom={view.viewport.zoom}
            onStartDrag={drag.onStartDrag}
            layer="wash"
          />
        )}

        {/* bands and stop squares interleaved by per-line z-priority */}
        {renderables.map((r, i) =>
          r.kind === 'band' ? (
            <SegmentBand
              key={'b:' + r.spec.pairKey + ':' + r.spec.lines.map((l) => l.id).join(',')}
              spec={r.spec}
              interactive={selection.creatingLineTag}
              colorMap={colorMap}
              onLineSelect={
                inHandMode
                  ? undefined
                  : (lineId, e) => {
                      e.stopPropagation();
                      selection.selectLine(lineId);
                    }
              }
              {...(selection.creatingLineTag ? makeBandHandlers(r.spec) : {})}
            />
          ) : (
            <rect
              key={'m:' + i}
              x={-STOP_SIZE / 2}
              y={-STOP_SIZE / 2}
              width={STOP_SIZE}
              height={STOP_SIZE}
              fill={
                colorMap && r.spec.lineId !== highlightLineId
                  ? (colorMap[r.spec.lineId] ?? r.spec.color)
                  : r.spec.color
              }
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

        {/* station labels: rendered after bg/wash so a selected station's
            orange wash never paints over a neighbor's label. */}
        {Object.values(stations).map((st) => (
          <StationView
            key={st.id + ':label'}
            station={st}
            lines={lines}
            zoom={view.viewport.zoom}
            onStartDrag={drag.onStartDrag}
            layer="label"
          />
        ))}

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

        {/* Debug highlight: dim overlay + re-painted selected line on top.
            Painted after dots so other lines' stop dots can't punch through
            the selected line's outline. */}
        {highlightLineId && debug.dimAlpha > 0 && (
          <rect
            x={view.vbX}
            y={view.vbY}
            width={view.vbW}
            height={view.vbH}
            fill={debug.dimColor}
            fillOpacity={debug.dimAlpha}
            pointerEvents="none"
          />
        )}
        {highlightLineId && (
          <g pointerEvents="none">
            {renderables.map((r, i) => {
              if (r.kind !== 'band') return null;
              const k = r.spec.lines.findIndex((l) => l.id === highlightLineId);
              if (k < 0) return null;
              return (
                <path
                  key={'hl-b:' + i}
                  d={r.spec.paths[k]}
                  fill="none"
                  stroke={r.spec.lines[k].color}
                  strokeWidth={14}
                  strokeLinecap="square"
                  strokeLinejoin="round"
                />
              );
            })}
            {renderables.map((r, i) => {
              if (r.kind !== 'marker' || r.spec.lineId !== highlightLineId) return null;
              const m = r.spec;
              return (
                <rect
                  key={'hl-m:' + i}
                  x={-STOP_SIZE / 2}
                  y={-STOP_SIZE / 2}
                  width={STOP_SIZE}
                  height={STOP_SIZE}
                  fill={m.color}
                  transform={`translate(${m.cx} ${m.cy}) rotate(${m.rotationDeg})`}
                />
              );
            })}
            {/* Re-render the selected line's stop dots on top so the
                colored markers don't swallow them. */}
            {(() => {
              const ln = lines[highlightLineId];
              if (!ln) return null;
              return ln.stations.flatMap((sid) => {
                const st = stations[sid];
                if (!st) return [];
                const cell = st.stops.find((c) => c.lineId === highlightLineId);
                if (!cell) return [];
                const local = stopCenterAt(cell.row, cell.col);
                const a = (st.rotation * Math.PI) / 4;
                const cs = Math.cos(a);
                const sn = Math.sin(a);
                const cx = st.x + local.x * cs - local.y * sn;
                const cy = st.y + local.x * sn + local.y * cs;
                return [
                  <circle key={'hl-d:' + sid} cx={cx} cy={cy} r={STOP_SIZE * 0.28} fill="#000" />,
                ];
              });
            })()}
            {/* Selected line's station names rendered in white above dim. */}
            {(() => {
              const ln = lines[highlightLineId];
              if (!ln) return null;
              return ln.stations.flatMap((sid) => {
                const st = stations[sid];
                if (!st) return [];
                return [
                  <StationView
                    key={'hl-l:' + sid}
                    station={st}
                    lines={lines}
                    zoom={view.viewport.zoom}
                    onStartDrag={drag.onStartDrag}
                    layer="highlight-label"
                  />,
                ];
              });
            })()}
          </g>
        )}

        {/* Line tags: in-band labels that ride each line's stripe. */}
        <LineTagsLayer bands={bands} zoom={view.viewport.zoom} svgRef={svgRef} />

        {/* Match-stroke: gray outline on each station whose layout matches
            the selected station while mirror mode is on. Drawn beneath the
            selection stroke so the selected station's black outline still
            stands out. */}
        {matchingIds.map(
          (sid) =>
            stations[sid] && (
              <StationView
                key={sid + ':match-stroke'}
                station={stations[sid]}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="match-stroke"
              />
            ),
        )}

        {/* selection stroke: 2px black ring around the merged silhouette,
            painted on top of everything so the outline is never occluded. */}
        {selection.selectedStationId && stations[selection.selectedStationId] && (
          <StationView
            key={selection.selectedStationId + ':stroke'}
            station={stations[selection.selectedStationId]}
            lines={lines}
            zoom={view.viewport.zoom}
            onStartDrag={drag.onStartDrag}
            layer="stroke"
          />
        )}
      </svg>

      <WarningToasts />
    </div>
  );
}
