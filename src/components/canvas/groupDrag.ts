import { useDoc, useSelection } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import { kindVisibleNow } from '../../state/visibility';
import type { Vec2 } from '../../geometry/vec';
import type { AlignExclude } from './snapTargets';

export type GrabbedKind =
  | 'station'
  | 'bullet'
  | 'label'
  | 'polygon'
  | 'svgImage'
  | 'anchor'
  | 'lineCircle';

// Every OTHER selected item, captured at pointer-down with its start position,
// so a group drag can tow them by the grabbed item's per-frame delta. x/y items
// store a start point; polygons store their full start vertex list.
export interface GroupSiblings {
  stations: { id: string; startX: number; startY: number }[];
  bullets: { id: string; startX: number; startY: number }[];
  labels: { id: string; startX: number; startY: number }[];
  polygons: { id: string; startVerts: Vec2[] }[];
  svgImages: { id: string; startX: number; startY: number }[];
  // Free transfer anchors — the plain x/y flavour, like bullets and labels.
  // HOSTED anchors have no x/y at all (they are station-grid cells) and are
  // never canvas-selectable, so they can never reach this list.
  anchors: { id: string; startX: number; startY: number }[];
  // Line circles, towed by their CENTER (`moveLineCircle`, which carries the
  // stations bound to them).
  lineCircles: { id: string; startX: number; startY: number }[];
  // Stations that MOVE with the drag but are NOT towed by us: the passengers of
  // a towed ring, carried by `moveLineCircle`. Ids only — nothing here is
  // translated. They are tracked so the snap pools can still exclude them (a
  // target that moves with the grab is an unstable one) without a second write:
  // a bound station's `moveStation` reseats it on its ring, so towing a
  // passenger as well would drift it round the rim. The drag twin of
  // `rotateItemsAround`'s `carriedByCircle`.
  carriedStations: string[];
}

export function emptyGroupSiblings(): GroupSiblings {
  return {
    stations: [],
    bullets: [],
    labels: [],
    polygons: [],
    svgImages: [],
    anchors: [],
    lineCircles: [],
    carriedStations: [],
  };
}

/**
 * Snapshot the multi-selection siblings of the grabbed item (every type except
 * the grabbed item itself) at pointer-down. Returns no siblings unless the
 * grabbed item is itself part of the selection — dragging an unselected item
 * never tows the selection. Locked items (bullets, labels, polygons) never tow,
 * and neither does anything on a layer the View menu is hiding: a tow is an edit
 * to the towed item, so the same rule the Delete key and the arrow keys follow
 * (`unlockedSelectedItemIds`) applies here. The grabbed item needs no such check
 * — a hidden one has no grab surface to press.
 */
