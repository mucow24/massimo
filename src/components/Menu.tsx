import { ReactNode, useId, useState } from 'react';
import { ChevronRightIcon } from '@radix-ui/react-icons';
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

interface SubMenuProps {
  label: string;
  children: ReactNode;
}

/**
 * A nested flyout inside a `<Menu>`. The trigger is a `menu-item` row with a ›
 * caret; the child panel flies out to the right on hover or click. The
 * trigger's onClick stops propagation so it doesn't trip the parent panel's
 * close-on-click — but activating a leaf `<MenuItem>` inside still bubbles up
 * and closes the whole menu.
 */
export function SubMenu({ label, children }: SubMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div
      className="menu-sub"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`menu-item menu-sub-trigger${open ? ' open' : ''}`}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          // Don't bubble to the parent panel's close-on-click. Force open
          // (rather than toggle) so a click never fights the hover that just
          // opened it; moving the pointer away closes it via onMouseLeave.
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
        <span className="menu-sub-caret" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      </button>
      {open && (
        <div className="menu-panel menu-sub-panel" id={id} role="menu">
          {children}
        </div>
      )}
    </div>
  );
}
