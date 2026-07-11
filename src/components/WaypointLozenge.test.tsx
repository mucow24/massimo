import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WaypointLozenge } from './WaypointLozenge';

function renderLozenge(props: { rightX: number; centerY: number; fontSize: number }) {
  const { container } = render(
    <svg>
      <WaypointLozenge {...props} />
    </svg>,
  );
  return container.querySelector('svg')!;
}

describe('WaypointLozenge', () => {
  it('renders a rounded pill with the "WP" label', () => {
    const svg = renderLozenge({ rightX: 100, centerY: 50, fontSize: 12 });
    const pill = svg.querySelector('[data-waypoint-lozenge]')!;
    expect(pill).toBeTruthy();
    const rect = pill.querySelector('rect')!;
    const text = pill.querySelector('text')!;
    expect(text.textContent).toBe('WP');
    // Fully-rounded: corner radius is half the height.
    const h = Number(rect.getAttribute('height'));
    expect(Number(rect.getAttribute('rx'))).toBeCloseTo(h / 2, 5);
  });

  it('grows leftward from rightX and centers vertically on centerY', () => {
    const rightX = 100;
    const centerY = 50;
    const svg = renderLozenge({ rightX, centerY, fontSize: 12 });
    const rect = svg.querySelector('rect')!;
    const x = Number(rect.getAttribute('x'));
    const y = Number(rect.getAttribute('y'));
    const w = Number(rect.getAttribute('width'));
    const h = Number(rect.getAttribute('height'));
    // Right edge sits exactly at rightX; the pill extends to its left.
    expect(x + w).toBeCloseTo(rightX, 5);
    expect(x).toBeLessThan(rightX);
    // Vertically centered on centerY.
    expect(y + h / 2).toBeCloseTo(centerY, 5);
  });

  it('scales with the host font size', () => {
    const small = renderLozenge({ rightX: 100, centerY: 50, fontSize: 10 }).querySelector('rect')!;
    const large = renderLozenge({ rightX: 100, centerY: 50, fontSize: 20 }).querySelector('rect')!;
    expect(Number(large.getAttribute('height'))).toBeGreaterThan(
      Number(small.getAttribute('height')),
    );
  });
});
