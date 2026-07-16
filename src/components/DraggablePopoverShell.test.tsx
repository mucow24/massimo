import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DraggablePopoverShell } from './DraggablePopoverShell';

const noop = () => {};
const headerHandlers = {
  onPointerDown: noop,
  onPointerMove: noop,
  onPointerUp: noop,
  onPointerCancel: noop,
};

function renderShell(props: { hidden?: boolean; measuring?: boolean }) {
  const { container } = render(
    <DraggablePopoverShell
      className="bullet-popover"
      title="Test"
      left={10}
      top={20}
      headerHandlers={headerHandlers}
      {...props}
    >
      content
    </DraggablePopoverShell>,
  );
  return container.querySelector('.bullet-popover') as HTMLElement;
}

describe('<DraggablePopoverShell /> visibility switches', () => {
  it('renders visible at left/top by default', () => {
    const el = renderShell({});
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.display).toBe('');
    expect(el.style.visibility).toBe('');
  });

  it('measuring hides via visibility, NOT display — the box must keep real layout', () => {
    // The measuring commit reads offsetWidth/Height off this element;
    // display:none would zero them and silently degrade every placement to
    // the nominal fallback in real browsers.
    const el = renderShell({ measuring: true });
    expect(el.style.visibility).toBe('hidden');
    expect(el.style.display).toBe('');
  });

  it('hidden uses display:none (keeps the frozen anchor mounted, zero layout)', () => {
    const el = renderShell({ hidden: true });
    expect(el.style.display).toBe('none');
  });
});
