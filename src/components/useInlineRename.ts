import { useRef, useState, type ReactEventHandler, type KeyboardEventHandler } from 'react';

/**
 * Click-to-edit rename state, shared by every inline name field in the app: the
 * map name, a style's name in the Styles panel, "Save style…" in the style-
 * preset row, a palette's title in the editor, and a palette color row's two
 * (the color's name and the palette it saves into). Manages the draft plus a
 * one-shot cancel flag so a commit fires exactly once — on Enter or blur — and
 * Escape reverts without touching the store.
 *
 * The library dialog's `RenameField` reproduces this BEHAVIOUR without the hook
 * (its commit is async and its Escape is kept out of the Dialog's dismiss); the
 * contract both answer to is pinned in useInlineRename.test.tsx.
 *
 * `onCommit` receives the RAW draft; each caller trims / validates / falls back
 * as its own model requires (e.g. the map name defaults when empty; a style name
 * refuses the reserved "Custom"). Render your own display element, call
 * `start(currentName)` to enter edit mode, and spread `inputProps` onto the edit
 * `<input>` — adding your own id / className / aria-label / placeholder.
 */
export function useInlineRename(onCommit: (draft: string) => void): {
  editing: boolean;
  start: (initial: string) => void;
  inputProps: {
    value: string;
    autoFocus: boolean;
    onFocus: ReactEventHandler<HTMLInputElement>;
    onChange: ReactEventHandler<HTMLInputElement>;
    onBlur: () => void;
    onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  };
} {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Escape sets this before blurring so the blur-driven commit is skipped.
  const cancelledRef = useRef(false);

  const start = (initial: string) => {
    setDraft(initial);
    cancelledRef.current = false;
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) return;
    onCommit(draft);
  };

  return {
    editing,
    start,
    inputProps: {
      value: draft,
      autoFocus: true,
      onFocus: (e) => e.currentTarget.select(),
      onChange: (e) => setDraft(e.currentTarget.value),
      onBlur: commit,
      onKeyDown: (e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          cancelledRef.current = true;
          e.currentTarget.blur();
        }
      },
    },
  };
}
