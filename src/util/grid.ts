// Clamp `v` into the closed interval [lo, hi]. Callers must pass lo ≤ hi (the
// two-sided `Math.max(lo, Math.min(hi, v))` idiom this replaces has the same
// precondition). Pure min/max — no rounding — so it never perturbs a value that
// is already in range, which is why it's safe on the float-sensitive geometry
// call sites (angle cosines, arc parameters) as well as the integer/percent ones.
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Round a value to a step grid and clamp at the bottom only (spinbuttons accept
// values above a slider's max). The three-decimal rounding kills float artifacts
// like 1.1500000000000001 while preserving the finest step in use (tracking's
// 0.001); coarser 0.05 / 0.25 steps never carry a legitimate third decimal, so
// they're unaffected. This is the raw arithmetic shared by `snapToStep` and by
// every per-field canonicalizer (canonicalLineWidth / canonicalDotSize /
// clampRouteBulletSize / …). Those own their OWN finiteness guard because they
// diverge on non-finite input (a transform keeps the current value, a sanitizer
// drops the field), so this primitive deliberately does NOT guard — it passes
// NaN straight through.
export function roundClamp(v: number, step: number, min: number): number {
  return Math.max(min, Math.round(Math.round(v / step) * step * 1000) / 1000);
}

// As `roundClamp`, but a non-finite input collapses to `min`. Used by the style
// / per-station / per-label writers that want that fallback baked in.
export function snapToStep(v: number, step: number, min: number): number {
  if (!Number.isFinite(v)) return min;
  return roundClamp(v, step, min);
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
