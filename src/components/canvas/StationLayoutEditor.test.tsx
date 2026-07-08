import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { StationLayoutEditor } from './StationLayoutEditor';
import { useDoc, useSelection, dragState } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
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

  it('paints each orientation arrow in whichever of black/white reads on the dot fill', () => {
    // The arrow sits on top of the stop dot, so its color must contrast the
    // dot's resolved fill — a fixed white arrow vanishes on white/light dots.
    useDoc.setState({
      ...DEFAULT_DOC,
      stations: { a: hubStation() },
      lines: {
        // White-filled dot ⇒ the arrow must flip to black.
        L1: {
          id: 'L1',
          service: '1',
          name: '1 line',
          color: '#ffffff',
          stations: ['a'],
          defaultDotStyle: DOT_SHAPE_PRESETS['filled-white'],
        },
        // Black-filled dot ⇒ white arrow.
        L2: { id: 'L2', service: '2', name: '2 line', color: '#111111', stations: ['a'] },
      },
      lineOrder: ['L1', 'L2'],
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['a'],
      uiMode: { kind: 'editing-station-layout', stationId: 'a' },
      selectedStopLineId: null,
      labelSelected: false,
      toolMode: 'arrow',
      spaceHeld: false,
    });
    const { container } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"] text');
    const l2 = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"] text');
    expect(l1?.getAttribute('fill')).toBe('#000');
    expect(l2?.getAttribute('fill')).toBe('#fff');
  });

  it('rotates the "L" glyph to match the label rotation', () => {
    seed();
    // Turn the label a quarter turn (rotation step 2 = 90°); the actual label
    // text rotates about its cell, so the "L" preview must too.
    useDoc.setState((s) => ({
      stations: {
        ...s.stations,
        a: { ...s.stations.a, label: { ...s.stations.a.label, rotation: 2 } },
      },
    }));
    const { container } = renderEditor();
    const labelText = container.querySelector('[data-cell-kind="label"] text') as Element;
    expect(labelText).not.toBeNull();
    // Cell center for row=0,col=-1 is (-14, 0); the glyph pivots there.
    expect(labelText.getAttribute('transform')).toBe('rotate(90 -14 0)');
  });
});

describe('<StationLayoutEditor /> — hand mode passes through', () => {
  it('handles and shield drop pointer events so drag-to-pan works', () => {
    seed();
    useSelection.setState({ ...useSelection.getState(), toolMode: 'hand' });
    const { container, onStartNodeDrag } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]') as Element;
    fireEvent.pointerDown(l1, { button: 0 });
    expect(onStartNodeDrag).not.toHaveBeenCalled();
    // The hit surfaces are pointer-transparent in hand mode.
    expect(l1.querySelector('circle')?.getAttribute('pointer-events')).toBe('none');
    const shield = container.querySelector('[data-layout-shield]') as Element;
    expect(shield.getAttribute('pointer-events')).toBe('none');
  });
});
