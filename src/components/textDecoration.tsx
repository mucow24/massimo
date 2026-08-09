import type { SegmentStyle } from '../geometry/labelTokens';

/**
 * The inline `<u>`/`<s>` rule: where it sits and how heavy it is.
 *
 * Both label renderers paint these as explicit `<line>` geometry rather than
 * the SVG `text-decoration` attribute — Chromium mishandles toggling that
 * attribute on a rotated `<text>`, and svg2pdf ignores it outright — so both
 * need the same three numbers, and a `<u>` must read the same whether it is
 * typed into a station name (`renderStationLabelText`) or a free text label
 * (`LabelView`). They live here so the two renderers cannot drift apart; the
 * `data-text-decoration` tag both emit is what tells these rules apart from a
 * station's hover underline, which is a different rule at a different offset.
 *
 * Every offset hangs off the RUN's shared alphabetic baseline and scales with
 * the RUN's font size, so a bigger `<size>` run gets a proportionally placed,
 * proportionally heavier rule.
 */
const UNDERLINE_DROP_RATIO = 0.1;
const STRIKE_RISE_RATIO = 0.28;
const THICKNESS_RATIO = 0.07;

export type TextDecorationKind = 'underline' | 'strike';

/** The rule's y, given the run's baseline and size. */
export function decorationY(kind: TextDecorationKind, baselineY: number, fontSize: number): number {
  return kind === 'underline'
    ? baselineY + fontSize * UNDERLINE_DROP_RATIO
    : baselineY - fontSize * STRIKE_RISE_RATIO;
}

/** The rule's stroke weight, given the run's size. */
export function decorationThickness(fontSize: number): number {
  return fontSize * THICKNESS_RATIO;
}

export interface DecorationSpan {
  kind: TextDecorationKind;
  /** Left edge and width of the run the rule spans, in the renderer's frame. */
  x: number;
  width: number;
  baselineY: number;
  fontSize: number;
  /** The run's own ink color — a `<color=…>` run underlines in its own color. */
  stroke: string;
  key: string;
}

export function decorationLine({
  kind,
  x,
  width,
  baselineY,
  fontSize,
  stroke,
  key,
}: DecorationSpan) {
  const y = decorationY(kind, baselineY, fontSize);
  return (
    <line
      key={`${key}-${kind}`}
      data-text-decoration={kind}
      x1={x}
      x2={x + width}
      y1={y}
      y2={y}
      stroke={stroke}
      strokeWidth={decorationThickness(fontSize)}
    />
  );
}

/**
 * Both rules a styled run asks for, in paint order. An unstyled run, a run
 * asking for neither, and a zero-width run all draw nothing.
 */
export function decorationNodes(
  span: Omit<DecorationSpan, 'kind'>,
  style: SegmentStyle | undefined,
): React.ReactNode[] {
  if (!style || (!style.underline && !style.strike) || span.width <= 0) return [];
  const out: React.ReactNode[] = [];
  if (style.underline) out.push(decorationLine({ ...span, kind: 'underline' }));
  if (style.strike) out.push(decorationLine({ ...span, kind: 'strike' }));
  return out;
}
