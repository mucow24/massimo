// Per-transfer style overrides of the doc-level transfer settings
// (doc.transferThickness / transferColor / transferStrokeWidth /
// transferStrokeColor). The sentinel for "follow the doc setting" is an
// ABSENT optional field on the Transfer: the setters collapse a value equal
// to the doc's current setting to `undefined` (same contract as
// StopCell.dotStyle / dotSize), so persisted state stays clean and such a
// transfer tracks later changes to the setting.

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
// doc-level settings they fall back to.
export interface TransferStyle {
  thickness: number;
  color: string;
  strokeWidth: number;
  strokeColor: string;
}

/**
 * The canonical STORED form of a per-transfer thickness override: round to
 * an integer, clamp to ≥ TRANSFER_THICKNESS_MIN, and collapse to `undefined`
 * when it equals `dropAt` — the doc's current transferThickness the value
 * would otherwise redundantly duplicate. Shared by the `updateTransferStyle`
 * transform and the `sanitizeTransferStyles` file cleaner so the clamp rule
 * can never drift (same idiom as canonicalDotSize). Callers own the
 * finiteness guard.
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
 * `undefined` at the doc's current color. Exact string comparison — the doc
 * color setters don't normalize case either, and every in-app write comes
 * from ColorField's normalized hex.
 */
export const canonicalTransferColor = (c: string, dropAt: string): string | undefined =>
  c === dropAt ? undefined : c;

/**
 * Fully-resolved style of one transfer: each override when present, else the
 * doc-level setting. Structural transfer parameter so narrowed shapes pass
 * through (same convention as dotSizeOverride).
 */
export const resolveTransferStyle = (
  t: { thickness?: number; color?: string; strokeWidth?: number; strokeColor?: string },
  defaults: TransferStyle,
): TransferStyle => ({
  thickness: t.thickness ?? defaults.thickness,
  color: t.color ?? defaults.color,
  strokeWidth: t.strokeWidth ?? defaults.strokeWidth,
  strokeColor: t.strokeColor ?? defaults.strokeColor,
});
