import { expandGlyphTags, isPendingGlyphTag } from '../geometry/labelTokens';
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
 * half-typed `<air` on screen for a few keystrokes, and it gets two allowances:
 *
 *  - it is NOT upper-cased, because tag names are lowercase and `<AIR>` matches
 *    nothing — upper-casing the fragment would make the tag impossible to close;
 *  - it counts as the ONE character it is about to become, not as its own
 *    length. `<a_ne` is five characters that become `↗`.
 *
 * Both allowances are gated on `isPendingGlyphTag`, so they reach a shortcut on
 * its way to closing and nothing else: `<b`, `<q` and `<x1` are ordinary text
 * that upper-cases and counts in full. Gating on "is there a `<`" instead let
 * any mixed-case, over-long string through — and since `<` is not a legal bullet
 * `CODE`, committing one also silently skipped `updateLine`'s bullet rewrite.
 *
 * Counting a pending shortcut as one character also refuses a dead end while it
 * is being typed rather than at the closing `>`: with the cap already full,
 * `ABC<x` can never resolve to anything legal, so it never gets taken.
 *
 * An unknown tag (`<q>`) is ordinary text here exactly as it is in a label.
 */
export function serviceCodeDraft(raw: string): string | null {
  const expanded = expandGlyphTags(raw);
  const open = expanded.lastIndexOf('<');
  const pending = open >= 0 && isPendingGlyphTag(expanded.slice(open));
  const code = pending ? expanded.slice(0, open) : expanded;
  if ([...code].length + (pending ? 1 : 0) > SERVICE_CODE_MAX) return null;
  return pending ? code.toUpperCase() + expanded.slice(open) : code.toUpperCase();
}

/**
 * What a finished edit writes, or `null` to abandon it and leave the stored code
 * standing.
 *
 * The one thing a draft can hold that is not a code is a shortcut the user never
 * finished — `<a_ne` is five characters, over the cap, and not a legal bullet
 * `CODE`, so committing it would both break `SERVICE_CODE_MAX` and strand every
 * bullet wearing the old code. An unfinished shortcut is an unfinished edit:
 * nothing is written, rather than the fragment being trimmed to some prefix the
 * user never asked for. Everything else — including an empty field, which is the
 * deliberate clear — commits exactly as it reads.
 */
export function serviceCodeCommit(draft: string): string | null {
  const open = draft.lastIndexOf('<');
  return open >= 0 && isPendingGlyphTag(draft.slice(open)) ? null : draft;
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
