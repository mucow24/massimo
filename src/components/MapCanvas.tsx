import { useMemo, useRef, useState } from 'react';

import { beginHistoryGroup, dragState, useDoc, useSelection } from '../state/store';
import { snapDraggedStation, type SnapGuide } from '../geometry/snap';
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
import { useRectSelect } from './canvas/useRectSelect';
import { Grid } from './canvas/Grid';
import { WarningToasts } from './canvas/WarningToasts';
import { EditingBanner } from './canvas/EditingBanner';
import { SnapGuides } from './canvas/SnapGuides';
import { LineTagsLayer } from './canvas/LineTagsLayer';
import { RouteBulletView } from './RouteBulletView';
import { RouteBulletPopover } from './RouteBulletPopover';
import { TransferLayer, transferEndWorld } from './TransferLayer';
import {
  closestParamOnOffsetPath,
  lineTraversesForwardCanon,
  offsetPathLength,
  sampleOffsetPath,
} from '../geometry/lineTagGeometry';
import type { LineId } from '../model/types';
import { findMatchingStations } from '../model/matching';
import { desaturateColor, legibleTextOn } from '../util/color';

const DIM_COLOR = '#000000';
const DIM_ALPHA = 0.75;
// 1 = full color, 0 = greyscale.
const OTHER_LINE_SATURATION = 0.5;
const BULLET_SNAP_TOLERANCE = 10;

