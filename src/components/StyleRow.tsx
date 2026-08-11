import { ChevronDownIcon, LoopIcon, ResetIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { FieldSelectContent } from './FieldSelectContent';
import { useInlineRename } from './useInlineRename';
import { useDoc } from '../state/store';
import { captureStyleProps, styleFieldsDiff, stylesOfKind } from '../model/styles';
import type { MapDoc, StyleKind } from '../model/types';

// Select sentinels. Real style ids are UUIDs (or `y0`-style counter ids in
// tests), so the dunder values can't collide with one.
const CUSTOM = '__custom__';
const SAVE = '__save__';

interface Props {
  kind: StyleKind;
  itemId: string;
  styleId: string | undefined;
  disabled?: boolean;
}

/**
 * The style-preset row at the top of each item popover/inspector: a dropdown
 * of this kind's named styles plus the "Custom" sentinel and a define-by-
 * example "Save style…" action that captures the item's current effective
 * formatting (typing an existing name redefines that style, like palette
 * upsert), followed by the Sync-to-style and Revert-to-style buttons. The
 * dropdown's VALUE derives from the styleId tag alone; covered edits keep the
 * tag as per-field overrides, and while any exist the trigger reads
 * "<name> (edited)" — the buttons resolve that divergence in either
 * direction (push the item's look into the def, or re-stamp the def over the
 * item). Mount with key={itemId} so naming state resets when the selection
 * switches items.
 */
export function StyleRow({ kind, itemId, styleId, disabled }: Props) {
  const styles = useDoc((s) => s.styles);
  const applyStyle = useDoc((s) => s.applyStyle);
  const clearStyleTag = useDoc((s) => s.clearStyleTag);
  const saveStyle = useDoc((s) => s.saveStyle);
  // Does the item diverge from its style on any covered field? (false when
  // untagged — nothing to diverge from.) stopDot never mounts a StyleRow, so
  // the kind narrows safely.
  const edited = useDoc((s) => {
    const def = styleId !== undefined ? s.styles[styleId] : undefined;
    if (!def || def.kind !== kind || kind === 'stopDot') return false;
    const props = captureStyleProps(s as unknown as MapDoc, kind, itemId);
    return props !== null && styleFieldsDiff(kind, props, def.props).length > 0;
  });
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
      {/* Resolve a divergence in either direction. Both idle (disabled) until
          the item actually diverges from a real style. */}
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
      <button
        type="button"
        className="style-row-btn"
        aria-label="Revert to style"
        title="Revert to style — discard this item's overrides"
        disabled={disabled || current === CUSTOM || !edited}
        onClick={() => applyStyle(current, itemId)}
      >
        <ResetIcon />
      </button>
    </div>
  );
}
