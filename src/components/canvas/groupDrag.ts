import { useDoc, useSelection } from '../../state/store';
import type { Vec2 } from '../../geometry/vec';

export type GrabbedKind = 'station' | 'bullet' | 'label' | 'polygon';

// Every OTHER selected item, captured at pointer-down with its start position,
// so a group drag can tow them by the grabbed item's per-frame delta. x/y items
// store a start point; polygons store their full start vertex list.
export interface GroupSiblings {
  stations: { id: string; startX: number; startY: number }[];
  bullets: { id: string; startX: number; startY: number }[];
  labels: { id: string; startX: number; startY: number }[];
  polygons: { id: string; startVerts: Vec2[] }[];
}

export function emptyGroupSiblings(): GroupSiblings {
  return { stations: [], bullets: [], labels: [], polygons: [] };
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
          : sel.selectedPolygonIds.includes(grabbedId);
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
  return out;
}

export function hasGroupSiblings(s: GroupSiblings): boolean {
  return s.stations.length + s.bullets.length + s.labels.length + s.polygons.length > 0;
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
}
