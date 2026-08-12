import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePopover } from './usePopover';

/**
 * The panel placement `usePopover` hands its consumers. jsdom has no layout, so
 * this stubs the trigger's rect and asserts the ARITHMETIC — that the panel is
 * pinned in WINDOW coordinates just below the trigger, right edges flush. The
 * clipping it exists to escape is a real-browser fact, held by
 * e2e/toolbarOverflow.spec.ts.
 */

const TRIGGER_RECT = { bottom: 43, right: 800, top: 4, left: 760, width: 40, height: 39 };

function Host() {
  const { open, setOpen, wrapRef, panelStyle } = usePopover();
  return (
    <div className="wrap" ref={wrapRef}>
      <button type="button" onClick={() => setOpen(!open)}>
        Trigger
      </button>
      {open && (
        <div role="dialog" aria-label="Panel" style={panelStyle}>
          body
        </div>
      )}
    </div>
  );
}

/** Every element's box, which is all this needs: the hook measures the wrap. */
const stubLayout = (rect: typeof TRIGGER_RECT) => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return { ...rect, x: rect.left, y: rect.top, toJSON: () => rect } as globalThis.DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
};

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('usePopover panel placement', () => {
  it('pins the panel to the viewport, under the trigger and flush with its right edge', async () => {
    restore = stubLayout(TRIGGER_RECT);
    window.innerWidth = 1200;
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    const panel = screen.getByRole('dialog', { name: 'Panel' });
    // Fixed, not absolute: an absolute panel is clipped by any scrolling
    // ancestor, which is exactly what the toolbar strip became.
    expect(panel.style.position).toBe('fixed');
    // 4px of air below the trigger, matching the gap the CSS used to carry.
    expect(panel.style.top).toBe('47px');
    // Right-aligned to the trigger: 1200 - 800.
    expect(panel.style.right).toBe('400px');
  });

  it('re-measures when the window resizes under an open panel', async () => {
    restore = stubLayout(TRIGGER_RECT);
    window.innerWidth = 1200;
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.getByRole('dialog', { name: 'Panel' }).style.right).toBe('400px');

    restore();
    restore = stubLayout({ ...TRIGGER_RECT, right: 600, bottom: 60 });
    window.innerWidth = 900;
    act(() => window.dispatchEvent(new globalThis.Event('resize')));

    const panel = screen.getByRole('dialog', { name: 'Panel' });
    expect(panel.style.right).toBe('300px');
    expect(panel.style.top).toBe('64px');
  });

  it('re-measures on reopen, so a rect from the last opening is never reused', async () => {
    restore = stubLayout(TRIGGER_RECT);
    window.innerWidth = 1200;
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Panel' })).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('dialog', { name: 'Panel' })).not.toBeInTheDocument();

    // Reopening at a moved trigger takes the NEW rect, not the one from before.
    restore();
    restore = stubLayout({ ...TRIGGER_RECT, right: 500, bottom: 80 });
    await user.click(trigger);
    const panel = screen.getByRole('dialog', { name: 'Panel' });
    expect(panel.style.right).toBe('700px');
    expect(panel.style.top).toBe('84px');
  });
});
