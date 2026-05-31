import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Shared dismissal effect for floating panels. While `active`, an outside
 * mousedown — registered on the next tick so the click that opened the panel
 * doesn't immediately fire it — or an Escape keypress calls `onDismiss`. Clicks
 * inside any `ignore` element are not treated as "outside".
 */
export function useDismiss(
  active: boolean,
  onDismiss: () => void,
  ignore: ReadonlyArray<RefObject<Node | null>>,
): void {
  useEffect(() => {
    if (!active) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      for (const r of ignore) {
        if (r.current && r.current.contains(target)) return;
      }
      onDismiss();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
    // `ignore` is a fresh array literal each render; depend on its members.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onDismiss, ...ignore]);
}

/**
 * Open/close state + outside-click and Escape handling for a small floating
 * panel anchored to a trigger element. Spread `wrapRef` onto the wrapping
 * element that contains both trigger and panel; clicks anywhere outside that
 * element (or Escape) close the popover.
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [wrapRef]);
  return { open, setOpen, wrapRef };
}
