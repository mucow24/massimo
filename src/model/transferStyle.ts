// Per-transfer style overrides of the CONSTANT transfer defaults below. The
// sentinel for "the default" is an ABSENT optional field on the Transfer:
// the setters collapse a value equal to the default to `undefined` (same
// contract as StopCell.dotStyle / dotSize and Line.width), so persisted
// state stays clean. There are no doc-level transfer settings — map-wide
// restyling goes through the "Default" transfer style preset instead (its
// editor re-stamps every transfer wearing it).

// Transform clamp floor; the slider min too.
export const TRANSFER_THICKNESS_MIN = 1;
// Slider bound only — the textbox may exceed it (NumericFieldRow's
// textboxAllowAboveMax); the transforms clamp only the floor.
export const TRANSFER_THICKNESS_MAX = 14;
// The legacy hard-coded look: 2px black body, no outline, classic white
// when the outline is opted in.
export const TRANSFER_THICKNESS_DEFAULT = 2;
export const TRANSFER_COLOR_DEFAULT = '#000000';

// 0 = no outline; a legal, stored value (the DOC setting defaults to it —
// unlike line casings, transfer stroke width is a required doc field).
export const TRANSFER_STROKE_WIDTH_MIN = 0;
// Slider bound only, like TRANSFER_THICKNESS_MAX.
export const TRANSFER_STROKE_WIDTH_MAX = 5;
export const TRANSFER_STROKE_WIDTH_DEFAULT = 0;
export const TRANSFER_STROKE_COLOR_DEFAULT = '#ffffff';

// The four style knobs a transfer can override — also the shape of the
// constant defaults they fall back to.
export interface TransferStyle {
  thickness: number;
  color: string;
  strokeWidth: number;
  strokeColor: string;
}

// The constant fallback for every unset override — the legacy hard-coded
// look. One frozen object so render paths can pass it by reference.
export const TRANSFER_STYLE_DEFAULTS: TransferStyle = {
  thickness: TRANSFER_THICKNESS_DEFAULT,
  color: TRANSFER_COLOR_DEFAULT,
  strokeWidth: TRANSFER_STROKE_WIDTH_DEFAULT,
  strokeColor: TRANSFER_STROKE_COLOR_DEFAULT,
};

/**
 * The canonical STORED form of a per-transfer thickness override: round to
 * an integer, clamp to ≥ TRANSFER_THICKNESS_MIN, and collapse to `undefined`
 * when it equals `dropAt` — the constant default the value would otherwise
 * redundantly duplicate. Shared by the `updateTransferStyle` transform and
 * the `sanitizeTransferStyles` file cleaner so the clamp rule can never
 * drift (same idiom as canonicalDotSize). Callers own the finiteness guard.
 */
export const canonicalTransferThickness = (n: number, dropAt: number): number | undefined => {
  const norm = Math.max(TRANSFER_THICKNESS_MIN, Math.round(n));
  return norm === dropAt ? undefined : norm;
};

/** Same contract as canonicalTransferThickness for the outline width. */
export const canonicalTransferStrokeWidth = (n: number, dropAt: number): number | undefined => {
  const norm = Math.max(TRANSFER_STROKE_WIDTH_MIN, Math.round(n));
  return norm === dropAt ? undefined : norm;
};

/**
 * The canonical STORED form of a per-transfer color override: collapsed to
 * `undefined` at the constant default. Exact string comparison — every
 * in-app write comes from ColorField's normalized hex.
 */
export const canonicalTransferColor = (c: string, dropAt: string): string | undefined =>
  c === dropAt ? undefined : c;

/**
 * Fully-resolved style of one transfer: each override when present, else the
 * constant default. Structural transfer parameter so narrowed shapes pass
 * through (same convention as dotSizeOverride). `defaults` stays a parameter
 * for callers that already thread the constant explicitly (TransferLayer's
 * prop) and for tests; every production fallback is TRANSFER_STYLE_DEFAULTS.
 */
export const resolveTransferStyle = (
  t: { thickness?: number; color?: string; strokeWidth?: number; strokeColor?: string },
  defaults: TransferStyle = TRANSFER_STYLE_DEFAULTS,
): TransferStyle => ({
  thickness: t.thickness ?? defaults.thickness,
  color: t.color ?? defaults.color,
  strokeWidth: t.strokeWidth ?? defaults.strokeWidth,
  strokeColor: t.strokeColor ?? defaults.strokeColor,
});
