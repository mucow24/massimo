import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LayerNumberLabels } from './LayerNumberLabels';
import type { SegmentBandSpec } from '../../geometry/interlining';
import type { Line, LineId } from '../../model/types';
import { makeLine } from '../../test/fixtures';

const makeBand = (lineIds: string[], color = '#EF374B'): SegmentBandSpec => {
  const lines = lineIds.map((id) => ({ id, color, style: 'solid' as const }));
  return {
    pairKey: 's1|s2',
    bandKey: `s1|s2#${lineIds.slice().sort().join(',')}`,
    fromId: 's1',
    toId: 's2',
    lines,
    paths: lineIds.map(() => 'M0,0 L100,0'),
    warning: false,
    centerline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    radius: 24,
    linePriorities: lineIds.map((_, i) => i),
  };
};

const renderLabels = (
  bands: SegmentBandSpec[],
  lines: Record<LineId, Line>,
  hovered: { bandKey: string; lineId: string } | null = null,
) =>
  render(
    <svg>
      <LayerNumberLabels bands={bands} lines={lines} hovered={hovered} />
    </svg>,
  );

describe('<LayerNumberLabels>', () => {
  it('renders no labels when every incident segment is at layer 0 (and nothing hovered)', () => {
    const band = makeBand(['A']);
    const lines = { A: makeLine({ id: 'A' }) };
    const { container } = renderLabels([band], lines);
    expect(container.querySelectorAll('[data-layer-number]').length).toBe(0);
  });

  it('renders a label for any stripe whose segment layer is non-zero', () => {
    const band = makeBand(['A']);
    const lines = {
      A: makeLine({ id: 'A', segmentLayers: { 's1|s2': 2 } }),
    };
    const { container } = renderLabels([band], lines);
    const labels = container.querySelectorAll('[data-layer-number]');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toBe('+2');
    expect(labels[0].getAttribute('data-layer')).toBe('2');
  });

  it('formats negative layers with a leading minus sign', () => {
    const band = makeBand(['A']);
    const lines = {
      A: makeLine({ id: 'A', segmentLayers: { 's1|s2': -3 } }),
    };
    const { container } = renderLabels([band], lines);
    expect(container.querySelector('[data-layer-number]')?.textContent).toBe('-3');
  });

  it('renders 0 for the hovered stripe even when its layer is 0', () => {
    const band = makeBand(['A']);
    const lines = { A: makeLine({ id: 'A' }) };
    const { container } = renderLabels([band], lines, { bandKey: band.bandKey, lineId: 'A' });
    const labels = container.querySelectorAll('[data-layer-number]');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toBe('0');
  });

  it('renders only the hovered + non-zero labels in a multi-stripe band', () => {
    const band = makeBand(['A', 'B', 'C']);
    const lines = {
      A: makeLine({ id: 'A' }), // layer 0, not hovered → skip
      B: makeLine({ id: 'B', segmentLayers: { 's1|s2': 1 } }), // non-zero → render
      C: makeLine({ id: 'C' }), // layer 0, hovered → render
    };
    const { container } = renderLabels([band], lines, { bandKey: band.bandKey, lineId: 'C' });
    const labels = container.querySelectorAll('[data-layer-number]');
    expect(labels.length).toBe(2);
    const renderedFor = Array.from(labels).map((el) => el.getAttribute('data-line-id'));
    expect(renderedFor).toEqual(expect.arrayContaining(['B', 'C']));
    expect(renderedFor).not.toContain('A');
  });

  it('picks a legible fill against the line color (white on dark, black on light)', () => {
    const darkBand = makeBand(['A'], '#000000');
    const lightBand = makeBand(['B'], '#ffffff');
    lightBand.pairKey = 's3|s4';
    lightBand.bandKey = `s3|s4#B`;
    const lines = {
      A: makeLine({ id: 'A', segmentLayers: { 's1|s2': 1 } }),
      B: makeLine({ id: 'B', segmentLayers: { 's3|s4': 1 } }),
    };
    const { container } = renderLabels([darkBand, lightBand], lines);
    const labels = container.querySelectorAll('[data-layer-number]');
    const byLine: Record<string, Element> = {};
    for (const el of labels) {
      byLine[el.getAttribute('data-line-id')!] = el;
    }
    expect(byLine.A.getAttribute('fill')).toBe('#fff'); // white on black
    expect(byLine.B.getAttribute('fill')).toBe('#000'); // black on white
  });

  it('skips labels for stripes whose line is missing from the lines dict', () => {
    const band = makeBand(['ghost']);
    const { container } = renderLabels([band], {}); // empty lines dict
    expect(container.querySelectorAll('[data-layer-number]').length).toBe(0);
  });

  it('shifts the label away from a higher-priority crossing that covers the midpoint', () => {
    // Vertical target band y=0→100 at x=0, painted BEHIND a horizontal
    // crossing band that hides the midpoint. The label should not land on
    // the centerline midpoint (0, 50); a t-search should pick a clearer
    // spot. Asserted as |y - 50| > 0 (i.e. not the midpoint) rather than
    // an exact value, so the assertion survives any future tweaks to the
    // candidate-t set inside pickLayerLabelT.
    const target: SegmentBandSpec = {
      pairKey: 's1|s2',
      bandKey: 'V',
      fromId: 's1',
      toId: 's2',
      lines: [{ id: 'A', color: '#000000', style: 'solid' }],
      paths: ['M0,0 L0,100'],
      warning: false,
      centerline: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      radius: 24,
      linePriorities: [10], // target painted BEHIND
    };
    const crossing: SegmentBandSpec = {
      pairKey: 's3|s4',
      bandKey: 'H',
      fromId: 's3',
      toId: 's4',
      lines: [{ id: 'B', color: '#000000', style: 'solid' }],
      paths: ['M-50,50 L50,50'],
      warning: false,
      centerline: [
        { x: -50, y: 50 },
        { x: 50, y: 50 },
      ],
      radius: 24,
      linePriorities: [0], // crossing painted IN FRONT (covers midpoint)
    };
    const lines = {
      A: makeLine({ id: 'A', segmentLayers: { 's1|s2': -1 } }),
      B: makeLine({ id: 'B' }),
    };
    const { container } = renderLabels([target, crossing], lines);
    const label = container.querySelector('[data-line-id="A"]') as SVGTextElement | null;
    expect(label).not.toBeNull();
    const y = Number(label!.getAttribute('y'));
    expect(Math.abs(y - 50)).toBeGreaterThan(0);
  });
});
