import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LayerNumberLabels } from './LayerNumberLabels';
import type { SegmentBandSpec } from '../../geometry/interlining';
import type { Line, LineId } from '../../model/types';
import { makeBandSpec, makeLine } from '../../test/fixtures';
import * as placement from '../../geometry/layerLabelPlacement';

const makeBand = (lineIds: string[]): SegmentBandSpec => makeBandSpec(lineIds);

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
  // Cover the four presence/formatting cases at once: layer-0 stripes only
  // render when hovered, non-zero stripes always render, the formatter
  // signs both directions. Each row pins both the visible count and the
  // resulting text so a regression in either is caught.
  it.each([
    { label: 'layer 0, not hovered → no label', layer: 0, hover: false, count: 0, text: null },
    { label: 'layer +2, not hovered → +2', layer: 2, hover: false, count: 1, text: '+2' },
    { label: 'layer -3, not hovered → -3', layer: -3, hover: false, count: 1, text: '-3' },
    { label: 'layer 0, hovered → 0', layer: 0, hover: true, count: 1, text: '0' },
  ])('$label', ({ layer, hover, count, text }) => {
    const band = makeBand(['A']);
    const segmentLayers = layer !== 0 ? { 's1|s2': layer } : undefined;
    const lines = { A: makeLine({ id: 'A', segmentLayers }) };
    const { container } = renderLabels(
      [band],
      lines,
      hover ? { bandKey: band.bandKey, lineId: 'A' } : null,
    );
    const labels = container.querySelectorAll('[data-layer-number]');
    expect(labels.length).toBe(count);
    if (text !== null) {
      expect(labels[0].textContent).toBe(text);
      expect(labels[0].getAttribute('data-layer')).toBe(String(layer));
    }
  });

  it('places the label at the stripe’s baked offset in a mixed-width band', () => {
    // Widths [14, 28] → offsets ±10.5. The wide stripe (B, layer +1) must get
    // its label at |y| = 10.5 off the horizontal centerline — the legacy
    // stripeOffset(k, n) math would put it at ±7.
    const band = makeBandSpec(['A', 'B'], { stripeWidths: [14, 28] });
    const lines = {
      A: makeLine({ id: 'A' }),
      B: makeLine({ id: 'B', segmentLayers: { 's1|s2': 1 } }),
    };
    const { container } = renderLabels([band], lines);
    const label = container.querySelector('[data-line-id="B"]')!;
    expect(label).not.toBeNull();
    expect(Math.abs(Number(label.getAttribute('y')))).toBeCloseTo(10.5, 5);
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
    // Color drives the legible-text choice and now comes from the live lines
    // map (the spec is presentation-free), so the dark/light contrast lives
    // on the lines, not the band fixtures.
    const darkBand = makeBand(['A']);
    const lightBand = makeBand(['B']);
    lightBand.pairKey = 's3|s4';
    lightBand.bandKey = `s3|s4#B`;
    const lines = {
      A: makeLine({ id: 'A', color: '#000000', segmentLayers: { 's1|s2': 1 } }),
      B: makeLine({ id: 'B', color: '#ffffff', segmentLayers: { 's3|s4': 1 } }),
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
    const target: SegmentBandSpec = makeBandSpec(['A'], {
      bandKey: 'V',
      paths: ['M0,0 L0,100'],
      centerline: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      linePriorities: [10], // target painted BEHIND
    });
    const crossing: SegmentBandSpec = makeBandSpec(['B'], {
      pairKey: 's3|s4',
      bandKey: 'H',
      fromId: 's3',
      toId: 's4',
      paths: ['M-50,50 L50,50'],
      centerline: [
        { x: -50, y: 50 },
        { x: 50, y: 50 },
      ],
      linePriorities: [0], // crossing painted IN FRONT (covers midpoint)
    });
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

  it('memoizes pickLayerLabelT across rerenders with the same bands reference', () => {
    // Regression guard: the placement search is the bottleneck behind the
    // 300-500ms layer-click lag we shipped a fix for. The fix relies on
    // `LayerNumberLabels`'s tByKey useMemo holding when `bands` is the same
    // reference (which MapCanvas guarantees via the split bandsGeometry /
    // bands memos). If a future refactor drifts the deps onto `lines` or
    // anything that changes per layer cycle, this test catches it.
    const spy = vi.spyOn(placement, 'pickLayerLabelT');
    try {
      const bands = [makeBand(['A', 'B'])];
      const lines = {
        A: makeLine({ id: 'A', segmentLayers: { 's1|s2': 1 } }),
        B: makeLine({ id: 'B' }),
      };
      const { rerender } = render(
        <svg>
          <LayerNumberLabels bands={bands} lines={lines} hovered={null} />
        </svg>,
      );
      const firstRenderCalls = spy.mock.calls.length;
      expect(firstRenderCalls).toBeGreaterThan(0);

      // Same bands reference, same lines reference → both useMemo hits hold.
      rerender(
        <svg>
          <LayerNumberLabels bands={bands} lines={lines} hovered={null} />
        </svg>,
      );
      expect(spy.mock.calls.length).toBe(firstRenderCalls);

      // Even a hover change must not re-run the search — only the visible
      // stripe set changes; the t-table is shared.
      rerender(
        <svg>
          <LayerNumberLabels
            bands={bands}
            lines={lines}
            hovered={{ bandKey: bands[0].bandKey, lineId: 'B' }}
          />
        </svg>,
      );
      expect(spy.mock.calls.length).toBe(firstRenderCalls);
    } finally {
      spy.mockRestore();
    }
  });
});
