import { stopPosWorld } from '../../geometry/interlining';
import { svgImageCorners } from '../../geometry/svgImage';
import { measureTextLabel } from '../../geometry/textMeasure';
import { rotatedRectCorners, type Vec2 } from '../../geometry/vec';
import type { MapDoc, TextLabel } from '../../model/types';

/** Per-kind id sets excluded from the pool — the dragged item itself plus, in a
 *  group drag, every co-selected sibling (they move with the drag, so they'd be
 *  unstable targets). */
export interface AlignExclude {
  stationIds?: ReadonlySet<string>;
  polygonIds?: ReadonlySet<string>;
  svgImageIds?: ReadonlySet<string>;
  labelIds?: ReadonlySet<string>;
  bulletIds?: ReadonlySet<string>;
}

/** The doc slices the pool draws from. Structural so tests can pass a plain
 *  object; the live store state satisfies it. */
export type AlignDoc = Pick<
  MapDoc,
  'stations' | 'polygons' | 'svgImages' | 'textLabels' | 'routeBullets'
>;

/**
 * The four world-space corners of a label's visible bbox (no hit padding),
 * clockwise from the unrotated top-left, rotated about the center like the
 * render transform (`rotate(label.rotation * 45)`; positive `vec.rotate` is
 * clockwise in the y-down frame). Parallels {@link svgImageCorners}; the
 * label drag anchors on the topmost-then-leftmost of these.
 */
export function textLabelCorners(label: TextLabel): Vec2[] {
  const m = measureTextLabel(label);
  const rad = (label.rotation * 45 * Math.PI) / 180;
  return rotatedRectCorners({ x: label.x, y: label.y }, m.width / 2, m.height / 2, rad);
}

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
 * The shared "Snap to all" target pool: every station stop-center (anchor when
 * stopless), every polygon vertex, every svg image's rotated corners, three
 * points per text label, and every route bullet's center — minus the excluded
 * items. Built once at pointer-down (everything in it is stationary for the
 * duration of a drag), shared by every point-snapper drag path.
 */
export function alignTargets(doc: AlignDoc, exclude: AlignExclude = {}): Vec2[] {
  const out: Vec2[] = [];
  for (const id of Object.keys(doc.stations)) {
    if (exclude.stationIds?.has(id)) continue;
    const st = doc.stations[id];
    if (st.stops.length === 0) out.push({ x: st.x, y: st.y });
    else for (const c of st.stops) out.push(stopPosWorld(c, st));
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
  return out;
}