export function collectGroupSiblings(grabbedKind: GrabbedKind, grabbedId: string): GroupSiblings {
  const sel = useSelection.getState();
  const network = useViewportStore.getState().showNetwork;
  const shows = {
    stations: network,
    bullets: kindVisibleNow('showRouteBullets'),
    labels: kindVisibleNow('showTextLabels'),
    polygons: kindVisibleNow('showPolygons'),
    svgImages: kindVisibleNow('showSvgImages'),
    anchors: kindVisibleNow('showAnchors'),
    lineCircles: kindVisibleNow('showLineCircles'),
  };
  // Spelled out as an exhaustive switch rather than a ternary chain ending in a
  // catch-all: the tail used to be a bare `: sel.selectedSvgImageIds`, so a new
  // GrabbedKind would have been silently tested against the svg-image selection
  // instead of failing to compile.
  const selectedIdsFor = (kind: GrabbedKind): readonly string[] => {
    switch (kind) {
      case 'station':
        return sel.selectedStationIds;
      case 'bullet':
        return sel.selectedRouteBulletIds;
      case 'label':
        return sel.selectedLabelIds;
      case 'polygon':
        return sel.selectedPolygonIds;
      case 'svgImage':
        return sel.selectedSvgImageIds;
      case 'anchor':
        return sel.selectedAnchorIds;
      case 'lineCircle':
        return sel.selectedLineCircleIds;
      default: {
        const unhandled: never = kind;
        return unhandled;
      }
    }
  };
  if (!selectedIdsFor(grabbedKind).includes(grabbedId)) return emptyGroupSiblings();

  const doc = useDoc.getState();
  const out = emptyGroupSiblings();
  // Which rings will MOVE this gesture — every unlocked selected one, including
  // the grabbed ring (excluded from the towed list below, but it moves). Their
  // passengers ride along inside `moveLineCircle`, so the station loop files
  // them under `carriedStations` instead of towing them. A LOCKED ring stays
  // put, so its passengers are towed normally (and slide along the stationary
  // rim, exactly as a lone bound-station drag does) — as does a HIDDEN one, so
  // this set and the towed list below must read the same visibility flag or a
  // passenger would be filed as carried by a ring that never moves.
  const movingCircleIds = new Set<string>();
  if (shows.lineCircles) {
    for (const id of sel.selectedLineCircleIds) {
      const c = doc.lineCircles[id];
      if (c && !c.locked) movingCircleIds.add(id);
    }
  }
  // Every station bound to a moving ring, SELECTED OR NOT: the ring takes its
  // passengers with it either way, so selection has no say here. Lock has none
  // either — `moveLineCircle` carries a locked passenger just the same.
  if (movingCircleIds.size > 0) {
    for (const id of Object.keys(doc.stations)) {
      const cid = doc.stations[id].circleId;
      if (cid !== undefined && movingCircleIds.has(cid)) out.carriedStations.push(id);
    }
  }
  for (const id of shows.stations ? sel.selectedStationIds : []) {
    if (grabbedKind === 'station' && id === grabbedId) continue;
    const s = doc.stations[id];
    if (!s) continue;
    // Already carried by its ring (above) — towing it as well would be the
    // second write that drifts it round the rim.
    if (s.circleId !== undefined && movingCircleIds.has(s.circleId)) continue;
    // Locked stations never tow (mirrors locked polygons below).
    if (!s.locked) out.stations.push({ id, startX: s.x, startY: s.y });
  }
  for (const id of shows.bullets ? sel.selectedRouteBulletIds : []) {
    if (grabbedKind === 'bullet' && id === grabbedId) continue;
    const b = doc.routeBullets[id];
    if (b && !b.locked) out.bullets.push({ id, startX: b.x, startY: b.y });
  }
  for (const id of shows.labels ? sel.selectedLabelIds : []) {
    if (grabbedKind === 'label' && id === grabbedId) continue;
    const l = doc.textLabels[id];
    if (l && !l.locked) out.labels.push({ id, startX: l.x, startY: l.y });
  }
  for (const id of shows.polygons ? sel.selectedPolygonIds : []) {
    if (grabbedKind === 'polygon' && id === grabbedId) continue;
    const p = doc.polygons[id];
    if (p && !p.locked) out.polygons.push({ id, startVerts: p.vertices.map((v) => ({ ...v })) });
  }
  for (const id of shows.svgImages ? sel.selectedSvgImageIds : []) {
    if (grabbedKind === 'svgImage' && id === grabbedId) continue;
    const im = doc.svgImages[id];
    if (im && !im.locked) out.svgImages.push({ id, startX: im.x, startY: im.y });
  }
  for (const id of shows.anchors ? sel.selectedAnchorIds : []) {
    if (grabbedKind === 'anchor' && id === grabbedId) continue;
    const a = doc.transferAnchors[id];
    // No `!a.locked` guard — anchors have no lock, so they always tow. This is
    // the one deliberate break from the five loops above.
    if (a) out.anchors.push({ id, startX: a.x, startY: a.y });
  }
  for (const id of sel.selectedLineCircleIds) {
    if (grabbedKind === 'lineCircle' && id === grabbedId) continue;
    // `movingCircleIds` already dropped the locked ones — same set, so a ring
    // whose passengers were filed as carried is guaranteed to be towed here.
    if (movingCircleIds.has(id)) {
      const c = doc.lineCircles[id];
      out.lineCircles.push({ id, startX: c.x, startY: c.y });
    }
  }
  return out;
}

