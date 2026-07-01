import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { StationLayoutEditor } from './StationLayoutEditor';
import { useDoc, useSelection, dragState } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import type { Station } from '../../model/types';

const hubStation = (): Station => ({
  id: 'a',
  name: 'A',
  x: 100,
  y: 100,
  rotation: 0,
  stops: [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
    { lineId: 'L2', row: 0, col: 1, orientation: 'auto-vertical' },
  ],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
});

const seed = () => {
  useDoc.setState({
    ...DEFAULT_DOC,
    stations: { a: hubStation() },
    lines: {
      L1: { id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] },
      L2: { id: 'L2', service: '2', name: '2 line', color: '#222222', stations: ['a'] },
    },
    lineOrder: ['L1', 'L2'],
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: ['a'],
    uiMode: { kind: 'editing-station-layout', stationId: 'a' },
    selectedStopLineId: null,
    labelSelected: false,
    mirrorMatching: false,
    toolMode: 'arrow',
    spaceHeld: false,
  });
};

const renderEditor = () => {
  const onStartNodeDrag = vi.fn();
  const station = useDoc.getState().stations.a;
  const lines = useDoc.getState().lines;
  const { container } = render(
    <svg>
      <StationLayoutEditor
        station={station}
        lines={lines}
        zoom={1}
        onStartNodeDrag={onStartNodeDrag}
        swapTarget={null}
      />
    </svg>,
  );
  return { container, onStartNodeDrag };
};

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  dragState.suppressClick = false;
});

describe('<StationLayoutEditor />', () => {
  it('renders a grab handle per stop and one for the label, with cell metadata', () => {
    seed();
    const { container } = renderEditor();
    const stops = container.querySelectorAll('[data-cell-kind="stop"]');
    expect(stops).toHaveLength(2);
    expect(container.querySelectorAll('[data-cell-kind="label"]')).toHaveLength(1);
    const l2 = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]');
    expect(l2?.getAttribute('data-cell-col')).toBe('1');
  });

  it('pointerdown on a stop handle starts a node drag with that source', () => {
    seed();
    const { container, onStartNodeDrag } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]') as Element;
    fireEvent.pointerDown(l1, { button: 0 });
    expect(onStartNodeDrag).toHaveBeenCalledTimes(1);
    expect(onStartNodeDrag.mock.calls[0][0]).toBe('a');
    expect(onStartNodeDrag.mock.calls[0][1]).toEqual({ kind: 'stop', lineId: 'L1' });
  });

  it('right-click on a stop handle selects it and cycles its orientation — not the station', () => {
    seed();
    const { container } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]') as Element;
    fireEvent.contextMenu(l1);
    const st = useDoc.getState().stations.a;
    expect(st.stops.find((s) => s.lineId === 'L1')!.orientation).toBe('auto-ne-sw');
    expect(st.rotation).toBe(0);
    expect(useSelection.getState().selectedStopLineId).toBe('L1');
  });

  it('right-click on the label handle rotates the label', () => {
    seed();
    const { container } = renderEditor();
    const label = container.querySelector('[data-cell-kind="label"]') as Element;
    fireEvent.contextMenu(label);
    expect(useDoc.getState().stations.a.label.rotation).toBe(1);
  });

  it('the shield swallows clicks (clears the sub-selection, never rotates the station)', () => {
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L1' });
    const { container } = renderEditor();
    const shield = container.querySelector('[data-layout-shield]') as Element;
    expect(shield).not.toBeNull();
    fireEvent.contextMenu(shield);
    expect(useDoc.getState().stations.a.rotation).toBe(0);
    fireEvent.click(shield);
    expect(useSelection.getState().selectedStopLineId).toBeNull();
  });

  it('marks the selected stop handle', () => {
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L2' });
    const { container } = renderEditor();
    const l2 = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]');
    expect(l2?.getAttribute('data-selected')).toBe('true');
  });
});
