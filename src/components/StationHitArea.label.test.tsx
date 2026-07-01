import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { StationHitArea } from './StationHitArea';
import { useDoc, useSelection, dragState } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeStation, makeStop, makeLine } from '../test/fixtures';

// The label hit rect is the SECOND rect (cells AABB first, label second).
const labelRect = (container: HTMLElement) => container.querySelectorAll('rect')[1] as SVGElement;
const cellsRect = (container: HTMLElement) => container.querySelectorAll('rect')[0] as SVGElement;

const seed = (over: Record<string, unknown> = {}) => {
  useDoc.setState({
    ...DEFAULT_DOC,
    ...makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', stations: ['a'] })],
    }),
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: ['a'],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
    selectedStopLineId: null,
    labelSelected: false,
    editingStationId: null,
    uiMode: { kind: 'idle' },
    toolMode: 'arrow',
    spaceHeld: false,
    ...over,
  });
};

const renderHitArea = () => {
  const onStartDrag = vi.fn();
  const onStartLabelDrag = vi.fn();
  const station = useDoc.getState().stations.a;
  const lines = useDoc.getState().lines;
  const { container } = render(
    <svg>
      <StationHitArea
        station={station}
        lines={lines}
        onStartDrag={onStartDrag}
        onStartLabelDrag={onStartLabelDrag}
      />
    </svg>,
  );
  return { container, onStartDrag, onStartLabelDrag };
};

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  dragState.suppressClick = false;
});

describe('StationHitArea — label drag fork (sole-selected station)', () => {
  it('pointerdown on the label rect starts a LABEL drag, not a station drag', () => {
    seed();
    const { container, onStartDrag, onStartLabelDrag } = renderHitArea();
    fireEvent.pointerDown(labelRect(container), { button: 0 });
    expect(onStartLabelDrag).toHaveBeenCalledTimes(1);
    expect(onStartLabelDrag.mock.calls[0][0]).toBe('a');
    expect(onStartDrag).not.toHaveBeenCalled();
  });

  it('pointerdown on the cells rect still drags the station', () => {
    seed();
    const { container, onStartDrag, onStartLabelDrag } = renderHitArea();
    fireEvent.pointerDown(cellsRect(container), { button: 0 });
    expect(onStartDrag).toHaveBeenCalledTimes(1);
    expect(onStartLabelDrag).not.toHaveBeenCalled();
  });

  it('an UNselected (or co-selected) station keeps the station drag on its name', () => {
    seed({ selectedStationIds: ['a', 'other'] });
    const { container, onStartDrag, onStartLabelDrag } = renderHitArea();
    fireEvent.pointerDown(labelRect(container), { button: 0 });
    expect(onStartDrag).toHaveBeenCalledTimes(1);
    expect(onStartLabelDrag).not.toHaveBeenCalled();
  });

  it('right-click on the armed label rect rotates the LABEL, not the station', () => {
    seed();
    const { container } = renderHitArea();
    fireEvent.contextMenu(labelRect(container));
    const st = useDoc.getState().stations.a;
    expect(st.label.rotation).toBe(1);
    expect(st.rotation).toBe(0);
  });

  it('click on the armed label rect selects the label sub-selection', () => {
    seed();
    const { container } = renderHitArea();
    fireEvent.click(labelRect(container));
    expect(useSelection.getState().labelSelected).toBe(true);
  });

  it('double-click on the armed label rect still opens the rename editor', () => {
    seed();
    const { container } = renderHitArea();
    fireEvent.doubleClick(labelRect(container));
    expect(useSelection.getState().editingStationId).toBe('a');
  });

  it('the fork is disabled in hand mode (press falls through to pan)', () => {
    seed({ toolMode: 'hand' });
    const { container, onStartDrag, onStartLabelDrag } = renderHitArea();
    fireEvent.pointerDown(labelRect(container), { button: 0 });
    expect(onStartDrag).not.toHaveBeenCalled();
    expect(onStartLabelDrag).not.toHaveBeenCalled();
  });

  it('the fork is disabled while renaming this station', () => {
    seed({ editingStationId: 'a' });
    const { container, onStartDrag, onStartLabelDrag } = renderHitArea();
    fireEvent.pointerDown(labelRect(container), { button: 0 });
    expect(onStartLabelDrag).not.toHaveBeenCalled();
    expect(onStartDrag).toHaveBeenCalledTimes(1);
  });
});

describe('StationHitArea — modifier clicks keep station-selection semantics', () => {
  it('shift-click on the armed label rect toggles the station selection, not the label', () => {
    seed();
    const { container } = renderHitArea();
    fireEvent.click(labelRect(container), { shiftKey: true });
    // Shift-click = toggle membership: the sole-selected station deselects.
    expect(useSelection.getState().selectedStationIds).toEqual([]);
    expect(useSelection.getState().labelSelected).toBe(false);
  });
});
