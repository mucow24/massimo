import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InlineBulletText } from './InlineBulletText';
import type { Line } from '../model/types';

const lineMap = (lines: Line[]): Map<string, Line> => {
  const m = new Map<string, Line>();
  for (const ln of lines) m.set(ln.service, ln);
  return m;
};

const red = lineMap([
  { id: 'l1', service: 'A1', name: 'A1', color: '#ff0000', stations: [] },
]);

const badge = (container: HTMLElement) =>
  container.querySelector('[data-inline-bullet]') as HTMLElement | null;

describe('<InlineBulletText />', () => {
  it('renders a filled circle badge with the line color background', () => {
    const { container } = render(<InlineBulletText text="Hub <A1>" lineByService={red} />);
    const b = badge(container);
    expect(b?.className).toBe('inline-bullet-badge inline-bullet-badge--circle');
    expect(b?.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('renders shape modifier classes for square and diamond tokens', () => {
    const sq = render(<InlineBulletText text="[A1]" lineByService={red} />);
    expect(badge(sq.container)?.className).toContain('inline-bullet-badge--square');
    const di = render(<InlineBulletText text="{A1}" lineByService={red} />);
    expect(badge(di.container)?.className).toContain('inline-bullet-badge--diamond');
  });

  it('renders unfilled tokens as hollow badges colored by the line', () => {
    const { container } = render(<InlineBulletText text="<<A1>>" lineByService={red} />);
    const b = badge(container);
    expect(b?.className).toContain('inline-bullet-badge--hollow');
    // Line color rides on `color` (outline via currentColor + the code);
    // the interior background comes from the theme CSS, not inline style.
    expect(b?.style.color).toBe('rgb(255, 0, 0)');
    expect(b?.style.backgroundColor).toBe('');
  });
});
