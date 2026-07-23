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
