import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StationOrientationArrows } from './StationOrientationArrows';
import type { Station } from '../model/types';
import { makeLine } from '../test/fixtures';

const label: Station['label'] = {
  row: 0,
  col: -1,
  rotation: 0,
  offset: 0,
  align: 'auto',
  valign: 'middle',
};

const station = (over: Partial<Station> = {}): Station => ({
  id: 'a',
  name: 'A',
  x: 100,
  y: 50,
  rotation: 0,
  stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
  label,
  ...over,
});

const lines = {
  L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] }),
  L2: makeLine({ id: 'L2', service: '2', name: '2 line', color: '#222222', stations: ['a'] }),
};

const renderArrows = (st: Station) => {
  const { container } = render(
    <svg>
      <StationOrientationArrows station={st} lines={lines} />
    </svg>,
  );
  return container;
};

describe('<StationOrientationArrows />', () => {
  it('paints each orientation as its axis glyph', () => {
    const c = renderArrows(
      station({
        stops: [
          { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
          { lineId: 'L2', row: 0, col: 1, orientation: 'auto-nw-se' },
        ],
      }),
    );
    const glyphs = [...c.querySelectorAll('text')].map((t) => t.textContent);
    expect(glyphs).toEqual(['↔', '⤡']);
  });

  it('renders inside the station-rotated frame so glyphs read world-true', () => {
    const c = renderArrows(station({ rotation: 2 }));
    expect(c.querySelector('[data-station-arrows="a"]')!.getAttribute('transform')).toBe(
      'translate(100 50) rotate(90)',
    );
  });

  it('floors the glyph at the station-name default size for a default (8px) dot', () => {
    const c = renderArrows(station());
    expect(Number(c.querySelector('text')!.getAttribute('font-size'))).toBe(12);
  });

  it('scales the glyph with an oversized dot instead of hiding under it', () => {
    const c = renderArrows(
      station({
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical', dotSize: 20 }],
      }),
    );
    expect(Number(c.querySelector('text')!.getAttribute('font-size'))).toBe(24);
  });

  it('uses the two-tone white-core/black-edge recipe so it reads on any dot color', () => {
    const c = renderArrows(station());
    const t = c.querySelector('text')!;
    expect(t.getAttribute('fill')).toBe('#fff');
    expect(t.getAttribute('stroke')).toBe('#000');
    expect(t.getAttribute('paint-order')).toBe('stroke');
  });
});
