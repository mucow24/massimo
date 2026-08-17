// Swatch refs: the link half of the raw-value-plus-tag contract palette-linked
// colors use (see SwatchRef in types.ts). This module owns ref equality and
// resolution against a map's palettes; the reconcile pass that enforces the
// value-agrees-with-swatch invariant lives with the doc transforms.

import type { SwatchRef } from './types';
import { isLinePalette, type Palette, type PaletteSwatch } from './palettes';
import { normalizeHex } from '../util/color';

/**
 * Ref equality — absent ≡ absent, else both present naming the same palette
 * and swatch. Always value-wise: two refs are the same LINK, never the same
 * object (the DotStyle strokeAlign trap: `===` on optional objects reads
 * every distinct-but-equal pair as different).
 */
export function swatchRefsEqual(a: SwatchRef | undefined, b: SwatchRef | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.palette === b.palette && a.swatch === b.swatch;
}

/** Is this untyped value shaped like a SwatchRef? Load-time gate — refs from
 *  hand-edited files get no other validation before reconcile reads them. */
export function isSwatchRef(v: unknown): v is SwatchRef {
  if (!v || typeof v !== 'object') return false;
  const r = v as { palette?: unknown; swatch?: unknown };
  return (
    typeof r.palette === 'string' &&
    r.palette.length > 0 &&
    typeof r.swatch === 'string' &&
    r.swatch.length > 0
  );
}

const resolveIn = (
  palettes: readonly Palette[],
  ref: SwatchRef,
  kindMatches: (p: Palette) => boolean,
): PaletteSwatch | undefined => {
  const palette = palettes.find((p) => p.name === ref.palette);
  if (!palette || !kindMatches(palette)) return undefined;
  return palette.swatches.find((s) => s.name === ref.swatch);
};

/**
 * Resolve a LINE color ref — line palettes only. A ref into a design palette
 * is a kind mismatch and resolves to nothing, exactly as if the palette were
 * gone: the caller drops the ref and keeps the painted value.
 */
export const resolveLineSwatchRef = (
  palettes: readonly Palette[],
  ref: SwatchRef,
): PaletteSwatch | undefined => resolveIn(palettes, ref, isLinePalette);

/** Resolve a DESIGN color ref — design palettes only, the mirror rule. */
export const resolveDesignSwatchRef = (
  palettes: readonly Palette[],
  ref: SwatchRef,
): PaletteSwatch | undefined => resolveIn(palettes, ref, (p) => !isLinePalette(p));

/**
 * The write rule, for patch-style transforms: the ref a patch leaves on a
 * pair. Its own ref key wins when present (undefined clears); a patch that
 * touched a value half WITHOUT the ref key detaches (a hand-picked color);
 * anything else keeps the current link.
 */
export function patchedRef(
  patch: Record<string, unknown>,
  valueKeys: readonly string[],
  refKey: string,
  cur: SwatchRef | undefined,
): SwatchRef | undefined {
  if (refKey in patch) return patch[refKey] as SwatchRef | undefined;
  return valueKeys.some((k) => k in patch) ? undefined : cur;
}

/** The day/night pair a swatch paints — `night` collapsed means "same as day". */
export const swatchPair = (s: PaletteSwatch): { day: string; night: string } => ({
  day: s.color,
  night: s.night ?? s.color,
});

/**
 * The ref a line color IS, if any: the first LINE-palette swatch (map palette
 * order) whose color equals it via `normalizeHex`. One rule shared by
 * `addLine` (a line born on a swatch hex is born linked) and the load-time
 * `bakeLineColorRefs` conversion — the two must agree, or a freshly built doc
 * wouldn't round-trip through parse().
 */
export function lineColorRefFor(
  palettes: readonly Palette[],
  color: string,
): SwatchRef | undefined {
  const hex = normalizeHex(color);
  for (const p of palettes.filter(isLinePalette)) {
    for (const s of p.swatches) {
      if (normalizeHex(s.color) === hex) return { palette: p.name, swatch: s.name };
    }
  }
  return undefined;
}
