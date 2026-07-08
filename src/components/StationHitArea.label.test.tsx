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
  const station = useDoc.getState().stations.a;
  const lines = useDoc.getState().lines;
  const { container } = render(
    <svg>
      <StationHitArea station={station} lines={lines} onStartDrag={onStartDrag} />
    </svg>,
  );
  return { container, onStartDrag };
};

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  dragState.suppressClick = false;
});

// The label rect is NOT a special "label handle" — grabbing a selected
// station anywhere on its footprint, name included, drags the whole STATION.
// Label layout is edited in the station-layout editor, not on the main canvas.
describe('StationHitArea — the name rect drags the station', () => {
  it('pointerdown on the label rect starts a STATION drag', () => {
    seed();
    const { container, onStartDrag } = renderHitArea();
    fireEvent.pointerDown(labelRect(container), { button: 0 });
    expect(onStartDrag).toHaveBeenCalledTimes(1);
    expect(onStartDrag.mock.calls[0][0]).toBe('a');
  });

  it('pointerdown on the cells rect also drags the station', () => {
    seed();
    const { container, onStartDrag } = renderHitArea();
    fireEvent.pointerDown(cellsRect(container), { button: 0 });
    expect(onStartDrag).toHaveBeenCalledTimes(1);
    expect(onStartDrag.mock.calls[0][0]).toBe('a');
  });

  it('right-click on the label rect rotates the STATION, not the label', () => {
    seed();
    const { container } = renderHitArea();
    fireEvent.contextMenu(labelRect(container));
    const st = useDoc.getState().stations.a;
    expect(st.rotation).toBe(1);
    expect(st.label.rotation).toBe(0);
  });

  it('a plain click on the label rect selects the station (no label sub-selection)', () => {
    seed({ selectedStationIds: [] });
    const { container } = renderHitArea();
    fireEvent.click(labelRect(container), { button: 0 });
    expect(useSelection.getState().selectedStationIds).toEqual(['a']);
    expect(useSelection.getState().labelSelected).toBe(false);
  });

  it('double-click on the label rect opens the rename editor', () => {
    seed();
    const { container } = renderHitArea();
    fireEvent.doubleClick(labelRect(container));
    expect(useSelection.getState().editingStationId).toBe('a');
  });

  it('the name rect falls through to pan in hand mode', () => {
    seed({ toolMode: 'hand' });
    const { container, onStartDrag } = renderHitArea();
    fireEvent.pointerDown(labelRect(container), { button: 0 });
    expect(onStartDrag).not.toHaveBeenCalled();
  });
});
