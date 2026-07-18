import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StationHitArea } from './StationHitArea';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { Line, LineId, Station, StationId } from '../model/types';

// A locked station must stay reachable while it's SELECTED — lock protects
// against canvas drags of the station (enforced downstream), but the popover /
// unlock toggle stay reachable, so both hit rects (cells + name) keep catching
// pointer events. Click-through only applies while the locked station is
// UNselected.

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
  const onStartDrag = vi.fn();
  const container = render(
    <svg>
      <StationHitArea station={station} lines={lines} onStartDrag={onStartDrag} />
    </svg>,
  ).container;
  return { container, onStartDrag };
}

const rects = (c: HTMLElement) => c.querySelectorAll('g[data-station-id="S"] rect');

describe('<StationHitArea /> — a locked, sole-selected station stays reachable', () => {
  const locked = () => ({
    ...stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
    locked: true,
  });

  it('both hit rects stay live while the locked station is selected', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['S' as StationId] });
    const { container } = renderHitArea(locked());
    const [cells, label] = Array.from(rects(container));
    expect(cells.getAttribute('pointer-events')).toBe('all');
    expect(label.getAttribute('pointer-events')).toBe('all');
  });

  it('a pointerdown on the name rect routes to the station handle (reachable despite lock)', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['S' as StationId] });
    const { container, onStartDrag } = renderHitArea(locked());
    const label = Array.from(rects(container))[1];
    fireEvent.pointerDown(label, { button: 0 });
    expect(onStartDrag).toHaveBeenCalledTimes(1);
    expect(onStartDrag.mock.calls[0][0]).toBe('S');
  });

  it('an unselected locked station renders both rects hitless (click-through)', () => {
    const { container } = renderHitArea(locked());
    const [cells, label] = Array.from(rects(container));
    expect(cells.getAttribute('pointer-events')).toBe('none');
    expect(label.getAttribute('pointer-events')).toBe('none');
  });

  it('stays click-through while another station is layout-edited (click exits, not retargets)', () => {
    // In editing-station-layout mode a click on a locked station must fall
    // through to the canvas (exiting the mode) — a live hit rect would route
    // to selectStation, whose layoutEditReconcile RETARGETS the editor onto
    // the locked station instead of exiting.
    useSelection.setState({
      ...useSelection.getState(),
      uiMode: { kind: 'editing-station-layout', stationId: 'OTHER' as StationId },
      selectedStationIds: ['OTHER' as StationId],
    });
    const { container } = renderHitArea(locked());
    const [cells, label] = Array.from(rects(container));
    expect(cells.getAttribute('pointer-events')).toBe('none');
    expect(label.getAttribute('pointer-events')).toBe('none');
  });
});
