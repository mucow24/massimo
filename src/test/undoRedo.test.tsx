import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('undo/redo', () => {
  it('undoes addStation', () => {
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
    useDoc.temporal.getState().undo();
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
  });

  it('redoes after undo', () => {
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    useDoc.temporal.getState().undo();
    useDoc.temporal.getState().redo();
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
  });

  it('does NOT capture viewport in history', () => {
    useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    useViewportStore.getState().setViewport({ x: 50, y: 50, zoom: 2 });
    useDoc.temporal.getState().undo();
    // Viewport unchanged by undoing the station add.
    expect(useViewportStore.getState().zoom).toBe(2);
    expect(useViewportStore.getState().x).toBe(50);
  });

  it('does NOT capture selection in history', () => {
    const { addStation } = useDoc.getState();
    const id = addStation(0, 0);
    useSelection.getState().selectStation(id);
    expect(useSelection.getState().selectedStationId).toBe(id);
    useDoc.temporal.getState().undo();
    // Station gone, but selection store is independent.
    expect(useSelection.getState().selectedStationId).toBe(id);
  });
});
