import { edgeEndpoints } from './lineTopology';
import { pairKeyOf } from './pairKey';
import { collectSwatchRefs } from './transforms';
import { endStationId, isFreeAnchorEnd, isHostedAnchorEnd } from './transferAnchors';
import { isSwatchRef, resolveDesignSwatchRef, resolveLineSwatchRef } from './swatchRef';
import type { MapDoc, StyleKind } from './types';

// Every keyed collection whose records carry their own `id`, with the noun a
// violation names it by. The KEY is the identity — it is what the order arrays,
// the `styleId` tags, the selection and every drag carry around — so a record
// filed under a key its own `id` disagrees with is a writer bug, and one that
// tags items with a dangling id if the record is a StyleDef. This is exactly
// the set the import path rewrites (`sanitizeDocReferences`'s id sweep, plus
// `sanitizeRegionAssignments` and `sanitizeStyles`, which each rebuild `id`
// from the key), so the audit and the repair must enumerate the same
// collections or the door stops guarding what the load path promises. Neither
// list can derive itself from the other — the repair is split across three
// functions with different jobs — so docAudit.test.ts asks BOTH the same
// question, over the collections it reads off a populated doc.
const ID_KEYED_COLLECTIONS: ReadonlyArray<[keyof MapDoc, string]> = [
  ['stations', 'station'],
  ['lines', 'line'],
  ['lineTags', 'lineTag'],
  ['routeBullets', 'routeBullet'],
  ['transferAnchors', 'transferAnchor'],
  ['transfers', 'transfer'],
  ['textLabels', 'textLabel'],
  ['polygons', 'polygon'],
  ['regionAssignments', 'regionAssignment'],
  ['svgImages', 'svgImage'],
  ['lineCircles', 'lineCircle'],
  ['guides', 'guide'],
  ['styles', 'style'],
];

