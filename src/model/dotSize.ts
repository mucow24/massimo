import { STOP_DOT_RADIUS } from '../geometry/orientation';

// Stop dot size, expressed as the dot's DIAMETER in px. The default derives
// from STOP_DOT_RADIUS so the "missing ⇒ default" chain renders identically
// to the pre-feature app (same idiom as LINE_WIDTH_DEFAULT === STOP_SIZE).
export const DOT_SIZE_DEFAULT = 2 * STOP_DOT_RADIUS;
// Transform clamp floor AND slider min — 0 (an invisible dot) is legal.
export const DOT_SIZE_MIN = 0;
// Slider bound only — the textboxes may exceed it (NumericFieldRow's
// textboxAllowAboveMax); the transforms clamp only the floor, mirroring
// setLineWidth.
export const DOT_SIZE_MAX = 20;

/**
 * The canonical STORED form of a dot size (diameter px): round to an integer,
 * clamp to ≥ DOT_SIZE_MIN, and collapse to `undefined` when it equals `dropAt`
 * — the effective default the value would otherwise redundantly duplicate.
 * `dropAt` is DOT_SIZE_DEFAULT for a line default, or the line's effective
 * default for a per-stop override. The one home for that arithmetic, shared by
 * the `setDotSize`/`setLineDefaultDotSize` transforms and the
 * `sanitizeStopDotSizes`/`sanitizeLineDotSize` file cleaners so the clamp rule
 * can never drift. Callers own the finiteness guard (they diverge on
 * non-finite input).
 */
export const canonicalDotSize = (
  size: number,
  dropAt: number = DOT_SIZE_DEFAULT,
): number | undefined => {
  const norm = Math.max(DOT_SIZE_MIN, Math.round(size));
  return norm === dropAt ? undefined : norm;
};

/**
 * The OVERRIDE-ONLY size: stop override, else line default, else undefined.
 * `undefined` means "fully tracking defaults" — rendering then keeps the
 * per-style fixed radii (SERVICE_CODE_DOT_RADIUS for code discs,
 * STOP_DOT_RADIUS otherwise), which is why this must NOT collapse to
 * DOT_SIZE_DEFAULT. Structural parameters so narrowed line/stop shapes pass
 * through (same convention as lineWidthOf).
 */
export const dotSizeOverride = (
  line: { defaultDotSize?: number } | null | undefined,
  stop: { dotSize?: number } | null | undefined,
): number | undefined => stop?.dotSize ?? line?.defaultDotSize;

/**
 * Fully-resolved size for UI display (the station inspector textbox). NOT
 * for rendering — see dotSizeOverride.
 */
export const resolveDotSize = (
  line: { defaultDotSize?: number } | null | undefined,
  stop: { dotSize?: number } | null | undefined,
): number => dotSizeOverride(line, stop) ?? DOT_SIZE_DEFAULT;

/**
 * Effective line default for the LineInspector slider. Missing field ⇒
 * DOT_SIZE_DEFAULT, so saves from before the field existed need no
 * migration (mirrors lineWidthOf).
 */
export const lineDefaultDotSizeOf = (
  line: { defaultDotSize?: number } | null | undefined,
): number => line?.defaultDotSize ?? DOT_SIZE_DEFAULT;
