import { stopPosWorld } from '../../geometry/interlining';
import { stationAnchorWorld } from '../../geometry/transferEnds';
import { textLabelCorners } from '../../geometry/stationBoundary';
import { svgImageCorners } from '../../geometry/svgImage';
import { type Vec2 } from '../../geometry/vec';
import { useDoc } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import { kindVisibleNow } from '../../state/visibility';
import type { MapDoc, Station, TextLabel, TransferAnchor } from '../../model/types';

/** Per-kind id sets excluded from the pool — the dragged item itself plus, in a
 *  group drag, every co-selected sibling (they move with the drag, so they'd be
 *  unstable targets). */
export interface AlignExclude {
  stationIds?: ReadonlySet<string>;
  polygonIds?: ReadonlySet<string>;
  svgImageIds?: ReadonlySet<string>;
  labelIds?: ReadonlySet<string>;
  bulletIds?: ReadonlySet<string>;
  anchorIds?: ReadonlySet<string>;
}

/** The doc slices the pool draws from. Structural so tests can pass a plain
 *  object; the live store state satisfies it. */
export type AlignDoc = Pick<
  MapDoc,
  | 'stations'
  | 'polygons'
  | 'svgImages'
  | 'textLabels'
  | 'routeBullets'
  | 'transferAnchors'
  | 'lineCircles'
>;

/**
 * The three alignment points a text label contributes as a snap target: the
 * visible bbox's upper-left corner, its center, and its lower-right corner.
 * UL + LR cover left/top and right/bottom edge alignment of label stacks;
 * the center covers centering.
 */
export function textLabelAlignPoints(label: TextLabel): Vec2[] {
  const corners = textLabelCorners(label);
  return [corners[0], { x: label.x, y: label.y }, corners[2]];
}

/**
 * The shared "Snap to all" target pool: every station stop-center (the station's
 * own point when stopless) plus each anchor cell it hosts, every polygon vertex,
 * every svg image's rotated corners, three points per text label, every route
 * bullet's center, and every free transfer anchor — minus the excluded items.
 * Built once at pointer-down (everything in it is stationary for the duration of
 * a drag), shared by every point-snapper drag path.
 */
export function alignTargets(doc: AlignDoc, exclude: AlignExclude = {}): Vec2[] {
  const out: Vec2[] = [];
  for (const id of Object.keys(doc.stations)) {
    if (exclude.stationIds?.has(id)) continue;
    const st = doc.stations[id];
    if (st.stops.length === 0) out.push({ x: st.x, y: st.y });
    else for (const c of st.stops) out.push(stopPosWorld(c, st, doc.lineCircles));
    // Hosted anchors ride along with their station, so the one `stationIds`
    // check above covers them in a group drag too.
    for (const cell of st.transferAnchors ?? [])
      out.push(stationAnchorWorld(st, cell, doc.lineCircles));
  }
  for (const id of Object.keys(doc.polygons)) {
    if (exclude.polygonIds?.has(id)) continue;
    for (const v of doc.polygons[id].vertices) out.push(v);
  }
  for (const id of Object.keys(doc.svgImages)) {
    if (exclude.svgImageIds?.has(id)) continue;
    for (const c of svgImageCorners(doc.svgImages[id])) out.push(c);
  }
  for (const id of Object.keys(doc.textLabels)) {
    if (exclude.labelIds?.has(id)) continue;
    out.push(...textLabelAlignPoints(doc.textLabels[id]));
  }
  for (const id of Object.keys(doc.routeBullets)) {
    if (exclude.bulletIds?.has(id)) continue;
    const b = doc.routeBullets[id];
    out.push({ x: b.x, y: b.y });
  }
  // Transfer anchors are targets as well as snappers — an elbow is only useful
  // if the NEXT thing can line up on it. The hosted ones go in with their
  // station above rather than here: an anchor cell is its own point on the
  // station lattice, and one parked a few cells out lands nowhere near a stop
  // centre, so the stops already in the pool do not stand in for it.
  for (const id of Object.keys(doc.transferAnchors)) {
    if (exclude.anchorIds?.has(id)) continue;
    const a = doc.transferAnchors[id];
    out.push({ x: a.x, y: a.y });
  }
  return out;
}

