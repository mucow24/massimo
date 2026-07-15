import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { InlineBullet } from './InlineBullet';
import { useDoc } from '../state/store';
import type { Line } from '../model/types';
import { edgesFromStations } from '../model/lineTopology';

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
  edges: edgesFromStations(overrides.stations ?? []),
});

const redA1 = lineMap([makeLine({ id: 'l1', service: 'A1', color: '#ff0000' })]);

afterEach(() => {
  useDoc.setState({ darkMode: false });
});

describe('<InlineBullet />', () => {
  it('renders a colored circle and the service code when the code resolves', () => {
    const { container } = render(
      <svg>
        <InlineBullet
          code="A1"
          shape="circle"
          filled
          diameter={20}
          cx={50}
          cy={30}
          lineByService={redA1}
        />
      </svg>,
    );
    const circle = container.querySelector('circle');
    expect(circle).toBeTruthy();
    expect(circle?.getAttribute('fill')).toBe('#ff0000');
    expect(circle?.getAttribute('r')).toBe('10');
    expect(circle?.getAttribute('stroke')).toBeNull();
    const text = container.querySelector('text');
    expect(text?.textContent).toBe('A1');
  });

  it('renders a full-extent square in the line color for shape="square"', () => {
    const { container } = render(
      <svg>
        <InlineBullet
          code="A1"
          shape="square"
          filled
          diameter={20}
          cx={0}
          cy={0}
          lineByService={redA1}
        />
      </svg>,
    );
    const rect = container.querySelector('rect');
    expect(rect?.getAttribute('fill')).toBe('#ff0000');
    expect(rect?.getAttribute('x')).toBe('-10');
    expect(rect?.getAttribute('width')).toBe('20');
  });

  it('renders a full-extent diamond polygon for shape="diamond"', () => {
    const { container } = render(
      <svg>
        <InlineBullet
          code="A1"
          shape="diamond"
          filled
          diameter={20}
          cx={0}
          cy={0}
          lineByService={redA1}
        />
      </svg>,
    );
    const poly = container.querySelector('polygon');
    expect(poly?.getAttribute('fill')).toBe('#ff0000');
    expect(poly?.getAttribute('points')).toBe('0,-10 10,0 0,10 -10,0');
  });

  it('renders an unfilled bullet as line-color outline, white interior, line-color code', () => {
    const { container } = render(
      <svg>
        <InlineBullet
          code="A1"
          shape="circle"
          filled={false}
          diameter={20}
          cx={0}
          cy={0}
          lineByService={redA1}
        />
      </svg>,
    );
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#ffffff');
    expect(circle?.getAttribute('stroke')).toBe('#ff0000');
    // Outline inset by half its width so the outer edge matches a filled bullet.
    expect(Number(circle?.getAttribute('r'))).toBeLessThan(10);
    const text = container.querySelector('text');
    expect(text?.getAttribute('fill')).toBe('#ff0000');
  });

  it('fills an unfilled bullet interior black in dark mode', () => {
    useDoc.setState({ darkMode: true });
    const { container } = render(
      <svg>
        <InlineBullet
          code="A1"
          shape="square"
          filled={false}
          diameter={20}
          cx={0}
          cy={0}
          lineByService={redA1}
        />
      </svg>,
    );
    const rect = container.querySelector('rect');
    expect(rect?.getAttribute('fill')).toBe('#000000');
    expect(rect?.getAttribute('stroke')).toBe('#ff0000');
  });

  it('renders a gray "?" bullet when the code does not resolve', () => {
    const { container } = render(
      <svg>
        <InlineBullet
          code="UNKNOWN"
          shape="circle"
          filled
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
          shape="circle"
          filled
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
