import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import { DOT_SHAPE_PRESETS } from '../model/dotStyle';
import type { Line, Station } from '../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    hoveredLineStop: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
  useDoc.setState({ darkMode: false });
});

// Black-stroked white dot: both a fill AND a stroke, so each dot contributes
// to both passes.
const STROKED = DOT_SHAPE_PRESETS['filled-white-black-stroke'];

function renderDots(station: Station, lines: Record<string, Line>) {
  const { container } = render(
    <svg>
      <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="dots" />
    </svg>,
  );
  return container.querySelector('svg')!;
}

// Role of each painted dot element in document (= paint) order: the stroke pass
// is tagged data-stop-stroke, the fill pass keeps the canonical data-stop-shape.
const dotRoles = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll('[data-stop-stroke], [data-stop-shape]')).map((el) =>
    el.hasAttribute('data-stop-stroke') ? 'stroke' : 'fill',
  );

describe('StationDots — strokes render before fills (one outer border on overlap)', () => {
  it('emits every dot stroke before every dot fill', () => {
    // Two stops one cell apart: their dots overlap once sizes grow, and their
    // borders must merge into a single outer outline rather than each fill
    // punching a hole in the neighbor's border.
    const station = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, dotStyle: STROKED }),
        makeStop('L2', { row: 1, col: 0, dotStyle: STROKED }),
      ],
    });
    const lines = {
      L1: makeLine({ id: 'L1', stations: ['s1'] }),
      L2: makeLine({ id: 'L2', stations: ['s1'] }),
    };
    expect(dotRoles(renderDots(station, lines))).toEqual(['stroke', 'stroke', 'fill', 'fill']);
  });

  it('a no-stroke dot contributes only a fill; stroked neighbors still draw their border first', () => {
    const station = makeStation({
      id: 's1',
      stops: [
        makeStop('L1', { row: 0, col: 0, dotStyle: STROKED }),
        makeStop('L2', { row: 1, col: 0, dotStyle: DOT_SHAPE_PRESETS['filled-black'] }),
      ],
    });
    const lines = {
      L1: makeLine({ id: 'L1', stations: ['s1'] }),
      L2: makeLine({ id: 'L2', stations: ['s1'] }),
    };
    const svg = renderDots(station, lines);
    expect(svg.querySelectorAll('[data-stop-stroke]').length).toBe(1);
    expect(svg.querySelectorAll('[data-stop-shape]').length).toBe(2);
    // The single stroke leads, before either fill.
    expect(dotRoles(svg)).toEqual(['stroke', 'fill', 'fill']);
  });

  it('keeps exactly one canonical seam element per dot (data-stop-station + data-stop-line)', () => {
    const station = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, dotStyle: STROKED })],
    });
    const svg = renderDots(station, { L1: makeLine({ id: 'L1', stations: ['s1'] }) });
    // The E2E seam stays one-per-dot on the fill pass; the stroke pass is not
    // matched by the station+line selector.
    expect(svg.querySelectorAll('[data-stop-station="s1"][data-stop-line="L1"]').length).toBe(1);
  });
});
