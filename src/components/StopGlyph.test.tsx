import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StopGlyph } from './StopGlyph';
import { STOP_DOT_RADIUS } from '../geometry/orientation';
import type { DotShape } from '../model/types';

function renderGlyph(
  shape: DotShape | undefined,
  isHovered = false,
  lineColor?: string,
  serviceCode?: string,
) {
  const { container } = render(
    <svg>
      <StopGlyph
        cx={0}
        cy={0}
        shape={shape}
        lineColor={lineColor}
        serviceCode={serviceCode}
        isHovered={isHovered}
        stationId="A"
        lineId="L1"
      />
    </svg>,
  );
  return container.querySelector('svg')!;
}

describe('<StopGlyph />', () => {
  it('renders filled-black (default) as a black circle with no stroke', () => {
    const svg = renderGlyph('filled-black');
    const c = svg.querySelector('circle')!;
    expect(c).toBeTruthy();
    expect(c.getAttribute('fill')).toBe('#000');
    expect(c.getAttribute('stroke')).toBeNull();
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
  });

  it('treats undefined shape as filled-black', () => {
    const svg = renderGlyph(undefined);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000');
    expect(c.getAttribute('data-stop-shape')).toBe('filled-black');
  });

  it("renders open-black as a circle with fill='none' and a 1.5px black stroke", () => {
    const svg = renderGlyph('open-black');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('none');
    expect(c.getAttribute('stroke')).toBe('#000');
    expect(c.getAttribute('stroke-width')).toBe('1.5');
  });

  it('renders filled-black-white-stroke', () => {
    const svg = renderGlyph('filled-black-white-stroke');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000');
    expect(c.getAttribute('stroke')).toBe('#fff');
    expect(c.getAttribute('stroke-width')).toBe('2');
  });

  it('renders filled-white as a white circle with no stroke', () => {
    const svg = renderGlyph('filled-white');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#fff');
    expect(c.getAttribute('stroke')).toBeNull();
  });

  it('renders open-white as fill=none with 1.5px white stroke', () => {
    const svg = renderGlyph('open-white');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('none');
    expect(c.getAttribute('stroke')).toBe('#fff');
    expect(c.getAttribute('stroke-width')).toBe('1.5');
  });

  it('renders filled-white-black-stroke', () => {
    const svg = renderGlyph('filled-white-black-stroke');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#fff');
    expect(c.getAttribute('stroke')).toBe('#000');
    expect(c.getAttribute('stroke-width')).toBe('2');
  });

  it("renders filled-line-color as a circle filled with the line's color, no stroke", () => {
    const svg = renderGlyph('filled-line-color', false, '#e6002d');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#e6002d');
    expect(c.getAttribute('stroke')).toBeNull();
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
  });

  it('filled-line-color falls back to black when no lineColor is provided', () => {
    const svg = renderGlyph('filled-line-color');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000');
  });

  it('renders filled-black-service-code as a black circle with the service code in white', () => {
    const svg = renderGlyph('filled-black-service-code', false, '#e6002d', 'A');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000');
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
    const t = svg.querySelector('text')!;
    expect(t.textContent).toBe('A');
    expect(t.getAttribute('fill')).toBe('#fff');
    expect(svg.querySelector('g')!.getAttribute('data-stop-shape')).toBe(
      'filled-black-service-code',
    );
  });

  it('filled-black-service-code falls back to "?" when no serviceCode is provided', () => {
    const svg = renderGlyph('filled-black-service-code');
    expect(svg.querySelector('text')!.textContent).toBe('?');
  });

  it('hover on filled-black-service-code strokes the circle white 3px', () => {
    const svg = renderGlyph('filled-black-service-code', true, undefined, 'A');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('stroke')).toBe('#fff');
    expect(c.getAttribute('stroke-width')).toBe('3');
  });

  it('renders filled-black-diamond as a polygon', () => {
    const svg = renderGlyph('filled-black-diamond');
    const p = svg.querySelector('polygon')!;
    expect(p).toBeTruthy();
    expect(p.getAttribute('fill')).toBe('#000');
    expect(svg.querySelector('circle')).toBeNull();
    // Diamond inscribed in the circle's bounding box: vertex distance = STOP_DOT_RADIUS.
    const points = p.getAttribute('points')!;
    expect(points).toMatch(/-?\d/);
    // Height (top to bottom vertex) = 2 * R.
    const coords = points
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(',').map(Number));
    const ys = coords.map((c) => c[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * STOP_DOT_RADIUS, 5);
  });

  it('renders filled-white-diamond as a white polygon', () => {
    const svg = renderGlyph('filled-white-diamond');
    const p = svg.querySelector('polygon')!;
    expect(p.getAttribute('fill')).toBe('#fff');
  });

  it("'none' renders nothing — no circle, no polygon, no data-stop-shape", () => {
    const svg = renderGlyph('none');
    expect(svg.querySelector('circle')).toBeNull();
    expect(svg.querySelector('polygon')).toBeNull();
    expect(svg.querySelector('[data-stop-shape]')).toBeNull();
  });

  it('hover overrides the stroke with white 3px regardless of base shape', () => {
    const svg = renderGlyph('filled-white-black-stroke', true);
    const c = svg.querySelector('circle')!;
    // White stroke replaces the base 2px black on hover so the affordance stays consistent.
    expect(c.getAttribute('stroke')).toBe('#fff');
    expect(c.getAttribute('stroke-width')).toBe('3');
  });

  it('hover on a diamond also gets the white 3px stroke', () => {
    const svg = renderGlyph('filled-black-diamond', true);
    const p = svg.querySelector('polygon')!;
    expect(p.getAttribute('stroke')).toBe('#fff');
    expect(p.getAttribute('stroke-width')).toBe('3');
  });

  it('tags each glyph with data-stop-station and data-stop-shape for E2E', () => {
    const svg = renderGlyph('filled-black-diamond');
    const p = svg.querySelector('polygon')!;
    expect(p.getAttribute('data-stop-station')).toBe('A');
    expect(p.getAttribute('data-stop-shape')).toBe('filled-black-diamond');
  });
});
