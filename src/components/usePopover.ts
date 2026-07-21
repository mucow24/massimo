import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * True when a keyboard event's target is a form field that should swallow
 * the key (Escape closing a popover, etc.) — shared by the popovers' key
 * handlers so the denylist can't drift between them.
 */
export function isInFormField(target: unknown): boolean {
  const t = target as HTMLElement | null;
  const tag = t?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(t?.isContentEditable);
}

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
  opts?: {
    // Set false when another component owns Escape for this state (e.g. the
    // station popover's step-out ladder) — two independent Escape listeners
    // over the same state race on document-listener attachment order.
    escape?: boolean;
  },
): void {
  const escape = opts?.escape ?? true;
  useEffect(() => {
    if (!active) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      // A ColorField opens its RGBA picker, and a field-select its option panel,
      // in portals under `.app` — outside every popover's own subtree. Interacting
      // with either must not dismiss the popover (inspector, options panel) that
      // owns the control.
      if (target instanceof Element && target.closest('.color-field-popover, .field-select-panel'))
        return;
      for (const r of ignore) {
        if (r.current && r.current.contains(target)) return;
      }
      onDismiss();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    if (escape) document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      if (escape) document.removeEventListener('keydown', onKey);
    };
    // `ignore` is a fresh array literal each render; depend on its members.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onDismiss, escape, ...ignore]);
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
