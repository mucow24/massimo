import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, dragState, useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import {
  snapDraggedStation,
  snapLabelToGrid,
  snapPointToGrid,
  type SnapGuide,
} from '../../geometry/snap';
import { measureTextLabel } from '../../geometry/textMeasure';
import { TEXT_LABEL_HIT_PAD } from '../../geometry/stationBoundary';
import type { Vec2 } from '../../geometry/vec';

const BULLET_SNAP_TOLERANCE = 10;

// Drag state for a free-floating x/y item (route bullet or text label). When
// the grabbed item is part of a multi-selection, the sibling arrays carry every
// other selected item along by the same per-frame delta.
type ItemDragState = {
  id: string;
  startWX: number;
  startWY: number;
  startMX: number;
  startMY: number;
  moved: boolean;
  bulletSiblings: { id: string; startX: number; startY: number }[];
  stationSiblings: { id: string; startX: number; startY: number }[];
  labelSiblings: { id: string; startX: number; startY: number }[];
  polygonSiblings: { id: string; startVerts: Vec2[] }[];
  history: ReturnType<typeof beginHistoryGroup>;
};

export interface ItemDragApi {
  bulletSnapGuides: SnapGuide[];
  onBulletPointerDown: (id: string, e: React.PointerEvent) => void;
  onLabelPointerDown: (id: string, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * Owns drag state for the free-floating items — route bullets and text labels.
 * Mirrors {@link useStationDrag}: tracks the in-flight drag, snaps the grabbed
 * item (bullet uses the station snap engine in bullet mode + grid fallback;
 * labels grid-snap their visible upper-left), tows multi-selection siblings,
 * and commits one history entry per gesture. Pointer handlers are drag-only;
 * the shell composes them onto each event alongside pan / station drag.
 *
 * Lifted verbatim out of MapCanvas (previously two inline refs); the only change
 * is that viewport zoom + hand-mode come in as arguments.
 */
export function useItemDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  inHandMode: boolean,
): ItemDragApi {
  const routeBullets = useDoc((s) => s.routeBullets);
  const textLabels = useDoc((s) => s.textLabels);
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const moveRouteBullet = useDoc((s) => s.moveRouteBullet);
  const moveTextLabel = useDoc((s) => s.moveTextLabel);
  const setPolygonVertices = useDoc((s) => s.setPolygonVertices);
  const polygons = useDoc((s) => s.polygons);
  const snapModes = useSnapPrefs((s) => s.modes);

  const bulletDragRef = useRef<ItemDragState | null>(null);
  const labelDragRef = useRef<ItemDragState | null>(null);
  const [bulletSnapGuides, setBulletSnapGuides] = useState<SnapGuide[]>([]);

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
    const labelSiblings: { id: string; startX: number; startY: number }[] = [];
    const polygonSiblings: { id: string; startVerts: Vec2[] }[] = [];
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
      for (const lid of sel.selectedLabelIds) {
        const lb = textLabels[lid];
        if (!lb) continue;
        labelSiblings.push({ id: lid, startX: lb.x, startY: lb.y });
      }
      for (const pid of sel.selectedPolygonIds) {
        const pg = polygons[pid];
        if (!pg) continue;
        polygonSiblings.push({ id: pid, startVerts: pg.vertices.map((v) => ({ ...v })) });
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
      labelSiblings,
      polygonSiblings,
      history: beginHistoryGroup(),
    };
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
    const polygonSiblings: { id: string; startVerts: Vec2[] }[] = [];
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
      for (const pid of sel.selectedPolygonIds) {
        const pg = polygons[pid];
        if (!pg) continue;
        polygonSiblings.push({ id: pid, startVerts: pg.vertices.map((v) => ({ ...v })) });
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
      polygonSiblings,
      history: beginHistoryGroup(),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
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
        const dx = dxScreen / zoom;
        const dy = dyScreen / zoom;
        let nx = bd.startWX + dx;
        let ny = bd.startWY + dy;
        const cur = routeBullets[bd.id];
        const lineId = cur?.lineId ?? null;
        // Group-drag suppresses the bullet-line snap: siblings are moving,
        // so snap targets become unstable and a half-snapped grabbed
        // bullet would drag the whole group off-axis.
        const inGroupDrag =
          bd.bulletSiblings.length > 0 ||
          bd.stationSiblings.length > 0 ||
          bd.labelSiblings.length > 0 ||
          bd.polygonSiblings.length > 0;
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
        } else {
          if (bulletSnapGuides.length > 0) setBulletSnapGuides([]);
          // Grid snap fallback when the snap engine wasn't called (unbound
          // bullet or group drag). Shift still bypasses.
          if (snapModes.grid !== 'off' && !e.shiftKey) {
            const g = snapPointToGrid(nx, ny, snapModes.grid);
            nx = g.x;
            ny = g.y;
          }
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
          for (const ls of bd.labelSiblings) {
            moveTextLabel(ls.id, ls.startX + deltaX, ls.startY + deltaY);
          }
          for (const ps of bd.polygonSiblings) {
            setPolygonVertices(
              ps.id,
              ps.startVerts.map((v) => ({ x: v.x + deltaX, y: v.y + deltaY })),
            );
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
        const rawDx = dxScreen / zoom;
        const rawDy = dyScreen / zoom;
        let nx = ld.startWX + rawDx;
        let ny = ld.startWY + rawDy;
        // Labels don't go through the snap engine (no axis/orientation), but
        // grid snap still applies. Register the label by its upper-left
        // bbox corner so the visible edge lands on a grid line. Shift
        // bypasses like elsewhere.
        if (snapModes.grid !== 'off' && !e.shiftKey) {
          const cur = textLabels[ld.id];
          if (cur) {
            const m = measureTextLabel(cur);
            // Snap the VISIBLE upper-left (the dashed selection ring), which
            // includes hit-test padding around the text bbox — that's the
            // corner the user actually sees on screen.
            const snapped = snapLabelToGrid(
              { x: nx, y: ny },
              m.width + 2 * TEXT_LABEL_HIT_PAD,
              m.height + 2 * TEXT_LABEL_HIT_PAD,
              snapModes.grid,
            );
            nx = snapped.x;
            ny = snapped.y;
          }
        }
        const dx = nx - ld.startWX;
        const dy = ny - ld.startWY;
        moveTextLabel(ld.id, nx, ny);
        const inGroupDrag =
          ld.labelSiblings.length +
            ld.bulletSiblings.length +
            ld.stationSiblings.length +
            ld.polygonSiblings.length >
          0;
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
          for (const ps of ld.polygonSiblings) {
            setPolygonVertices(
              ps.id,
              ps.startVerts.map((v) => ({ x: v.x + dx, y: v.y + dy })),
            );
          }
        }
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
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

  return { bulletSnapGuides, onBulletPointerDown, onLabelPointerDown, onPointerMove, onPointerUp };
}
