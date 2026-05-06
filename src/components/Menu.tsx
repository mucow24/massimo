import { ReactNode, useEffect, useId, useRef, useState } from 'react';

interface MenuProps {
  label: string;
  children: ReactNode;
}

/**
 * Minimal text-button dropdown menu. Trigger is an underlined Helvetica Neue
 * label; clicking opens a panel of `<MenuItem>` rows beneath it. Closes on
 * outside click, Escape, or after an item is activated.
 */
export function Menu({ label, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Defer until next tick so the click that opened the menu doesn't also close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={wrapRef}>
      <button
        type="button"
        className={`menu-trigger${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((x) => !x)}
      >
        {label}
      </button>
      {open && (
        <div className="menu-panel" id={id} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  onClick: () => void;
  children: ReactNode;
}

export function MenuItem({ onClick, children }: MenuItemProps) {
  return (
    <button type="button" className="menu-item" role="menuitem" onClick={onClick}>
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}
