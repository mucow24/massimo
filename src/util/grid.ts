// Clamp `v` into the closed interval [lo, hi]. Callers must pass lo ≤ hi (the
// two-sided `Math.max(lo, Math.min(hi, v))` idiom this replaces has the same
// precondition). Pure min/max — no rounding — so it never perturbs a value that
// is already in range, which is why it's safe on the float-sensitive geometry
// call sites (angle cosines, arc parameters) as well as the integer/percent ones.
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Six decimals: fine enough that no value anyone types or drags is touched,
// coarse enough to erase the binary dust an addition leaves behind
// (0.1 + 0.2 = 0.30000000000000004, 23 × 0.05 = 1.1500000000000001).
const FLOAT_CLEAN = 1e6;

// Kill binary float artifacts WITHOUT quantizing. Every piece of field
// arithmetic in the app (a wheel tick, a percent conversion, a legacy bake)
// ends here, so dust never reaches the doc — and 0.32455 comes back as
// 0.32455.
export function cleanFloat(v: number): number {
  return Math.round(v * FLOAT_CLEAN) / FLOAT_CLEAN;
}

// THE canonical stored form of an editable numeric field: clamp at the bottom
// only (spinbuttons accept values above a slider's max) and clean the float.
// Deliberately NO grid rounding. A field's `step` is the granularity of its
// slider, its arrow keys and its wheel — not the set of legal values — so what
// the user types is what the document gets: 0.32455 stays 0.32455, where the
// old step-grid rounding gave back 0.325 and made the box look broken.
// Shared by every per-field canonicalizer (canonicalLineWidth /
// canonicalDotSize / clampRouteBulletSize / …). A non-finite input collapses to
// `min`: callers still decide what to do with garbage BEFORE calling (a
// transform keeps the current value, a sanitizer drops the field), and this is
// the backstop for one that forgets.
export function clampField(v: number, min: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, cleanFloat(v));
}

// Round onto a step grid and clamp at the bottom; a non-finite input collapses
// to `min`. This is a GESTURE snap, not a field rule — the only caller is the
// line-circle radius drag, where a pointer distance should land on the same
// quarter grid the placement preview draws. A typed field must never use it.
export function snapToStep(v: number, step: number, min: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, cleanFloat(Math.round(v / step) * step));
}

// Decimal places implied by a step: 1 → 0, 0.5 → 1, 0.25 → 2, 0.001 → 3. THE
// reading of a step's precision, shared by the numeric field's text mirror and
// by `stepFromValue` below.
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * One step along a field's grid — the grid anchored at `min`, `dir` = +1/−1.
 *
 * From a value already ON the grid this is plain `v ± step`. From an off-grid
 * value it lands ON the grid (10.2 → 10.25 → 10.5, or 10.2 → 10 → 9.75) rather
 * than carrying the offset along forever. That is what native
 * `<input type=number>` stepUp/stepDown does (the HTML stepping algorithm walks
 * multiples of the step from the step base) and what Radix's slider arrows do
 * (`getNextStepValue`), so the wheel, the arrow keys and the spinner buttons
 * all agree.
 */
export function stepFromValue(v: number, step: number, min: number, dir: 1 | -1): number {
  const stepsFromMin = (v - min) / step;
  const nearest = Math.round(stepsFromMin);
  // Exact (float-cleaned) equality, NOT equality at the step's decimals: a
  // value may carry more precision than its step, and rounding both sides to
  // the step's decimals reads 0.32455 as "already on the 0.001 grid" and skips
  // the landing tick.
  const aligned = cleanFloat(min + nearest * step) === cleanFloat(v);
  const next = aligned
    ? nearest + dir
    : dir > 0
      ? Math.ceil(stepsFromMin)
      : Math.floor(stepsFromMin);
  return cleanFloat(min + next * step);
}

// Normalize an integer onto the 8-step rotation ring (0..7). Rotations render
// mod 8 (SVG rotate is periodic); in-app mutators wrap, but hand-edited/persisted
// docs and octant arithmetic (angle deltas, +90° steps) can carry 8 or −1, which
// must land on 0 and 7. Bare `n % 8` won't do it — JS `%` keeps the sign, so
// −1 % 8 === −1; the double-mod folds negatives back up. The result is always a
// valid `Rotation`, so callers producing one cast at their own site.
export function rot8(n: number): number {
  return ((n % 8) + 8) % 8;
}
