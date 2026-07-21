// Snap a value to a step grid and clamp at the bottom only (spinbuttons accept
// values above a slider's max). The three-decimal rounding kills float artifacts
// like 1.1500000000000001 while preserving the finest step in use (tracking's
// 0.001); coarser 0.05 / 0.25 steps never carry a legitimate third decimal, so
// they're unaffected. Shared by every quarter-grid canonicalizer (line/dot/
// transfer/label style props) and the per-station / per-label writers.
export function snapToStep(v: number, step: number, min: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.round(Math.round(v / step) * step * 1000) / 1000);
}
