/**
 * The fixed-point scale every clipper operation runs at.
 *
 * Lives in its own leaf module so both engine backends can read it without
 * `clipWasm` having to import from `clip` (which imports `clipWasm` back).
 *
 * World coordinates are multiplied by this and rounded to integers before any
 * boolean, which is what makes exactly-coincident, collinear and edge-tangent
 * geometry well-defined rather than a robustness failure mode.
 */
export const CLIP_SCALE = 1000;