/**
 * Every station that MOVES during the drag: the towed siblings plus the
 * passengers a towed ring carries. This is the snap engines' exclusion set —
 * stationary stations stay valid targets, but anything moving with the grab is
 * an unstable one.
 */
export function movingStationIds(s: GroupSiblings): ReadonlySet<string> {
  return new Set([...s.stations.map((x) => x.id), ...s.carriedStations]);
}

/**
 * The alignment-pool exclusion set for a drag: the grabbed item itself plus
 * everything that MOVES with it — every towed sibling, and the passengers a
 * towed ring carries. Everything else — including stationary, non-selected
 * items — stays a valid snap target, so a group drag keeps the same alignment
 * quality as a solo drag.
 */
export function groupAlignExclude(
  grabbedKind: GrabbedKind,
  grabbedId: string,
  siblings: GroupSiblings,
): AlignExclude {
  const ex = {
    stationIds: new Set(movingStationIds(siblings)),
    bulletIds: new Set(siblings.bullets.map((b) => b.id)),
    labelIds: new Set(siblings.labels.map((l) => l.id)),
    polygonIds: new Set(siblings.polygons.map((p) => p.id)),
    svgImageIds: new Set(siblings.svgImages.map((i) => i.id)),
    anchorIds: new Set(siblings.anchors.map((a) => a.id)),
  };
  // Every kind spelled out (the tail was a catch-all `else`, which would have
  // quietly filed a new kind's id under svgImageIds — excluding the wrong item
  // from the snap pool and leaving the dragged one in it).
  switch (grabbedKind) {
    case 'station':
      ex.stationIds.add(grabbedId);
      break;
    case 'bullet':
      ex.bulletIds.add(grabbedId);
      break;
    case 'label':
      ex.labelIds.add(grabbedId);
      break;
    case 'polygon':
      ex.polygonIds.add(grabbedId);
      break;
    case 'svgImage':
      ex.svgImageIds.add(grabbedId);
      break;
    case 'anchor':
      ex.anchorIds.add(grabbedId);
      break;
    case 'lineCircle':
      // Nothing to add: line circles are not in the align pool at all (they sit
      // outside both snappers — a ring's own capture rule is
      // `lineCircleAtPoint`), so there is no ring target to exclude. The
      // passengers it carries are already excluded above, via
      // `movingStationIds`.
      break;
    default: {
      const unhandled: never = grabbedKind;
      throw new Error(`groupAlignExclude: unhandled kind ${String(unhandled)}`);
    }
  }
  return ex;
}

// `carriedStations` is deliberately absent: nothing translates them (their ring
// does), and a non-empty list always comes with the ring that carries them —
// either in `lineCircles` or as the grabbed master.
export function hasGroupSiblings(s: GroupSiblings): boolean {
  return (
    s.stations.length +
      s.bullets.length +
      s.labels.length +
      s.polygons.length +
      s.svgImages.length +
      s.anchors.length +
      s.lineCircles.length >
    0
  );
}

/** Translate every captured sibling by (dx, dy) through the store mutators. */
export function translateSiblings(s: GroupSiblings, dx: number, dy: number): void {
  const doc = useDoc.getState();
  for (const cs of s.lineCircles) doc.moveLineCircle(cs.id, cs.startX + dx, cs.startY + dy);
  for (const ss of s.stations) doc.moveStation(ss.id, ss.startX + dx, ss.startY + dy);
  for (const bs of s.bullets) doc.moveRouteBullet(bs.id, bs.startX + dx, bs.startY + dy);
  for (const ls of s.labels) doc.moveTextLabel(ls.id, ls.startX + dx, ls.startY + dy);
  for (const ps of s.polygons) {
    doc.setPolygonVertices(
      ps.id,
      ps.startVerts.map((v) => ({ x: v.x + dx, y: v.y + dy })),
    );
  }
  for (const is of s.svgImages) doc.moveSvgImage(is.id, is.startX + dx, is.startY + dy);
  for (const as of s.anchors) doc.moveTransferAnchor(as.id, as.startX + dx, as.startY + dy);
}
