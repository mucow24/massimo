import { RefObject, useCallback, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useRoutedSnapGuides } from './useRoutedSnapGuides';
import {
  constrainedGridMode,
  guideConstraint,
  guideFoot,
  guideMoveVector,
  guideNeighbourReadout,
  guideNudgeDelta,
  guideOffsetOf,
  guideTensOffset,
  type GuideTarget,
  type SnapGuide,
} from '../../geometry/snap';
import type { Vec2 } from '../../geometry/vec';
import type { GuideOrientation } from '../../model/types';
import { useDragSnap } from './useDragSnap';
import { liveAlignTargets, liveGuideTargets } from './snapTargets';
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
 * gesture passes `guideTargets` to the snapper. Both do carry a parallel pool
 * they never snap ONTO but do read: every frame draws the spacing to the
 * nearest parallel guide either side (`guideNeighbourReadout`, whose contract
 * is where that pool's membership is argued), and under "Snap to grid length"
 * the nearest STATIONARY one also anchors the offset's cadence — a whole grid
 * length measured off a guide, which is a gap, never a stack (`guideTensOffset`
 * declines the zero-step notch that would land the two on top of each other).
 *
 * Shift bypasses snapping, as everywhere — but not the readout, which is a
 * measurement rather than a snap. Both gestures capture to the SVG on the first
 * real move (trackDragMove), so the svg's shared pointer pipeline drives them;
 * the well strips also forward their own move/up events for the sub-threshold
 * stretch where the pointer is still over the strip.
 */
export function useGuideDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  screenToWorld: ScreenToWorld,
): GuideDragApi {
  const moveGuide = useDoc((s) => s.moveGuide);
  const addGuide = useDoc((s) => s.addGuide);
  const deleteGuide = useDoc((s) => s.deleteGuide);
  const { snapPoint, modes, gridInterval, tolerance } = useDragSnap(zoom);
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
    // The STATIONARY guides this gesture reads: what the readout measures
    // against, and what the grid-length cadence steps FROM (never ONTO — see
    // guideTensOffset). Snapshotted at pointer-down like every other pool.
    neighbours: readonly GuideTarget[];
    // The towed parallel siblings, as their constant gap to the master. They
    // are out of every SNAP pool (a target moving with the grab is an unstable
    // one) but they are still ink on the canvas, so the readout has to see them
    // or it draws a span through one — hence a gap rather than an exclusion.
    // Constant for the whole gesture: a parallel sibling takes the master's
    // offset delta verbatim (`guideNudgeDelta ∘ guideMoveVector` is the
    // identity on its own orientation), so the live offset is master + gap.
    towedGaps: readonly number[];
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  const pullRef = useRef<{
    orientation: GuideOrientation;
    offset: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    allTargets: Vec2[];
    neighbours: readonly GuideTarget[];
    towedGaps: readonly number[];
  } | null>(null);

  // Which of the host's three well-bearing edge bands the pointer is in. Beyond
  // the canvas edge counts as inside, so dragging a guide up into the toolbar
  // reads as "back into the well" rather than a stranded commit. Null before
  // the host has a box to measure. One layout read per gesture frame — both
  // questions below are answered off this one reading rather than each taking
  // its own.
  type WellBands = { top: boolean; left: boolean; bottom: boolean };
  const wellBandsAt = (e: { clientX: number; clientY: number }): WellBands | null => {
    const host = svgRef.current?.closest('.canvas-host')?.getBoundingClientRect();
    if (!host) return null;
    return {
      top: e.clientY <= host.top + WELL_SIZE_PX,
      left: e.clientX <= host.left + WELL_SIZE_PX,
      bottom: e.clientY >= host.bottom - WELL_SIZE_PX,
    };
  };
  // Is the pointer inside this orientation's DELETE zone — its home well plus
  // the corner squares that interrupt the strip it lives in? A strip guide's
  // zone is its whole edge band; a diagonal's is only its own corner.
  const inWell = (orientation: GuideOrientation, b: WellBands) => {
    switch (orientation) {
      case 'horizontal':
        return b.top;
      case 'vertical':
        return b.left;
      case 'diagonal-up':
        return b.left && b.top;
      case 'diagonal-down':
        return b.left && b.bottom;
    }
  };
  // The specific well under the pointer — corners beat the strips they
  // interrupt. Only consulted once `inWell` says the drop would delete, so a
  // strip guide hovering a corner square (inside its edge band, outside its
  // home strip) tints the square the cursor actually occupies.
  const wellAt = (b: WellBands): GuideOrientation | null => {
    if (b.left && b.top) return 'diagonal-up';
    if (b.left && b.bottom) return 'diagonal-down';
    if (b.top) return 'horizontal';
    if (b.left) return 'vertical';
    return null;
  };
  const syncOverWell = (orientation: GuideOrientation, e: React.PointerEvent) => {
    const bands = wellBandsAt(e);
    const over = bands && inWell(orientation, bands) ? wellAt(bands) : null;
    if (over !== overWell) setOverWell(over);
  };
  // The drop test, for the two release paths: no host box means no well.
  const releasedInWell = (orientation: GuideOrientation, e: React.PointerEvent) => {
    const bands = wellBandsAt(e);
    return bands !== null && inWell(orientation, bands);
  };

  // Shared by both gestures: the snapped offset for a proposed pointer
  // position, plus the chrome that goes with it. The along-axis coordinate
  // rides the live cursor (the proposed point is the cursor's foot on the
  // proposed guide line) so any drawn alignment segment — snap or spacing
  // readout — lands by the pointer, not at a stale spot.
  const snappedOffset = (
    orientation: GuideOrientation,
    rawOffset: number,
    e: React.PointerEvent,
    pools: {
      allTargets: Vec2[];
      neighbours: readonly GuideTarget[];
      towedGaps: readonly number[];
    },
  ): number => {
    const world = screenToWorld(e.clientX, e.clientY);
    let offset = rawOffset;
    let snapChrome: SnapGuide[] = [];
    if (!e.shiftKey) {
      const proposed = guideFoot(orientation, rawOffset, world);
      const constrain = guideConstraint(orientation);
      const snap = snapPoint(proposed, { allTargets: pools.allTargets, constrain });
      offset = guideOffsetOf(orientation, snap);
      snapChrome = snap.guides;
      // "Snap to grid length" on the guide's one degree of freedom —
      // `guideTensOffset` owns the cadence itself (anchor, step, why it stands
      // down); this is where it competes. It is off while the grid pins that
      // DOF, grid being the hard constraint that owns quantization there,
      // exactly as the point snapper has it. Against an engaged alignment it
      // settles by the closest-wins rule every same-axis contest uses, ties
      // going to the alignment: that one says something about the map, the
      // cadence only about spacing. The empty-chrome disjunct carries the case
      // where nothing engaged at all — `offset` is then the raw pointer with
      // zero displacement, which no candidate can beat on distance.
      if (modes.tens && constrainedGridMode(modes.grid, constrain) === 'off') {
        const tens = guideTensOffset(
          orientation,
          rawOffset,
          pools.neighbours,
          gridInterval,
          tolerance,
        );
        if (
          tens !== null &&
          (snapChrome.length === 0 || Math.abs(tens - rawOffset) < Math.abs(offset - rawOffset))
        ) {
          offset = tens;
          // The alignment lost: its chrome would claim a snap that didn't
          // happen. The spacing readout below is the cadence's own feedback.
          snapChrome = [];
        }
      }
    }
    // Set unconditionally — frozen local state can't gate a clear while the
    // pipeline is armed (see useRoutedSnapGuides). The spacing readout is
    // measured off the LANDED offset, so it reads the gap the release commits,
    // and the towed siblings ride that same offset out to where they now sit.
    setSnapGuides([
      ...snapChrome,
      ...guideNeighbourReadout(orientation, offset, world, [
        ...pools.neighbours,
        ...pools.towedGaps.map((gap) => ({ orientation, offset: offset + gap })),
      ]),
    ]);
    return offset;
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
    const exclude = groupAlignExclude('guide', id, siblings);
    dragRef.current = {
      id,
      orientation: guide.orientation,
      startOffset: guide.offset,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      siblings,
      allTargets: liveAlignTargets(exclude),
      neighbours: liveGuideTargets(exclude),
      towedGaps: siblings.guides
        .filter((g) => g.orientation === guide.orientation)
        .map((g) => g.startOffset - guide.offset),
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
      // No exclusions: the ghost isn't in the doc yet (placement's rule), and
      // a pull tows nothing.
      allTargets: liveAlignTargets(),
      neighbours: liveGuideTargets(),
      towedGaps: [],
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
      const next = snappedOffset(ds.orientation, raw, e, ds);
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
      ps.offset = snappedOffset(ps.orientation, raw, e, ps);
      setPull({ orientation: ps.orientation, offset: ps.offset });
      syncOverWell(ps.orientation, e);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (ds) {
      dragRef.current = null;
      if (ds.moved && releasedInWell(ds.orientation, e)) {
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
      if (ps.moved && !releasedInWell(ps.orientation, e)) {
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
