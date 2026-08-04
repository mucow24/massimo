import { edgeEndpoints } from './lineTopology';
import { pairKeyOf } from './pairKey';
import type { MapDoc, StyleKind } from './types';

// Which style kind each tagged collection's `styleId` must name. stopDot is
// absent on purpose — its wearers are the dot SLOTS, audited separately below.
const STYLE_KIND_OF: ReadonlyArray<[keyof MapDoc, StyleKind]> = [
  ['lines', 'line'],
  ['textLabels', 'textLabel'],
  ['polygons', 'polygon'],
  ['routeBullets', 'routeBullet'],
  ['transfers', 'transfer'],
  ['stations', 'station'],
];

/**
 * Referential audit over a MapDoc — the invariant vocabulary the import
 * pathway repairs to (serialize.ts). Returns human-readable violations;
 * empty = coherent. Two callers:
 *   - tests: `parse()` output must audit clean for ANY input it accepts;
 *   - the export doors (Export → JSON, Save version, auto-save): a violation
 *     there means an app writer corrupted the live doc — the bytes are still
 *     written (user work is never held hostage to a bug), but the failure
 *     surfaces as a toast instead of being discovered on some future load.
 * Deliberately referential, not stylistic: value-level canonicality (drop-at-
 * default fields, collapsed overrides) is the sanitizers' business, and states
 * the app legitimately produces — stopless stations, degree-0 members,
 * region-anchor pairKeys awaiting reconcile — are not violations. Linear in
 * the doc; no geometry.
 */
