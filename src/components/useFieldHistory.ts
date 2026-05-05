import { useEffect, useMemo, useRef } from 'react';
import { beginHistoryGroup } from '../state/store';

/**
 * Hook for continuous-input UI controls (text fields, sliders, color
 * pickers) that fire many onChange events between user gestures. Returns
 * `onFocus` / `onBlur` handlers; spread them onto the input. While the
 * field is focused, doc changes don't record individual history entries —
 * on blur (or Enter triggering blur), one entry covering the whole edit
 * is committed.
 *
 * If the input is unmounted while focused (e.g. selecting a different
 * station collapses the inspector), the open group is committed on
 * unmount so its edits aren't silently lost from history.
 */
export function useFieldHistory() {
  const ref = useRef<ReturnType<typeof beginHistoryGroup> | null>(null);

  // Commit on unmount as a safety net.
  useEffect(() => {
    return () => {
      ref.current?.commit();
      ref.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      onFocus: () => {
        // If a group is somehow still open (no blur fired), commit it before
        // starting a new one so we don't leak the pause state.
        ref.current?.commit();
        ref.current = beginHistoryGroup();
      },
      onBlur: () => {
        ref.current?.commit();
        ref.current = null;
      },
    }),
    [],
  );
}
