/**
 * Region-assignment reconciliation: carries every stored paint choice from the
 * pre-edit region set to the post-edit one, so assignments survive nudges,
 * long drags, teleports, splits (both halves), merges (deterministically),
 * and temporary destruction of their overlap (dormancy). Pure; the store runs
 * it inside the same undo entry as the geometry edit.
 */
import type { LineId, RegionAnchor, RegionAssignment } from '../model/types';
import { pairKeyOf } from '../model/pairKey';
import { edgeEndpoints, lineHasEdge, neighborsOf } from '../model/lineTopology';
import { intersect, offsetClosed, type Ring } from './clip';
import {
  armOfLinePairKey,
  bindAssignments,
  distinctCoverLines,
  mintAnchors,
  stripeArcLength,
  type RegionFace,
} from './lineRegions';
import { regionsFor, type GeometrySlice, type RegionGeometry } from './regionCache';
import type { SegmentBandSpec } from './interlining';

/** BFS depth cap when re-routing an anchor across an edge split. */
const MAX_SPLIT_PATH_EDGES = 4;

/** Shortest station path a→b along a line's edge set, or null. */
function shortestEdgePath(
  line: { edges: string[] } & Parameters<typeof neighborsOf>[0],
  a: string,
  b: string,
  maxEdges: number,
): string[] | null {
  if (a === b) return null;
  const prev = new Map<string, string>([[a, a]]);
  let frontier = [a];
  for (let depth = 0; depth < maxEdges && frontier.length; depth++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of neighborsOf(line, cur)) {
        if (prev.has(nb)) continue;
        prev.set(nb, cur);
        if (nb === b) {
          const path = [b];
          let walk = b;
          while (walk !== a) {
            walk = prev.get(walk)!;
            path.unshift(walk);
          }
          return path;
        }
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Translate an anchor whose pairKey no longer exists on its line across the
 * topology delta: an edge SPLIT (station spliced in) walks the replacement
 * chain consuming the anchor distance; an edge HEAL (through-station deleted)
 * maps the distance onto the direct replacement edge. Null when
 * untranslatable — the assignment then survives on its other anchors.
 */
function translateAnchor(
  anchor: RegionAnchor,
  oldGeom: GeometrySlice,
  newGeom: GeometrySlice,
  oldBands: SegmentBandSpec[],
  newBands: SegmentBandSpec[],
): RegionAnchor | null {
  const newLine = newGeom.lines[anchor.lineId];
  if (!newLine) return null;
  const [pa, pb] = edgeEndpoints(anchor.pairKey);
  if (lineHasEdge(newLine, pa, pb)) return anchor;
  const anchorStation = anchor.anchorEnd === 'from' ? pa : pb;
  const otherStation = anchorStation === pa ? pb : pa;

  // SPLIT: both endpoints still exist — walk the replacement chain from the
  // anchored end, consuming the stored distance across the new stripe lengths.
  if (newGeom.stations[pa] && newGeom.stations[pb]) {
    const path = shortestEdgePath(newLine, anchorStation, otherStation, MAX_SPLIT_PATH_EDGES);
    if (path) {
      let remaining = anchor.distance;
      for (let i = 0; i + 1 < path.length; i++) {
        const eKey = pairKeyOf(path[i], path[i + 1]);
        const len = stripeArcLength(newBands, eKey, anchor.lineId);
        if (len === null) return null;
        if (remaining <= len || i + 2 === path.length) {
          const [from] = edgeEndpoints(eKey);
          return {
            lineId: anchor.lineId,
            pairKey: eKey,
            anchorEnd: path[i] === from ? 'from' : 'to',
            distance: Math.min(remaining, len),
            ...(anchor.side !== undefined ? { side: anchor.side } : {}),
          };
        }
        remaining -= len;
      }
      return null;
    }
  }

  // HEAL: one endpoint was deleted and the line's edges were re-stitched.
  // Find the single fresh edge incident to the surviving endpoint.
  const oldLine = oldGeom.lines[anchor.lineId];
  const survivor = newGeom.stations[anchorStation]
    ? anchorStation
    : newGeom.stations[otherStation]
      ? otherStation
      : null;
  if (!survivor || !oldLine) return null;
  const oldEdges = new Set(oldLine.edges);
  const fresh = newLine.edges.filter((e) => {
    if (oldEdges.has(e)) return false;
    const [ea, eb] = edgeEndpoints(e);
    return ea === survivor || eb === survivor;
  });
  if (fresh.length !== 1) return null;
  const eKey = fresh[0];
  const len = stripeArcLength(newBands, eKey, anchor.lineId);
  if (len === null) return null;
  let dFromSurvivor: number;
  if (survivor === anchorStation) {
    dFromSurvivor = anchor.distance;
  } else {
    const oldLen = stripeArcLength(oldBands, anchor.pairKey, anchor.lineId);
    if (oldLen === null) return null;
    dFromSurvivor = Math.max(0, oldLen - anchor.distance);
  }
  const [from] = edgeEndpoints(eKey);
  return {
    lineId: anchor.lineId,
    pairKey: eKey,
    anchorEnd: survivor === from ? 'from' : 'to',
    distance: Math.min(dFromSurvivor, len),
    ...(anchor.side !== undefined ? { side: anchor.side } : {}),
  };
}

const anchorsEqual = (a: RegionAnchor[], b: RegionAnchor[]): boolean =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.lineId === b[i].lineId &&
      x.pairKey === b[i].pairKey &&
      x.anchorEnd === b[i].anchorEnd &&
      x.distance === b[i].distance &&
      x.side === b[i].side,
  );

const assignmentsEqual = (a: RegionAssignment, b: RegionAssignment): boolean =>
  a.id === b.id &&
  a.lineId === b.lineId &&
  a.winnerPairKey === b.winnerPairKey &&
  a.lines.length === b.lines.length &&
  a.lines.every((l, i) => l === b.lines[i]) &&
  anchorsEqual(a.anchors, b.anchors);

const facesOverlap = (a: RegionFace, b: Ring[]): boolean => intersect(a.face, b).length > 0;

const maxStripeWidth = (bands: SegmentBandSpec[]): number => {
  let w = 0;
  for (const band of bands) for (const sw of band.stripeWidths) w = Math.max(w, sw);
  return w;
};

export function reconcileRegionAssignments(
  oldGeom: GeometrySlice,
  newGeom: GeometrySlice,
  assignments: Record<string, RegionAssignment>,
  mintId: () => string,
): Record<string, RegionAssignment> {
  const ids = Object.keys(assignments).sort();
  if (!ids.length) return assignments;

  const oldR: RegionGeometry = regionsFor(oldGeom);
  const newR: RegionGeometry = regionsFor(newGeom);
  const oldLive = new Set<LineId>(Object.keys(oldGeom.lines));
  const newLive = new Set<LineId>(Object.keys(newGeom.lines));

  // The numbered steps are conceptual phases, not code order: they execute
  // 0, 1, 3, 4, 2 down the function. Split inheritance (2) runs LAST because it
  // duplicates onto faces left unclaimed after the remint (4) has settled every
  // bound assignment.
  //
  // Step 0 — drop choices whose chosen line died (mirrors the transform
  // cascade), shrink covers of dead members, translate dangling anchors.
  const translated: Record<string, RegionAssignment> = {};
  for (const id of ids) {
    const a = assignments[id];
    if (!newLive.has(a.lineId)) continue;
    const lines = a.lines.filter((l) => newLive.has(l));
    // One cover line arbitrates nothing — unless the choice is an ARM of it
    // (a self-overlap face), where one line is the whole point.
    if (lines.length < 2 && a.winnerPairKey === undefined) continue;
    // The arm choice rides its own anchor: winnerPairKey is by construction
    // the pairKey of one of the winner line's anchors, so translating that
    // anchor translates the choice. Untranslatable ⇒ kept verbatim, like a
    // dormant anchor — the remint below re-derives or degrades it.
    let winnerPairKey = a.winnerPairKey;
    const anchors: RegionAnchor[] = [];
    for (const anchor of a.anchors) {
      const t = translateAnchor(anchor, oldGeom, newGeom, oldR.bands, newR.bands);
      if (t) {
        if (
          a.winnerPairKey !== undefined &&
          winnerPairKey === a.winnerPairKey &&
          anchor.lineId === a.lineId &&
          anchor.pairKey === a.winnerPairKey
        ) {
          winnerPairKey = t.pairKey;
        }
        anchors.push(t);
      }
    }
    // Zero translatable anchors: keep the originals verbatim — the assignment
    // is dormant, and future reconciles may find geometry they fit again.
    if (!anchors.length) {
      translated[id] = a;
      continue;
    }
    const next =
      lines.length === a.lines.length &&
      anchorsEqual(anchors, a.anchors) &&
      winnerPairKey === a.winnerPairKey
        ? a
        : {
            ...a,
            lines,
            anchors,
            ...(winnerPairKey !== undefined ? { winnerPairKey } : {}),
          };
    translated[id] = next;
  }

  // Step 1 — bind under both geometries (nearest compatible face). New-side
  // binding priority: larger OLD face first (so when regions merge, the
  // assignment that governed more area keeps the merged face), then id.
  const oldBound = bindAssignments(oldR.faces, assignments, oldR.bands, oldLive);
  const bindOrder = Object.keys(translated).sort((x, y) => {
    const ax = oldBound.has(x) ? oldR.faces[oldBound.get(x)!].area : 0;
    const ay = oldBound.has(y) ? oldR.faces[oldBound.get(y)!].area : 0;
    return ay - ax || (x < y ? -1 : 1);
  });
  const newBound = bindAssignments(newR.faces, translated, newR.bands, newLive, bindOrder);

  const out: Record<string, RegionAssignment> = {};
  let changed = false;
  const claimedFaces = new Set<number>(newBound.values());

  // Step 3 (merge/conflict) — an assignment that failed to bind because its
  // wanted face was claimed by another was merged away: delete it. One that
  // has NO compatible face at all is dormant: keep it.
  for (const id of Object.keys(translated)) {
    if (newBound.has(id)) continue;
    const solo = bindAssignments(newR.faces, { [id]: translated[id] }, newR.bands, newLive);
    const wanted = solo.get(id);
    if (wanted !== undefined && claimedFaces.has(wanted)) {
      changed = true; // merged into the winner — deleted
      continue;
    }
    out[id] = translated[id]; // dormant
    if (translated[id] !== assignments[id]) changed = true;
  }

  // Step 4 — re-mint bound assignments from their faces.
  for (const [id, faceIndex] of newBound) {
    const a = translated[id];
    const face = newR.faces[faceIndex];
    const anchors = mintAnchors(face, newR.bands);
    // Re-derive the arm choice against the fresh anchors: the translated key
    // names the arm; the arm's own new anchor re-spells it. An arm that no
    // longer resolves drops the field — merged, never a wrong clip.
    let winnerPairKey: string | undefined;
    if (a.winnerPairKey !== undefined) {
      const arm = armOfLinePairKey(newR.bands, a.lineId, a.winnerPairKey);
      if (arm !== null) {
        winnerPairKey = anchors.find(
          (an) =>
            an.lineId === a.lineId && armOfLinePairKey(newR.bands, a.lineId, an.pairKey) === arm,
        )?.pairKey;
      }
    }
    const reminted: RegionAssignment = {
      id,
      lineId: a.lineId,
      // Distinct LINES whatever the face's cover spelling — arm ids are
      // build-local and must never persist.
      lines: distinctCoverLines(face.lineIds).sort(),
      anchors,
      ...(winnerPairKey !== undefined ? { winnerPairKey } : {}),
    };
    const same = assignmentsEqual(reminted, assignments[id] ?? reminted) && assignments[id];
    out[id] = same ? assignments[id] : reminted;
    if (!same) changed = true;
  }

  // Step 2 — split inheritance: every unclaimed face that descends from a
  // bound assignment's old face inherits a duplicate. "Descends" = overlaps
  // the old face in world space (pure splits), or — when the gesture also
  // MOVED the region so the old face is elsewhere — overlaps the bound new
  // face dilated by a stripe width (siblings sit just across the cutting
  // line's body).
  const dilation = Math.max(maxStripeWidth(newR.bands), 1);
  for (const [id, faceIndex] of newBound) {
    // Inherit from the PRE-remint assignment: its cover is what the user's
    // choice arbitrated. The re-minted one may have grown to include the
    // cutting line, which would wrongly exclude split siblings the cutter
    // does not cross.
    const a = translated[id];
    const oldFaceIndex = oldBound.get(id);
    const boundFace = newR.faces[faceIndex];
    const seed: Ring[] = [];
    if (oldFaceIndex !== undefined) {
      const oldFace = oldR.faces[oldFaceIndex];
      seed.push(...oldFace.face);
      if (!facesOverlap(boundFace, oldFace.face)) {
        seed.push(...offsetClosed(boundFace.face, dilation));
      }
    } else {
      seed.push(...offsetClosed(boundFace.face, dilation));
    }
    for (let i = 0; i < newR.faces.length; i++) {
      if (claimedFaces.has(i)) continue;
      const f = newR.faces[i];
      // Cover compatibility: the duplicate must still arbitrate the same
      // lines (the cutting line may ADD to the cover, never remove).
      if (!translatedCoverCompatible(a, f)) continue;
      if (!facesOverlap(f, seed)) continue;
      const dupId = mintId();
      const dupAnchors = mintAnchors(f, newR.bands);
      // A split sibling inherits the arm choice too, re-spelled against its
      // own anchors — same derivation as the remint above.
      let dupWinnerPairKey: string | undefined;
      if (a.winnerPairKey !== undefined) {
        const arm = armOfLinePairKey(newR.bands, a.lineId, a.winnerPairKey);
        if (arm !== null) {
          dupWinnerPairKey = dupAnchors.find(
            (an) =>
              an.lineId === a.lineId && armOfLinePairKey(newR.bands, a.lineId, an.pairKey) === arm,
          )?.pairKey;
        }
      }
      out[dupId] = {
        id: dupId,
        lineId: a.lineId,
        lines: distinctCoverLines(f.lineIds).sort(),
        anchors: dupAnchors,
        ...(dupWinnerPairKey !== undefined ? { winnerPairKey: dupWinnerPairKey } : {}),
      };
      claimedFaces.add(i);
      changed = true;
    }
  }

  if (!changed && Object.keys(out).length === ids.length) return assignments;
  return out;
}

/** The inheriting face must still cover every line the assignment arbitrates. */
function translatedCoverCompatible(a: RegionAssignment, face: RegionFace): boolean {
  const cover = distinctCoverLines(face.lineIds);
  return cover.includes(a.lineId) && a.lines.every((l) => cover.includes(l));
}
