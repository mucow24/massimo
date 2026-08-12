import { ReloadIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import {
  STYLE_COLLECTION_OF,
  captureStyleProps,
  styleFieldsDiff,
  type ItemStyleKind,
} from '../model/styles';
import { LABEL_WEIGHT_NAMES } from '../util/fonts';
import type { MapDoc, StyleDef } from '../model/types';

// Human field names for the tooltip, where the raw key doesn't read well.
// Fields not listed pass through verbatim (width, leading, tracking, weight,
// italic, align, shape, size, thickness, draw, closed, fill, stroke, color).
const FIELD_LABELS: Record<string, string> = {
  darkColor: 'dark color',
  fontSize: 'size',
  strokeWidth: 'stroke width',
  strokeColor: 'stroke color',
  curveRadius: 'curve radius',
  dashLength: 'dash length',
  dashWidth: 'dash width',
  interlineGap: 'interline gap',
  labelGap: 'label gap',
  singletonDotStyleId: 'singleton dot',
  multiDotStyleId: 'interchange dot',
  singletonDotSize: 'singleton dot size',
  multiDotSize: 'interchange dot size',
  darkFill: 'dark fill',
  darkStroke: 'dark stroke',
};

// Units for the numeric fields that carry one. Leading (a multiplier) and
// weight (a ladder rung) stay bare.
const FIELD_UNITS: Record<string, string> = {
  width: 'px',
  fontSize: 'px',
  size: 'px',
  strokeWidth: 'px',
  thickness: 'px',
  singletonDotSize: 'px',
  multiDotSize: 'px',
  curveRadius: 'px',
  dashLength: 'px',
  dashWidth: 'px',
  interlineGap: 'px',
  labelGap: 'px',
  tracking: 'em',
};

// The style's value for one field, formatted for the tooltip. `styles` is the
// doc's def map, for resolving a dot-TYPE id to its library name.
function formatStyleValue(field: string, value: unknown, styles: Record<string, StyleDef>): string {
  if (field === 'weight') {
    return LABEL_WEIGHT_NAMES.find((w) => w.value === value)?.name ?? String(value);
  }
  if (field === 'singletonDotStyleId' || field === 'multiDotStyleId') {
    return styles[value as string]?.name ?? String(value);
  }
  if (field === 'strokeColor' && value === 'line') return 'line color';
  if (field === 'width' && value === 0) return 'auto';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (value !== null && typeof value === 'object' && 'day' in (value as object)) {
    const { day, night } = value as { day: string; night: string };
    return day === night ? day : `${day} / ${night}`;
  }
  if (typeof value === 'number') return `${value}${FIELD_UNITS[field] ?? ''}`;
  // Absent optionals read as their defaults everywhere else; in a tooltip the
  // honest word is what the item would do without a stored value.
  if (value === undefined) return 'auto';
  return String(value);
}

// A caller that supplies `overridden` has already diffed; the hook still runs
// (rules of hooks) but bails before the capture.
const NO_FIELDS: readonly string[] = [];

/**
 * The overridden subset of `fields`, joined so the subscription's result
 * compares stably ('' = nothing diverges). Exported because the StyleRow needs
 * the very same answer for its "(edited)" trigger and its Sync button, and one
 * capture+diff per row is enough — it hands the result back down as
 * `overridden`.
 */
export function useOverriddenFields(
  kind: ItemStyleKind,
  itemId: string,
  fields: readonly string[],
): string {
  return useDoc((s) => {
    if (fields.length === 0) return '';
    const coll = s[STYLE_COLLECTION_OF[kind]] as Record<string, { styleId?: string }>;
    const styleId = coll[itemId]?.styleId;
    const def = styleId !== undefined ? s.styles[styleId] : undefined;
    if (!def || def.kind !== kind) return '';
    const props = captureStyleProps(s as unknown as MapDoc, kind, itemId);
    if (!props) return '';
    const diff = styleFieldsDiff(kind, props, def.props);
    return fields.filter((f) => diff.includes(f)).join(',');
  });
}

// Exactly one of the two sources, never neither: a dot handed no fields and no
// diff would silently never show.
type DotProps = {
  kind: ItemStyleKind;
  itemId: string;
  name: string;
  disabled?: boolean;
} & ({ fields: readonly string[]; overridden?: never } | { overridden: string; fields?: never });

/**
 * The red per-field override marker: rendered inside an editor row whose
 * covered field(s) diverge from the item's style, absolutely positioned in
 * the row's reserved left gutter (see the `.style-fields` CSS — every row in
 * a style-capable editor carries the gutter, so labels stay aligned whether
 * or not a dot is present). It is badge-sized and carries a revert glyph, so
 * the marker reads as the button it is rather than as decoration. Its tooltip
 * names the style's own value for each diverging field; clicking it reverts
 * exactly this row's fields to those values, in one undo entry. Renders
 * nothing when the item is untagged or the row matches its style — there is
 * no stored override state; the dot IS the diff, made visible.
 *
 * `fields` lists the covered field names this row edits (usually one; color
 * rows carry the day/night pair, the align row carries align + italic).
 * `name` is the row's human label, for the button's accessible name. The
 * StyleRow is the one caller that passes `overridden` instead: it stands for
 * the kind's WHOLE covered set (so its dot is the wholesale revert) and has
 * already run that diff for its own trigger text.
 */
export function OverrideDot({ kind, itemId, fields, overridden: given, name, disabled }: DotProps) {
  const revertStyleFields = useDoc((s) => s.revertStyleFields);
  const computed = useOverriddenFields(
    kind,
    itemId,
    given === undefined ? (fields ?? NO_FIELDS) : NO_FIELDS,
  );
  const overridden = given ?? computed;
  // One tooltip line per diverging field, naming the style's value — string
  // result, so the subscription stays comparison-stable.
  const title = useDoc((s) => {
    if (!overridden) return '';
    const coll = s[STYLE_COLLECTION_OF[kind]] as Record<string, { styleId?: string }>;
    const styleId = coll[itemId]?.styleId;
    const def = styleId !== undefined ? s.styles[styleId] : undefined;
    if (!def || def.kind !== kind) return '';
    const lines = overridden
      .split(',')
      .map(
        (f) =>
          `Overrides style ${FIELD_LABELS[f] ?? f} ` +
          `(${formatStyleValue(f, (def.props as unknown as Record<string, unknown>)[f], s.styles)})`,
      );
    return lines.length === 1
      ? `${lines[0]} — click to revert`
      : `${lines.join('\n')}\nClick to revert`;
  });
  if (!overridden) return null;
  return (
    <button
      type="button"
      className="override-dot"
      aria-label={`Revert ${name} to style`}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        // Never let the click double as a label/row activation (a dot can sit
        // next to a checkbox row's label).
        e.preventDefault();
        e.stopPropagation();
        revertStyleFields(kind, itemId, overridden.split(','));
      }}
    >
      <ReloadIcon aria-hidden="true" />
    </button>
  );
}
