import { useRef, useState } from 'react';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { useDoc } from '../state/store';
import { stylesOfKind } from '../model/styles';
import type { StyleKind } from '../model/types';

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
 * upsert). The dropdown is a Radix Select wearing the shared `field-select`
 * chrome (same as the Weight dropdown). Its value derives from the styleId
 * tag alone — the transforms keep "tagged ⇒ matches" true, so no value
 * comparison happens here. Mount with key={itemId} so naming state resets
 * when the selection switches items.
 */
export function StyleRow({ kind, itemId, styleId, disabled }: Props) {
  const styles = useDoc((s) => s.styles);
  const applyStyle = useDoc((s) => s.applyStyle);
  const clearStyleTag = useDoc((s) => s.clearStyleTag);
  const saveStyle = useDoc((s) => s.saveStyle);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  // Escape sets this before blurring so the blur-driven commit is skipped
  // (MapNameField pattern).
  const cancelledRef = useRef(false);

  // Belt and braces: a tag that doesn't resolve to a def of this kind reads
  // as Custom (parse prunes these; only a mid-flight delete can race here).
  const current = styleId !== undefined && styles[styleId]?.kind === kind ? styleId : CUSTOM;

  const startNaming = () => {
    const cur = current !== CUSTOM ? styles[current] : undefined;
    setDraft(cur?.name ?? '');
    cancelledRef.current = false;
    setNaming(true);
  };

  const commit = () => {
    setNaming(false);
    if (cancelledRef.current) return;
    const name = draft.trim();
    // Empty cancels; "Custom" is reserved — it's the detached sentinel and a
    // style wearing it would be indistinguishable in this dropdown.
    if (!name || name.toLowerCase() === 'custom') return;
    saveStyle(kind, name, itemId);
  };

  if (naming) {
    return (
      <div className="row style-row">
        <label htmlFor={`style-name-${itemId}`}>Style</label>
        <input
          id={`style-name-${itemId}`}
          aria-label="Style name"
          placeholder="Style name"
          value={draft}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              cancelledRef.current = true;
              e.currentTarget.blur();
            }
          }}
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
          <Select.Value />
          <Select.Icon className="field-select-caret" aria-hidden="true">
            <ChevronDownIcon />
          </Select.Icon>
        </Select.Trigger>
        <Select.Content className="field-select-panel" position="popper" sideOffset={4}>
          <Select.Viewport>
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
          </Select.Viewport>
        </Select.Content>
      </Select.Root>
    </div>
  );
}