export function MapCanvas() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const curveRadius = useDoc((s) => s.curveRadius);
  const lineOrder = useDoc((s) => s.lineOrder);
  const addStation = useDoc((s) => s.addStation);
  const addLineTag = useDoc((s) => s.addLineTag);
  const routeBullets = useDoc((s) => s.routeBullets);
  const addRouteBullet = useDoc((s) => s.addRouteBullet);
  const moveRouteBullet = useDoc((s) => s.moveRouteBullet);
  const rotateRouteBullet = useDoc((s) => s.rotateRouteBullet);
  const transfers = useDoc((s) => s.transfers);
  const selection = useSelection();
  const highlightLineId = selection.selectedLineId;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const view = useViewport(svgRef);
  const drag = useStationDrag(svgRef, view.viewport.zoom);
  const rectSelect = useRectSelect(svgRef, view.screenToWorld);

  const bands = useMemo(
    () => buildBands(stations, lines, curveRadius, lineOrder),
    [stations, lines, curveRadius, lineOrder],
  );

  // When mirror-matching mode is on for the selected station, highlight the
  // adjacent stations whose unrotated stop layouts are identical. Mirror
  // mode only applies to single-selection.
  const soloSelectedId =
    selection.selectedStationIds.length === 1 ? selection.selectedStationIds[0] : null;
  const matchingIds = useMemo(() => {
    if (!selection.mirrorMatching || !soloSelectedId) return [];
    return findMatchingStations({ stations, lines }, soloSelectedId);
  }, [selection.mirrorMatching, soloSelectedId, stations, lines]);
  // Color override map for non-selected lines while a line is being edited.
  // Selected line keeps its true color; others get desaturated toward greyscale.
  const colorMap = useMemo(() => {
    if (!highlightLineId || OTHER_LINE_SATURATION >= 1) return undefined;
    const map: Record<string, string> = {};
    for (const ln of Object.values(lines)) {
      if (ln.id === highlightLineId) continue;
      map[ln.id] = desaturateColor(ln.color, OTHER_LINE_SATURATION);
    }
    return map;
  }, [highlightLineId, lines]);

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

  // Bullet drag state — minimal local ref to avoid a whole new hook for now.
  const bulletDragRef = useRef<{
    id: string;
    startWX: number;
    startWY: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  const [bulletSnapGuides, setBulletSnapGuides] = useState<SnapGuide[]>([]);
  // Cursor position in world coords — used to draw the in-progress transfer
  // line from the picked anchor station to the user's cursor while they
  // hunt for the second endpoint.
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    // Middle-button drag pans regardless of tool mode.
    if (e.button === 1) {
      e.preventDefault();
      view.startPan(e);
      return;
    }
    if (inHandMode) {
      view.startPan(e);
      return;
    }
    // Arrow mode: a left-button pointerdown on background may begin a
    // rect-select. The hook self-gates on background hit + active mode.
    rectSelect.onPointerDown(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    view.onPointerMove(e);
    drag.onPointerMove(e);
    rectSelect.onPointerMove(e);
    if (selection.creatingTransfer && selection.transferAnchor) {
      setCursorWorld(view.screenToWorld(e.clientX, e.clientY));
    } else if (cursorWorld) {
      setCursorWorld(null);
    }
    const bd = bulletDragRef.current;
    if (bd) {
      const dxScreen = e.clientX - bd.startMX;
      const dyScreen = e.clientY - bd.startMY;
      if (!bd.moved && Math.hypot(dxScreen, dyScreen) > 4) {
        bd.moved = true;
        dragState.suppressClick = true;
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      if (bd.moved) {
        const dx = dxScreen / view.viewport.zoom;
        const dy = dyScreen / view.viewport.zoom;
        let nx = bd.startWX + dx;
        let ny = bd.startWY + dy;
        const cur = routeBullets[bd.id];
        const lineId = cur?.lineId ?? null;
        if (lineId && !e.shiftKey) {
          // Reuse the station snap engine in bullet mode — it already
          // handles per-stop axis alignment, two-axis snap at corners,
          // and the "third in-line station" opposite-direction guide.
          const snap = snapDraggedStation({
            proposedX: nx,
            proposedY: ny,
            stations,
            lines,
            tolerance: BULLET_SNAP_TOLERANCE,
            bulletLineId: lineId,
          });
          nx = snap.x;
          ny = snap.y;
          setBulletSnapGuides(snap.guides);
        } else if (bulletSnapGuides.length > 0) {
          setBulletSnapGuides([]);
        }
        moveRouteBullet(bd.id, nx, ny);
      }
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    view.onPointerUp(e);
    drag.onPointerUp(e);
    rectSelect.onPointerUp(e);
    const bd = bulletDragRef.current;
    if (bd) {
      const wasMoved = bd.moved;
      bulletDragRef.current = null;
      setBulletSnapGuides([]);
      if (wasMoved) {
        bd.history.commit();
        try {
          svgRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // pointer may not have been captured
        }
        setTimeout(() => {
          dragState.suppressClick = false;
        }, 0);
      } else {
        bd.history.cancel();
      }
    }
  };

  const onBulletPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    const b = routeBullets[id];
    if (!b) return;
    e.stopPropagation();
    bulletDragRef.current = {
      id,
      startWX: b.x,
      startWY: b.y,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      history: beginHistoryGroup(),
    };
  };
  const onBulletClick = (id: string, e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    if (inHandMode) return;
    e.stopPropagation();
    selection.selectRouteBullet(id);
  };
  const onBulletContextMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rotateRouteBullet(id);
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
    if (selection.creatingRouteBullet) {
      const w = view.screenToWorld(e.clientX, e.clientY);
      // Default new bullet to the first line in z-order so it has a
      // recognizable color/service immediately. User can change it via
      // the popover after exiting placement mode (Esc / right-click).
      // Don't auto-select — that would close the placement banner and
      // break the click-click-click drop pattern, like place-station mode.
      const defaultLineId = lineOrder.find((id) => lines[id]) ?? null;
      addRouteBullet(w.x, w.y, defaultLineId);
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
    if (selection.creatingTransfer) {
      // Click on background while picking transfer endpoints exits the mode.
      selection.setCreatingTransfer(false);
      return;
    }
    selection.selectStation(null);
    selection.selectLineTag(null);
    selection.selectRouteBullet(null);
    selection.selectTransfer(null);
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
        className={(inHandMode ? 'tool-hand' : 'tool-arrow') + (view.panning ? ' panning' : '')}
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
            background. One per selected station. */}
        {selection.selectedStationIds.map(
          (sid) =>
            stations[sid] && (
              <StationView
                key={sid + ':wash'}
                station={stations[sid]}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="wash"
              />
            ),
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

        {/* Transfers: 2px black lines connecting two dots. Rendered BEFORE
            the dim layer so they fade with everything else when a line is
            selected, and the selected line's stripe paints on top of them. */}
        <TransferLayer
          transfers={transfers}
          stations={stations}
          selectedId={selection.selectedTransferId}
          zoom={view.viewport.zoom}
          onSelect={(id) => selection.selectTransfer(id)}
        />

        {/* In-progress transfer preview line: from the anchor dot to the
            cursor while waiting for the second click. */}
        {selection.creatingTransfer &&
          selection.transferAnchor &&
          cursorWorld &&
          stations[selection.transferAnchor.stationId] &&
          (() => {
            const anchorWorld = transferEndWorld(
              stations[selection.transferAnchor.stationId],
              selection.transferAnchor.lineId,
            );
            return (
              <line
                x1={anchorWorld.x}
                y1={anchorWorld.y}
                x2={cursorWorld.x}
                y2={cursorWorld.y}
                stroke="#000"
                strokeWidth={2}
                strokeLinecap="round"
                pointerEvents="none"
              />
            );
          })()}

        {/* Route bullets: rendered before the dim so they fade with the
            rest of the map when a line is selected. */}
        {Object.values(routeBullets).map((b) => (
          <RouteBulletView
            key={b.id}
            bullet={b}
            lines={lines}
            selected={selection.selectedRouteBulletId === b.id}
            onPointerDown={onBulletPointerDown}
            onClick={onBulletClick}
            onContextMenu={onBulletContextMenu}
          />
        ))}

        {/* Debug highlight: dim overlay + re-painted selected line on top.
            Painted after dots so other lines' stop dots can't punch through
            the selected line's outline. */}
        {highlightLineId && DIM_ALPHA > 0 && (
          <rect
            x={view.vbX}
            y={view.vbY}
            width={view.vbW}
            height={view.vbH}
            fill={DIM_COLOR}
            fillOpacity={DIM_ALPHA}
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
            {/* Selected line's station names rendered in white above dim.
                The append-mode "starter" station gets its own treatment
                below (line-color name + arrowhead), so skip it here. */}
            {(() => {
              const ln = lines[highlightLineId];
              if (!ln) return null;
              const starterId =
                selection.appendingToLineId === highlightLineId &&
                selection.insertAfterIndex != null &&
                selection.insertAfterIndex >= 0
                  ? ln.stations[selection.insertAfterIndex]
                  : null;
              return ln.stations.flatMap((sid) => {
                if (sid === starterId) return [];
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
            {/* In append mode, surface stations not yet on the line as
                light gray labels above the dim, plus highlight the
                "starter" stop and draw an arrowhead pointing at where
                the next station will be inserted. */}
            {selection.appendingToLineId === highlightLineId &&
              (() => {
                const ln = lines[highlightLineId];
                if (!ln) return null;
                const onLine = new Set(ln.stations);
                const addable = Object.values(stations)
                  .filter((st) => !onLine.has(st.id))
                  .map((st) => (
                    <StationView
                      key={'add-l:' + st.id}
                      station={st}
                      lines={lines}
                      zoom={view.viewport.zoom}
                      onStartDrag={drag.onStartDrag}
                      layer="highlight-label"
                      highlightColor="#bbb"
                    />
                  ));

                const idx = selection.insertAfterIndex ?? -1;
                const stopWorld = (sid: string) => {
                  const st = stations[sid];
                  if (!st) return null;
                  const cell = st.stops.find((c) => c.lineId === highlightLineId);
                  if (!cell) return null;
                  const local = stopCenterAt(cell.row, cell.col);
                  const a = (st.rotation * Math.PI) / 4;
                  const cs = Math.cos(a);
                  const sn = Math.sin(a);
                  return {
                    x: st.x + local.x * cs - local.y * sn,
                    y: st.y + local.x * sn + local.y * cs,
                  };
                };

                // Pick origin (the stop the arrow extends from) and the
                // direction in which insertion will happen.
                let originIdx: number;
                let dirToIdx: number | null;
                let dirSign: 1 | -1 = 1;
                if (idx === -1) {
                  // Insert at start: arrow extends BEFORE station 0,
                  // opposite of the 0→1 direction.
                  originIdx = 0;
                  dirToIdx = ln.stations.length > 1 ? 1 : null;
                  dirSign = -1;
                } else if (idx >= ln.stations.length - 1) {
                  // After last station: arrow extends past it in the
                  // direction of the final segment.
                  originIdx = idx;
                  dirToIdx = idx > 0 ? idx - 1 : null;
                  dirSign = -1;
                } else {
                  // Between K and K+1: arrow points from K toward K+1.
                  originIdx = idx;
                  dirToIdx = idx + 1;
                  dirSign = 1;
                }

                const originSid = ln.stations[originIdx];
                const origin = originSid ? stopWorld(originSid) : null;
                const dirRef = dirToIdx != null ? stopWorld(ln.stations[dirToIdx]) : null;
                let arrow: React.ReactNode = null;
                if (origin && dirRef) {
                  const rdx = (dirRef.x - origin.x) * dirSign;
                  const rdy = (dirRef.y - origin.y) * dirSign;
                  const rlen = Math.hypot(rdx, rdy) || 1;
                  const dx = rdx / rlen;
                  const dy = rdy / rlen;
                  const px = -dy;
                  const py = dx;
                  // Triangle: base STOP_SIZE wide centered just past the
                  // dot, apex one stop further along the direction. For
                  // the -1 ("add before start") case the arrow is rendered
                  // outside station 0, but flipped 180° so it points back
                  // down the line at station 0.
                  const baseDist = STOP_SIZE * 0.85;
                  const apexDist = baseDist + STOP_SIZE * 0.7;
                  const halfW = STOP_SIZE * 0.55;
                  const flipped = idx === -1;
                  const baseR = flipped ? apexDist : baseDist;
                  const apexR = flipped ? baseDist : apexDist;
                  const baseCx = origin.x + dx * baseR;
                  const baseCy = origin.y + dy * baseR;
                  const apexX = origin.x + dx * apexR;
                  const apexY = origin.y + dy * apexR;
                  const lX = baseCx + px * halfW;
                  const lY = baseCy + py * halfW;
                  const rX = baseCx - px * halfW;
                  const rY = baseCy - py * halfW;
                  arrow = (
                    <path
                      d={`M ${apexX} ${apexY} L ${lX} ${lY} L ${rX} ${rY} Z`}
                      fill={ln.color}
                      stroke={legibleTextOn(ln.color)}
                      strokeWidth={1}
                      strokeLinejoin="round"
                    />
                  );
                }

                const starterSid = idx >= 0 ? ln.stations[idx] : null;
                const starter =
                  starterSid && stations[starterSid] ? (
                    <StationView
                      key={'starter:' + starterSid}
                      station={stations[starterSid]}
                      lines={lines}
                      zoom={view.viewport.zoom}
                      onStartDrag={drag.onStartDrag}
                      layer="starter-label"
                      highlightColor={ln.color}
                    />
                  ) : null;

                return (
                  <>
                    {addable}
                    {arrow}
                    {starter}
                  </>
                );
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
            painted on top of everything so the outline is never occluded.
            One per selected station. */}
        {selection.selectedStationIds.map(
          (sid) =>
            stations[sid] && (
              <StationView
                key={sid + ':stroke'}
                station={stations[sid]}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="stroke"
              />
            ),
        )}

        {/* Rubber-band rect for the rect-select gesture. World coords; the
            stroke width compensates for zoom so the dashed line stays a
            consistent screen weight. */}
        {rectSelect.rect && (
          <rect
            x={Math.min(rectSelect.rect.x0, rectSelect.rect.x1)}
            y={Math.min(rectSelect.rect.y0, rectSelect.rect.y1)}
            width={Math.abs(rectSelect.rect.x1 - rectSelect.rect.x0)}
            height={Math.abs(rectSelect.rect.y1 - rectSelect.rect.y0)}
            fill="rgba(26, 78, 168, 0.08)"
            stroke="#1a4ea8"
            strokeWidth={1.5 / view.viewport.zoom}
            strokeDasharray={`${4 / view.viewport.zoom} ${3 / view.viewport.zoom}`}
            pointerEvents="none"
          />
        )}

        {/* Snap guides: rendered last so the dotted lines + measurement
            labels sit on top of line tags and everything else. */}
        <SnapGuides guides={[...drag.snapGuides, ...bulletSnapGuides]} zoom={view.viewport.zoom} />
      </svg>

      {selection.selectedRouteBulletId &&
        routeBullets[selection.selectedRouteBulletId] &&
        view.vbW > 0 &&
        view.vbH > 0 &&
        (() => {
          const b = routeBullets[selection.selectedRouteBulletId];
          // Canvas-host-relative pixel coords from the bullet's world
          // position via the current viewport. No ref reads — keeps the
          // react-hooks lint happy.
          const x = ((b.x - view.vbX) / view.vbW) * view.size.w;
          const y = ((b.y - view.vbY) / view.vbH) * view.size.h;
          return (
            <RouteBulletPopover
              bullet={b}
              anchor={{ x, y }}
              onClose={() => selection.selectRouteBullet(null)}
            />
          );
        })()}

      <WarningToasts />
    </div>
  );
}
