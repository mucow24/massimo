import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stub only the export ENTRY POINTS. getCanvasSvg stays real, so the export runs
// against the live <App/> canvas and each test can inspect exactly what the
// pipeline would have serialized.
vi.mock('../export/exportCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../export/exportCanvas')>();
  return {
    ...actual,
    downloadBlob: vi.fn(),
    exportCanvasSvg: vi.fn(async () => {}),
  };
});

import App from '../App';
import { exportCanvasSvg } from '../export/exportCanvas';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makePolygon, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

const sizeProps = ['clientWidth', 'clientHeight'] as const;
const originals: Partial<Record<(typeof sizeProps)[number], PropertyDescriptor>> = {};
beforeEach(() => {
  for (const prop of sizeProps) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useViewportStore.setState({ x: 0, y: 0, zoom: 1, showNetwork: true });
  useSelection.setState({ selectedLineId: null, selectedStationIds: [], uiMode: { kind: 'idle' } });
  vi.mocked(exportCanvasSvg).mockClear();
});
afterEach(() => {
  for (const prop of sizeProps) {
    const d = originals[prop];
    if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

const seed = () =>
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          stationWithStop('s1' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
          stationWithStop('s2' as StationId, 'L1' as LineId, { x: 200, y: 0 }),
        ],
        lines: [makeLine({ id: 'L1' as LineId, stations: ['s1', 's2'] as StationId[] })],
        lineOrder: ['L1' as LineId],
        polygons: [makePolygon({ id: 'p1' })],
      }),
    });
  });

const exportSvg = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Canvas' }));
  await user.click(screen.getByRole('menuitem', { name: 'Export' }));
  // The leaf flyout is hover-driven; userEvent's pointer movement tears it down
  // before the click lands, so fire the click directly on the leaf.
  fireEvent.click(screen.getByRole('menuitem', { name: 'SVG' }));
  await waitFor(() => expect(exportCanvasSvg).toHaveBeenCalledTimes(1));
  return vi.mocked(exportCanvasSvg).mock.calls[0][0];
};

const liveStripes = () => document.querySelectorAll('[data-band-stripe]').length;

describe('Toolbar — export is independent of the lines/stations toggle', () => {
  it('exports the whole map while the network is hidden, and never disturbs the toggle', async () => {
    render(<App />);
    seed();
    act(() => {
      useViewportStore.getState().setShowNetwork(false);
    });
    // Precondition, so the assertions below can't pass vacuously: the live
    // canvas really is bare.
    expect(liveStripes()).toBe(0);

    const captured = await exportSvg();

    // Hiding is momentary working state, not a decision about the map's
    // content — the file gets everything, exactly as if the toggle were on.
    expect(captured.querySelectorAll('[data-band-stripe]').length).toBeGreaterThan(0);
    expect(captured.querySelectorAll('[data-station-id]').length).toBeGreaterThan(0);
    expect(captured.querySelectorAll('[data-polygon-id]').length).toBeGreaterThan(0);

    // ...and the toggle is exactly where the user left it. The capture is taken
    // from a detached snapshot inside ONE synchronous task, so the network is
    // never painted back — not even for the seconds a PDF export takes.
    expect(useViewportStore.getState().showNetwork).toBe(false);
    expect(liveStripes()).toBe(0);
  });

  it('exports the whole map when the network is shown (baseline)', async () => {
    render(<App />);
    seed();
    const captured = await exportSvg();
    expect(captured.querySelectorAll('[data-band-stripe]').length).toBeGreaterThan(0);
    expect(captured.querySelectorAll('[data-polygon-id]').length).toBeGreaterThan(0);
    expect(useViewportStore.getState().showNetwork).toBe(true);
  });

  it('keeps a selected line selected, and still captures it undesaturated', async () => {
    // Same contract as the toggle, and the reason the snapshot is taken
    // synchronously: a selected line desaturates the others on the live canvas,
    // so the capture drops the selection — but the user's selection must
    // survive, and must not visibly blink away during the async pipeline.
    render(<App />);
    seed();
    act(() => {
      useSelection.getState().selectLine('L1' as LineId);
    });
    const captured = await exportSvg();
    // No dim wash baked into the file: that's selection chrome, not the map.
    expect(captured.querySelectorAll('[data-dim]').length).toBe(0);
    expect(captured.querySelectorAll('[data-band-stripe]').length).toBeGreaterThan(0);
    expect(useSelection.getState().selectedLineId).toBe('L1');
  });
});
