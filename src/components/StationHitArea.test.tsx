import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StationHitArea } from './StationHitArea';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { Line, LineId, Station, StationId } from '../model/types';

// The label-edit fork: while a station is the SOLE selection, its label rect
// becomes the label's own handle. This must keep working on LOCKED stations —
// lock protects against canvas drags of the STATION, while label-layout edits
// stay allowed (inspector parity) — and its reachability now depends on the
// locked-and-selected station staying hit-testable (click-through only
// applies while unselected).

const lines: Record<string, Line> = {
  L1: makeLine({ id: 'L1' as LineId, stations: ['S'] as StationId[] }),
};

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    toolMode: 'arrow',
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
    editingStationId: null,
    labelSelected: false,
  });
});

function renderHitArea(station: Station) {
  return render(
    <svg>
      <StationHitArea
        station={station}
        lines={lines}
        onStartDrag={vi.fn()}
        onStartLabelDrag={vi.fn()}
      />
    </svg>,
  ).container;
}

const rects = (c: HTMLElement) => c.querySelectorAll('g[data-station-id="S"] rect');

describe('<StationHitArea /> — locked, sole-selected station keeps the label-edit fork', () => {
  const locked = () => ({
    ...stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
    locked: true,
  });

  it('both hit rects stay live while the locked station is selected', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['S' as StationId] });
    const c = renderHitArea(locked());
    const [cells, label] = Array.from(rects(c));
    expect(cells.getAttribute('pointer-events')).toBe('all');
    expect(label.getAttribute('pointer-events')).toBe('all');
  });

  it('a plain click on the label rect arms the label sub-selection (fork active despite lock)', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['S' as StationId] });
    const c = renderHitArea(locked());
    const label = Array.from(rects(c))[1];
    fireEvent.click(label, { button: 0 });
    expect(useSelection.getState().labelSelected).toBe(true);
  });

  it('an unselected locked station renders both rects hitless (click-through)', () => {
    const c = renderHitArea(locked());
    const [cells, label] = Array.from(rects(c));
    expect(cells.getAttribute('pointer-events')).toBe('none');
    expect(label.getAttribute('pointer-events')).toBe('none');
  });
});
