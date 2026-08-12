import { ChevronDownIcon, LoopIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { FieldSelectContent } from './FieldSelectContent';
import { OverrideDot, useOverriddenFields } from './OverrideDot';
import { useInlineRename } from './useInlineRename';
import { useDoc } from '../state/store';
import { STYLE_FIELDS, stylesOfKind, type ItemStyleKind } from '../model/styles';

// Select sentinels. Real style ids are UUIDs (or `y0`-style counter ids in
// tests), so the dunder values can't collide with one.
const CUSTOM = '__custom__';
const SAVE = '__save__';

interface Props {
  // stopDot has no item collection, so it never mounts a style row.
  kind: ItemStyleKind;
  itemId: string;
  styleId: string | undefined;
  disabled?: boolean;
}

/**
 * The style-preset row at the top of each item popover/inspector: a dropdown
 * of this kind's named styles plus the "Custom" sentinel and a define-by-
 * example "Save style…" action that captures the item's current effective
 * formatting (typing an existing name redefines that style, like palette
 * upsert), followed by the Sync-to-style button. The dropdown's VALUE derives
 * from the styleId tag alone; covered edits keep the tag as per-field
 * overrides, and while any exist the trigger reads "<name> (edited)". The two
 * directions out of that divergence are Sync (push the item's look into the
 * def, all wearers follow) and the row's own override dot — the same red
 * gutter marker the field rows wear, standing for the whole covered set, so
 * reverting everything is the row-level case of the one revert idiom rather
 * than a second button. Mount with key={itemId} so naming state resets when
 * the selection switches items.
 */
export function StyleRow({ kind, itemId, styleId, disabled }: Props) {
  const styles = useDoc((s) => s.styles);
  const applyStyle = useDoc((s) => s.applyStyle);
  const clearStyleTag = useDoc((s) => s.clearStyleTag);
  const saveStyle = useDoc((s) => s.saveStyle);
  // The item's whole override set — '' when it matches its style or is
  // untagged (nothing to diverge from). ONE capture+diff for the row: the
  // trigger's "(edited)", the Sync button's idle state and the gutter dot are
  // three faces of this one answer, so the dot takes it rather than
  // recomputing it.
  const overridden = useOverriddenFields(kind, itemId, STYLE_FIELDS[kind]);
  const edited = overridden !== '';
  // Shared inline-rename plumbing (same as MapNameField / the Styles panel).
  const {
    editing: naming,
    start,
    inputProps,
  } = useInlineRename((draft) => {
    const name = draft.trim();
    // Empty cancels; "Custom" is reserved — it's the detached sentinel and a
    // style wearing it would be indistinguishable in this dropdown.
    if (!name || name.toLowerCase() === 'custom') return;
    saveStyle(kind, name, itemId);
  });

  // Belt and braces: a tag that doesn't resolve to a def of this kind reads
  // as Custom (parse prunes these; only a mid-flight delete can race here).
  const current = styleId !== undefined && styles[styleId]?.kind === kind ? styleId : CUSTOM;

  const startNaming = () => {
    const cur = current !== CUSTOM ? styles[current] : undefined;
    start(cur?.name ?? '');
  };

  if (naming) {
    return (
      <div className="row style-row">
        <label htmlFor={`style-name-${itemId}`}>Style</label>
        <input
          id={`style-name-${itemId}`}
          aria-label="Style name"
          placeholder="Style name"
          {...inputProps}
        />
      </div>
    );
  }

  return (
    <div className="row style-row">
      {/* Every covered field at once: the gutter dot appears as soon as the
          item diverges anywhere, and clicking it puts the whole item back on
          its style. */}
      <OverrideDot
        kind={kind}
        itemId={itemId}
        overridden={overridden}
        name="all overrides"
        disabled={disabled}
      />
      <label htmlFor={`style-select-${itemId}`}>Style</label>
      <Select.Root
        value={current}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === SAVE) startNaming();
          else if (v === CUSTOM) clearStyleTag(kind, itemId);
          else applyStyle(v, itemId);
        }}
      >
        <Select.Trigger id={`style-select-${itemId}`} className="field-select" aria-label="Style">
          {/* Explicit children (not the auto item text) so the trigger can
              carry the divergence marker without it appearing in the list. */}
          <Select.Value>
            {current === CUSTOM ? 'Custom' : styles[current].name + (edited ? ' (edited)' : '')}
          </Select.Value>
          <Select.Icon className="field-select-caret" aria-hidden="true">
            <ChevronDownIcon />
          </Select.Icon>
        </Select.Trigger>
        <FieldSelectContent>
          <Select.Item value={CUSTOM} className="field-select-item">
            <Select.ItemText>Custom</Select.ItemText>
          </Select.Item>
          {stylesOfKind(styles, kind).map((d) => (
            <Select.Item key={d.id} value={d.id} className="field-select-item">
              <Select.ItemText>{d.name}</Select.ItemText>
            </Select.Item>
          ))}
          <Select.Separator className="field-select-separator" aria-hidden="true" />
          {/* An action, not a state — muted so it reads as a verb. */}
          <Select.Item value={SAVE} className="field-select-item field-select-action">
            <Select.ItemText>Save style…</Select.ItemText>
          </Select.Item>
        </FieldSelectContent>
      </Select.Root>
      {/* Idle (disabled) until the item actually diverges from a real style. */}
      <button
        type="button"
        className="style-row-btn"
        aria-label="Sync to style"
        title="Sync to style — redefine the style from this item (all wearers follow)"
        disabled={disabled || current === CUSTOM || !edited}
        onClick={() => saveStyle(kind, styles[current].name, itemId)}
      >
        <LoopIcon />
      </button>
    </div>
  );
}
