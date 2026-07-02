import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stub the actual file download (jsdom has no URL.createObjectURL / anchor
// download); keep the rest of the export module (mapFileBasename, parse helpers,
// etc.) real. getCanvasSvg + the two export entry points are stubbed so the
// Toolbar's runExport wiring can be asserted without touching real DOM/raster.
vi.mock('../export/exportCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../export/exportCanvas')>();
  return {
    ...actual,
    downloadBlob: vi.fn(),
    getCanvasSvg: vi.fn(),
    exportCanvasSvg: vi.fn(async () => {}),
    exportCanvasPng: vi.fn(async () => {}),
  };
});

import { Toolbar } from './Toolbar';
import {
  downloadBlob,
  getCanvasSvg,
  exportCanvasSvg,
  exportCanvasPng,
} from '../export/exportCanvas';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { serialize } from '../model/serialize';
import { makeDoc, makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';
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
  useViewportStore.setState({
    x: 0,
    y: 0,
    zoom: 1,
    gridVisible: true,
    gridSize: 10,
    darkMode: false,
  });
  vi.mocked(downloadBlob).mockClear();
  vi.mocked(getCanvasSvg).mockReset();
  vi.mocked(exportCanvasSvg).mockClear();
  vi.mocked(exportCanvasPng).mockClear();
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

  it('cycles grid size 10 → 20 → 5 → 10', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const btn = () => screen.getByLabelText('Cycle grid size');
    expect(btn()).toHaveTextContent('10');
    await user.click(btn());
    expect(useViewportStore.getState().gridSize).toBe(20);
    expect(btn()).toHaveTextContent('20');
    await user.click(btn());
    expect(useViewportStore.getState().gridSize).toBe(5);
    expect(btn()).toHaveTextContent('5');
    await user.click(btn());
    expect(useViewportStore.getState().gridSize).toBe(10);
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

describe('Toolbar — sidebar toggle', () => {
  it('the single arrow collapses and reopens the sidebar', async () => {
    const user = userEvent.setup();
    useSelection.setState({ ...useSelection.getState(), sidebarOpen: true });
    render(<Toolbar />);

    const btn = () => screen.getByLabelText('Toggle sidebar');
    expect(btn().getAttribute('title')).toBe('Hide sidebar');

    await user.click(btn());
    expect(useSelection.getState().sidebarOpen).toBe(false);
    // The affordance flips to "reopen".
    expect(btn().getAttribute('title')).toBe('Show sidebar');

    await user.click(btn());
    expect(useSelection.getState().sidebarOpen).toBe(true);
  });
});

describe('Toolbar — map name field', () => {
  it('renders the editable map name flanked by dividers', () => {
    render(<Toolbar />);
    const field = screen.getByRole('button', { name: 'Untitled map' });
    expect(field.previousElementSibling).toHaveClass('tool-group-divider');
    expect(field.nextElementSibling).toHaveClass('tool-group-divider');
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

describe('Toolbar — Add menu mode commands', () => {
  const openAdd = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Add' }));
  };

  it.each<[string, string]>([
    ['Line tags', 'creating-line-tag'],
    ['Route bullets', 'creating-route-bullet'],
    ['Label', 'placing-label'],
    ['Polygon', 'creating-polygon'],
    ['Transfer', 'creating-transfer'],
  ])('Add → %s enters %s mode', async (item, expectedKind) => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openAdd(user);
    await user.click(screen.getByRole('menuitem', { name: item }));
    expect(useSelection.getState().uiMode.kind).toBe(expectedKind);
  });

  it('Add → Transfer enters creating-transfer with a null anchor', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openAdd(user);
    await user.click(screen.getByRole('menuitem', { name: 'Transfer' }));
    const mode = useSelection.getState().uiMode;
    expect(mode.kind).toBe('creating-transfer');
    expect(mode.kind === 'creating-transfer' && mode.anchor).toBeNull();
  });

  it('clicking an active Add item again toggles back to idle', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openAdd(user);
    await user.click(screen.getByRole('menuitem', { name: 'Polygon' }));
    expect(useSelection.getState().uiMode.kind).toBe('creating-polygon');
    // Re-open the menu (it closed on activation) and click the same item.
    await openAdd(user);
    await user.click(screen.getByRole('menuitem', { name: 'Polygon' }));
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});

describe('Toolbar — Load', () => {
  const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

  it('shows an error for an invalid-JSON file and does not replace the doc', async () => {
    render(<Toolbar />);
    const badFile = new File(['this is not json'], 'broken.json', { type: 'application/json' });
    fireEvent.change(fileInput(), { target: { files: [badFile] } });
    await screen.findByRole('alert');
    // Doc untouched (still empty).
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
  });

  it('replaces the document with a valid serialized file and clears temporal history', async () => {
    const json = serialize(
      makeDoc({
        stations: [makeStation({ id: 'fromfile', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['fromfile'] })],
      }),
    );
    render(<Toolbar />);
    const goodFile = new File([json], 'map.massimo.json', { type: 'application/json' });
    fireEvent.change(fileInput(), { target: { files: [goodFile] } });

    await waitFor(() => {
      expect(useDoc.getState().stations.fromfile).toBeDefined();
    });
    // No error surfaced, and undo history was cleared by the load.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useDoc.temporal.getState().pastStates.length).toBe(0);
  });
});

describe('Toolbar — Export wiring', () => {
  const openExportSubmenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
  };

  it('Export → SVG forwards the live canvas svg to exportCanvasSvg', async () => {
    const fakeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    vi.mocked(getCanvasSvg).mockReturnValue(fakeSvg);

    const user = userEvent.setup();
    render(<Toolbar />);
    await openExportSubmenu(user);
    // The leaf flyout is hover-driven; userEvent's pointer movement tears it
    // down before the click lands, so fire the click directly on the leaf.
    fireEvent.click(screen.getByRole('menuitem', { name: 'SVG' }));

    await waitFor(() => expect(exportCanvasSvg).toHaveBeenCalledTimes(1));
    expect(vi.mocked(exportCanvasSvg).mock.calls[0][0]).toBe(fakeSvg);
    // The SVG command must NOT route to the PNG exporter.
    expect(exportCanvasPng).not.toHaveBeenCalled();
  });

  it('shows "Canvas not ready" when the live svg is missing', async () => {
    vi.mocked(getCanvasSvg).mockReturnValue(null);

    const user = userEvent.setup();
    render(<Toolbar />);
    await openExportSubmenu(user);
    fireEvent.click(screen.getByRole('menuitem', { name: 'SVG' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Canvas not ready');
    expect(exportCanvasSvg).not.toHaveBeenCalled();
  });
});
