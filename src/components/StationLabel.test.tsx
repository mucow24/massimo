import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLabel, makeLine, makeStation, makeStop } from '../test/fixtures';

// A station's name is painted by THREE passes — the normal `label` pass, the
// `highlight-label` pass above the line-edit dim, and the Edit Stops
// `starter-label` — and they differ ONLY in paint (fill, size, weight, stroke).
// The positioning is one shared derivation, because a pass that drifted would
// print the same name twice in two places: the dim overlay is drawn OVER the
// normal pass, so any disagreement shows up as a visibly doubled label. These
// tests pin that agreement.

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
// one would land somewhere else.
const skewed = () =>
  makeStation({
    id: 's1',
    name: 'Union Square',
    x: 137,
    y: -84,
    rotation: 1,
    stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
    label: makeLabel({ row: -1, col: 2, rotation: 1 }),
  });

const lines = () => ({ L1: makeLine({ id: 'L1', service: 'A', stations: ['s1'] }) });

// The geometry every pass must agree on: the label group's rotation plus the
// <text> anchor and its baseline/anchoring mode.
const paintedGeometry = (layer: 'label' | 'highlight-label' | 'starter-label') => {
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
  };
};

// The station's own typography, as the <text> actually carries it. Separate
// from paintedGeometry because italic changes no anchor or baseline — it is a
// pure paint attribute, so a pass that dropped it would still match on
// geometry and print the name in the wrong face.
const paintedFace = (layer: 'label' | 'highlight-label' | 'starter-label') => {
  const { container } = render(
    <svg>
      <StationView
        station={{ ...skewed(), italic: true }}
        lines={lines()}
        zoom={1}
        onStartDrag={vi.fn()}
        layer={layer}
        highlightColor="#cc0000"
      />
    </svg>,
  );
  const text = container.querySelector('text');
  if (!text) throw new Error(`no label painted for ${layer}`);
  return text.getAttribute('font-style');
};

describe('station label passes — one shared positioning derivation', () => {
  it('paints the highlight pass at exactly the normal pass geometry', () => {
    expect(paintedGeometry('highlight-label')).toEqual(paintedGeometry('label'));
  });

  // An italic station is italic in every pass. The layout each pass measures
  // is computed WITH the italic metrics, so a pass painting upright text is
  // both the wrong face and glyphs that no longer fill the box reserved for
  // them. Weight is the one deliberate per-pass difference (the starter is
  // always bold); the face is not.
  it('paints an italic station italic in all three passes', () => {
    expect(paintedFace('label')).toBe('italic');
    expect(paintedFace('highlight-label')).toBe('italic');
    expect(paintedFace('starter-label')).toBe('italic');
  });

  it('paints the starter pass at exactly the normal pass geometry too', () => {
    // Since #346 the starter pass also honors the station's own font size, so
    // nothing about WHERE it paints differs any more — only fill, weight, and
    // the contrast stroke.
    expect(paintedGeometry('starter-label')).toEqual(paintedGeometry('label'));
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
