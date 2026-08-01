import type { LineStyle } from './types';

/**
 * Every `LineStyle`, in canonical order — the one enumeration the rest of the
 * codebase derives from, so a newly added style cannot be half-adopted.
 *
 * The ORDER is meaningful in one place: it breaks a tie between styles with
 * equal standing (see interlining's stop-dot plurality). `solid` is first, so a
 * tie it takes part in resolves to solid.
 *
 * `NEXT_STYLE` (appendGestures.ts) walks the same sequence but stays a separate
 * literal on purpose: it is the user-facing CYCLE, and deriving it here would
 * make reordering this array silently reorder what shift-click does.
 */
export const LINE_STYLES = [
  'solid',
  'dashed',
  'hatched',
  'hatched-mirror',
  'dotted',
  'dashed-open',
] as const;

/**
 * Position of each style in {@link LINE_STYLES}, for tie-breaking. Lower wins,
 * so `solid` (0) takes any tie it is part of.
 *
 * The `satisfies` clause is the EXHAUSTIVENESS guard for the array above: this
 * object's keys are exactly `LINE_STYLES`' elements, so a `LineStyle` missing
 * from the array leaves a missing key here and fails to compile.
 */
export const LINE_STYLE_TIE_RANK = Object.fromEntries(LINE_STYLES.map((s, i) => [s, i])) as Record<
  (typeof LINE_STYLES)[number],
  number
> satisfies Record<LineStyle, number>;

/** Membership test over {@link LINE_STYLES} — order-insensitive by nature. */
export const KNOWN_LINE_STYLES: ReadonlySet<LineStyle> = new Set<LineStyle>(LINE_STYLES);
