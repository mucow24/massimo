import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('Menu keyboard navigation', () => {
  it('moves focus through items with the arrow keys and activates with Enter', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onLoad = vi.fn();
    render(
      <Menu label="File">
        <MenuItem onClick={onSave}>Save</MenuItem>
        <MenuItem onClick={onLoad}>Load</MenuItem>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Save' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Load' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a submenu with ArrowRight and activates its item with Enter', async () => {
    const user = userEvent.setup();
    const onPng = vi.fn();
    render(
      <Menu label="Canvas">
        <SubMenu label="Export">
          <MenuItem onClick={onPng}>PNG</MenuItem>
        </SubMenu>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Export/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menuitem', { name: 'PNG' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onPng).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('SubMenu', () => {
  it('opens on hover and closes when a sibling item is hovered', async () => {
    const user = userEvent.setup();
    render(
      <Menu label="Canvas">
        <SubMenu label="Export">
          <MenuItem onClick={() => {}}>PNG</MenuItem>
        </SubMenu>
        <MenuItem onClick={() => {}}>Clear</MenuItem>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    const trigger = screen.getByRole('menuitem', { name: /Export/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.hover(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('menuitem', { name: 'PNG' })).toBeInTheDocument();

    await user.hover(screen.getByRole('menuitem', { name: 'Clear' }));
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  });

  it('activating a flyout item closes the whole menu', async () => {
    // Activation is by keyboard: jsdom's zero-size layout defeats Radix's
    // hover-grace polygon (moving the pointer from the sub trigger to the
    // flyout item closes the sub), so clicking flyout items is exercised by
    // the Playwright suite in a real browser instead.
    const user = userEvent.setup();
    const onPng = vi.fn();
    render(
      <Menu label="Canvas">
        <SubMenu label="Export">
          <MenuItem onClick={onPng}>PNG</MenuItem>
        </SubMenu>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    const trigger = screen.getByRole('menuitem', { name: /Export/ });
    await user.hover(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');
    expect(onPng).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
