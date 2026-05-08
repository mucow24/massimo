import { ReactNode, useId } from 'react';
import { usePopover } from './usePopover';

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
  const { open, setOpen, wrapRef } = usePopover();
  const id = useId();

  return (
    <div className="menu" ref={wrapRef}>
      <button
        type="button"
        className={`menu-trigger${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
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
