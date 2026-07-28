/**
 * Pure logic for the region freeze-during-gesture path (no React).
 *
 * While a history group is open (a drag, a slider), MapCanvas stops
 * recomputing the region arrangement — the doc doesn't need faces until the
 * group's commit runs reconcile, so mid-gesture face geometry is pure
 * presentation. What it shows instead is the arrangement FROZEN at the
 * gesture's start, with one correction: an exclusion hole may only stay
 * painted while it is provably still what a fresh build would compute —
 * a hole attached to geometry that has since moved would tear off its
 * stroke. So each frame diffs the current geometry units against the frozen
 * ones and DROPS the per-face hole entries anything dirty could have
 * touched; those faces fall back to the default lineOrder stacking until
 * the drop, exactly like an unassigned face. Everything far from the
 * gesture keeps its override pixel-perfect, by construction.
 *
 * Winner BINDING is deliberately frozen too: anchors evaluate against arc
 * positions, which smear while corridors stretch, and re-binding per frame
 * is exactly the flicker regime PR #368 hardened. Freezing is the stronger
 * form of its "bind once at gesture start" follow-up.
 */
import type { SegmentBandSpec, StopMarkerSpec } from '../../geometry/interlining';
import { hashUnits, type GeomUnit } from '../../geometry/regionIncremental';
import {
  boxesOverlap,
  SLIVER_ABSORB_REACH,
  type FaceHoles,
  type RegionFace,
  type RegionSliver,
} from '../../geometry/lineRegions';
import type { Line, LineId } from '../../model/types';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../../model/lineStroke';
import { lineWidthOf } from '../../model/lineWidth';

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Capture the per-unit content hashes the retention diff compares against. */
export function captureUnits(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
): Map<string, GeomUnit> {
  return hashUnits(bands, markers).units;
}

/**
 * Conservative boxes of everything that moved since `frozen` was captured:
 * a unit that appeared, vanished, or changed hash contributes both its old
 * and new box — the same both-sides rule the incremental builder uses.
 */
export function dirtyBoxesSince(
  frozen: Map<string, GeomUnit>,
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
): Box[] {
  const { units } = hashUnits(bands, markers);
  const dirty: Box[] = [];
  for (const [key, u] of units) {
    const old = frozen.get(key);
    if (old && old.hash === u.hash) continue;
    dirty.push(u.box);
    if (old) dirty.push(old.box);
  }
  for (const [key, old] of frozen) {
    if (!units.has(key)) dirty.push(old.box);
  }
  return dirty;
}

/**
 * Presentation inputs of buildExclusionHoles that unit hashing can't see:
 * casing rails (railWOf) read each line's stroke width. Geometry fields are
 * covered by the unit diff; this signature covers the rest — when it drifts
 * from the frozen one mid-gesture (a casing slider), no retained hole is
 * provably valid and the caller drops them all.
 */
export function railSig(lines: Record<LineId, Line>): string {
  const parts: string[] = [];
  for (const id of Object.keys(lines)) {
    const ln = lines[id];
    parts.push(id, String(lineStrokeRailWidth(lineStrokeWidthOf(ln), lineWidthOf(ln))));
  }
  return parts.join('|');
}

/** Slack over every spatial test: unit boxes are conservative supersets of
 * paint already; this covers the erosion/reclaim morphology's sub-unit reach
 * and flattening slop. */
const FACE_GEOM_PAD = 2;

/**
 * The per-face hole entries still provably identical to a fresh build, given
 * what moved. An entry is dropped when anything dirty could have reached its
 * computation: its own reveal region + dilation neighborhood (reach, with
 * the 3× miter allowance), the sliver-absorb neighborhood, any face close
 * enough to have been a shield source whose own geometry moved, or any
 * absorbable sliver that moved.
 */
export function retainFaceHoles(
  faceHoles: FaceHoles[],
  faces: RegionFace[],
  slivers: RegionSliver[],
  dirty: Box[],
): FaceHoles[] {
  if (!dirty.length) return faceHoles;
  const touched = (box: Box, pad: number) => dirty.some((d) => boxesOverlap(d, box, pad));
  const faceTouched = faces.map((f) => touched(f.bbox, FACE_GEOM_PAD));
  const sliverTouched = slivers.map((s) => touched(s.bbox, FACE_GEOM_PAD));
  return faceHoles.filter((fh) => {
    const ownPad = Math.max(fh.reach * 3, SLIVER_ABSORB_REACH * 3) + FACE_GEOM_PAD;
    if (touched(fh.bbox, ownPad)) return false;
    for (let j = 0; j < faces.length; j++) {
      if (faceTouched[j] && boxesOverlap(faces[j].bbox, fh.bbox, fh.reach * 3)) return false;
    }
    for (let k = 0; k < slivers.length; k++) {
      if (sliverTouched[k] && boxesOverlap(slivers[k].bbox, fh.bbox, SLIVER_ABSORB_REACH * 3)) {
        return false;
      }
    }
    return true;
  });
}
