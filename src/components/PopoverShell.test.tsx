import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PopoverShell } from './PopoverShell';

function renderShell(props: { hidden?: boolean }) {
  const { container } = render(
    <PopoverShell className="bullet-popover" title="Test" left={10} top={20} {...props}>
      content
    </PopoverShell>,
  );
  return container.querySelector('.bullet-popover') as HTMLElement;
}

describe('<PopoverShell /> visibility switches', () => {
  it('renders visible at left/top by default', () => {
    const el = renderShell({});
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.display).toBe('');
    expect(el.style.visibility).toBe('');
  });

  it('hidden uses display:none (stays mounted, zero layout)', () => {
    const el = renderShell({ hidden: true });
    expect(el.style.display).toBe('none');
  });
});
