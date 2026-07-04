import type { RouteBulletShape } from '../model/types';
import { bolderWeight, parseWeightToken, stepWeight } from '../export/fonts';

/**
 * Resolved inline style of a text segment, produced by `parseFormattedLine`
 * from the HTML-like formatting tags (labels only). Absent (`undefined`) on
 * unstyled segments so bullet-only consumers keep their historical shapes.
 */
export interface SegmentStyle {
  /** Render two steps up the shipped weight ladder (see fonts.bolderWeight). */
  bold: boolean;
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
}

/**
 * One entry in the `<w=…>` open-tag stack: an absolute shipped weight
 * (`<w=Name>`) or a signed ladder step (`<w=±N>`). Innermost (top) wins.
 */
type WeightFrame = { abs: number } | { rel: number };

export type LabelSegment =
  | { kind: 'text'; value: string; style?: SegmentStyle }
  | { kind: 'bullet'; code: string; shape: RouteBulletShape; filled: boolean };

/**
 * Open-tag state threaded between lines so a tag can span '\n' breaks and
 * column-mode word wraps: counts of open b/i/u/s tags plus the open color
 * stack. `parseFormattedLine` takes the entry state and returns the exit
 * state; a fresh line of a fresh label starts from `emptyStyleState()`.
 */
export interface InlineStyleState {
  bold: number;
  italic: number;
  underline: number;
  strike: number;
  colors: string[];
  weights: WeightFrame[];
}

export function emptyStyleState(): InlineStyleState {
  return { bold: 0, italic: 0, underline: 0, strike: 0, colors: [], weights: [] };
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
 * Formatting tag grammar (labels only): `<b>`/`<i>`/`<u>`/`<s>` with `</...>`
 * closers, `<color=VALUE>`/`</color>`, `<w=VALUE>`/`</w>` (font weight), and
 * the self-closing glyph shortcuts `<air>` (✈) and `<xfer>` (↔). Tag names are
 * lowercase; anything else (`<q>`, `<3`, `a < b`) stays literal text. Color and
 * weight values can't contain spaces, angle brackets, or newlines; an invalid
 * weight value (see `parseWeightToken`) keeps the tag as literal text.
 */
const TAG_ALTS =
  `<(?<open>[bius])>|<\\/(?<close>[bius])>|` +
  `<color=(?<color>[^<> \\n]+)>|(?<colorClose><\\/color>)|` +
  `<w=(?<weight>[^<> \\n]+)>|(?<weightClose><\\/w>)|(?<air><air>)|(?<xfer><xfer>)`;

const BULLET_TOKEN_RE = new RegExp(`(?<esc>\\\\)?(?:${BULLET_ALTS})`, 'g');
const FORMATTED_TOKEN_RE = new RegExp(`(?<esc>\\\\)?(?:${BULLET_ALTS}|${TAG_ALTS})`, 'g');

const AIR_GLYPH = '✈';
// U+2194 rather than 🡘 (U+1F858): the shipped DejaVu Sans fallback covers
// U+2194, so screen, PDF (glyph tracer), and PNG all draw the same arrow.
const XFER_GLYPH = '↔';

const TAG_FLAG: Record<string, 'bold' | 'italic' | 'underline' | 'strike'> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  s: 'strike',
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
  // Innermost open <w> wins; relative steps do NOT compound with enclosing ones.
  const wTop = st.weights.length > 0 ? st.weights[st.weights.length - 1] : undefined;
  if (
    !st.bold &&
    !st.italic &&
    !st.underline &&
    !st.strike &&
    color === undefined &&
    wTop === undefined
  ) {
    return undefined;
  }
  const style: SegmentStyle = {
    bold: st.bold > 0,
    italic: st.italic > 0,
    underline: st.underline > 0,
    strike: st.strike > 0,
  };
  if (color !== undefined) style.color = color;
  if (wTop !== undefined) {
    if ('abs' in wTop) style.weight = wTop.abs;
    else style.weightStep = wTop.rel;
  }
  return style;
}

/**
 * Shared scanner for both grammars. Literal text (including escaped tokens,
 * unknown tags, and the air/xfer glyphs) accumulates in a buffer that's
 * flushed as ONE segment whenever the style changes or a bullet lands — so
 * `go \(west) now` measures and kerns as a single run, not three. `state` is
 * null in bullets-only mode (the regex then contains no tag groups).
 */
function scanLine(
  line: string,
  re: RegExp,
  state: InlineStyleState | null,
): { segments: LabelSegment[]; state: InlineStyleState | null } {
  const st = state
    ? { ...state, colors: [...state.colors], weights: [...state.weights] } // never mutate the caller's state
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
    if (g.open) {
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
    } else if (g.air) {
      buffer += AIR_GLYPH;
    } else if (g.xfer) {
      buffer += XFER_GLYPH;
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
 * Resolve the rendered font weight of a styled run against the label's base
 * weight. `<w=Name>` sets an absolute weight; `<w=±N>` steps the base along the
 * shipped ladder; `<b>` adds two steps on top of either. Shared by the renderer
 * (`LabelView`), the station-label renderer (`stationLabelText`), and the
 * measurer (`textMeasure`) so the box always matches the glyphs. No style → the
 * base weight unchanged.
 */
export function resolveRunWeight(baseWeight: number, style?: SegmentStyle): number {
  if (!style) return baseWeight;
  const anchored =
    style.weight ??
    (style.weightStep !== undefined ? stepWeight(baseWeight, style.weightStep) : baseWeight);
  return style.bold ? bolderWeight(anchored) : anchored;
}

/**
 * Quick test: does this (possibly multi-line) text contain any inline token —
 * a bullet, an escape sequence, or a formatting tag / glyph shortcut? Renderers
 * use it to pick the plain fast path over segment-aware layout: anything the
 * segment scanner would rewrite (a bullet circle, a dropped backslash, a
 * `<b>`/`<color=…>`/`<w=…>` style change, an `<air>`/`<xfer>` glyph) forces the
 * per-segment path. Unknown tags (`<q>`, `<A>`) and stray brackets stay literal
 * and don't trip it, matching what `parseFormattedLine` actually rewrites.
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
