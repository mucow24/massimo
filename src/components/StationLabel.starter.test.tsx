import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from '../components/StationView';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, Station } from '../model/types';
import { LINE_HEIGHT } from '../geometry/textMeasure';

type LabelLayer = 'label' | 'highlight-label' | 'starter-label';

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
  useViewportStore.setState({ showWaypoints: false, showNetwork: true });
});

function renderLabel(station: Station, lines: Record<string, Line>, layer: LabelLayer) {
  const { container } = render(
    <svg>
      <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer={layer} />
    </svg>,
  );
  return container.querySelector('svg')!;
}

// A station whose name typography is NOT the LABEL_* default: 24px, two lines.
const bigStation = () =>
  makeStation({
    id: 's1',
    name: 'Union\nSquare',
    fontSize: 24,
    stops: [makeStop('L1')],
  });
const lines = () => ({ L1: makeLine({ id: 'L1', stations: ['s1'] }) });

describe('Edit Stops starter label honors the station’s own font size', () => {
  it('paints the armed append-cursor station name at its stored fontSize (24), not the 12px default', () => {
    const svg = renderLabel(bigStation(), lines(), 'starter-label');
    const text = svg.querySelector('text')!;
    expect(text.textContent).toContain('Union');
    expect(Number(text.getAttribute('font-size'))).toBe(24);
  });

  it('stacks the starter label’s lines at the same pitch as the normal label (layout was computed at 24)', () => {
    const starter = renderLabel(bigStation(), lines(), 'starter-label');
    const secondLineDy = Number(starter.querySelectorAll('tspan')[1].getAttribute('dy'));
    // renderStationLabelText stacks lines at fontSize * LINE_HEIGHT * leading,
    // and labelLayoutLocal placed the block's anchor assuming that same pitch.
    expect(secondLineDy).toBeCloseTo(24 * LINE_HEIGHT, 6);
  });

  it('renders the same text geometry as the highlight pass (only fill/weight/stroke differ)', () => {
    const starter = renderLabel(bigStation(), lines(), 'starter-label').querySelector('text')!;
    const highlight = renderLabel(bigStation(), lines(), 'highlight-label').querySelector('text')!;
    expect(starter.getAttribute('font-size')).toBe(highlight.getAttribute('font-size'));
    expect(starter.getAttribute('y')).toBe(highlight.getAttribute('y'));
  });
});
