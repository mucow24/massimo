// Line END style: what the line's painted end looks like at a terminus.
//
// A line's end today is the OUTWARD half of its stop marker — the band stripe
// itself stops dead at the terminal stop's center (butt cap), and the
// width x width marker square supplies the half beyond it. The three styles are
// exactly SVG's three line caps taken at that center:
//
//   square — the full marker square (the historical look, and the default).
//   short  — only the inward half, so the line ends flush at the stop center
//            and a same-width round dot covers the rest with no corners
//            peeking out from behind it.
//   round  — the outward half replaced by a half-disc of radius width/2, so a
//            round dot NARROWER than the line still sits inside a smooth end.
//
// Presentation, not geometry: it never moves a band path, changes tangency, or
// re-packs a station. It does change the marker's painted FOOTPRINT, so the
// region arrangement reads it (see lineRegions.markerBodyRings) — which is why
// the resolution below is shared rather than duplicated per consumer.

import type { Line, LineEndStyle, LineStyle, StationId } from './types';

export type { LineEndStyle };

// Order is the UI order (the picker renders them in this sequence).
export const LINE_END_STYLES = ['square', 'short', 'round'] as const;

// Never stored: the field is dropped at this value, so an absent field means
// square and saves that predate the feature need no migration.
export const LINE_END_STYLE_DEFAULT: LineEndStyle = 'square';

const KNOWN = new Set<string>(LINE_END_STYLES);

export function isLineEndStyle(v: unknown): v is LineEndStyle {
  return typeof v === 'string' && KNOWN.has(v);
}

/**
 * A line's own end style — the default every one of its termini wears unless
 * that station pins an override. Structural parameter so narrowed line shapes
 * pass through (same idiom as `lineWidthOf`).
 */
export function lineEndStyleOf(line: { endStyle?: LineEndStyle } | null | undefined): LineEndStyle {
  return line?.endStyle ?? LINE_END_STYLE_DEFAULT;
}

/**
 * The end style at ONE of a line's termini: the per-station override when the
 * station pins one, else the line's own. A pure lookup — it does not check that
 * `stationId` is actually a terminus (callers reach it only where `outward` is
 * set, and orphaned keys are pruned on every topology change).
 */
export function stationEndStyleOf(
  line:
    | { endStyle?: LineEndStyle; stationEndStyles?: Record<StationId, LineEndStyle> }
    | null
    | undefined,
  stationId: StationId,
): LineEndStyle {
  return line?.stationEndStyles?.[stationId] ?? lineEndStyleOf(line);
}

/**
 * Write a line's per-terminus pins, keeping "no overrides" in ONE
 * representation: an empty map DROPS the field rather than storing `{}`. Every
 * writer of the map goes through here — the two setters, the orphan prune, and
 * the file loader — so the invariant can't drift apart across them.
 */
export function withStationEndStyles(line: Line, pins: Record<StationId, LineEndStyle>): Line {
  if (Object.keys(pins).length > 0) return { ...line, stationEndStyles: pins };
  const { stationEndStyles: _gone, ...rest } = line;
  return rest as Line;
}

/**
 * Can this segment style paint a rounded end? The three dash-pattern styles are
 * drawn as ONE stroke with a dash array, so there is no shape to round — only
 * the styles painted as a filled shape (solid, and the two hatch patterns,
 * which fill a polygon) can carry an arc.
 */
export function endStyleCanRound(style: LineStyle): boolean {
  return style === 'solid' || style === 'hatched' || style === 'hatched-mirror';
}

/**
 * The end style actually painted, given the marker's resolved segment style:
 * `round` degrades to `short` wherever an arc can't be drawn. The STORED value
 * is never rewritten — cycling a segment back to solid brings the round end
 * straight back — so this must be the single resolution point both the painter
 * (StopMarker) and the region footprint (markerBodyRings) read, or the painted
 * end and its region cover disagree.
 */
export function resolveEndStyle(end: LineEndStyle, style: LineStyle): LineEndStyle {
  return end === 'round' && !endStyleCanRound(style) ? 'short' : end;
}
