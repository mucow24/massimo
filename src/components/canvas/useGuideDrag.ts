import { RefObject, useCallback, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useRoutedSnapGuides } from './useRoutedSnapGuides';
import {
  guideFoot,
  guideMoveVector,
  guideNudgeDelta,
  guideOffsetOf,
  type SnapGuide,
} from '../../geometry/snap';
import type { Vec2 } from '../../geometry/vec';
import type { GuideOrientation } from '../../model/types';
import { useDragSnap } from './useDragSnap';
import { liveAlignTargets } from './snapTargets';
import { finishDrag, pointerLost, releaseDragCapture, trackDragMove } from './dragGesture';
import {
  collectGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';
import { WELL_SIZE_PX } from './GuideWells';

export interface GuideDragApi {
  snapGuides: SnapGuide[];
  /** The well pull-out ghost, or null. MapCanvas renders it in the guides
   *  layer at placement-ghost opacity. */
  pull: { orientation: GuideOrientation; offset: number } | null;
  /** The well under the pointer while a drop there would CANCEL the pull or
   *  DELETE the dragged guide, so that well tints. It is the well the CURSOR
   *  occupies, not the guide's home: a strip guide's delete zone includes the
   *  corner squares (its whole edge band), and the square under the cursor is
   *  the one that must light up. */
  overWell: GuideOrientation | null;
  onStartDrag: (id: string, e: React.PointerEvent) => void;
  onWellPointerDown: (orientation: GuideOrientation, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

type ScreenToWorld = (mx: number, my: number) => Vec2;

/**
 * Guide gestures, both of them:
 *
 *  - DRAG an existing guide: 1-DOF — the offset follows the pointer's axis
 *    component, snapped through the point snapper with the matching
 *    `constrain` (so only alignments the guide can honour engage) against the
 *    shared pool. Groups tow rigidly by the guide's axis delta. Releasing
 *    back over the guide's home well DELETES it (the same place it came
 *    from), inside the gesture's single history entry.
 *
 *  - PULL a new guide out of a well: a ghost (no doc writes) follows and
 *    snaps exactly like a committed guide drag would; release commits one
 *    `addGuide` and selects it (opening the popover, like every single-shot
 *    placement); releasing back inside the well — or never crossing the drag
 *    threshold — creates nothing.
 *
 * Guides never snap to other guides (stacking two is meaningless), so neither
 * gesture passes `guideTargets`. Shift bypasses snapping, as everywhere. Both
 * gestures capture to the SVG on the first real move (trackDragMove), so the
 * svg's shared pointer pipeline drives them; the well strips also forward
 * their own move/up events for the sub-threshold stretch where the pointer is
 * still over the strip.
 */
export function useGuideDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  screenToWorld: ScreenToWorld,
): GuideDragApi {
  const moveGuide = useDoc((s) => s.moveGuide);
  const addGuide = useDoc((s) => s.addGuide);
  const deleteGuide = useDoc((s) => s.deleteGuide);
  const { snapPoint } = useDragSnap(zoom);
  const [snapGuides, setSnapGuides] = useRoutedSnapGuides('guide');
  const [pull, setPull] = useState<{ orientation: GuideOrientation; offset: number } | null>(null);
  const [overWell, setOverWell] = useState<GuideOrientation | null>(null);

  const dragRef = useRef<{
    id: string;
    orientation: GuideOrientation;
    startOffset: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    siblings: GroupSiblings;
    allTargets: Vec2[];
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  const pullRef = useRef<{
    orientation: GuideOrientation;
    offset: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    allTargets: Vec2[];
  } | null>(null);

  // Is the pointer inside (or past) the given orientation's home well — the
  // top edge band for horizontal guides, the left band for vertical, the
  // upper-left / lower-left corner squares for the diagonals? Beyond the
  // canvas edge counts too, so dragging a guide up into the toolbar reads as
  // "back into the well" rather than a stranded commit.
  const inWell = (orientation: GuideOrientation, e: { clientX: number; clientY: number }) => {
    const host = svgRef.current?.closest('.canvas-host')?.getBoundingClientRect();
    if (!host) return false;
    const inTop = e.clientY <= host.top + WELL_SIZE_PX;
    const inLeft = e.clientX <= host.left + WELL_SIZE_PX;
    switch (orientation) {
      case 'horizontal':
        return inTop;
      case 'vertical':
        return inLeft;
      case 'diagonal-up':
        return inLeft && inTop;
      case 'diagonal-down':
        return inLeft && e.clientY >= host.bottom - WELL_SIZE_PX;
    }
  };
  // The specific well under the pointer — corners beat the strips they
  // interrupt. Only consulted once `inWell` says the drop would delete, so a
  // strip guide hovering a corner square (inside its edge band, outside its
  // home strip) tints the square the cursor actually occupies.
  const wellAt = (e: { clientX: number; clientY: number }): GuideOrientation | null => {
    const host = svgRef.current?.closest('.canvas-host')?.getBoundingClientRect();
    if (!host) return null;
    const inTop = e.clientY <= host.top + WELL_SIZE_PX;
    const inLeft = e.clientX <= host.left + WELL_SIZE_PX;
    if (inLeft && inTop) return 'diagonal-up';
    if (inLeft && e.clientY >= host.bottom - WELL_SIZE_PX) return 'diagonal-down';
    if (inTop) return 'horizontal';
    if (inLeft) return 'vertical';
    return null;
  };
  const syncOverWell = (orientation: GuideOrientation, e: React.PointerEvent) => {
    const over = inWell(orientation, e) ? wellAt(e) : null;
    if (over !== overWell) setOverWell(over);
  };

  // Shared by both gestures: the snapped offset for a proposed pointer
  // position. The along-axis coordinate rides the live cursor (the proposed
  // point is the cursor's foot on the proposed guide line) so any drawn
  // alignment segment lands by the pointer, not at a stale spot.
  const snappedOffset = (
    orientation: GuideOrientation,
    rawOffset: number,
    e: React.PointerEvent,
    allTargets: Vec2[],
  ): number => {
    if (e.shiftKey) {
      // Unconditional clear: frozen local state can't gate a clear while the
      // pipeline is armed (see useRoutedSnapGuides).
      setSnapGuides([]);
      return rawOffset;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    const proposed = guideFoot(orientation, rawOffset, world);
    const constrain =
      orientation === 'horizontal' ? 'y' : orientation === 'vertical' ? 'x' : orientation;
    const snap = snapPoint(proposed, { allTargets, constrain });
    setSnapGuides(snap.guides);
    return guideOffsetOf(orientation, snap);
  };

  const onStartDrag = useCallback((id: string, e: React.PointerEvent) => {
    // Left button only — a middle press bubbles to the pan, a right press to
    // the context-menu path; either would fight a move handler.
    if (e.button !== 0) return;
    const guide = useDoc.getState().guides[id];
    if (!guide || guide.locked) return;
    // Selecting at pointer-down is the scaffolding convention (the popover
    // appears as you grab — see useLineCircleDrag, which also spells out why
    // an already-selected or Shift-grabbed item must NOT re-select).
    const sel = useSelection.getState();
    if (!e.shiftKey && !sel.selectedGuideIds.includes(id)) sel.selectGuide(id);
    const siblings = collectGroupSiblings('guide', id);
    dragRef.current = {
      id,
      orientation: guide.orientation,
      startOffset: guide.offset,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      siblings,
      allTargets: liveAlignTargets(groupAlignExclude('guide', id, siblings)),
      history: beginHistoryGroup({ deferPersist: true }),
    };
  }, []);

  const onWellPointerDown = useCallback((orientation: GuideOrientation, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pullRef.current = {
      orientation,
      offset: 0,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      // No exclusions: the ghost isn't in the doc yet (placement's rule).
      allTargets: liveAlignTargets(),
    };
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (ds) {
      if (pointerLost(e)) return onPointerCancel();
      const { moved, dxScreen, dyScreen } = trackDragMove(ds, e, svgRef);
      if (!moved) return;
      const raw =
        ds.startOffset + guideNudgeDelta(ds.orientation, dxScreen / zoom, dyScreen / zoom);
      const next = snappedOffset(ds.orientation, raw, e, ds.allTargets);
      moveGuide(ds.id, next);
      if (hasGroupSiblings(ds.siblings)) {
        // Rigid along the guide's one degree of freedom; the along-axis half
        // of the pointer's travel moves nothing, master included.
        const mv = guideMoveVector(ds.orientation, next - ds.startOffset);
        translateSiblings(ds.siblings, mv.x, mv.y);
      }
      syncOverWell(ds.orientation, e);
      return;
    }
    const ps = pullRef.current;
    if (ps) {
      if (pointerLost(e)) return onPointerCancel();
      const { moved } = trackDragMove(ps, e, svgRef);
      if (!moved) return;
      const world = screenToWorld(e.clientX, e.clientY);
      const raw = guideOffsetOf(ps.orientation, world);
      ps.offset = snappedOffset(ps.orientation, raw, e, ps.allTargets);
      setPull({ orientation: ps.orientation, offset: ps.offset });
      syncOverWell(ps.orientation, e);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (ds) {
      dragRef.current = null;
      if (ds.moved && inWell(ds.orientation, e)) {
        // Back into the well it came from: the drop deletes the guide, inside
        // the same single history entry as the drag that carried it there.
        useSelection.getState().selectGuide(null);
        deleteGuide(ds.id);
      }
      // Exit first, clear second: the exit drains the pipeline, so the clear
      // lands in hook state instead of being routed away (useRoutedSnapGuides).
      finishDrag(ds, e, svgRef);
      setSnapGuides([]);
      setOverWell(null);
      return;
    }
    const ps = pullRef.current;
    if (ps) {
      pullRef.current = null;
      if (ps.moved && !inWell(ps.orientation, e)) {
        // One write = one undo entry; selecting opens the popover, the same
        // auto-select every single-shot placement does.
        const id = addGuide(ps.orientation, ps.offset);
        useSelection.getState().selectGuide(id);
      }
      if (ps.moved) releaseDragCapture(e, svgRef);
      setPull(null);
      setSnapGuides([]);
      setOverWell(null);
    }
  };

  const onPointerCancel = () => {
    const ds = dragRef.current;
    if (ds) {
      dragRef.current = null;
      ds.history.rollback();
    }
    pullRef.current = null;
    setPull(null);
    setSnapGuides([]);
    setOverWell(null);
  };

  return {
    snapGuides,
    pull,
    overWell,
    onStartDrag,
    onWellPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
