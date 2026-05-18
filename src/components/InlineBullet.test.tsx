import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InlineBullet } from './InlineBullet';
import type { Line } from '../model/types';

const lineMap = (lines: Line[]): Map<string, Line> => {
  const m = new Map<string, Line>();
  for (const ln of lines) m.set(ln.service, ln);
  return m;
};

const makeLine = (overrides: Partial<Line> & Pick<Line, 'id' | 'service'>): Line => ({
  id: overrides.id,
  service: overrides.service,
  name: overrides.name ?? overrides.service,
  color: overrides.color ?? '#ff0000',
  stations: overrides.stations ?? [],
});

describe('<InlineBullet />', () => {
  it('renders a colored circle and the service code when the code resolves', () => {
    const { container } = render(
      <svg>
        <InlineBullet
          code="A1"
          diameter={20}
          cx={50}
          cy={30}
          lineByService={lineMap([makeLine({ id: 'l1', service: 'A1', color: '#ff0000' })])}
        />
      </svg>,
    );
    const circle = container.querySelector('circle');
    expect(circle).toBeTruthy();
    expect(circle?.getAttribute('fill')).toBe('#ff0000');
    expect(circle?.getAttribute('r')).toBe('10');
    const text = container.querySelector('text');
    expect(text?.textContent).toBe('A1');
  });

  it('renders a gray "?" bullet when the code does not resolve', () => {
    const { container } = render(
      <svg>
        <InlineBullet
          code="UNKNOWN"
          diameter={16}
          cx={0}
          cy={0}
          lineByService={lineMap([])}
        />
      </svg>,
    );
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#888');
    const text = container.querySelector('text');
    expect(text?.textContent).toBe('?');
  });

  it('positions the bullet at the given (cx, cy) via a translate transform', () => {
    const { container } = render(
      <svg>
        <InlineBullet
          code="X"
          diameter={10}
          cx={123}
          cy={456}
          lineByService={lineMap([])}
        />
      </svg>,
    );
    const g = container.querySelector('[data-inline-bullet]');
    expect(g?.getAttribute('transform')).toBe('translate(123 456)');
  });
});
