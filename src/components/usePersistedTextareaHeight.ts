import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Persist the height of a user-resizable `<textarea>` (one with CSS
 * `resize: vertical`). Spread the returned `ref` and `onPointerUp` onto the
 * textarea:
 *
 *   const { ref, onPointerUp } = usePersistedTextareaHeight(height, onCommit);
 *   <textarea ref={ref} onPointerUp={onPointerUp} … />
 *
 * `height` is the stored height in CSS px (or `undefined` to leave the box
 * auto-sized to its content — the historical default before the user stretches
 * it). It is applied to the element imperatively, NOT via a controlled `style`
 * prop, so a live resize drag isn't reconciled back to the old value mid-
 * gesture; it re-applies whenever `height` changes (e.g. selecting a different
 * label with its own stored height).
 *
 * When the user drags the resize grip the browser writes the new height to the
 * element's inline `style.height`. On the pointer-up that ends the drag we read
 * that value and, if it differs from the stored one, call `onCommit(px)` — once
 * per drag, so it lands as a single undo entry. A plain click (no resize)
 * leaves the height untouched and commits nothing.
 */
export function usePersistedTextareaHeight(
  height: number | undefined,
  onCommit: (height: number) => void,
) {
  const elRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = useCallback((el: HTMLTextAreaElement | null) => {
    elRef.current = el;
  }, []);

  // Apply the stored height before paint so the box opens at its remembered
  // size with no flash of the default. `undefined` clears any explicit height,
  // handing sizing back to the `rows` attribute / CSS min-height.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (el) el.style.height = height != null ? `${height}px` : '';
  }, [height]);

  const onPointerUp = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const dragged = Math.round(parseFloat(el.style.height));
    if (Number.isFinite(dragged) && dragged > 0 && dragged !== height) onCommit(dragged);
  }, [height, onCommit]);

  return { ref, onPointerUp };
}
