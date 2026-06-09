import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stub the actual file download (jsdom has no URL.createObjectURL / anchor
// download); keep the rest of the export module (getCanvasSvg, etc.) real.
vi.mock('../export/exportCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../export/exportCanvas')>();
  return { ...actual, downloadBlob: vi.fn() };
});

import { Toolbar } from './Toolbar';
import { downloadBlob } from '../export/exportCanvas';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    toolMode: 'arrow',
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    selectedLineId: null,
  });
  useViewportStore.setState({ x: 0, y: 0, zoom: 1, gridVisible: true, darkMode: false });
  vi.mocked(downloadBlob).mockClear();
});

describe('Toolbar — tool + view toggles', () => {
  it('switches to hand mode and back to arrow', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByTitle('Hand (H) — hold Space'));
    expect(useSelection.getState().toolMode).toBe('hand');
    await user.click(screen.getByTitle('Arrow (A)'));
    expect(useSelection.getState().toolMode).toBe('arrow');
  });

  it('toggles grid visibility', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByLabelText('Toggle grid'));
    expect(useViewportStore.getState().gridVisible).toBe(false);
  });

  it('toggles layering mode', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByLabelText('Toggle layering mode'));
    expect(useSelection.getState().uiMode.kind).toBe('layering');
  });

  it('toggles dark mode', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByLabelText('Toggle dark mode'));
    expect(useViewportStore.getState().darkMode).toBe(true);
  });

  it('resets the viewport', async () => {
    const user = userEvent.setup();
    useViewportStore.setState({ x: 100, y: 50, zoom: 3 });
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(useViewportStore.getState()).toMatchObject({ x: 0, y: 0, zoom: 1 });
  });
});

describe('Toolbar — Add menu', () => {
  it('Add → Stations enters placing-station mode', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Stations' }));
    expect(useSelection.getState().uiMode.kind).toBe('placing-station');
  });

  it('Add → Line creates a line and enters append mode', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Line' }));
    expect(Object.keys(useDoc.getState().lines).length).toBe(1);
    expect(useSelection.getState().uiMode.kind).toBe('appending-to-line');
  });
});

describe('Toolbar — Canvas menu', () => {
  it('Save serializes and triggers a download', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Save' }));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it('Clear wipes the document and selection', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['S'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
      stations: { S: stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
    });
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['S' as StationId] });
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Clear' }));
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
    expect(useSelection.getState().selectedStationIds).toHaveLength(0);
  });
});
