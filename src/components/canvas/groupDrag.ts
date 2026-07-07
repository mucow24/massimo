import { useDoc, useSelection } from '../../state/store';
import type { Vec2 } from '../../geometry/vec';
import type { AlignExclude } from './snapTargets';

export type GrabbedKind = 'station' | 'bullet' | 'label' | 'polygon' | 'svgImage';

// Every OTHER selected item, captured at pointer-down with its start position,
// so a group drag can tow them by the grabbed item's per-frame delta. x/y items
// store a start point; polygons store their full start vertex list.
export interface GroupSiblings {
  stations: { id: string; startX: number; startY: number }[];
  bullets: { id: string; startX: number; startY: number }[];
  labels: { id: string; startX: number; startY: number }[];
  polygons: { id: string; startVerts: Vec2[] }[];
  svgImages: { id: string; startX: number; startY: number }[];
}

export function emptyGroupSiblings(): GroupSiblings {
  return { stations: [], bullets: [], labels: [], polygons: [], svgImages: [] };
}

/**
 * Snapshot the multi-selection siblings of the grabbed item (every type except
 * the grabbed item itself) at pointer-down. Returns no siblings unless the
 * grabbed item is itself part of the selection — dragging an unselected item
 * never tows the selection. Locked items (bullets, labels, polygons) never tow.
 */
export function collectGroupSiblings(grabbedKind: GrabbedKind, grabbedId: string): GroupSiblings {
  const sel = useSelection.getState();
  const grabbedSelected =
    grabbedKind === 'station'
      ? sel.selectedStationIds.includes(grabbedId)
      : grabbedKind === 'bullet'
        ? sel.selectedRouteBulletIds.includes(grabbedId)
        : grabbedKind === 'label'
          ? sel.selectedLabelIds.includes(grabbedId)
          : grabbedKind === 'polygon'
            ? sel.selectedPolygonIds.includes(grabbedId)
            : sel.selectedSvgImageIds.includes(grabbedId);
  if (!grabbedSelected) return emptyGroupSiblings();

  const doc = useDoc.getState();
  const out = emptyGroupSiblings();
  for (const id of sel.selectedStationIds) {
    if (grabbedKind === 'station' && id === grabbedId) continue;
    const s = doc.stations[id];
    // Locked stations never tow (mirrors locked polygons below).
    if (s && !s.locked) out.stations.push({ id, startX: s.x, startY: s.y });
  }
  for (const id of sel.selectedRouteBulletIds) {
    if (grabbedKind === 'bullet' && id === grabbedId) continue;
    const b = doc.routeBullets[id];
    if (b && !b.locked) out.bullets.push({ id, startX: b.x, startY: b.y });
  }
  for (const id of sel.selectedLabelIds) {
    if (grabbedKind === 'label' && id === grabbedId) continue;
    const l = doc.textLabels[id];
    if (l && !l.locked) out.labels.push({ id, startX: l.x, startY: l.y });
  }
  for (const id of sel.selectedPolygonIds) {
    if (grabbedKind === 'polygon' && id === grabbedId) continue;
    const p = doc.polygons[id];
    if (p && !p.locked) out.polygons.push({ id, startVerts: p.vertices.map((v) => ({ ...v })) });
  }
  for (const id of sel.selectedSvgImageIds) {
    if (grabbedKind === 'svgImage' && id === grabbedId) continue;
    const im = doc.svgImages[id];
    if (im && !im.locked) out.svgImages.push({ id, startX: im.x, startY: im.y });
  }
  return out;
}

/**
 * The alignment-pool exclusion set for a drag: the grabbed item itself plus
 * every towed sibling. Everything else — including stationary, non-selected
 * items — stays a valid snap target, so a group drag keeps the same alignment
 * quality as a solo drag.
 */
export function groupAlignExclude(
  grabbedKind: GrabbedKind,
  grabbedId: string,
  siblings: GroupSiblings,
): AlignExclude {
  const ex = {
    stationIds: new Set(siblings.stations.map((s) => s.id)),
    bulletIds: new Set(siblings.bullets.map((b) => b.id)),
    labelIds: new Set(siblings.labels.map((l) => l.id)),
    polygonIds: new Set(siblings.polygons.map((p) => p.id)),
    svgImageIds: new Set(siblings.svgImages.map((i) => i.id)),
  };
  if (grabbedKind === 'station') ex.stationIds.add(grabbedId);
  else if (grabbedKind === 'bullet') ex.bulletIds.add(grabbedId);
  else if (grabbedKind === 'label') ex.labelIds.add(grabbedId);
  else if (grabbedKind === 'polygon') ex.polygonIds.add(grabbedId);
  else ex.svgImageIds.add(grabbedId);
  return ex;
}

export function hasGroupSiblings(s: GroupSiblings): boolean {
  return (
    s.stations.length +
      s.bullets.length +
      s.labels.length +
      s.polygons.length +
      s.svgImages.length >
    0
  );
}

/** Translate every captured sibling by (dx, dy) through the store mutators. */
export function translateSiblings(s: GroupSiblings, dx: number, dy: number): void {
  const doc = useDoc.getState();
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
}
