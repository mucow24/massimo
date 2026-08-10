import type { RouteBulletShape } from '../model/types';
import {
  BOLD_WEIGHT_STEPS,
  MIN_FONT_SIZE,
  parseSizeToken,
  parseWeightToken,
  stepWeight,
} from '../util/fonts';

/**
 * Resolved inline style of a text segment, produced by `parseFormattedLine`
 * from the HTML-like formatting tags (labels only). Absent (`undefined`) on
 * unstyled segments so bullet-only consumers keep their historical shapes.
 */
export interface SegmentStyle {
  /**
   * Rungs to step bold-ward on the shipped weight ladder, from the innermost
   * open bold-ward tag — `<b>` (3), `<sb>` (2), or `<m>` (1). Applied ON TOP of
   * the run's anchored weight (the label's base, or an enclosing `<w=…>`), so
   * `<w=Light><b>` is bold-ward of Light rather than of the base. Absent = no
   * bold-ward tag is open.
   */
  boldStep?: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Resolved CSS color (named or #hex); absent = inherit the label color. */
  color?: string;
  /**
   * Absolute weight from an open `<w=Name>` — a shipped CSS weight that
   * overrides the label's base weight for this run. Mutually exclusive with
   * `weightStep`; both absent = inherit the base weight.
   */
  weight?: number;
  /**
   * Relative weight from an open `<w=±N>`: a signed number of steps along the
   * shipped weight ladder, applied to the label's BASE weight (not compounding
   * with enclosing weight tags). Innermost `<w>` wins.
   */
  weightStep?: number;
  /**
   * Absolute font size (world units) from an open `<size=N>` — overrides the
   * label's base size for this run. Mutually exclusive with `sizeStep`; both
   * absent = inherit the base size.
   */
  size?: number;
  /**
   * Relative font size from an open `<size=±N>`: a signed delta added to the
   * label's BASE size (not compounding with enclosing size tags). Innermost
   * `<size>` wins.
   */
  sizeStep?: number;
}

/**
 * One entry in the `<w=…>` open-tag stack: an absolute shipped weight
 * (`<w=Name>`) or a signed ladder step (`<w=±N>`). Innermost (top) wins.
 */
type WeightFrame = { abs: number } | { rel: number };

/**
 * One entry in the `<size=…>` open-tag stack: an absolute font size
 * (`<size=N>`) or a signed delta (`<size=±N>`). Innermost (top) wins.
 */
type SizeFrame = { abs: number } | { rel: number };

export type LabelSegment =
  | { kind: 'text'; value: string; style?: SegmentStyle }
  | { kind: 'bullet'; code: string; shape: RouteBulletShape; filled: boolean };

/**
 * Open-tag state threaded between lines so a tag can span '\n' breaks and
 * column-mode word wraps: counts of open i/u/s tags plus the open bold-ward,
 * color, weight, and size stacks. `parseFormattedLine` takes the entry state
 * and returns the exit state; a fresh line of a fresh label starts from
 * `emptyStyleState()`.
 */
export interface InlineStyleState {
  /**
   * Open bold-ward tags as their ladder steps (`<b>` → 3, `<sb>` → 2, `<m>` →
   * 1); innermost (top) wins, exactly like `weights`/`sizes`. A stack rather
   * than a count per tag so nesting two DIFFERENT bold-ward tags resolves by
   * that same house rule instead of needing a precedence table — and so
   * `<b><b>` still doesn't compound.
   */
  boldward: number[];
  italic: number;
  underline: number;
  strike: number;
  colors: string[];
  weights: WeightFrame[];
  sizes: SizeFrame[];
}

export function emptyStyleState(): InlineStyleState {
  return {
    boldward: [],
    italic: 0,
    underline: 0,
    strike: 0,
    colors: [],
    weights: [],
    sizes: [],
  };
}

/**
 * Inline bullet circle diameter, as a fraction of the host fontSize. Picked
 * to be a little shorter than the line's font height so a bullet sits
 * comfortably between baselines rather than dominating the row.
 */
export const INLINE_BULLET_DIAMETER_RATIO = 0.9;

export function inlineBulletDiameter(fontSize: number): number {
  return fontSize * INLINE_BULLET_DIAMETER_RATIO;
}

/**
 * Bullet token grammar: the delimiter picks the shape — `|CODE|` circle,
 * `[CODE]` square, `{CODE}` diamond — and doubling it (`||CODE||`,
 * `[[CODE]]`, `{{CODE}}`) makes the bullet unfilled (line-color outline
 * instead of a filled shape). A code can't contain any delimiter character,
 * an angle bracket (reserved for formatting tags), or a newline — parens are
 * ordinary code characters. Unclosed or mismatched delimiters and empty
 * codes stay as literal text. A backslash immediately before a token renders
 * the token's literal text instead (backslash dropped); a backslash anywhere
 * else is just a backslash.
 */
const CODE = '[^|<>[\\]{}\\n]+';

const CODE_ONLY = new RegExp(`^${CODE}$`);

/**
 * Would `s` parse as a bullet CODE — the text between a token's delimiters?
 * The grammar above is the single owner of that answer, so callers that build
 * or match tokens gate on this rather than re-deriving the character class.
 *
 * The load-bearing case is the EMPTY string, which is not a code (`CODE` is
 * one-or-more): `updateLine`'s service-code rename builds its search patterns
 * as `|${service}|` etc., so an empty service degenerates them to the bare
 * delimiter pairs `||`, `[]`, `{}` — which match literal text, and match both
 * halves of an UNFILLED bullet belonging to another line.
 */
export function isBulletCode(s: string): boolean {
  return CODE_ONLY.test(s);
}

// Doubled (unfilled) alternatives listed before their single (filled) forms so
// they win at the same start position. Group names: shape initial + u/f.
const BULLET_ALTS =
  `\\|\\|(?<cu>${CODE})\\|\\||\\|(?<cf>${CODE})\\||` +
  `\\[\\[(?<su>${CODE})\\]\\]|\\[(?<sf>${CODE})\\]|` +
  `\\{\\{(?<du>${CODE})\\}\\}|\\{(?<df>${CODE})\\}`;

const BULLET_VARIANTS: Record<string, { shape: RouteBulletShape; filled: boolean }> = {
  cu: { shape: 'circle', filled: false },
  cf: { shape: 'circle', filled: true },
  su: { shape: 'square', filled: false },
  sf: { shape: 'square', filled: true },
  du: { shape: 'diamond', filled: false },
  df: { shape: 'diamond', filled: true },
};
const BULLET_GROUP_KEYS = Object.keys(BULLET_VARIANTS);

/**
 * Formatting tag grammar (labels only): the bold-ward trio `<b>`/`<sb>`/`<m>`,
 * `<i>`/`<u>`/`<s>`, all with `</...>` closers, plus `<color=VALUE>`/`</color>`,
 * `<w=VALUE>`/`</w>` (font weight), `<size=VALUE>`/`</size>` (font size), and the
 * self-closing glyph shortcuts `<air>` (✈), `<xfer>` (↔), `<c>` (©), and `<tm>`
 * (™). Tag names are lowercase; anything else (`<q>`, `<3`, `a < b`) stays
 * literal text. Color, weight, and size values can't contain spaces, angle
 * brackets, or newlines; an invalid weight/size value (see
 * `parseWeightToken`/`parseSizeToken`) keeps the tag as literal text.
 *
 * Nothing here can be confused with `<s>`/`</s>` (strike), because those require
 * the char after `s` to be `>` — which neither `size` nor `sb` has.
 */
const TAG_ALTS =
  `<(?<step>sb|b|m)>|<\\/(?<stepClose>sb|b|m)>|` +
  `<(?<open>[ius])>|<\\/(?<close>[ius])>|` +
  `<color=(?<color>[^<> \\n]+)>|(?<colorClose><\\/color>)|` +
  `<w=(?<weight>[^<> \\n]+)>|(?<weightClose><\\/w>)|` +
  `<size=(?<size>[^<> \\n]+)>|(?<sizeClose><\\/size>)|` +
  `(?<air><air>)|(?<xfer><xfer>)|(?<copy><c>)|(?<tm><tm>)`;

const BULLET_TOKEN_RE = new RegExp(`(?<esc>\\\\)?(?:${BULLET_ALTS})`, 'g');
const FORMATTED_TOKEN_RE = new RegExp(`(?<esc>\\\\)?(?:${BULLET_ALTS}|${TAG_ALTS})`, 'g');

// Söhne has no dingbats, so this one is drawn by the shipped Massimo Symbols
// fallback — a single glyph cut to Söhne's cap height (see its NOTICE in
// /public/fonts). Screen, PDF (glyph tracer) and PNG all read that same face.
const AIR_GLYPH = '✈';
// U+2194 rather than 🡘 (U+1F858): Söhne covers U+2194 itself, and the shipped
// fallbacks cover it too, so screen, PDF (glyph tracer), and PNG all draw the
// same arrow whatever face a run resolves to.
const XFER_GLYPH = '↔';
// ©/™ (U+00A9 / U+2122) are covered by the map's own text face, so they trace
// from whatever face the run around them is set in and never reach a fallback
// at all. Both fallbacks carry them anyway, for a text face that lacks them.
const COPY_GLYPH = '©';
const TM_GLYPH = '™';

const TAG_FLAG: Record<string, 'italic' | 'underline' | 'strike'> = {
  i: 'italic',
  u: 'underline',
  s: 'strike',
};

/**
 * The bold-ward tags and the rungs each one steps. Each is named for the rung
 * it reaches FROM ROMAN — `<b>` Bold, `<sb>` SemiBold, `<m>` Medium — but all
 * three are RELATIVE, riding the run's anchored weight rather than pinning a
 * number, so they read the same way on a Light label as on a Roman one.
 * `<w=SemiBold>` and friends are the absolute forms. `<b>` shares its count
 * with the station-label hover bump and the legacy `labelBold` migration, so it
 * reads `BOLD_WEIGHT_STEPS`; 2 and 1 are this grammar's alone. Adding another
 * tag is a line here plus its name in `TAG_ALTS` — the stack, the
 * innermost-wins rule, and the resolver are already generic over the count.
 */
export const BOLDWARD_TAG_STEPS: Record<string, number> = {
  b: BOLD_WEIGHT_STEPS,
  sb: 2,
  m: 1,
};

/** Accept CSS named colors, `#hex` (3/6 digits), and `0xhex` (normalized to
 *  `#`). Anything else returns null and the tag stays literal text so the
 *  typo is visible on the canvas. Named colors are passed through to SVG
 *  unvalidated (an unknown name paints like plain text in the browser). */
function normalizeColor(value: string): string | null {
  const hex0x = /^0x([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (hex0x) return `#${hex0x[1]}`;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return value;
  if (/^[a-zA-Z]+$/.test(value)) return value;
  return null;
}

function styleOf(st: InlineStyleState): SegmentStyle | undefined {
  const color = st.colors.length > 0 ? st.colors[st.colors.length - 1] : undefined;
  // Innermost open <w>/<size> wins; relative steps/deltas do NOT compound with
  // enclosing ones.
  const wTop = st.weights.length > 0 ? st.weights[st.weights.length - 1] : undefined;
  const sTop = st.sizes.length > 0 ? st.sizes[st.sizes.length - 1] : undefined;
  // Innermost open bold-ward tag wins too — `<b>a<sb>b</sb>c</b>` steps b by 2
  // and a/c by 3, and the two never sum.
  const bwTop = st.boldward.length > 0 ? st.boldward[st.boldward.length - 1] : undefined;
  if (
    bwTop === undefined &&
    !st.italic &&
    !st.underline &&
    !st.strike &&
    color === undefined &&
    wTop === undefined &&
    sTop === undefined
  ) {
    return undefined;
  }
  const style: SegmentStyle = {
    italic: st.italic > 0,
    underline: st.underline > 0,
    strike: st.strike > 0,
  };
  if (bwTop !== undefined) style.boldStep = bwTop;
  if (color !== undefined) style.color = color;
  if (wTop !== undefined) {
    if ('abs' in wTop) style.weight = wTop.abs;
    else style.weightStep = wTop.rel;
  }
  if (sTop !== undefined) {
    if ('abs' in sTop) style.size = sTop.abs;
    else style.sizeStep = sTop.rel;
  }
  return style;
}

/**
 * Shared scanner for both grammars. Literal text (including escaped tokens,
 * unknown tags, and the glyph shortcuts) accumulates in a buffer that's
 * flushed as ONE segment whenever the style changes (a `<b>`/`<sb>`/`<m>`/
 * `<color=…>`/`<w=…>`/`<size=…>` boundary) or a bullet lands — so
 * `go \(west) now` measures and kerns as a single run, not three. `state` is
 * null in bullets-only mode (the regex then contains no tag groups).
 */
function scanLine(
  line: string,
  re: RegExp,
  state: InlineStyleState | null,
  // Drop the `<xfer>` glyph instead of emitting its arrow. Used by the compact
  // list renderer (`stationNameListText`); the canvas renderers keep it.
  suppressXfer = false,
): { segments: LabelSegment[]; state: InlineStyleState | null } {
  const st = state
    ? // never mutate the caller's state — every stack needs its own copy
      {
        ...state,
        boldward: [...state.boldward],
        colors: [...state.colors],
        weights: [...state.weights],
        sizes: [...state.sizes],
      }
    : null;
  const segments: LabelSegment[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer.length === 0) return;
    const style = st ? styleOf(st) : undefined;
    segments.push(style ? { kind: 'text', value: buffer, style } : { kind: 'text', value: buffer });
    buffer = '';
  };

  let lastIndex = 0;
  re.lastIndex = 0;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    const g = m.groups!;
    if (m.index > lastIndex) buffer += line.slice(lastIndex, m.index);
    lastIndex = m.index + m[0].length;
    if (g.esc) {
      // Escaped token: literal text, backslash dropped.
      buffer += m[0].slice(1);
      continue;
    }
    const bulletKey = BULLET_GROUP_KEYS.find((k) => g[k] !== undefined);
    if (bulletKey) {
      flush();
      const { shape, filled } = BULLET_VARIANTS[bulletKey];
      segments.push({ kind: 'bullet', code: g[bulletKey]!, shape, filled });
      continue;
    }
    // Tag groups only exist in the formatted grammar, where st is non-null.
    if (g.step) {
      flush();
      st!.boldward.push(BOLDWARD_TAG_STEPS[g.step]);
    } else if (g.stepClose) {
      // A closer with no matching opener is consumed as a no-op. Any bold-ward
      // closer pops any bold-ward opener — one stack, so `<b>x</sb>` closes the
      // `<b>`, matching how `</w>` pops whichever `<w>` is on top.
      if (st!.boldward.length > 0) {
        flush();
        st!.boldward.pop();
      }
    } else if (g.open) {
      flush();
      st![TAG_FLAG[g.open]]++;
    } else if (g.close) {
      // A closer with no matching opener is consumed as a no-op.
      const flag = TAG_FLAG[g.close];
      if (st![flag] > 0) {
        flush();
        st![flag]--;
      }
    } else if (g.color !== undefined) {
      const color = normalizeColor(g.color);
      if (color === null) {
        buffer += m[0]; // invalid value: keep the tag visible as literal text
      } else {
        flush();
        st!.colors.push(color);
      }
    } else if (g.colorClose) {
      if (st!.colors.length > 0) {
        flush();
        st!.colors.pop();
      }
    } else if (g.weight !== undefined) {
      const parsed = parseWeightToken(g.weight);
      if (parsed === null) {
        buffer += m[0]; // invalid value: keep the tag visible as literal text
      } else {
        flush();
        st!.weights.push(parsed);
      }
    } else if (g.weightClose) {
      if (st!.weights.length > 0) {
        flush();
        st!.weights.pop();
      }
    } else if (g.size !== undefined) {
      const parsed = parseSizeToken(g.size);
      if (parsed === null) {
        buffer += m[0]; // invalid value: keep the tag visible as literal text
      } else {
        flush();
        st!.sizes.push(parsed);
      }
    } else if (g.sizeClose) {
      if (st!.sizes.length > 0) {
        flush();
        st!.sizes.pop();
      }
    } else if (g.air) {
      buffer += AIR_GLYPH;
    } else if (g.xfer) {
      if (!suppressXfer) buffer += XFER_GLYPH;
    } else if (g.copy) {
      buffer += COPY_GLYPH;
    } else if (g.tm) {
      buffer += TM_GLYPH;
    }
  }
  if (lastIndex < line.length) buffer += line.slice(lastIndex);
  flush();
  return { segments, state: st };
}

/**
 * Parse a single label line into segments of literal text or bullet tokens.
 * Bullets + escapes only — formatting tags stay literal text. This is the
 * station-name grammar (canvas station labels, sidebar lists); text labels
 * go through `parseFormattedLine`.
 */
export function parseLabelLine(line: string): LabelSegment[] {
  if (line.length === 0) return [];
  return scanLine(line, BULLET_TOKEN_RE, null).segments;
}

/**
 * Parse one rendered line of a text label: bullets + escapes + formatting
 * tags. `state` carries the open tags from previous lines (tags span '\n'
 * and column-mode wraps until closed); the returned state feeds the next
 * line. The input state is never mutated.
 */
export function parseFormattedLine(
  line: string,
  state: InlineStyleState,
): { segments: LabelSegment[]; state: InlineStyleState } {
  const r = scanLine(line, FORMATTED_TOKEN_RE, state);
  return { segments: r.segments, state: r.state! };
}

/**
 * Render a station name as compact one-line plain text for list contexts
 * (the sidebar station list and the line editor's per-line station list):
 *  - formatting tags (`<b>`/`<sb>`/`<m>`/`<i>`/`<u>`/`<s>`/`<color>`/`<w>`/
 *    `<size>`) are stripped, keeping only their inner text;
 *  - inline route bullets (`|A|`, `[A]`, `{A}`, doubled forms) are removed
 *    entirely — the list shows the routes in its own column, so a bullet in
 *    the name is just noise;
 *  - the glyph shortcuts resolve to their characters (`<tm>`→™, `<air>`→✈,
 *    `<c>`→©) EXCEPT `<xfer>`, which is omitted (list rows don't show the
 *    transfer arrow).
 * Newlines collapse to spaces and whitespace left behind by removed tokens is
 * squeezed, so `"Foo |A|  Bar"` reads `"Foo Bar"`.
 */
export function stationNameListText(text: string): string {
  // Full-grammar scan (per line, xfer suppressed) so tags/glyphs/bullets
  // tokenize exactly as they do on the canvas. We then keep only text segments
  // — which discards bullets and, since we read `value` and ignore each run's
  // resolved style, strips the formatting tags too. Glyph shortcuts have
  // already been folded into the text (`<xfer>` alone is dropped in the scan).
  const { segments } = scanLine(
    text.replace(/\n/g, ' '),
    FORMATTED_TOKEN_RE,
    emptyStyleState(),
    true,
  );
  let out = '';
  for (const seg of segments) if (seg.kind === 'text') out += seg.value;
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Resolve the rendered font weight of a styled run against the label's base
 * weight. `<w=Name>` sets an absolute weight; `<w=±N>` steps the base along the
 * shipped ladder; a bold-ward tag — `<b>` (3 rungs), `<sb>` (2), `<m>` (1) —
 * then steps on top of either, clamped at Black. Shared by the renderer
 * (`LabelView`), the station-label renderer (`stationLabelText`), and the
 * measurer (`textMeasure`) so the box always matches the glyphs. No style → the
 * base weight unchanged.
 */
export function resolveRunWeight(baseWeight: number, style?: SegmentStyle): number {
  if (!style) return baseWeight;
  const anchored =
    style.weight ??
    (style.weightStep !== undefined ? stepWeight(baseWeight, style.weightStep) : baseWeight);
  return style.boldStep !== undefined ? stepWeight(anchored, style.boldStep) : anchored;
}

/**
 * Resolve the rendered font size of a styled run against the label's base size.
 * `<size=N>` sets an absolute size; `<size=±N>` adds a signed delta to the base;
 * the result is floored at MIN_FONT_SIZE so a run can never collapse to zero.
 * Shared by the renderers (`LabelView`, `stationLabelText`) and the measurer
 * (`textMeasure`) so every layer sizes the run identically. No style (or a style
 * with no size tag) → the base size unchanged.
 */
export function resolveRunFontSize(baseSize: number, style?: SegmentStyle): number {
  if (!style) return baseSize;
  const raw = style.size ?? (style.sizeStep !== undefined ? baseSize + style.sizeStep : baseSize);
  return Math.max(MIN_FONT_SIZE, raw);
}

/**
 * Quick test: does this (possibly multi-line) text contain any inline token —
 * a bullet, an escape sequence, or a formatting tag / glyph shortcut? Renderers
 * use it to pick the plain fast path over segment-aware layout: anything the
 * segment scanner would rewrite (a bullet circle, a dropped backslash, a
 * `<b>`/`<sb>`/`<m>`/`<color=…>`/`<w=…>`/`<size=…>` style change, an
 * `<air>`/`<xfer>`/`<c>`/`<tm>` glyph) forces the per-segment path. Unknown
 * tags (`<q>`, `<A>`) and stray brackets stay literal and don't trip it,
 * matching what `parseFormattedLine` actually rewrites.
 */
export function hasFormattedToken(text: string): boolean {
  FORMATTED_TOKEN_RE.lastIndex = 0;
  return FORMATTED_TOKEN_RE.test(text);
}

// ---------- Legacy-syntax migration ----------

// The pre-formatting-tags grammar: `<CODE>` was the circle bullet and codes
// could contain pipes and parens (only <>[]{}\n were excluded).
const LEGACY_CODE = '[^<>[\\]{}\\n]+';
const LEGACY_MIGRATE_RE = new RegExp(
  // Legacy angle tokens (doubled before single), plus any text that would
  // NEWLY parse as a pipe bullet and so needs escaping.
  `<<(?<au>${LEGACY_CODE})>>|<(?<af>${LEGACY_CODE})>|(?<lit>\\|\\|${CODE}\\|\\||\\|${CODE}\\|)`,
  'g',
);

/**
 * One-time rewrite of a station name / label text saved under the legacy
 * bullet syntax:
 *  - `<X>` / `<<X>>` circle bullets become `|X|` / `||X||`;
 *  - literal text that would NOW parse as a pipe bullet — `|x|`, `||x||`,
 *    even a pre-existing `\|a|` — gets a backslash escape so its rendering
 *    is unchanged.
 * Runs once per doc, gated by the persist version (v8) / file version (2) —
 * it must NOT re-run on migrated text, where `<b>` is a formatting tag and
 * `|X|` a real bullet. A legacy angle token whose code contains a pipe can't
 * be expressed in the new grammar and is left as literal text.
 */
export function migrateLegacyInlineTokens(text: string): string {
  return text.replace(LEGACY_MIGRATE_RE, (...args) => {
    const g = args[args.length - 1] as Record<string, string | undefined>;
    if (g.au !== undefined) return g.au.includes('|') ? args[0] : `||${g.au}||`;
    if (g.af !== undefined) return g.af.includes('|') ? args[0] : `|${g.af}|`;
    return `\\${g.lit}`;
  });
}
