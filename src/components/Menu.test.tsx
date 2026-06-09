import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, MenuItem, MenuSeparator, SubMenu } from './Menu';

describe('Menu', () => {
  it('is closed initially and opens on trigger click', async () => {
    const user = userEvent.setup();
    render(
      <Menu label="File">
        <MenuItem onClick={() => {}}>Save</MenuItem>
      </Menu>,
    );
    const trigger = screen.getByRole('button', { name: 'File' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('fires the item handler and closes the menu when an item is activated', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <Menu label="File">
        <MenuItem onClick={onSave}>Save</MenuItem>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders a separator with the separator role', async () => {
    const user = userEvent.setup();
    render(
      <Menu label="File">
        <MenuItem onClick={() => {}}>Save</MenuItem>
        <MenuSeparator />
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});

describe('SubMenu', () => {
  it('opens on hover and closes on leave', async () => {
    const user = userEvent.setup();
    render(
      <SubMenu label="Export">
        <MenuItem onClick={() => {}}>PNG</MenuItem>
      </SubMenu>,
    );
    const trigger = screen.getByRole('menuitem', { name: /Export/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.hover(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'PNG' })).toBeInTheDocument();

    await user.unhover(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('force-opens on click without bubbling to the parent panel', async () => {
    const user = userEvent.setup();
    render(
      <SubMenu label="Export">
        <MenuItem onClick={() => {}}>PNG</MenuItem>
      </SubMenu>,
    );
    const trigger = screen.getByRole('menuitem', { name: /Export/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