export function auditDoc(doc: MapDoc): string[] {
  const v: string[] = [];
  const finite = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n);

  for (const [key, st] of Object.entries(doc.stations)) {
    if (st.id !== key) v.push(`station "${key}": id reads "${st.id}"`);
    if (!finite(st.x) || !finite(st.y)) v.push(`station "${key}": non-finite position`);
    if (st.circleId !== undefined && !doc.lineCircles[st.circleId])
      v.push(`station "${key}": dangling circleId "${st.circleId}"`);
    const seen = new Set<string>();
    for (const stop of st.stops) {
      if (!doc.lines[stop.lineId]) {
        v.push(`station "${key}": stop for missing line "${stop.lineId}"`);
      } else if (!doc.lines[stop.lineId].stations.includes(key)) {
        v.push(`station "${key}": has a stop for "${stop.lineId}" but is not a member`);
      }
      if (seen.has(stop.lineId)) v.push(`station "${key}": duplicate stop for "${stop.lineId}"`);
      seen.add(stop.lineId);
      if (stop.dotStyleId !== undefined && doc.styles[stop.dotStyleId]?.kind !== 'stopDot')
        v.push(`station "${key}": stop dotStyleId "${stop.dotStyleId}" is not a stopDot style`);
    }
  }

  for (const [key, ln] of Object.entries(doc.lines)) {
    if (ln.id !== key) v.push(`line "${key}": id reads "${ln.id}"`);
    const members = new Set(ln.stations);
    if (members.size !== ln.stations.length) v.push(`line "${key}": duplicate members`);
    for (const sid of ln.stations) {
      if (!doc.stations[sid]) {
        v.push(`line "${key}": member "${sid}" is not a station`);
      } else if (!doc.stations[sid].stops.some((c) => c.lineId === key)) {
        v.push(`line "${key}": member "${sid}" has no stop for it`);
      }
    }
    const seenEdges = new Set<string>();
    for (const e of ln.edges) {
      const [a, b] = edgeEndpoints(e);
      if (!a || !b || a === b || pairKeyOf(a, b) !== e) {
        v.push(`line "${key}": non-canonical edge "${e}"`);
        continue;
      }
      if (seenEdges.has(e)) v.push(`line "${key}": duplicate edge "${e}"`);
      seenEdges.add(e);
      for (const end of [a, b]) {
        if (!members.has(end)) v.push(`line "${key}": edge "${e}" endpoint is not a member`);
      }
    }
    for (const id of [ln.singletonDotStyleId, ln.multiDotStyleId]) {
      if (id !== undefined && doc.styles[id]?.kind !== 'stopDot')
        v.push(`line "${key}": dot style id "${id}" is not a stopDot style`);
    }
    // Topology-scoped overrides: the app prunes both alongside topology edits
    // (pruneOrphanLineOverrides), so an orphan here is a writer or load bug.
    const edgeSet = new Set(ln.edges);
    for (const k of Object.keys(ln.segmentStyles ?? {})) {
      if (!edgeSet.has(k)) v.push(`line "${key}": segment style keyed off a non-edge "${k}"`);
    }
    for (const sid of Object.keys(ln.stationEndStyles ?? {})) {
      if (!members.has(sid)) v.push(`line "${key}": end-style pin for a non-member "${sid}"`);
    }
  }

  const orderCheck = (label: string, order: string[], records: Record<string, unknown>) => {
    const seen = new Set<string>();
    for (const id of order) {
      if (seen.has(id)) v.push(`${label}: duplicate entry "${id}"`);
      else if (!records[id]) v.push(`${label}: dangling entry "${id}"`);
      seen.add(id);
    }
    for (const id of Object.keys(records)) {
      if (!seen.has(id)) v.push(`${label}: missing entry "${id}"`);
    }
  };
  orderCheck('lineOrder', doc.lineOrder, doc.lines);
  orderCheck('backgroundOrder', doc.backgroundOrder, { ...doc.polygons, ...doc.svgImages });

  for (const [key, t] of Object.entries(doc.lineTags)) {
    if (!doc.lines[t.lineId]) {
      v.push(`lineTag "${key}": dangling line "${t.lineId}"`);
      continue;
    }
    if (t.fromStationId >= t.toStationId) v.push(`lineTag "${key}": endpoints not canonical`);
    if (!doc.lines[t.lineId].edges.includes(pairKeyOf(t.fromStationId, t.toStationId)))
      v.push(`lineTag "${key}": pair is not an edge of "${t.lineId}"`);
  }

  for (const [key, t] of Object.entries(doc.transfers)) {
    for (const end of [t.a, t.b]) {
      if ('stationId' in end) {
        if (!doc.stations[end.stationId]) {
          v.push(`transfer "${key}": dangling station "${end.stationId}"`);
        } else if ('anchorId' in end) {
          if (!doc.stations[end.stationId].transferAnchors?.some((a) => a.id === end.anchorId))
            v.push(`transfer "${key}": dangling hosted anchor "${end.anchorId}"`);
        } else if (end.lineId !== null && !doc.lines[end.lineId]) {
          v.push(`transfer "${key}": dangling line "${end.lineId}"`);
        }
      } else if (!doc.transferAnchors[end.anchorId]) {
        v.push(`transfer "${key}": dangling free anchor "${end.anchorId}"`);
      }
    }
  }

  for (const [key, b] of Object.entries(doc.routeBullets)) {
    if (b.lineId !== null && !doc.lines[b.lineId])
      v.push(`routeBullet "${key}": dangling line "${b.lineId}"`);
  }

  for (const [key, a] of Object.entries(doc.regionAssignments)) {
    if (!doc.lines[a.lineId]) v.push(`regionAssignment "${key}": dangling line "${a.lineId}"`);
    else if (!a.lines.includes(a.lineId))
      v.push(`regionAssignment "${key}": chosen line is not in its cover set`);
    for (const l of a.lines) {
      if (!doc.lines[l]) v.push(`regionAssignment "${key}": dangling cover line "${l}"`);
    }
  }

  for (const [kind, id] of Object.entries(doc.styleDefaults)) {
    if (doc.styles[id]?.kind !== kind) v.push(`styleDefaults.${kind}: does not resolve`);
  }
  for (const [collection, kind] of STYLE_KIND_OF) {
    const records = doc[collection] as Record<string, { styleId?: string }>;
    for (const [key, item] of Object.entries(records)) {
      if (item.styleId !== undefined && doc.styles[item.styleId]?.kind !== kind)
        v.push(`${String(collection)} "${key}": styleId "${item.styleId}" is not a ${kind} style`);
    }
  }

  return v;
}
