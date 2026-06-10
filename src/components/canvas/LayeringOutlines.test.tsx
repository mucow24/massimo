import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LayeringDashedOutlines, LayeringHoverOutline } from './LayeringOutlines';
import type { SegmentBandSpec } from '../../geometry/interlining';
import type { Line, LineId } from '../../model/types';
import { makeBandSpec, makeLine } from '../../test/fixtures';

const makeBand = (lineIds: string[]): SegmentBandSpec => makeBandSpec(lineIds);

const renderDashed = (
  bands: SegmentBandSpec[],
  hovered: { bandKey: string; lineId: string } | null = null,
  lines: Record<LineId, Line> = {},
) =>
  render(
    <svg>
      <LayeringDashedOutlines bands={bands} lines={lines} hovered={hovered} />
    </svg>,
  );

const renderHover = (
  bands: SegmentBandSpec[],
  hovered: { bandKey: string; lineId: string } | null,
  lines: Record<LineId, Line> = {},
) =>
  render(
    <svg>
      <LayeringHoverOutline bands={bands} lines={lines} hovered={hovered} />
    </svg>,
  );

describe('<LayeringDashedOutlines>', () => {
  // All three cases test the same group-count behaviour: a stripe present in
  // bands gets a dashed group unless it's the hovered one (which paints via
  // LayeringHoverOutline). Parametrize so the table makes the rule obvious.
  it.each([
    { label: 'one group per stripe when nothing is hovered', bands: [['A', 'B']], expected: 2 },
    { label: 'no groups for an empty band list', bands: [], expected: 0 },
    { label: 'skips the hovered stripe', bands: [['A', 'B']], hovered: 'A', expected: 1 },
  ])('$label', ({ bands, hovered, expected }) => {
    const bandSpecs = (bands as string[][]).map((ids) => makeBand(ids));
    const hoveredSpec =
      hovered && bandSpecs[0] ? { bandKey: bandSpecs[0].bandKey, lineId: hovered } : null;
    const { container } = renderDashed(bandSpecs, hoveredSpec);
    const groups = container.querySelectorAll('[data-layering-outline]');
    expect(groups.length).toBe(expected);
    if (hovered) {
      // The remaining stripe should be the non-hovered one.
      const remaining = Array.from(groups).map((g) => g.getAttribute('data-line-id'));
      expect(remaining).not.toContain(hovered);
    }
  });

  it('dashed groups carry the expected stroke attributes', () => {
    const { container } = renderDashed([makeBand(['A'])]);
    const g = container.querySelector('[data-layering-outline]')!;
    expect(g.getAttribute('stroke')).toBe('#000');
    expect(g.getAttribute('stroke-width')).toBe('1.5');
    expect(g.getAttribute('stroke-opacity')).toBe('0.2');
    expect(g.getAttribute('stroke-dasharray')).toBe('4 2');
    // Two long edges + two cap lines per stripe.
    expect(g.querySelectorAll('path').length).toBe(2);
    expect(g.querySelectorAll('line').length).toBe(2);
  });

  it('skips the hovered stripe (it paints via LayeringHoverOutline instead)', () => {
    const band = makeBand(['A', 'B']);
    const { container } = renderDashed([band], { bandKey: band.bandKey, lineId: 'A' });
    const groups = container.querySelectorAll('[data-layering-outline]');
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute('data-line-id')).toBe('B');
  });

  it('shifts the cap line outward at a "win" endpoint (full dot enclosed)', () => {
    // Three-station vertical line with a layered middle segment. At s2 the
    // line has one layer-(-1) adjacency (s1|s2, the band we're outlining)
    // and one layer-0 adjacency (s2|s3) — the layered side wins the dot.
    // We render only the s1|s2 band so the dashed-cap at s2 should slide
    // outward (in band-coords: along the centerline tangent at vN1) by
    // STOP_SIZE/2 = 7.
    const band: SegmentBandSpec = makeBandSpec(['A'], {
      paths: ['M0,0 L0,100'],
      centerline: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
    });
    const lines: Record<LineId, Line> = {
      A: makeLine({
        id: 'A',
        stations: ['s1', 's2', 's3'],
        segmentLayers: { 's1|s2': -1 },
      }),
    };
    const { container } = renderDashed([band], null, lines);
    const lineEls = container.querySelector('[data-layering-outline]')!.querySelectorAll('line');
    // capStart is the s1 terminus (no other adjacency) — terminus = win,
    // outline extends OUTWARD past v0=(0,0) → y=-7.
    expect(Number(lineEls[0].getAttribute('y1'))).toBeCloseTo(-7, 5);
    // capEnd is at s2, layered-vs-0 → win, outline extends past v1=(0,100)
    // → y=107.
    expect(Number(lineEls[1].getAttribute('y1'))).toBeCloseTo(107, 5);
  });

  it('scales the win/lose cap shift to the stripe’s own width', () => {
    // Same win/win setup as above but on a width-28 line: the dot square is
    // 28×28, so the cap must slide a full 14 (not the default 7) to enclose
    // it.
    const band: SegmentBandSpec = makeBandSpec(['A'], {
      stripeWidths: [28],
      paths: ['M0,0 L0,100'],
      centerline: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
    });
    const lines: Record<LineId, Line> = {
      A: makeLine({
        id: 'A',
        stations: ['s1', 's2', 's3'],
        width: 28,
        segmentLayers: { 's1|s2': -1 },
      }),
    };
    const { container } = renderDashed([band], null, lines);
    const lineEls = container.querySelector('[data-layering-outline]')!.querySelectorAll('line');
    expect(Number(lineEls[0].getAttribute('y1'))).toBeCloseTo(-14, 5);
    expect(Number(lineEls[1].getAttribute('y1'))).toBeCloseTo(114, 5);
  });
});

describe('<LayeringHoverOutline>', () => {
  it('renders nothing when hovered is null', () => {
    const { container } = renderHover([makeBand(['A'])], null);
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });

  it('renders a 2px white halo and a 1px black stroke over the same closed path', () => {
    const band = makeBand(['A']);
    const { container } = renderHover([band], { bandKey: band.bandKey, lineId: 'A' });
    const hover = container.querySelector('[data-layering-hover-outline]')!;
    const paths = hover.querySelectorAll('path');
    expect(paths.length).toBe(2);
    const [halo, black] = paths;
    expect(halo.getAttribute('stroke')).toBe('#fff');
    expect(halo.getAttribute('stroke-width')).toBe('2');
    expect(black.getAttribute('stroke')).toBe('#000');
    expect(black.getAttribute('stroke-width')).toBe('1');
    // Same `d` for both layers — they trace the same closed perimeter.
    expect(halo.getAttribute('d')).toBe(black.getAttribute('d'));
    expect(halo.getAttribute('d')?.endsWith('Z')).toBe(true);
  });

  it('is a no-op when the hovered bandKey does not match any band', () => {
    const band = makeBand(['A']);
    const { container } = renderHover([band], { bandKey: 'nope', lineId: 'A' });
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });

  it('is a no-op when the hovered lineId is not in the matched band', () => {
    const band = makeBand(['A']);
    const { container } = renderHover([band], { bandKey: band.bandKey, lineId: 'ghost' });
    expect(container.querySelector('[data-layering-hover-outline]')).toBeNull();
  });
});
