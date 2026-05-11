import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';

import { beginHistoryGroup, dragState, useDoc, useSelection } from '../state/store';
import { randomStationName } from '../state/stationNames';
import { useSnapPrefs } from '../state/snapPrefs';
import { snapDraggedStation, type SnapGuide } from '../geometry/snap';
import {
  buildBands,
  buildOrderedRenderables,
  buildStopMarkers,
  SegmentBandSpec,
} from '../geometry/interlining';
import { STOP_SIZE, stopCenterAt, travelDirLocal, rotateBy } from '../geometry/orientation';
import { BandWarning, SegmentBand } from './SegmentBand';
import { HatchPatterns, lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from './HatchPatterns';
import { StopMarker } from './StopMarker';
import { StopGlyph } from './StopGlyph';
import { StationView } from './StationView';
import { useViewport } from './canvas/useViewport';
import { useStationDrag } from './canvas/useStationDrag';
import { useRectSelect } from './canvas/useRectSelect';
import { Grid } from './canvas/Grid';
import { WarningToasts } from './canvas/WarningToasts';
import { EditingBanner } from './canvas/EditingBanner';
import { SnapGuides } from './canvas/SnapGuides';
import { LineTagsLayer } from './canvas/LineTagsLayer';
import { StationPlacingPreview } from './canvas/StationPlacingPreview';
import { LabelPlacingPreview } from './canvas/LabelPlacingPreview';
import { RouteBulletView } from './RouteBulletView';
import { RouteBulletPopover } from './RouteBulletPopover';
import { LabelView } from './LabelView';
import { TextLabelPopover } from './TextLabelPopover';
import { TransferLayer, transferEndWorld } from './TransferLayer';
import {
  closestParamOnOffsetPath,
  lineTraversesForwardCanon,
  offsetPathLength,
  sampleOffsetPath,
} from '../geometry/lineTagGeometry';
import type { LineId, Station, StopCell } from '../model/types';
import { findMatchingStations } from '../model/matching';
import { pairKeyOf } from '../model/pairKey';
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
  const textLabels = useDoc((s) => s.textLabels);
  const addTextLabel = useDoc((s) => s.addTextLabel);
  const moveTextLabel = useDoc((s) => s.moveTextLabel);
  const rotateTextLabel = useDoc((s) => s.rotateTextLabel);
  const selection = useSelection();
  const snapModes = useSnapPrefs((s) => s.modes);
  const highlightLineId = selection.selectedLineId;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const view = useViewport(svgRef);
  const drag = useStationDrag(svgRef, view.viewport.zoom);
  const rectSelect = useRectSelect(svgRef, view.screenToWorld);
  // While a rect-select drag is in flight, render selection visuals
  // (station wash/stroke and bullet ring) over the previewed result
  // instead of the live selection so the user sees exactly what'll be
  // selected on release.
  const washIds = rectSelect.previewStationIds ?? selection.selectedStationIds;
  const bulletSelectedIds = rectSelect.previewBulletIds ?? selection.selectedRouteBulletIds;
  const labelSelectedIds = rectSelect.previewLabelIds ?? selection.selectedLabelIds;

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
    return findMatchingStations({ stations, lines }, soloSelectedId).map((m) => m.id);
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

  // Distinct colors of any line that has at least one hatched segment (in
  // either direction). Drives <pattern> emission in <defs>; each color gets
  // both hatch patterns (+45° and -45°) so SegmentBand can reference whichever
  // variant a stripe needs via hatchPatternId(color, variant).
  const hatchedColors = useMemo(() => {
    const seen = new Set<string>();
    for (const ln of Object.values(lines)) {
      if (!ln.segmentStyles) continue;
      const hasHatch = Object.values(ln.segmentStyles).some(
        (s) => s === 'hatched' || s === 'hatched-mirror',
      );
      if (!hasHatch) continue;
      const effective = colorMap?.[ln.id] ?? ln.color;
      seen.add(effective);
    }
    return Array.from(seen);
  }, [lines, colorMap]);

  // Band stripes, band warnings, and stop markers merged into one pass and
  // sorted back-to-front by per-stripe z-priority. Each stripe in an
  // interlined band paints at its own line's lineOrder index, so a
  // perpendicular line whose layer falls between two interlined lines
  // renders between their stripes (not behind the whole band).
  const renderables = useMemo(() => {
    const markers = buildStopMarkers(stations, lines, lineOrder, bands);
    return buildOrderedRenderables(bands, markers);
  }, [bands, stations, lines, lineOrder]);

  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;

  // Bullet drag state — minimal local ref to avoid a whole new hook for
  // now. When the grabbed bullet is part of a multi-selection, sibling
  // arrays carry every other selected item along by the same delta.
  const bulletDragRef = useRef<{
    id: string;
    startWX: number;
    startWY: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    bulletSiblings: { id: string; startX: number; startY: number }[];
    stationSiblings: { id: string; startX: number; startY: number }[];
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  // Text-label drag state. Same shape as bulletDragRef, minus snap (labels
  // don't snap in this iteration). Tracks group-drag siblings (other labels,
  // stations, bullets) so the whole multi-selection moves as a rigid body.
  const labelDragRef = useRef<{
    id: string;
    startWX: number;
    startWY: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    labelSiblings: { id: string; startX: number; startY: number }[];
    bulletSiblings: { id: string; startX: number; startY: number }[];
    stationSiblings: { id: string; startX: number; startY: number }[];
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  const [bulletSnapGuides, setBulletSnapGuides] = useState<SnapGuide[]>([]);
  // Cursor position in world coords — drives the in-progress transfer line
  // from the anchor dot to the cursor, and the station-placing-mode ghost
  // that follows the cursor before each click.
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);
  // Pre-rolled name for the next station that'll drop in placing mode, so
  // the ghost shows the actual name (not a placeholder) and the click commits
  // the same name the user just saw. Reset when placing mode toggles via the
  // "adjust state during render" pattern — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [previewName, setPreviewName] = useState<string | null>(() =>
    selection.placingStation ? randomStationName() : null,
  );
  const [prevPlacing, setPrevPlacing] = useState(selection.placingStation);
  if (selection.placingStation !== prevPlacing) {
    setPrevPlacing(selection.placingStation);
    setPreviewName(selection.placingStation ? randomStationName() : null);
  }

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
    if (
      (selection.creatingTransfer && selection.transferAnchor) ||
      selection.placingStation ||
      selection.placingLabel
    ) {
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
        // Group-drag suppresses the bullet-line snap: siblings are moving,
        // so snap targets become unstable and a half-snapped grabbed
        // bullet would drag the whole group off-axis.
        const inGroupDrag = bd.bulletSiblings.length > 0 || bd.stationSiblings.length > 0;
        if (lineId && !e.shiftKey && !inGroupDrag) {
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
            modes: snapModes,
          });
          nx = snap.x;
          ny = snap.y;
          setBulletSnapGuides(snap.guides);
        } else if (bulletSnapGuides.length > 0) {
          setBulletSnapGuides([]);
        }
        moveRouteBullet(bd.id, nx, ny);
        if (inGroupDrag) {
          const deltaX = nx - bd.startWX;
          const deltaY = ny - bd.startWY;
          for (const bs of bd.bulletSiblings) {
            moveRouteBullet(bs.id, bs.startX + deltaX, bs.startY + deltaY);
          }
          for (const ss of bd.stationSiblings) {
            useDoc.getState().moveStation(ss.id, ss.startX + deltaX, ss.startY + deltaY);
          }
        }
      }
    }
    const ld = labelDragRef.current;
    if (ld) {
      const dxScreen = e.clientX - ld.startMX;
      const dyScreen = e.clientY - ld.startMY;
      if (!ld.moved && Math.hypot(dxScreen, dyScreen) > 4) {
        ld.moved = true;
        dragState.suppressClick = true;
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      if (ld.moved) {
        const dx = dxScreen / view.viewport.zoom;
        const dy = dyScreen / view.viewport.zoom;
        const nx = ld.startWX + dx;
        const ny = ld.startWY + dy;
        moveTextLabel(ld.id, nx, ny);
        const inGroupDrag =
          ld.labelSiblings.length + ld.bulletSiblings.length + ld.stationSiblings.length > 0;
        if (inGroupDrag) {
          for (const ls of ld.labelSiblings) {
            moveTextLabel(ls.id, ls.startX + dx, ls.startY + dy);
          }
          for (const bs of ld.bulletSiblings) {
            moveRouteBullet(bs.id, bs.startX + dx, bs.startY + dy);
          }
          for (const ss of ld.stationSiblings) {
            useDoc.getState().moveStation(ss.id, ss.startX + dx, ss.startY + dy);
          }
        }
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
    const ld = labelDragRef.current;
    if (ld) {
      const wasMoved = ld.moved;
      labelDragRef.current = null;
      if (wasMoved) {
        ld.history.commit();
        try {
          svgRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // pointer may not have been captured
        }
        setTimeout(() => {
          dragState.suppressClick = false;
        }, 0);
      } else {
        ld.history.cancel();
      }
    }
  };

  const onBulletPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    const b = routeBullets[id];
    if (!b) return;
    e.stopPropagation();
    // Group-drag: if the grabbed bullet is part of the multi-selection,
    // every other selected item (bullets + stations) tags along with the
    // same delta on each pointer move.
    const sel = useSelection.getState();
    const includesGrabbed = sel.selectedRouteBulletIds.includes(id);
    const bulletSiblings: { id: string; startX: number; startY: number }[] = [];
    const stationSiblings: { id: string; startX: number; startY: number }[] = [];
    if (includesGrabbed) {
      for (const bid of sel.selectedRouteBulletIds) {
        if (bid === id) continue;
        const sb = routeBullets[bid];
        if (!sb) continue;
        bulletSiblings.push({ id: bid, startX: sb.x, startY: sb.y });
      }
      for (const sid of sel.selectedStationIds) {
        const ss = stations[sid];
        if (!ss) continue;
        stationSiblings.push({ id: sid, startX: ss.x, startY: ss.y });
      }
    }
    bulletDragRef.current = {
      id,
      startWX: b.x,
      startWY: b.y,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      bulletSiblings,
      stationSiblings,
      history: beginHistoryGroup(),
    };
  };
  const onBulletClick = (id: string, e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    if (inHandMode) return;
    e.stopPropagation();
    // Shift-click toggles bullet membership without disturbing other
    // selected items (mirrors station shift-click). Plain click replaces
    // the entire selection with this bullet.
    if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      selection.toggleRouteBulletSelection(id);
      return;
    }
    selection.selectRouteBullet(id);
  };
  const onBulletContextMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Right-click on a bullet that's part of a multi-selection rotates
    // the whole group rigidly around this bullet, mirroring the station
    // gesture. Stations, bullets, and labels all orbit via the unified
    // rotateItemsAround.
    const sel = useSelection.getState();
    const stIds = sel.selectedStationIds;
    const blIds = sel.selectedRouteBulletIds;
    const lbIds = sel.selectedLabelIds;
    const total = stIds.length + blIds.length + lbIds.length;
    if (total > 1 && blIds.includes(id)) {
      const members: { type: 'station' | 'bullet' | 'label'; id: string }[] = [
        ...stIds.map((sid) => ({ type: 'station' as const, id: sid })),
        ...blIds.map((bid) => ({ type: 'bullet' as const, id: bid })),
        ...lbIds.map((gid) => ({ type: 'label' as const, id: gid })),
      ];
      useDoc.getState().rotateItemsAround({ type: 'bullet', id }, members);
      return;
    }
    rotateRouteBullet(id);
  };

  const onLabelClick = (id: string, e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    if (inHandMode) return;
    e.stopPropagation();
    // Shift-click toggles membership (matching stations / bullets). Plain
    // click replaces the whole selection with just this label, which also
    // opens the popover (popover gates on `selectedLabelIds.length === 1`).
    if (e.shiftKey) {
      selection.toggleLabelSelection(id);
      return;
    }
    selection.selectLabel(id);
  };
  const onLabelContextMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Right-click on a label that's part of a multi-selection rotates the
    // whole group rigidly around this label, mirroring station + bullet
    // gestures. All three item types orbit via the unified rotateItemsAround.
    const sel = useSelection.getState();
    const stIds = sel.selectedStationIds;
    const blIds = sel.selectedRouteBulletIds;
    const lbIds = sel.selectedLabelIds;
    const total = stIds.length + blIds.length + lbIds.length;
    if (total > 1 && lbIds.includes(id)) {
      const members: { type: 'station' | 'bullet' | 'label'; id: string }[] = [
        ...stIds.map((sid) => ({ type: 'station' as const, id: sid })),
        ...blIds.map((bid) => ({ type: 'bullet' as const, id: bid })),
        ...lbIds.map((gid) => ({ type: 'label' as const, id: gid })),
      ];
      useDoc.getState().rotateItemsAround({ type: 'label', id }, members);
      return;
    }
    rotateTextLabel(id);
  };
  const onLabelPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (inHandMode) return;
    const lbl = textLabels[id];
    if (!lbl) return;
    e.stopPropagation();
    // Group-drag: if the grabbed label is part of the multi-selection,
    // every other selected item (labels + bullets + stations) tags along.
    const sel = useSelection.getState();
    const includesGrabbed = sel.selectedLabelIds.includes(id);
    const labelSiblings: { id: string; startX: number; startY: number }[] = [];
    const bulletSiblings: { id: string; startX: number; startY: number }[] = [];
    const stationSiblings: { id: string; startX: number; startY: number }[] = [];
    if (includesGrabbed) {
      for (const gid of sel.selectedLabelIds) {
        if (gid === id) continue;
        const sg = textLabels[gid];
        if (!sg) continue;
        labelSiblings.push({ id: gid, startX: sg.x, startY: sg.y });
      }
      for (const bid of sel.selectedRouteBulletIds) {
        const sb = routeBullets[bid];
        if (!sb) continue;
        bulletSiblings.push({ id: bid, startX: sb.x, startY: sb.y });
      }
      for (const sid of sel.selectedStationIds) {
        const ss = stations[sid];
        if (!ss) continue;
        stationSiblings.push({ id: sid, startX: ss.x, startY: ss.y });
      }
    }
    labelDragRef.current = {
      id,
      startWX: lbl.x,
      startWY: lbl.y,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      labelSiblings,
      bulletSiblings,
      stationSiblings,
      history: beginHistoryGroup(),
    };
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (inHandMode) return;
    const onBackground =
      e.target === svgRef.current || (e.target as Element).hasAttribute('data-bg');
    if (!onBackground) return;
    if (dragState.suppressClick) return;
    if (selection.placingStation) {
      const w = view.screenToWorld(e.clientX, e.clientY);
      addStation(w.x, w.y, previewName ?? undefined);
      setPreviewName(randomStationName());
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
    if (selection.placingLabel) {
      // Single-shot: place one label, exit placing mode, and auto-select the
      // new label so the popover opens. Different from station / bullet
      // placement, which stay in mode for rapid click-click-click drops —
      // labels are heavier (text edit) so the single-shot flow makes sense.
      const w = view.screenToWorld(e.clientX, e.clientY);
      const id = addTextLabel(w.x, w.y);
      selection.setPlacingLabel(false);
      selection.selectLabel(id);
      return;
    }
    selection.selectStation(null);
    selection.selectLineTag(null);
    selection.selectRouteBullet(null);
    selection.selectTransfer(null);
    selection.selectLabel(null);
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
        onPointerLeave={() => {
          if (cursorWorld) setCursorWorld(null);
        }}
        onClick={onCanvasClick}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <defs>
          <HatchPatterns colors={hatchedColors} />
        </defs>

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
            background. One per selected station (or per previewed station
            during a rect-select drag). */}
        {washIds.map(
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

        {/* band stripes, warnings, and stop squares interleaved by per-stripe z-priority */}
        {renderables.map((r) => {
          if (r.kind === 'stripe') {
            const stripeLineId = r.band.lines[r.stripeIndex].id;
            return (
              <SegmentBand
                key={'s:' + r.band.bandKey + ':' + stripeLineId}
                spec={r.band}
                stripeIndex={r.stripeIndex}
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
                {...(selection.creatingLineTag ? makeBandHandlers(r.band) : {})}
              />
            );
          }
          if (r.kind === 'warning') {
            return <BandWarning key={'w:' + r.band.bandKey} spec={r.band} />;
          }
          const effectiveColor =
            colorMap && r.spec.lineId !== highlightLineId
              ? (colorMap[r.spec.lineId] ?? r.spec.color)
              : r.spec.color;
          return (
            <StopMarker
              key={'m:' + r.spec.stationId + ':' + r.spec.lineId}
              spec={r.spec}
              effectiveColor={effectiveColor}
            />
          );
        })}

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

        {/* Station-placing-mode ghost: a faint dot + name following the
            cursor before each click, so the user can see where (and what
            name) the next placement will land. */}
        <StationPlacingPreview
          world={selection.placingStation ? cursorWorld : null}
          name={previewName}
          lines={lines}
        />
        {/* Label-placing-mode ghost: a faint "New Label" following the cursor
            before the click. Single-shot placement, so it disappears as soon
            as the user clicks (the click handler exits placingLabel). */}
        <LabelPlacingPreview world={selection.placingLabel ? cursorWorld : null} />

        {/* Route bullets: rendered before the dim so they fade with the
            rest of the map when a line is selected. */}
        {Object.values(routeBullets).map((b) => (
          <RouteBulletView
            key={b.id}
            bullet={b}
            lines={lines}
            selected={bulletSelectedIds.includes(b.id)}
            onPointerDown={onBulletPointerDown}
            onClick={onBulletClick}
            onContextMenu={onBulletContextMenu}
          />
        ))}

        {/* Text labels: free-floating annotations on top of stations + bullets
            but beneath the selection stroke ring. Dimmed alongside the rest
            of the map when a line is selected. */}
        {Object.values(textLabels).map((g) => (
          <LabelView
            key={g.id}
            label={g}
            selected={labelSelectedIds.includes(g.id)}
            layer="bg"
            onPointerDown={onLabelPointerDown}
            onClick={onLabelClick}
            onContextMenu={onLabelContextMenu}
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
            {(() => {
              const ln = lines[highlightLineId];
              if (!ln) return null;
              const hov = selection.hoveredInspectorSegment;
              const hovPairKey = hov ? pairKeyOf(hov.fromStationId, hov.toStationId) : null;
              const isHoverStation = (sid: string) =>
                !!hov && (sid === hov.fromStationId || sid === hov.toStationId);
              // Two buckets so dimmed stripe + colored stop square + direction
              // triangle at one station composite *together* into one isolated
              // group (children overdraw normally, then the group composites
              // once at 0.2). Without this each dimmed element composites to
              // the background separately and you see the stripe tinting
              // through the marker, the marker tinting through the triangle,
              // etc. When no divider is hovered, everything goes into the
              // matched bucket and renders flat.
              const dimmed: ReactNode[] = [];
              const matched: ReactNode[] = [];
              const push = (m: boolean, node: ReactNode) =>
                (m || !hov ? matched : dimmed).push(node);
              renderables.forEach((r, i) => {
                if (r.kind !== 'stripe') return;
                const stripeLn = r.band.lines[r.stripeIndex];
                if (stripeLn.id !== highlightLineId) return;
                const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(
                  stripeLn.style,
                  stripeLn.color,
                );
                const underlay = lineStyleUnderlayAttrs(stripeLn.style);
                const m = !!hov && hov.lineId === stripeLn.id && r.band.pairKey === hovPairKey;
                push(
                  m,
                  <Fragment key={'hl-b:' + i}>
                    {underlay && (
                      <path
                        d={r.band.paths[r.stripeIndex]}
                        fill="none"
                        stroke={underlay.stroke}
                        strokeWidth={14}
                        strokeLinecap={underlay.strokeLinecap}
                        strokeLinejoin="round"
                      />
                    )}
                    <path
                      d={r.band.paths[r.stripeIndex]}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={14}
                      strokeLinecap={strokeLinecap}
                      strokeLinejoin="round"
                      strokeDasharray={strokeDasharray}
                    />
                  </Fragment>,
                );
              });
              renderables.forEach((r, i) => {
                if (r.kind !== 'marker' || r.spec.lineId !== highlightLineId) return;
                push(
                  isHoverStation(r.spec.stationId),
                  <StopMarker key={'hl-m:' + i} spec={r.spec} />,
                );
              });
              // Direction triangles: small arrow ~5px past each stop dot
              // pointing along the stop's own travel direction.
              type P = { sid: string; x: number; y: number; st: Station; cell: StopCell };
              const points: P[] = [];
              for (const sid of ln.stations) {
                const st = stations[sid];
                if (!st) continue;
                const cell = st.stops.find((c) => c.lineId === highlightLineId);
                if (!cell) continue;
                const local = stopCenterAt(cell.row, cell.col);
                const a = (st.rotation * Math.PI) / 4;
                const cs = Math.cos(a);
                const sn = Math.sin(a);
                points.push({
                  sid,
                  st,
                  cell,
                  x: st.x + local.x * cs - local.y * sn,
                  y: st.y + local.x * sn + local.y * cs,
                });
              }
              if (points.length >= 2) {
                const dotR = STOP_SIZE * 0.28;
                const gap = 2;
                const halfW = 3;
                const height = 5;
                const baseDist = dotR + gap;
                const apexDist = baseDist + height;
                points.forEach((p, i) => {
                  // Hint resolves auto-* sign; for explicit orientations it's
                  // ignored. Use the segment toward the next stop (or back from
                  // the previous stop at the terminus).
                  const ref = i < points.length - 1 ? points[i + 1] : points[i - 1];
                  const sign = i < points.length - 1 ? 1 : -1;
                  const worldHint = { x: (ref.x - p.x) * sign, y: (ref.y - p.y) * sign };
                  const aInv = -(p.st.rotation * Math.PI) / 4;
                  const ci = Math.cos(aInv);
                  const si = Math.sin(aInv);
                  const localHint = {
                    x: worldHint.x * ci - worldHint.y * si,
                    y: worldHint.x * si + worldHint.y * ci,
                  };
                  const localDir = travelDirLocal(p.cell.orientation, localHint);
                  const worldDir = rotateBy(localDir, p.st.rotation);
                  const dx = worldDir.x;
                  const dy = worldDir.y;
                  const px = -dy;
                  const py = dx;
                  const baseCx = p.x + dx * baseDist;
                  const baseCy = p.y + dy * baseDist;
                  const apexX = p.x + dx * apexDist;
                  const apexY = p.y + dy * apexDist;
                  const lX = baseCx + px * halfW;
                  const lY = baseCy + py * halfW;
                  const rX = baseCx - px * halfW;
                  const rY = baseCy - py * halfW;
                  const isTerminus = i === points.length - 1;
                  push(
                    isHoverStation(p.sid),
                    <path
                      key={'hl-tri:' + p.sid}
                      d={`M ${apexX} ${apexY} L ${lX} ${lY} L ${rX} ${rY} Z`}
                      fill={isTerminus ? ln.color : '#000'}
                      stroke={isTerminus ? ln.color : undefined}
                      strokeWidth={isTerminus ? 10 : undefined}
                      strokeLinejoin={isTerminus ? 'miter' : undefined}
                      paintOrder={isTerminus ? 'stroke fill' : undefined}
                    />,
                  );
                });
              }
              // Re-render the selected line's stop dots on top so the colored
              // markers and direction triangles don't swallow them.
              for (const sid of ln.stations) {
                const st = stations[sid];
                if (!st) continue;
                const cell = st.stops.find((c) => c.lineId === highlightLineId);
                if (!cell) continue;
                const local = stopCenterAt(cell.row, cell.col);
                const a = (st.rotation * Math.PI) / 4;
                const cs = Math.cos(a);
                const sn = Math.sin(a);
                const cx = st.x + local.x * cs - local.y * sn;
                const cy = st.y + local.x * sn + local.y * cs;
                push(
                  isHoverStation(sid),
                  <StopGlyph
                    key={'hl-d:' + sid}
                    cx={cx}
                    cy={cy}
                    shape={cell.dotShape}
                    stationId={sid}
                    lineId={cell.lineId}
                  />,
                );
              }
              // Selected line's station names rendered in white above dim.
              // The append-mode "starter" station gets its own treatment
              // below (line-color name + arrowhead), so skip it here.
              const starterId =
                selection.appendingToLineId === highlightLineId &&
                selection.insertAfterIndex != null &&
                selection.insertAfterIndex >= 0
                  ? ln.stations[selection.insertAfterIndex]
                  : null;
              for (const sid of ln.stations) {
                if (sid === starterId) continue;
                const st = stations[sid];
                if (!st) continue;
                push(
                  isHoverStation(sid),
                  <StationView
                    key={'hl-l:' + sid}
                    station={st}
                    lines={lines}
                    zoom={view.viewport.zoom}
                    onStartDrag={drag.onStartDrag}
                    layer="highlight-label"
                  />,
                );
              }
              return (
                <>
                  {dimmed.length > 0 && <g opacity={0.2}>{dimmed}</g>}
                  {matched}
                </>
              );
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
            One per selected station (or per previewed station during a
            rect-select drag). */}
        {washIds.map(
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

        {/* Selection stroke for text labels: dashed black ring around each
            selected label's rotated bbox. Painted in this pass so it sits
            above the dim overlay and on top of the network — matching how
            stations and bullets handle their outlines. */}
        {labelSelectedIds.map(
          (gid) =>
            textLabels[gid] && (
              <LabelView key={gid + ':stroke'} label={textLabels[gid]} selected layer="stroke" />
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

      {selection.selectedRouteBulletIds.length === 1 &&
        selection.selectedStationIds.length === 0 &&
        routeBullets[selection.selectedRouteBulletIds[0]] &&
        view.vbW > 0 &&
        view.vbH > 0 &&
        (() => {
          const b = routeBullets[selection.selectedRouteBulletIds[0]];
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

      {selection.selectedLabelIds.length === 1 &&
        selection.selectedStationIds.length === 0 &&
        selection.selectedRouteBulletIds.length === 0 &&
        textLabels[selection.selectedLabelIds[0]] &&
        view.vbW > 0 &&
        view.vbH > 0 &&
        (() => {
          const g = textLabels[selection.selectedLabelIds[0]];
          const x = ((g.x - view.vbX) / view.vbW) * view.size.w;
          const y = ((g.y - view.vbY) / view.vbH) * view.size.h;
          return (
            <TextLabelPopover
              label={g}
              anchor={{ x, y }}
              onClose={() => selection.selectLabel(null)}
            />
          );
        })()}

      <WarningToasts />
    </div>
  );
}
