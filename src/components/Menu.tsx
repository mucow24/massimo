import { ReactNode, useRef } from 'react';
import { CheckIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import * as Dropdown from '@radix-ui/react-dropdown-menu';

interface MenuProps {
  label: string;
  children: ReactNode;
}

/**
 * Minimal text-button dropdown menu. Trigger is an underlined Helvetica Neue
 * label; clicking opens a panel of `<MenuItem>` rows beneath it. Radix
 * DropdownMenu supplies the behavior (outside click / Escape close, arrow-key
 * navigation, typeahead, submenu hover intent); the look stays ours via the
 * same CSS classes as before.
 *
 * The content is deliberately NOT portaled: it must stay inside `.app` so the
 * design-token custom properties (and the dark-mode reassignment) apply.
 */
export function Menu({ label, children }: MenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger ref={triggerRef} className="menu-trigger">
        {label}
      </Dropdown.Trigger>
      <Dropdown.Content
        className="menu-panel"
        align="start"
        sideOffset={4}
        loop
        // Don't let the trigger keep keyboard focus once the menu closes. The
        // canvas uses hold-Space-to-pan, and Radix's trigger opens the menu on
        // a Space keydown — so a lingering trigger focus would turn the next
        // pan keypress into a menu reopen. preventDefault stops Radix's own
        // focus-return (Escape / item-select / outside-click), and the blur
        // drops the focus a mouse toggle-close leaves on the button; both land
        // focus back on the canvas (body). Blurring only our own trigger never
        // steals focus from an input the user clicked to dismiss the menu.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          triggerRef.current?.blur();
        }}
      >
        {children}
      </Dropdown.Content>
    </Dropdown.Root>
  );
}

interface MenuItemProps {
  onClick: () => void;
  children: ReactNode;
  /** Greyed out and inert. Radix keeps a disabled item's activation from
   *  firing AND from closing the menu — the standard "nothing happened"
   *  reading. */
  disabled?: boolean;
  /** Optional accelerator hint (e.g. "Ctrl+S"), shown right-aligned and muted.
   *  aria-hidden — it's a visual affordance, so the item's accessible name
   *  stays the label alone. */
  shortcut?: string;
}

export function MenuItem({ onClick, children, disabled, shortcut }: MenuItemProps) {
  return (
    <Dropdown.Item
      className={'menu-item' + (shortcut ? ' has-shortcut' : '')}
      disabled={disabled}
      onSelect={onClick}
    >
      {children}
      {shortcut && (
        <span className="menu-shortcut" aria-hidden="true">
          {shortcut}
        </span>
      )}
    </Dropdown.Item>
  );
}

interface MenuCheckboxItemProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}

/**
 * A checkable menu row — a `menu-item` with a leading check column that fills in
 * when `checked`. Radix `CheckboxItem` supplies the toggle behavior and the
 * `role="menuitemcheckbox"` semantics; the check itself lives in an
 * `ItemIndicator`, which renders its child only in the checked state (the fixed
 * `menu-check` width reserves the gutter so the label never shifts). Selecting it
 * closes the menu like any other item — one toggle, immediate feedback, done.
 */
export function MenuCheckboxItem({ checked, onCheckedChange, children }: MenuCheckboxItemProps) {
  return (
    <Dropdown.CheckboxItem
      className="menu-item menu-checkbox-item"
      checked={checked}
      onCheckedChange={onCheckedChange}
    >
      <span className="menu-check" aria-hidden="true">
        <Dropdown.ItemIndicator>
          <CheckIcon />
        </Dropdown.ItemIndicator>
      </span>
      {children}
    </Dropdown.CheckboxItem>
  );
}

export function MenuSeparator() {
  return <Dropdown.Separator className="menu-separator" />;
}

interface SubMenuProps {
  label: string;
  children: ReactNode;
}

/**
 * A nested flyout inside a `<Menu>`. The trigger is a `menu-item` row with a ›
 * caret; the child panel flies out to the right on hover, click, or ArrowRight.
 * Must be rendered inside a `<Menu>` (it is a Radix `Sub`).
 */
export function SubMenu({ label, children }: SubMenuProps) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger className="menu-item menu-sub-trigger">
        {label}
        <span className="menu-sub-caret" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      </Dropdown.SubTrigger>
      {/* alignOffset -5 butts the flyout's first row up level with the trigger
          row (the old top: -5px), sideOffset 0 keeps it flush against the
          parent panel's edge so the pointer never crosses a dead zone. */}
      <Dropdown.SubContent className="menu-panel menu-sub-panel" alignOffset={-5} loop>
        {children}
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}
