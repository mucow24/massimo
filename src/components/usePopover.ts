import { useEffect, useRef, useState } from 'react';

/**
 * Open/close state + outside-click and Escape handling for a small floating
 * panel anchored to a trigger element. Spread `wrapRef` onto the wrapping
 * element that contains both trigger and panel; clicks anywhere outside that
 * element close the popover. Pressing Escape (anywhere on the document) also
 * closes it.
 *
 * The mousedown listener is registered on the next tick so that the click
 * which opened the panel doesn't immediately close it again.
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, setOpen, wrapRef };
}
