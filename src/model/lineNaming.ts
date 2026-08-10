import { expandGlyphTags } from '../geometry/labelTokens';
import type { Line, LineId } from './types';

// Most characters a service code may hold. Counted on the code ITSELF, so a
// shortcut costs whatever its glyph costs — `<air>` is one character, not five.
export const SERVICE_CODE_MAX = 3;

/**
 * The Service code field's live text after one keystroke, or `null` to refuse
 * the keystroke outright (the field then simply doesn't take the character, the
 * way its old `maxLength` did). What this returns is what the field shows AND
 * what it later commits — there is no second normalization at the commit, so a
 * code is always exactly what the box read.
 *
 * A glyph shortcut collapses the instant it closes, rather than at the commit,
 * so the code previews as the glyph it will actually print. That leaves a
 * half-typed `<air` on screen for a few keystrokes, and both rules below have to
 * step around it:
 *
 *  - it is NOT upper-cased, because tag names are lowercase and `<AIR>` matches
 *    nothing — upper-casing the fragment would make the tag impossible to close;
 *  - it is NOT counted against the cap, because it is on its way to ONE
 *    character. `<a_ne` is five characters that become `↗`.
 *
 * Everything else upper-cases and counts as it always did. An unknown tag
 * (`<q>`) is ordinary text here exactly as it is in a label.
 */
export function serviceCodeDraft(raw: string): string | null {
  const expanded = expandGlyphTags(raw);
  // A `<` with no `>` after it is a shortcut still being typed; everything from
  // there on is the pending fragment.
  const open = expanded.lastIndexOf('<');
  const cut = open > expanded.lastIndexOf('>') ? open : expanded.length;
  const code = expanded.slice(0, cut);
  if ([...code].length > SERVICE_CODE_MAX) return null;
  return code.toUpperCase() + expanded.slice(cut);
}

// Auto-name sequence for new lines: A, B, …, Z, 0, 1, …, 9, AA, AB, …, AZ,
// A0, …, A9, BA, … — a base-36 odometer over `ALPHABET`. Single characters
// come first (indices 0–35), then two-character names (36 onward).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Number of indices that map to a real name (used as an exclusive bound; the
// largest valid index is NAME_SPACE - 1). Two-char names require the first
// character to be a LETTER (first < 26), so they run AA…Z9 — i.e.
// 26 × 36 of them — on top of the 36 single-char names.
const NAME_SPACE = 26 * 36 + 36; // 972

// Map a sequence index to its auto-name; '?' once the space is exhausted
// (would need a third character — unreachable in practice for one map).
export const nameForIndex = (n: number): string => {
  const len = ALPHABET.length; // 36
  if (n < len) return ALPHABET[n];
  const m = n - len;
  const first = Math.floor(m / len);
  const second = m % len;
  if (first < 26) return ALPHABET[first] + ALPHABET[second];
  return '?'; // overflow; unlikely for v1
};

/**
 * How a line is named TO THE USER, wherever one is identified in prose: its
 * own `name`, falling back to `"<service> line"` for an unnamed line, and to
 * `'Unknown line'` when the line is gone (a stop can outlive the line it
 * belonged to mid-edit). One helper because these strings sit side by side —
 * the sidebar's line row, the inspector's stop badge, the layout editor's stop
 * tooltip — and a user hovering the same stop on two surfaces must not be told
 * two different names.
 */
export const lineDisplayName = (line: Pick<Line, 'name' | 'service'> | null | undefined): string =>
  line ? line.name || `${line.service} line` : 'Unknown line';

// First auto-name not already used by an existing line's `service` code.
export const pickNextLineName = (lines: Record<LineId, Line>): string => {
  const taken = new Set(Object.values(lines).map((l) => l.service));
  for (let i = 0; i < NAME_SPACE; i++) {
    const candidate = nameForIndex(i);
    if (!taken.has(candidate)) return candidate;
  }
  return '?';
};