// The numeric SUBSTANCE of a record, per collection: the fields the import
// path refuses to accept a non-finite value in, because no faithful repair
// exists — it drops the whole record (`sanitizeDocReferences`, and
// `sanitizeLineCircles`/`sanitizeGuides` for the last two). That is what puts
// an NaN arriving from inside the app on the same footing as a dangling id:
// the item stops rendering where it stands, and the only thing that clears it
// is a save-then-load that DELETES the user's work. `polygons` is absent here
// because its substance is an array of vertices, audited on its own below.
const FINITE_FIELDS: ReadonlyArray<[keyof MapDoc, string, readonly string[]]> = [
  ['stations', 'station', ['x', 'y']],
  ['transferAnchors', 'transferAnchor', ['x', 'y']],
  ['lineTags', 'lineTag', ['distance']],
  ['routeBullets', 'routeBullet', ['x', 'y', 'size']],
  ['textLabels', 'textLabel', ['x', 'y', 'fontSize']],
  ['svgImages', 'svgImage', ['x', 'y', 'width', 'height', 'rotation']],
  ['lineCircles', 'lineCircle', ['x', 'y', 'radius']],
  ['guides', 'guide', ['offset']],
];

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

  for (const [collection, noun] of ID_KEYED_COLLECTIONS) {
    const records = doc[collection] as Record<string, { id: string }>;
    for (const [key, item] of Object.entries(records)) {
      if (item.id !== key) v.push(`${noun} "${key}": id reads "${item.id}"`);
    }
  }

  for (const [collection, noun, fields] of FINITE_FIELDS) {
    const records = doc[collection] as Record<string, Record<string, unknown>>;
    for (const [key, item] of Object.entries(records)) {
      for (const f of fields) {
        if (!finite(item[f])) v.push(`${noun} "${key}": non-finite ${f}`);
      }
    }
  }

  // A polygon's substance is its outline: two finite vertices at the least
  // (one point is not a shape), plus the stroke width the renderer paints by.
  for (const [key, p] of Object.entries(doc.polygons)) {
    if (p.vertices.length < 2) v.push(`polygon "${key}": fewer than two vertices`);
    if (p.vertices.some((pt) => !finite(pt.x) || !finite(pt.y)))
      v.push(`polygon "${key}": non-finite vertex`);
    if (!finite(p.strokeWidth)) v.push(`polygon "${key}": non-finite strokeWidth`);
  }

  for (const [key, st] of Object.entries(doc.stations)) {
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

  // Narrowed through transferAnchors.ts, never by a bare `in` test: two of the
  // three arms carry a stationId, so an if-chain that leads with one is right
  // only by where it sits — which is the single easiest thing to get wrong
  // about this union, and why the guards exist. `endStationId` is the "both
  // station-keyed arms" question the station check actually wants; the three
  // arms then part company over which id each one still has to resolve.
  for (const [key, t] of Object.entries(doc.transfers)) {
    for (const end of [t.a, t.b]) {
      const stationId = endStationId(end);
      if (stationId !== null && !doc.stations[stationId]) {
        v.push(`transfer "${key}": dangling station "${stationId}"`);
        continue;
      }
      if (isHostedAnchorEnd(end)) {
        if (!doc.stations[end.stationId].transferAnchors?.some((a) => a.id === end.anchorId))
          v.push(`transfer "${key}": dangling hosted anchor "${end.anchorId}"`);
      } else if (isFreeAnchorEnd(end)) {
        if (!doc.transferAnchors[end.anchorId])
          v.push(`transfer "${key}": dangling free anchor "${end.anchorId}"`);
      } else if (end.lineId !== null && !doc.lines[end.lineId]) {
        v.push(`transfer "${key}": dangling line "${end.lineId}"`);
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

  // Palettes are the one doc collection keyed by NAME rather than by a record
  // key, and those names are what every SwatchRef resolves through — two
  // palettes (or two swatches within one) under one name is the same violation
  // as an `id` disagreeing with its key, and the load path drops the second of
  // each for exactly that reason. Whether a palette carries any color is NOT
  // audited: an empty one is canonicality (`dropEmptyPalettes`' business), not
  // a reference anything else in the doc can be pointing at.
  {
    const paletteNames = new Set<string>();
    for (const p of doc.palettes) {
      if (paletteNames.has(p.name)) v.push(`palette "${p.name}": name is not unique`);
      paletteNames.add(p.name);
      const swatchNames = new Set<string>();
      for (const s of p.swatches) {
        if (swatchNames.has(s.name))
          v.push(`palette "${p.name}": swatch name "${s.name}" is not unique`);
        swatchNames.add(s.name);
      }
    }
  }

  // Swatch refs: a link into `doc.palettes`, and the last reference class in
  // the doc that lives outside a keyed collection. `reconcileSwatchRefs` drops
  // every one that stops resolving on BOTH load doors, so a writer that leaves
  // one dangling ships a doc whose link silently evaporates on the next load —
  // the color it painted stays, so the only symptom is a palette Reset/Sync
  // that quietly stops doing anything. Read off the reconcile's own traversal
  // (`collectSwatchRefs`) rather than a second list of homes: the slot table is
  // where a ref home is added, and a home the audit cannot see is a home the
  // export door stops guarding. Duplicates collapse — a dozen homes wearing one
  // broken link is one thing to report.
  {
    const broken = new Set<string>();
    for (const { ref, linePalette } of collectSwatchRefs(doc)) {
      const resolve = linePalette ? resolveLineSwatchRef : resolveDesignSwatchRef;
      // Kind is half of resolution: a design ref naming a line palette resolves
      // to nothing, exactly as if the palette were gone.
      if (isSwatchRef(ref) && resolve(doc.palettes, ref)) continue;
      broken.add(isSwatchRef(ref) ? `"${ref.palette}"/"${ref.swatch}"` : JSON.stringify(ref));
    }
    for (const label of broken) v.push(`swatch ref ${label}: does not resolve`);
  }

  return v;
}
