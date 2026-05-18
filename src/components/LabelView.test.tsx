import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LabelView } from './LabelView';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeTextLabel } from '../test/fixtures';
import type { Line } from '../model/types';

const seedLine = (overrides: Partial<Line> & Pick<Line, 'id' | 'service'>): Line => ({
  id: overrides.id,
  service: overrides.service,
  name: overrides.name ?? overrides.service,
  color: overrides.color ?? '#ff0000',
  stations: overrides.stations ?? [],
});

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
});

describe('<LabelView /> — inline bullets', () => {
  it('renders an inline bullet with the line color when text contains <CODE>', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: seedLine({ id: 'L1', service: 'A1', color: '#00ff00' }) },
      lineOrder: ['L1'],
    });
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: '<A1>' })} selected={false} />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    expect(bullets[0].getAttribute('data-inline-bullet')).toBe('A1');
    const circle = bullets[0].querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#00ff00');
  });

  it('renders a gray "?" bullet when the code does not match any line', () => {
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: '<NOPE>' })} selected={false} />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    const circle = bullets[0].querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#888');
    expect(bullets[0].querySelector('text')?.textContent).toBe('?');
  });

  it('renders no bullet when text has no <...> tokens', () => {
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: 'plain text' })} selected={false} />
      </svg>,
    );
    expect(container.querySelectorAll('[data-inline-bullet]')).toHaveLength(0);
  });

  it('renders text segments around an inline bullet', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: seedLine({ id: 'L1', service: 'A1' }) },
      lineOrder: ['L1'],
    });
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: 'Take <A1> uptown' })} selected={false} />
      </svg>,
    );
    // The label group contains TWO text segments (before and after the bullet),
    // plus the bullet's own internal <text>. We assert on the segment texts.
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Take ');
    expect(texts).toContain(' uptown');
    expect(container.querySelectorAll('[data-inline-bullet]')).toHaveLength(1);
  });
});
