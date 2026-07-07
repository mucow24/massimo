import { add, sub, rotate, type Vec2 } from './vec';
import { polygonSnapAnchor } from './polygon';
import type { SvgImage } from '../model/types';

// The geometric subset of an SvgImage the pure transform helpers need. Keeping
// it structural (not the full SvgImage) means the math is testable with a plain
// object and never depends on `id`/`href`/`locked`.
export type SvgImageGeom = Pick<SvgImage, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

// A new bounding box after a resize: center + unrotated size. Rotation is never
// changed by a resize, so it isn't returned.
export interface SvgImageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// An image never shrinks below this (world units), on either axis.
export const SVG_IMAGE_MIN_SIZE = 4;
// Rotation snaps to multiples of this (degrees) by default; Shift frees it.
export const SNAP_ANGLE_STEP = 22.5;

// Corner local-frame signs, clockwise from top-left in the y-down screen frame.
// `opposite(i) = (i + 2) % 4`: 0↔2 (TL↔BR), 1↔3 (TR↔BL).
const CORNER_SIGNS: ReadonlyArray<{ sx: number; sy: number }> = [
  { sx: -1, sy: -1 }, // 0 TL
  { sx: 1, sy: -1 }, // 1 TR
  { sx: 1, sy: 1 }, // 2 BR
  { sx: -1, sy: 1 }, // 3 BL
];

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const center = (img: SvgImageGeom): Vec2 => ({ x: img.x, y: img.y });
const clampSize = (n: number): number => Math.max(SVG_IMAGE_MIN_SIZE, n);

// Local (image-frame) point → world: rotate by +rad about the center. Inverse
// uses -rad. This forward/inverse pair matches the render transform
// `translate(x,y) rotate(rotation)` (SVG rotate is clockwise; `vec.rotate` with
// a positive angle is clockwise in the y-down frame).
const localToWorld = (img: SvgImageGeom, local: Vec2): Vec2 =>
  add(center(img), rotate(local, toRad(img.rotation)));
const worldToLocal = (img: SvgImageGeom, world: Vec2): Vec2 =>
  rotate(sub(world, center(img)), -toRad(img.rotation));

export function normalizeRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function snapAngle(deg: number, snap: boolean): number {
  return snap ? Math.round(deg / SNAP_ANGLE_STEP) * SNAP_ANGLE_STEP : deg;
}

// The four world-space corners, clockwise from top-left.
export function svgImageCorners(img: SvgImageGeom): Vec2[] {
  const hw = img.width / 2;
  const hh = img.height / 2;
  return CORNER_SIGNS.map((s) => localToWorld(img, { x: s.sx * hw, y: s.sy * hh }));
}

// Resize by dragging a corner, with the opposite corner pinned in world space.
// Aspect is always locked to the start ratio: the axis with the larger relative
// drag drives, the other is derived. Computed in the image's local frame so it
// works at any rotation; the new center is recovered by re-pinning the anchor.
export function resizeSvgImageCorner(
  img: SvgImageGeom,
  cornerIndex: number,
  pointerWorld: Vec2,
): SvgImageBox {
  const anchorSigns = CORNER_SIGNS[(cornerIndex + 2) % 4];
  const anchorWorld = svgImageCorners(img)[(cornerIndex + 2) % 4];
  const aLocal = worldToLocal(img, anchorWorld);
  const pLocal = worldToLocal(img, pointerWorld);
  const rawW = Math.abs(pLocal.x - aLocal.x);
  const rawH = Math.abs(pLocal.y - aLocal.y);
  const ratio = img.width / img.height;
  let width: number;
  let height: number;
  if (rawW / img.width >= rawH / img.height) {
    width = rawW;
    height = rawW / ratio;
  } else {
    height = rawH;
    width = rawH * ratio;
  }
  width = clampSize(width);
  height = clampSize(height);
  // Re-pin: the anchor keeps its local signs, now at the new half-extents.
  const aLocalNew: Vec2 = { x: anchorSigns.sx * (width / 2), y: anchorSigns.sy * (height / 2) };
  const newCenter = sub(anchorWorld, rotate(aLocalNew, toRad(img.rotation)));
  return { x: newCenter.x, y: newCenter.y, width, height };
}

// Resize by dragging an edge midpoint: single axis, opposite edge pinned.
// edgeIndex 0=top, 1=right, 2=bottom, 3=left.
export function resizeSvgImageEdge(
  img: SvgImageGeom,
  edgeIndex: number,
  pointerWorld: Vec2,
): SvgImageBox {
  const hw = img.width / 2;
  const hh = img.height / 2;
  const pLocal = worldToLocal(img, pointerWorld);
  if (edgeIndex === 1 || edgeIndex === 3) {
    // Horizontal resize. sign = which side the dragged edge is on.
    const sign = edgeIndex === 1 ? 1 : -1;
    const aX = -sign * hw; // opposite (fixed) edge local x
    const newW = clampSize(Math.abs(pLocal.x - aX));
    const fixedMidWorld = localToWorld(img, { x: aX, y: 0 });
    const newCenter = add(
      fixedMidWorld,
      rotate({ x: sign * (newW / 2), y: 0 }, toRad(img.rotation)),
    );
    return { x: newCenter.x, y: newCenter.y, width: newW, height: img.height };
  }
  // Vertical resize (top/bottom).
  const sign = edgeIndex === 2 ? 1 : -1;
  const aY = -sign * hh;
  const newH = clampSize(Math.abs(pLocal.y - aY));
  const fixedMidWorld = localToWorld(img, { x: 0, y: aY });
  const newCenter = add(fixedMidWorld, rotate({ x: 0, y: sign * (newH / 2) }, toRad(img.rotation)));
  return { x: newCenter.x, y: newCenter.y, width: img.width, height: newH };
}

// The rotation (degrees, clockwise) that points the image's "up" toward the
// pointer. Zero = pointer straight above the center; +90 = pointer to the right.
// `shift` rounds to the nearest 22.5° multiple (the drag hook passes
// !e.shiftKey: snapped by default, Shift frees).
export function rotateSvgImageTo(img: SvgImageGeom, pointerWorld: Vec2, shift: boolean): number {
  const dx = pointerWorld.x - img.x;
  const dy = pointerWorld.y - img.y;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return normalizeRotation(snapAngle(deg, shift));
}

// The whole-image move snap anchor: the highest-then-leftmost ROTATED corner,
// reusing the same rule as a whole-polygon drag.
export function svgImageSnapAnchor(img: SvgImageGeom): Vec2 {
  return polygonSnapAnchor(svgImageCorners(img));
}
