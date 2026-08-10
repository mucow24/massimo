import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLabel, makeLine, makeStation, makeStop } from '../test/fixtures';

// A station's name is painted by THREE passes — the normal `label` pass, the
// `highlight-label` pass above the line-edit dim, and the Edit Stops
// `starter-label`. They paint the same name in the same place, SET THE SAME
// WAY, and differ only in how it is inked (fill, stroke) plus the starter's
// deliberate always-bold weight override. Both the positioning and the
// typography are one shared derivation apiece, because a pass that drifted
// would print the same name twice in two places: the dim overlay is drawn OVER
// the normal pass, so any disagreement shows up as a visibly doubled label.
// These tests pin that agreement.

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
  useDoc.setState({ darkMode: false });
});

// An off-origin, rotated station with a rotated, offset label cell — every
// term of the positioning derivation is non-trivial, so a pass that dropped
// one would land somewhere else. Italic on purpose: the face is a pure paint
// attribute that moves no anchor or baseline, so a theme-blind upright fixture
// cannot tell a pass that forwards it from one that drops it.
const skewed = () =>
  makeStation({
    id: 's1',
    name: 'Union Square',
    x: 137,
    y: -84,
    rotation: 1,
    italic: true,
    stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
    label: makeLabel({ row: -1, col: 2, rotation: 1 }),
  });

const lines = () => ({ L1: makeLine({ id: 'L1', service: 'A', stations: ['s1'] }) });

// Everything every pass must agree on: the label group's rotation, the <text>
// anchor and its baseline/anchoring mode, and the station's own typography.
// Weight is deliberately NOT read — the starter's 700 is a legitimate per-pass
// override, and pinning it would forbid the one difference that is allowed.
const paintedShared = (layer: 'label' | 'highlight-label' | 'starter-label') => {
  const { container } = render(
    <svg>
      <StationView
        station={skewed()}
        lines={lines()}
        zoom={1}
        onStartDrag={vi.fn()}
        layer={layer}
        highlightColor="#cc0000"
      />
    </svg>,
  );
  const outer = container.querySelector('svg > g');
  const rotated = container.querySelector('svg > g > g');
  const text = container.querySelector('text');
  const tspan = container.querySelector('tspan');
  if (!outer || !rotated || !text || !tspan) throw new Error(`no label painted for ${layer}`);
  return {
    stationTransform: outer.getAttribute('transform'),
    labelRotation: rotated.getAttribute('transform'),
    x: text.getAttribute('x'),
    y: text.getAttribute('y'),
    textAnchor: text.getAttribute('text-anchor'),
    baseline: text.getAttribute('dominant-baseline'),
    tspanX: tspan.getAttribute('x'),
    tspanDy: tspan.getAttribute('dy'),
    fontSize: text.getAttribute('font-size'),
    fontStyle: text.getAttribute('font-style'),
  };
};

describe('station label passes — one shared derivation for place and face', () => {
  // Absolute anchor for the two cross-pass comparisons below. Without it they
  // could pass vacuously: three passes that ALL dropped the face would agree on
  // `null` and read as agreement.
  it('paints the fixture station in its own italic face', () => {
    expect(paintedShared('label').fontStyle).toBe('italic');
  });

  it('paints the highlight pass at exactly the normal pass geometry and face', () => {
    expect(paintedShared('highlight-label')).toEqual(paintedShared('label'));
  });

  it('paints the starter pass at exactly the normal pass geometry and face too', () => {
    // Since #346 the starter pass also honors the station's own font size, so
    // nothing about WHERE it paints differs any more — and nothing about how it
    // is SET either. Only the fill, the contrast stroke, and the deliberate
    // always-bold weight.
    expect(paintedShared('starter-label')).toEqual(paintedShared('label'));
  });

  it('paints the starter name bold in the line color, over a legible stroke', () => {
    const { container } = render(
      <svg>
        <StationView
          station={skewed()}
          lines={lines()}
          zoom={1}
          onStartDrag={vi.fn()}
          layer="starter-label"
          highlightColor="#cc0000"
        />
      </svg>,
    );
    const text = container.querySelector('text')!;
    expect(text.getAttribute('fill')).toBe('#cc0000');
    expect(text.getAttribute('font-weight')).toBe('700');
    // Legible against the line color it sits on — white on a dark red.
    expect(text.getAttribute('stroke')).toBe('#fff');
    expect(text.getAttribute('paint-order')).toBe('stroke');
  });

  it('paints the highlight name in the highlight color at the station size', () => {
    const { container } = render(
      <svg>
        <StationView
          station={skewed()}
          lines={lines()}
          zoom={1}
          onStartDrag={vi.fn()}
          layer="highlight-label"
          highlightColor="#ffffff"
        />
      </svg>,
    );
    const text = container.querySelector('text')!;
    expect(text.getAttribute('fill')).toBe('#ffffff');
    expect(text.getAttribute('stroke')).toBeNull();
  });
});
