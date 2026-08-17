import { RefObject, useCallback, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useRoutedSnapGuides } from './useRoutedSnapGuides';
import {
  constrainedGridMode,
  formatMeasurement,
  guideAlongOf,
  guideAxis,
  guideConstraint,
  guideEndAlong,
  guideFoot,
  guideMoveVector,
  guideNeighbourReadout,
  guideNudgeDelta,
  guideOffsetOf,
  guidePointAt,
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
  emptyGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  translateSiblings,
  type GroupSiblings,
} from './groupDrag';
import { WELL_SIZE_PX } from './GuideWells';
import type { GuidePart } from '../GuideView';

export interface GuideDragApi {
  snapGuides: SnapGuide[];
  /** The well pull-out ghost, or null. MapCanvas renders it in the guides
   *  layer at placement-ghost opacity. `extent` rides along once a mid-pull
   *  Ctrl sweep has bounded the ghost. */
  pull: {
    orientation: GuideOrientation;
    offset: number;
    extent?: { center: number; halfLength: number };
  } | null;
  /** The well under the pointer while a drop there would CANCEL the pull or
   *  DELETE the dragged guide, so that well tints. It is the well the CURSOR
   *  occupies, not the guide's home: a strip guide's delete zone includes the
   *  corner squares (its whole edge band), and the square under the cursor is
   *  the one that must light up. */
  overWell: GuideOrientation | null;
  onStartDrag: (id: string, part: GuidePart, e: React.PointerEvent) => void;
  onWellPointerDown: (orientation: GuideOrientation, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

type ScreenToWorld = (mx: number, my: number) => Vec2;

/**
 * Guide gestures, all three of them:
 *
 *  - DRAG an existing guide: the offset follows the pointer's perpendicular
 *    component, snapped through the point snapper with the matching
 *    `constrain` (so only alignments the guide can honour engage) against the
 *    shared pool. An INFINITE guide is 1-DOF and that is the whole gesture; a
 *    BOUNDED one is an object rather than a line, so it also slides down its own
 *    street by the along component — the span's two TIPS snapping there, the
 *    same axis-constrained snap the resize sweeps its endpoint through. Groups
 *    tow rigidly by whichever of the two the master moved. Releasing back over
 *    the guide's home well DELETES it (the same place it came from), inside the
 *    gesture's single history entry.
 *
 *  - DRAG AN END HANDLE of a bounded guide: the resize below, with the anchor
 *    known up front — the tip pivots on its opposite number and the offset never
 *    moves. It tows nothing (a resize is not a translation), never reads as a
 *    well drop, and never flips to infinite: see `resizedExtent`.
 *
 *  - PULL a new guide out of a well: a ghost (no doc writes) follows and
 *    snaps exactly like a committed guide drag would; release commits one
 *    `addGuide` and selects it (opening the popover, like every single-shot
 *    placement); releasing back inside the well — or never crossing the drag
 *    threshold — creates nothing. Offset only, even once a mid-pull sweep has
 *    bounded the ghost: a pull PLACES a guide, and re-sliding the span on the
 *    way to the release would undo the aim the sweep just took.
 *
 * A guide's OFFSET never snaps to another guide (stacking two is meaningless),
 * so no gesture passes `guideTargets` on its offset call. Everything that moves
 * a TIP does — the resize below, and the bounded slide's tip snap — since a
 * crossing guide pins an end exactly where an end wants to be pinned. Both
 * gestures do carry a parallel pool the offset never snaps ONTO
 * but does read: every frame draws the spacing to the
 * nearest parallel guide either side (`guideNeighbourReadout`, whose contract
 * is where that pool's membership is argued), and under "Snap to grid length"
 * the nearest STATIONARY one also anchors the offset's cadence — a whole grid
 * length measured off a guide, which is a gap, never a stack (`guideTensOffset`
 * declines the zero-step notch that would land the two on top of each other).
 *
 * Both gestures also carry a RESIZE phase, live on Ctrl/Cmd like the station
 * drag's redistribute (re-read every move): while held, the offset freezes
 * where it stands and the gesture bounds the guide instead, highlighter
 * style — the foot where the phase began (the press foot when Ctrl was down
 * at the grab, else the first Ctrl frame's) marks one END, and the cursor's
 * foot sweeps the other; the swept stretch IS the span
 * (`AlignmentGuide.extent`). The swept
 * endpoint runs through the point snapper constrained ALONG the axis (the
 * mirror of the offset drag's constraint), where crossing guides are
 * legitimate targets — a perpendicular guide determines position along this
 * one, which is exactly what an endpoint wants. Sweeping the foot past the
 * visible canvas edge flips the guide back to INFINITE (the segment jumping to
 * full span is the feedback); back inside re-bounds it. Releasing Ctrl returns
 * to offset-dragging with the extent kept and the offset re-based so nothing
 * jumps — but the sibling tow keeps measuring from the gesture's ORIGINAL
 * start (`startOffset` is immutable; the re-base is a separate bias), since
 * towed items resume from wherever the resize froze them. A release while
 * resizing never reads as a well drop: the offset is frozen, so the guide
 * can't have been carried to its well.
 *
 * Shift bypasses snapping, as everywhere — but not the readouts (the spacing
 * one, and the resize phase's live length chip), which are measurements rather
 * than snaps. Both gestures capture to the SVG on the first real move
 * (trackDragMove), so the svg's shared pointer pipeline drives them; the well
 * strips also forward their own move/up events for the sub-threshold stretch
 * where the pointer is still over the strip.
 */
export function useGuideDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  zoom: number,
  screenToWorld: ScreenToWorld,
): GuideDragApi {
  const moveGuide = useDoc((s) => s.moveGuide);
  const addGuide = useDoc((s) => s.addGuide);
  const resizeGuide = useDoc((s) => s.resizeGuide);
  const deleteGuide = useDoc((s) => s.deleteGuide);
  const { snapPoint, modes, gridInterval, tolerance } = useDragSnap(zoom);
  const [snapGuides, setSnapGuides] = useRoutedSnapGuides('guide');
  const [pull, setPull] = useState<{
    orientation: GuideOrientation;
    offset: number;
    extent?: { center: number; halfLength: number };
  } | null>(null);
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
    // against, what the grid-length cadence steps FROM (never ONTO — see
    // guideTensOffset), and what the resize phase's endpoint snaps onto (the
    // crossing ones; a parallel is never a target). Snapshotted at
    // pointer-down like every other pool.
    neighbours: readonly GuideTarget[];
    // The towed parallel siblings, as their constant gap to the master. They
    // are out of every SNAP pool (a target moving with the grab is an unstable
    // one) but they are still ink on the canvas, so the readout has to see them
    // or it draws a span through one — hence a gap rather than an exclusion.
    // Constant for the whole gesture: a parallel sibling takes the master's
    // offset delta verbatim (`guideNudgeDelta ∘ guideMoveVector` is the
    // identity on its own orientation), so the live offset is master + gap.
    towedGaps: readonly number[];
    // The last committed offset — what the resize phase freezes at, and what
    // the offset drag resumes from when Ctrl lifts.
    lastOffset: number;
    // Where the span's along-position is measured FROM: its center at
    // pointer-down, null on an infinite guide (which has none to move). Unlike
    // `startOffset` this is NOT immutable — every resize exit re-bases it to
    // wherever the sweep left the span, because a sweep RE-PLACES the span
    // rather than translating it, and a tow measured from the original center
    // would carry the siblings by that re-placement (see `alongCarry`).
    startCenter: number | null;
    // The along twin of `offsetBias`, set at each resize → offset transition so
    // the span resumes exactly where the sweep left it.
    alongBias: number;
    // The along travel done BEFORE the current re-base — the part of the tow the
    // re-based `startCenter` no longer accounts for. Zero until the first resize
    // exit, so a gesture that never sweeps never thinks about it.
    alongCarry: number;
    // The along distance the group tow adds to the offset's perpendicular carry:
    // `alongCarry` plus the travel since the re-base. Held rather than
    // recomputed so a span that flips to infinite mid-gesture FREEZES its towed
    // siblings where they are instead of snapping them back.
    lastAlong: number;
    // Set for an END-HANDLE drag: which tip the pointer carries, and the along
    // parameter of the tip it pivots on (the opposite one, fixed for the whole
    // gesture — the same highlighter shape as the Ctrl sweep, with the anchor
    // known up front instead of swept out).
    handle: 'start' | 'end' | null;
    handleAnchor: number;
    // The resume correction: raw = startOffset + bias + nudge(pointer delta).
    // Set at each resize → offset transition so the offset picks up exactly
    // where it froze; startOffset itself never moves (the sibling tow's total
    // is measured from it).
    offsetBias: number;
    // Live while Ctrl holds the resize phase; `anchor` is the span's FIXED end
    // in the along parameter (the cursor's foot sweeps the other, highlighter
    // style), `mx/my` the last resize frame's cursor — what the resume re-base
    // measures from, so the travel since that frame still lands. Entered
    // lazily on the first Ctrl move frame — with Ctrl held from the press and
    // no offset frame yet, the anchor is the PRESS foot (you mark the first
    // end by where you grab), else the entering frame's foot.
    resize: { anchor: number; mx: number; my: number } | null;
    ctrlAtPress: boolean;
    everOffset: boolean;
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
    // The ghost's bounded extent (null = infinite), its live resize phase
    // (anchored end + the last resize frame's cursor, the drag ref's
    // convention), and the offset-resume correction — the pull's raw offset is
    // cursor-absolute, so its bias is additive on `guideOffsetOf` rather than
    // on a delta. A pull can only enter resize once an offset frame has run
    // (`everOffset`): before that there is no line to bound. With Ctrl held
    // from the WELL PRESS the first moved frame is forced through the offset
    // branch to mint that line — `ctrlFreeOffset` stays false there, so the
    // resize entry still anchors at the press foot ("where Ctrl went down
    // marks one end", the drag path's rule).
    extent: { center: number; halfLength: number } | null;
    resize: { anchor: number; mx: number; my: number } | null;
    everOffset: boolean;
    ctrlAtPress: boolean;
    ctrlFreeOffset: boolean;
    perpBias: number;
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
  //
  // `along` is a BOUNDED guide's second degree of freedom (see the lateral
  // slide below); passing it snaps the span's position along its own street as
  // well, and the returned `center` is where it landed. Both DOF are snapped in
  // ONE place because both feed one `setSnapGuides` call — a second setter would
  // clobber the first's chrome.
  const snappedOffset = (
    orientation: GuideOrientation,
    rawOffset: number,
    e: React.PointerEvent,
    pools: {
      allTargets: Vec2[];
      neighbours: readonly GuideTarget[];
      towedGaps: readonly number[];
    },
    along?: { rawCenter: number; halfLength: number },
  ): { offset: number; center: number | null } => {
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
          world,
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
    // The along DOF: a bounded span's two TIPS are what the eye lines up, so
    // each runs through the point snapper constrained ALONG the axis (the
    // offset's constraint mirrored — the resize phase's rule, so a slid tip and
    // a swept one behave alike), and the better-placed one carries the whole
    // span onto its target. Crossing guides are legitimate targets here;
    // parallel ones are structurally out, since `axisAllowed` drops the axis
    // they would engage on.
    //
    // A tip is only in the contest if it has something to say — it engaged an
    // alignment, or the grid moved it. A tip with nothing in range comes back
    // ZERO away, which would otherwise win every contest on distance and
    // silently veto the tip that did land on something. Among those that do
    // speak, the smallest displacement wins (better-aligned-wins, the rule every
    // same-axis contest settles by), so a tip already sitting exactly on a
    // target holds the span still against a further one pulling at it.
    let center = along ? along.rawCenter : null;
    if (along && !e.shiftKey) {
      const constrain = alongConstrain(orientation);
      let best: { d: number; delta: number; chrome: SnapGuide[] } | null = null;
      for (const which of ['start', 'end'] as const) {
        const t = guideEndAlong({ center: along.rawCenter, halfLength: along.halfLength }, which);
        const snap = snapPoint(guidePointAt(orientation, offset, t), {
          allTargets: pools.allTargets,
          guideTargets: pools.neighbours,
          constrain,
        });
        const landed = guideAlongOf(orientation, { x: snap.x, y: snap.y });
        const d = Math.abs(landed - t);
        if ((d === 0 && snap.guides.length === 0) || (best && d >= best.d)) continue;
        best = { d, delta: landed - t, chrome: snap.guides };
      }
      if (best) {
        center = along.rawCenter + best.delta;
        snapChrome = [...snapChrome, ...best.chrome];
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
    return { offset, center };
  };

  // The resize phase's snap constraint: the endpoint slides ALONG the guide,
  // so the free axis is the one the offset drag locks — 'x' for a horizontal
  // guide, 'y' for a vertical, and each diagonal frees the OTHER diagonal's
  // normal (a \ guide's axis IS the / constraint's free direction).
  const alongConstrain = (orientation: GuideOrientation) =>
    orientation === 'horizontal'
      ? ('x' as const)
      : orientation === 'vertical'
        ? ('y' as const)
        : orientation === 'diagonal-down'
          ? ('diagonal-up' as const)
          : ('diagonal-down' as const);

  // One resize frame, highlighter-style: the span runs from the ANCHORED end
  // (where the phase began) to the snapped cursor foot — or null when the
  // cursor's foot has left the visible canvas box, the flip back to infinite.
  // The flip caps a sweep at the current viewport: a span longer than the
  // screen (or a re-sweep that wanders out and back with a bounded guide's
  // old span already replaced) is the popover Length field's job, or zoom
  // out first. Also emits the phase's chrome: the endpoint snap's own guides
  // plus a live length chip spanning the extent (the neighbour readout stands
  // down — the offset is frozen, so the spacing it measures cannot change).
  // The flip tests the UNSNAPPED foot: it answers where the cursor is, not
  // where a target pulled the endpoint.
  //
  // `flipOutsideBox` is how a SWEEP says "unbounded" — the only way it has. An
  // end HANDLE turns it off: it resizes a span that already exists, so a tip
  // dragged past the edge just keeps going (the popover's ∞ is that gesture's
  // way back), and losing the span — handles and all — mid-drag would read as
  // the gesture breaking.
  const resizedExtent = (
    orientation: GuideOrientation,
    offset: number,
    anchor: number,
    e: React.PointerEvent,
    pools: { allTargets: Vec2[]; neighbours: readonly GuideTarget[] },
    flipOutsideBox = true,
  ): { center: number; halfLength: number } | null => {
    const world = screenToWorld(e.clientX, e.clientY);
    const foot = guideFoot(orientation, offset, world);
    if (flipOutsideBox) {
      const host = svgRef.current?.closest('.canvas-host')?.getBoundingClientRect();
      if (host) {
        const tl = screenToWorld(host.left, host.top);
        const br = screenToWorld(host.right, host.bottom);
        if (foot.x < tl.x || foot.x > br.x || foot.y < tl.y || foot.y > br.y) {
          setSnapGuides([]);
          return null;
        }
      }
    }
    let end = foot;
    let snapChrome: SnapGuide[] = [];
    if (!e.shiftKey) {
      const snap = snapPoint(foot, {
        allTargets: pools.allTargets,
        guideTargets: pools.neighbours,
        constrain: alongConstrain(orientation),
      });
      end = { x: snap.x, y: snap.y };
      snapChrome = snap.guides;
    }
    const t = guideAlongOf(orientation, end);
    const center = (anchor + t) / 2;
    const halfLength = Math.abs(t - anchor) / 2;
    // A zero-width frame (no along travel yet) has no span to chip.
    setSnapGuides(
      halfLength > 0
        ? [
            ...snapChrome,
            {
              from: guidePointAt(orientation, offset, center - halfLength),
              to: guidePointAt(orientation, offset, center + halfLength),
              label: formatMeasurement(2 * halfLength),
            },
          ]
        : snapChrome,
    );
    return { center, halfLength };
  };

  // Where the resize phase anchors its fixed end: a screen point's foot on the
  // frozen guide line, in the along parameter. Called only from the per-render
  // move handler — the pointer-down callbacks are `useCallback([])` and would
  // capture a first-render `screenToWorld`.
  const footAlongAt = (orientation: GuideOrientation, offset: number, mx: number, my: number) =>
    guideAlongOf(orientation, guideFoot(orientation, offset, screenToWorld(mx, my)));

  // Enter — or advance — the resize phase, for either gesture. The FIRST frame
  // fixes the anchored end: at the PRESS foot when Ctrl has been down since the
  // press with no Ctrl-free offset frame behind it (`anchorAtPress` — "where
  // you grab marks one end"), else at this frame's foot. Every frame then
  // records the cursor, which is what the resume re-base measures travel from.
  // One home for the rule so the drag and the pull can't drift apart on it.
  type ResizePhase = { anchor: number; mx: number; my: number };
  const enterResize = (
    st: {
      orientation: GuideOrientation;
      startMX: number;
      startMY: number;
      resize: ResizePhase | null;
    },
    offset: number,
    anchorAtPress: boolean,
    e: React.PointerEvent,
  ): ResizePhase => {
    if (!st.resize) {
      const [mx, my] = anchorAtPress ? [st.startMX, st.startMY] : [e.clientX, e.clientY];
      st.resize = { anchor: footAlongAt(st.orientation, offset, mx, my), mx, my };
    }
    st.resize.mx = e.clientX;
    st.resize.my = e.clientY;
    return st.resize;
  };

  const onStartDrag = useCallback((id: string, part: GuidePart, e: React.PointerEvent) => {
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
    // A handle press on an unbounded guide can't happen (there is no tip to
    // render one on), but it would be a resize with no anchor — read it as the
    // line drag it looks like rather than arming a gesture that can't run.
    const handle = part === 'line' || !guide.extent ? null : part;
    // A resize is not a translation, so it tows nothing — the line-circle
    // knob's rule, spelled the same way.
    const siblings = handle ? emptyGroupSiblings() : collectGroupSiblings('guide', id);
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
      lastOffset: guide.offset,
      offsetBias: 0,
      startCenter: guide.extent?.center ?? null,
      alongBias: 0,
      alongCarry: 0,
      lastAlong: 0,
      handle,
      handleAnchor:
        handle && guide.extent
          ? guideEndAlong(guide.extent, handle === 'start' ? 'end' : 'start')
          : 0,
      resize: null,
      ctrlAtPress: e.ctrlKey || e.metaKey,
      everOffset: false,
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
      extent: null,
      resize: null,
      everOffset: false,
      ctrlAtPress: e.ctrlKey || e.metaKey,
      ctrlFreeOffset: false,
      perpBias: 0,
    };
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (ds) {
      if (pointerLost(e)) return onPointerCancel();
      const { moved, dxScreen, dyScreen } = trackDragMove(ds, e, svgRef);
      if (!moved) return;
      if (ds.handle) {
        // An end handle IS the resize phase, for the whole gesture: the offset
        // never moves (so no well tint, and the release below can't read as a
        // drop), and the tip pivots on the opposite one. Ctrl means nothing
        // here — this gesture is already the thing Ctrl asks for.
        resizeGuide(
          ds.id,
          resizedExtent(ds.orientation, ds.startOffset, ds.handleAnchor, e, ds, false),
        );
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const rz = enterResize(ds, ds.lastOffset, ds.ctrlAtPress && !ds.everOffset, e);
        // resizeGuide already refuses the zero-width frame, so the guide keeps
        // its previous span until the sweep starts; null strips to infinite.
        resizeGuide(ds.id, resizedExtent(ds.orientation, ds.lastOffset, rz.anchor, e, ds));
        setOverWell(null);
        return;
      }
      // The live span — the resize phase may have replaced or stripped it, so
      // it is read from the doc rather than carried in the ref.
      const extent = useDoc.getState().guides[ds.id]?.extent;
      if (ds.resize) {
        // Leaving resize: re-base so the offset resumes exactly where it
        // froze — measured from the LAST RESIZE FRAME's cursor, so travel
        // since then still lands this frame. startOffset stays put (the
        // sibling tow measures its total from it).
        const resizeDX = (ds.resize.mx - ds.startMX) / zoom;
        const resizeDY = (ds.resize.my - ds.startMY) / zoom;
        ds.offsetBias =
          ds.lastOffset - (ds.startOffset + guideNudgeDelta(ds.orientation, resizeDX, resizeDY));
        // The span re-bases the same way, but with one extra move the offset
        // needs no equivalent of: `startCenter` moves TO where the sweep left
        // the span, and the along travel done up to here is banked in
        // `alongCarry`. A sweep RE-PLACES a span — it can drop it a thousand
        // units down the street — and that is not a translation, so the tow
        // must not read the gap between the old center and the new one as
        // travel. (The offset needs none of this because a sweep freezes the
        // offset: `startOffset` is still a true origin afterwards.) A guide the
        // sweep just BOUNDED comes through the same path, banking a carry of
        // zero — there was no span to slide before it existed.
        if (extent) {
          ds.alongCarry = ds.lastAlong;
          ds.startCenter = extent.center;
          ds.alongBias = -guideAlongOf(ds.orientation, { x: resizeDX, y: resizeDY });
        }
        ds.resize = null;
      }
      ds.everOffset = true;
      const dxWorld = dxScreen / zoom;
      const dyWorld = dyScreen / zoom;
      const raw =
        ds.startOffset + ds.offsetBias + guideNudgeDelta(ds.orientation, dxWorld, dyWorld);
      // A BOUNDED guide is 2-DOF: the offset takes the perpendicular half of
      // the travel and the span slides down its own street by the along half.
      // An infinite guide has no along position to move — the along half slides
      // past it, exactly as it always has.
      const alongTravel =
        extent && ds.startCenter !== null
          ? {
              rawCenter:
                ds.startCenter +
                ds.alongBias +
                guideAlongOf(ds.orientation, { x: dxWorld, y: dyWorld }),
              halfLength: extent.halfLength,
            }
          : undefined;
      const { offset: next, center } = snappedOffset(ds.orientation, raw, e, ds, alongTravel);
      ds.lastOffset = next;
      if (center !== null) ds.lastAlong = ds.alongCarry + (center - ds.startCenter!);
      moveGuide(ds.id, next, center ?? undefined);
      if (hasGroupSiblings(ds.siblings)) {
        // Rigid in both of the master's degrees of freedom: the offset's
        // perpendicular carry plus the span's travel along the axis (zero, and
        // frozen, for a guide with no span to slide).
        const mv = guideMoveVector(ds.orientation, next - ds.startOffset);
        const axis = guideAxis(ds.orientation);
        translateSiblings(ds.siblings, mv.x + axis.x * ds.lastAlong, mv.y + axis.y * ds.lastAlong);
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
      if ((e.ctrlKey || e.metaKey) && ps.everOffset) {
        const rz = enterResize(ps, ps.offset, ps.ctrlAtPress && !ps.ctrlFreeOffset, e);
        const ext = resizedExtent(ps.orientation, ps.offset, rz.anchor, e, ps);
        // null = flipped to infinite; a zero-width frame keeps the last span.
        if (ext === null) ps.extent = null;
        else if (ext.halfLength > 0) ps.extent = ext;
        setPull({ orientation: ps.orientation, offset: ps.offset, extent: ps.extent ?? undefined });
        setOverWell(null);
        return;
      }
      if (ps.resize) {
        // Same resume rule as the drag: re-base off the last resize frame's
        // cursor so travel since then still lands.
        ps.perpBias =
          ps.offset - guideOffsetOf(ps.orientation, screenToWorld(ps.resize.mx, ps.resize.my));
        ps.resize = null;
      }
      ps.everOffset = true;
      if (!(e.ctrlKey || e.metaKey)) ps.ctrlFreeOffset = true;
      const raw = guideOffsetOf(ps.orientation, world) + ps.perpBias;
      // Offset only: a pull PLACES a guide, and a mid-pull sweep is where its
      // span gets put. Sliding that span again on the way to the release would
      // undo the aim the sweep just took.
      ps.offset = snappedOffset(ps.orientation, raw, e, ps).offset;
      setPull({ orientation: ps.orientation, offset: ps.offset, extent: ps.extent ?? undefined });
      syncOverWell(ps.orientation, e);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (ds) {
      dragRef.current = null;
      if (ds.moved && !ds.resize && !ds.handle && releasedInWell(ds.orientation, e)) {
        // Back into the well it came from: the drop deletes the guide, inside
        // the same single history entry as the drag that carried it there.
        // Never while resizing, by either route — a frozen offset can't have
        // carried the guide to its well; the cursor is just sweeping past it.
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
      // A resize release always commits: the well cancel is the offset drag's
      // exit, and a frozen ghost can't have been carried back to its strip.
      if (ps.moved && (ps.resize !== null || !releasedInWell(ps.orientation, e))) {
        // One write = one undo entry; selecting opens the popover, the same
        // auto-select every single-shot placement does.
        const id = addGuide(ps.orientation, ps.offset, ps.extent ?? undefined);
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
