import { useEffect, useRef } from 'react';
import { beginHistoryGroup } from '../state/store';
import { redo, undo } from '../state/history';

/**
 * The inline-rename contract shared by the on-canvas label editor
 * (StationNameEditor) and the station popover's title editor: spread the
 * returned props onto a <textarea> whose value/onChange the caller wires to
 * the doc (live rename while typing). The hook owns
 * - one history group spanning the whole edit: opened on mount, committed on
 *   blur, Enter, or unmount, so the rename is a single undo entry;
 * - the keyboard protocol: Enter commits (single-line muscle memory),
 *   Shift+Enter inserts a newline, Escape closes;
 * - Cmd/Ctrl+Z(/Y) interception: the browser's native input undo would only
 *   revert one keystroke at a time AND fire onChange, creeping the doc back
 *   one char per press — instead commit the group, run our doc-level
 *   undo/redo, and close;
 * - focus + select-all on mount, done imperatively (not via autoFocus) so it
 *   also works for a textarea inside a foreignObject.
 */
export function useRenameEditor(onClose: () => void) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Open the group in useEffect (rather than via an onFocus handler): this
  // sidesteps any uncertainty about whether the synthetic focus event fires
  // when el.focus() is called programmatically.
  const groupRef = useRef<ReturnType<typeof beginHistoryGroup> | null>(null);
  useEffect(() => {
    groupRef.current = beginHistoryGroup();
    const el = ref.current;
    el?.focus();
    el?.select();
    return () => {
      groupRef.current?.commit();
      groupRef.current = null;
    };
  }, []);

  const closeEditor = () => {
    groupRef.current?.commit();
    groupRef.current = null;
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      closeEditor();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
      e.stopPropagation();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      closeEditor();
      if (e.shiftKey) redo();
      else undo();
      e.stopPropagation();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      closeEditor();
      redo();
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
  };

  return { ref, onKeyDown, onBlur: closeEditor };
}