/**
 * {@link alignTargets} over the LIVE doc — the single entry point every drag and
 * placement path uses to build its pool, so none of them can miss the rule
 * below.
 *
 * Every kind the View menu can hide drops out of the pool while it is hidden.
 * The pool is geometric (straight off the doc), so hiding a kind doesn't remove
 * it by itself: without this, dragging the background art the lines/stations
 * toggle just exposed would align it against stations that aren't on the canvas,
 * and draw snap guides pointing at empty space. Whatever is still on screen goes
 * on snapping to itself.
 *
 * Emptying the record is the whole gate for the four free kinds, because that is
 * how they leave the canvas too (MapCanvas). Stations and anchors keep their own
 * named helpers below: `showNetwork` is not the only thing that reveals an
 * anchor, and the snap ENGINE shares the station one.
 *
 * `alignTargets` stays pure (and separately tested) so it can be exercised over
 * a hand-built doc with no stores in play.
 */
export function liveAlignTargets(exclude: AlignExclude = {}): Vec2[] {
  const doc = useDoc.getState();
  // Through `kindVisibleNow`, not the raw flags: a kind its placing mode has
  // REVEALED is on the canvas, and a target you can see must be a target you can
  // snap to — dragging the thing you just placed toward a sibling of the same
  // kind is precisely when the pool matters.
  return alignTargets(
    {
      ...doc,
      stations: liveSnapHostedAnchors(liveSnapStations(doc.stations)),
      transferAnchors: liveSnapAnchors(doc.transferAnchors),
      polygons: kindVisibleNow('showPolygons') ? doc.polygons : {},
      svgImages: kindVisibleNow('showSvgImages') ? doc.svgImages : {},
      textLabels: kindVisibleNow('showTextLabels') ? doc.textLabels : {},
      routeBullets: kindVisibleNow('showRouteBullets') ? doc.routeBullets : {},
    },
    exclude,
  );
}

/**
 * The line circles a placement or drag may CAPTURE a station onto — `{}` while
 * the View menu hides the rings.
 *
 * Ring capture is doc-geometric like everything else here: without this a
 * station dropped near an invisible rim snaps onto it AND gets bound to it
 * (`bindDroppedStation`), so the map acquires a binding to a guide the user
 * cannot see and never chose. Rings are not align TARGETS — they are a hard
 * constraint, closer to the grid — which is why they take a helper of their own
 * rather than a slice in the pool above.
 */
export function liveCaptureCircles<C>(lineCircles: Record<string, C>): Record<string, C> {
  return kindVisibleNow('showLineCircles') ? lineCircles : {};
}

/**
 * The FREE transfer anchors the snap pool may align to — `{}` while either
 * toggle that hides them is off. Same rule, and the same reason, as
 * {@link liveSnapStations}: the pool is geometric (straight off the doc), so
 * hiding anchors doesn't remove them by itself, and snapping to an invisible
 * one draws a guide pointing at bare canvas.
 *
 * Gated on BOTH flags because the layer renders under both: anchors are part of
 * the transfer network, and every transfer surface goes with `showNetwork`.
 */
export function liveSnapAnchors(
  transferAnchors: Record<string, TransferAnchor>,
): Record<string, TransferAnchor> {
  return kindVisibleNow('showAnchors') ? transferAnchors : {};
}

/**
 * The same gate for the HOSTED half: the stations with their anchor cells
 * emptied while anchors are off screen. Only the anchors go — the stations, and
 * their stops, stay in the pool either way (they answer to `showNetwork`, which
 * {@link liveSnapStations} already applied).
 *
 * A separate pass rather than a flag on {@link alignTargets} because the pool
 * takes doc slices, not toggles, and because the snap ENGINE shares
 * `liveSnapStations` — it reads stops only, and has no business acquiring an
 * opinion about anchors.
 */
export function liveSnapHostedAnchors(stations: Record<string, Station>): Record<string, Station> {
  if (kindVisibleNow('showAnchors')) return stations;
  const out: Record<string, Station> = {};
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    out[id] = st.transferAnchors ? { ...st, transferAnchors: [] } : st;
  }
  return out;
}

/**
 * The stations the snap ENGINE may align to — `{}` while the lines/stations
 * toggle is off, mirroring the pool gate above.
 *
 * The engine takes a `stations` record directly, so every caller that can run
 * while the network is hidden must route it through here. A bound route bullet
 * is the reachable case: it stays visible and draggable with the network off,
 * and without this gate it jerks into alignment with an invisible stop and
 * draws a labelled guide across bare canvas. One named helper per pool keeps
 * the "doc-geometric code must opt in to visibility" rule findable.
 */
export function liveSnapStations(stations: Record<string, Station>): Record<string, Station> {
  return useViewportStore.getState().showNetwork ? stations : {};
}
