import { useDoc } from '../state/store';
import {
  STYLE_COLLECTION_OF,
  captureStyleProps,
  styleFieldsDiff,
  type ItemStyleKind,
} from '../model/styles';
import type { MapDoc } from '../model/types';

/**
 * The red per-field override marker: rendered inside an editor row whose
 * covered field(s) diverge from the item's style, absolutely positioned in
 * the row's reserved left gutter (see the `.style-fields` CSS — every row in
 * a style-capable editor carries the gutter, so labels stay aligned whether
 * or not a dot is present). Clicking it reverts exactly this row's fields to
 * the style's values, in one undo entry. Renders nothing when the item is
 * untagged or the row matches its style — there is no stored override state;
 * the dot IS the diff, made visible.
 *
 * `fields` lists the covered field names this row edits (usually one; color
 * rows carry the day/night pair, the align row carries align + italic).
 * `name` is the row's human label, for the button's accessible name.
 */
export function OverrideDot({
  kind,
  itemId,
  fields,
  name,
  disabled,
}: {
  kind: ItemStyleKind;
  itemId: string;
  fields: readonly string[];
  name: string;
  disabled?: boolean;
}) {
  const revertStyleFields = useDoc((s) => s.revertStyleFields);
  // The overridden subset of this row's fields, joined so the selector's
  // result compares stably ('' = no dot).
  const overridden = useDoc((s) => {
    const coll = s[STYLE_COLLECTION_OF[kind]] as Record<string, { styleId?: string }>;
    const styleId = coll[itemId]?.styleId;
    const def = styleId !== undefined ? s.styles[styleId] : undefined;
    if (!def || def.kind !== kind) return '';
    const props = captureStyleProps(s as unknown as MapDoc, kind, itemId);
    if (!props) return '';
    const diff = styleFieldsDiff(kind, props, def.props);
    return fields.filter((f) => diff.includes(f)).join(',');
  });
  if (!overridden) return null;
  return (
    <button
      type="button"
      className="override-dot"
      aria-label={`Revert ${name} to style`}
      title={`${name} overrides the style — click to revert`}
      disabled={disabled}
      onClick={(e) => {
        // Never let the click double as a label/row activation (a dot can sit
        // next to a checkbox row's label).
        e.preventDefault();
        e.stopPropagation();
        revertStyleFields(kind, itemId, overridden.split(','));
      }}
    />
  );
}
