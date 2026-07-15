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
    captureThumbnail: vi.fn(async () => 'data:image/png;base64,THUMB'),
    exportCanvasSvg: vi.fn(async () => {}),
    exportCanvasPng: vi.fn(async () => {}),
  };
});

/**
 * WHOLESALE, not the importOriginal partial this file uses elsewhere: jsdom has
 * no indexedDB, so a partial mock would leave the real getPayload/listRevisions
 * reachable from the Toolbar and die on a ReferenceError rather than a useful
 * assertion.
 *
 * The current-map pointer is a stateful fake, not a constant-returning vi.fn():
 * "the second save reuses the id the first one set" is unobservable otherwise.
 */
const libState = vi.hoisted(() => ({ current: null as string | null, minted: 0 }));
vi.mock('../state/mapLibrary', () => ({
  saveRevision: vi.fn(async () => 1),
  listMaps: vi.fn(async () => []),
  listRevisions: vi.fn(async () => []),
  getPayload: vi.fn(async () => undefined),
  renameMap: vi.fn(async () => {}),
  deleteMap: vi.fn(async () => {}),
  deleteRevision: vi.fn(async () => {}),
  newMapId: vi.fn(() => `minted-${++libState.minted}`),
  getCurrentMapId: vi.fn(() => libState.current),
  setCurrentMapId: vi.fn((id: string | null) => {
    libState.current = id;
  }),
}));

import { Toolbar } from './Toolbar';
import {
  downloadBlob,
  getCanvasSvg,
  captureThumbnail,
  exportCanvasSvg,
  exportCanvasPng,
} from '../export/exportCanvas';
import { saveRevision, newMapId, setCurrentMapId, getPayload } from '../state/mapLibrary';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { pickDocSnapshot } from '../state/store';
import { serialize } from '../model/serialize';
import { historyDepth } from '../state/history';
import { computeContentBounds } from '../geometry/contentBounds';
import { fitViewport } from './canvas/viewportMath';
import { makeDoc, makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

beforeEach(() => {
  localStorage.clear();
  libState.current = null;
  libState.minted = 0;
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
    showWaypoints: false,
    showNetwork: true,
  });
  vi.mocked(downloadBlob).mockClear();
  vi.mocked(getCanvasSvg).mockReset();
  vi.mocked(exportCanvasSvg).mockClear();
  vi.mocked(exportCanvasPng).mockClear();
  vi.mocked(captureThumbnail).mockClear();
  vi.mocked(captureThumbnail).mockResolvedValue('data:image/png;base64,THUMB');
  vi.mocked(saveRevision).mockClear();
  vi.mocked(saveRevision).mockResolvedValue(1);
  vi.mocked(newMapId).mockClear();
  vi.mocked(setCurrentMapId).mockClear();
  vi.mocked(getPayload).mockClear();
});

/**
 * A canvas stand-in real enough to be cloned — captureExportSnapshot calls
 * cloneNode on it, so an object literal would throw and be swallowed as "no
 * thumbnail", quietly defeating any assertion about the thumb.
 */
const mountableSvg = () =>
  document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;

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

  // The toggle writes the DOCUMENT, not session state: a night map stays a
  // night map when the file is reopened, so the mode has to land in the doc.
  it('toggles dark mode, writing it to the doc', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByLabelText('Toggle dark mode'));
    expect(useDoc.getState().darkMode).toBe(true);
  });

  it('toggles waypoint visibility via the WP button', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const btn = () => screen.getByLabelText('Toggle waypoints');
    expect(btn()).toHaveTextContent('WP');
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
    await user.click(btn());
    expect(useViewportStore.getState().showWaypoints).toBe(true);
    expect(btn()).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn());
    expect(useViewportStore.getState().showWaypoints).toBe(false);
  });

  it('toggles lines + stations via the eye button', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const btn = () => screen.getByLabelText('Toggle lines and stations');
    // Starts pressed: unlike the WP button, this one is ON in the normal case —
    // the map is drawn, and clicking is what takes it away.
    expect(btn()).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn());
    expect(useViewportStore.getState().showNetwork).toBe(false);
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
    await user.click(btn());
    expect(useViewportStore.getState().showNetwork).toBe(true);
  });

  it('Reset view fits the camera to the map content', async () => {
    // A single far-flung station: Reset view must move the camera onto it,
    // exactly the center+fit the file-load path performs.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['S'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
      stations: { S: stationWithStop('S' as StationId, 'L1' as LineId, { x: 1000, y: 500 }) },
    });
    const fakeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    fakeSvg.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as ReturnType<SVGSVGElement['getBoundingClientRect']>;
    vi.mocked(getCanvasSvg).mockReturnValue(fakeSvg);

    const user = userEvent.setup();
    useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Reset view' }));

    const bounds = computeContentBounds(useDoc.getState())!;
    expect(useViewportStore.getState()).toMatchObject(fitViewport(bounds, { w: 800, h: 600 }));
    // Sanity: the camera actually left the origin and landed on the content.
    expect(useViewportStore.getState().x).toBeGreaterThan(500);
  });

  it('Reset view falls back to the origin when the map is empty', async () => {
    const user = userEvent.setup();
    useViewportStore.setState({ x: 100, y: 50, zoom: 3 });
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(useViewportStore.getState()).toMatchObject({ x: 0, y: 0, zoom: 1 });
  });
});

describe('Toolbar — help guide', () => {
  const dialog = () => screen.queryByRole('dialog', { name: 'Quick reference' });
  // useDismiss defers its outside-mousedown listener to the next tick so the
  // opening click can't instantly dismiss; flush that timeout before firing
  // outside-clicks at the overlay.
  const flushDismissListener = () => new Promise((r) => setTimeout(r, 1));

  it('renders the ? help button last in the view-toggle group', () => {
    render(<Toolbar />);
    const help = screen.getByLabelText('Help');
    // Pinned as "closes out its group" rather than "sits right of <the WP
    // button>", which is what this asserted until a toggle was added between
    // the two. The invariant that matters is Help coming last; naming a
    // neighbour re-breaks this for every future button.
    expect(help.parentElement!.lastElementChild).toBe(help);
    expect(help.parentElement).toContainElement(screen.getByLabelText('Toggle waypoints'));
  });

  it('opens the quick-reference overlay on click and closes on a second click', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByLabelText('Help'));
    expect(dialog()).toBeInTheDocument();
    await user.click(screen.getByLabelText('Help'));
    expect(dialog()).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByLabelText('Help'));
    expect(dialog()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
  });

  it('closes on a backdrop click but stays open on a click inside the panel', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByLabelText('Help'));
    await flushDismissListener();

    fireEvent.mouseDown(dialog()!);
    expect(dialog()).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(dialog()).toBeNull();
  });

  it('the ? key opens and closes it', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.keyboard('?');
    expect(dialog()).toBeInTheDocument();
    await user.keyboard('?');
    expect(dialog()).toBeNull();
  });

  it('the ? key is inert while typing in a text field', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    // The map-name button becomes a real text input on click (select-all on
    // focus); typing "?" there must edit the name, not open the guide.
    await user.click(screen.getByRole('button', { name: 'Untitled map' }));
    await user.keyboard('?');
    expect(dialog()).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('?');
  });

  it('lists core gestures', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByLabelText('Help'));
    const panel = dialog()!;
    // Spot-check a few load-bearing entries; wording may evolve, but these
    // gestures must stay documented.
    expect(panel.textContent).toMatch(/right.?click/i);
    expect(panel.textContent).toMatch(/rotate/i);
    expect(panel.textContent).toMatch(/alt.?click/i);
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
  it('Export → JSON serializes and triggers a download', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    // The leaf flyout is hover-driven; userEvent's pointer movement tears it
    // down before the click lands, so fire the click directly on the leaf.
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it('Clear wipes the document and selection', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      name: 'My Map',
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
    // Clear stays in the same document: the title survives, and so does undo.
    // (The no-dialog and undo pins guard the ABSENCE of an earlier design that
    // put Clear behind a confirm and made it non-undoable.)
    expect(useDoc.getState().name).toBe('My Map');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(historyDepth()).toBeGreaterThan(0);
    expect(saveRevision).not.toHaveBeenCalled();
    useDoc.temporal.getState().undo();
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
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

  const validFile = () =>
    new File(
      [
        serialize(
          makeDoc({
            name: 'From File',
            stations: [makeStation({ id: 'fromfile', stops: [makeStop('L1')] })],
            lines: [makeLine({ id: 'L1', stations: ['fromfile'] })],
          }),
        ),
      ],
      'map.massimo.json',
      { type: 'application/json' },
    );

  const seedOutgoing = () =>
    useDoc.setState({
      ...useDoc.getState(),
      name: 'Outgoing',
      lines: { L9: makeLine({ id: 'L9' as LineId, stations: ['S9'] as StationId[] }) },
      lineOrder: ['L9' as LineId],
      stations: { S9: stationWithStop('S9' as StationId, 'L9' as LineId, { x: 0, y: 0 }) },
    });

  it('auto-saves the outgoing doc before adopting a file, and drops the library id', async () => {
    seedOutgoing();
    render(<Toolbar />);
    fireEvent.change(fileInput(), { target: { files: [validFile()] } });
    await waitFor(() => expect(useDoc.getState().stations.fromfile).toBeDefined());
    expect(saveRevision).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveRevision).mock.calls[0][1]).toBe('Outgoing');
    expect(vi.mocked(saveRevision).mock.calls[0][3]).toBe('auto');
    // A file is not a library map — saving it must fork a new one (D2b).
    expect(setCurrentMapId).toHaveBeenLastCalledWith(null);
  });

  /**
   * Adopting records the adopted bytes as the dedup baseline. Without that, an
   * unedited file-loaded doc is copied into the library on the very next
   * switch — so browsing N files deposits N-1 junk maps that nothing dedupes
   * (names may repeat) and nothing prunes (the cap is per-map).
   */
  it('does not deposit a copy of a file that was loaded and never edited', async () => {
    const user = userEvent.setup();
    seedOutgoing();
    render(<Toolbar />);
    fireEvent.change(fileInput(), { target: { files: [validFile()] } });
    await waitFor(() => expect(useDoc.getState().stations.fromfile).toBeDefined());
    expect(saveRevision).toHaveBeenCalledTimes(1); // the OUTGOING doc, correctly

    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'New' }));
    await waitFor(() => expect(Object.keys(useDoc.getState().stations)).toHaveLength(0));
    // Still just the outgoing doc's revision — the untouched file was not copied.
    expect(saveRevision).toHaveBeenCalledTimes(1);
  });

  it('writes no auto-save for a file that fails to parse', async () => {
    seedOutgoing();
    render(<Toolbar />);
    const badFile = new File(['not json'], 'broken.json', { type: 'application/json' });
    fireEvent.change(fileInput(), { target: { files: [badFile] } });
    await screen.findByRole('alert');
    expect(saveRevision).not.toHaveBeenCalled();
    expect(useDoc.getState().name).toBe('Outgoing');
  });

  /**
   * The error-surface half is the load-bearing one: "doc unchanged" passes
   * against a defective implementation that swallows the rejection as an
   * unhandled promise and simply does nothing. eslint has no type-aware rules
   * here, so nothing else would catch it.
   */
  it('aborts the load and surfaces the error when the auto-save fails', async () => {
    seedOutgoing();
    vi.mocked(saveRevision).mockRejectedValue(new Error('QuotaExceededError'));
    render(<Toolbar />);
    fireEvent.change(fileInput(), { target: { files: [validFile()] } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('QuotaExceededError');
    expect(useDoc.getState().stations.fromfile).toBeUndefined();
    expect(useDoc.getState().name).toBe('Outgoing');
    expect(setCurrentMapId).not.toHaveBeenCalled();
  });
});

describe('Toolbar — map library', () => {
  // A doc whose work is entirely lines: no stations, no labels, nothing the
  // camera hull looks at. This is the shape that a contentBounds-based gate
  // classifies as empty, and it is three clicks away (Add line, Add line, Esc).
  const seedLinesOnly = () =>
    useDoc.setState({
      ...useDoc.getState(),
      name: 'Lines Only',
      lines: {
        L1: makeLine({ id: 'L1' as LineId, stations: [] }),
        L2: makeLine({ id: 'L2' as LineId, stations: [] }),
      },
      lineOrder: ['L1', 'L2'] as LineId[],
    });

  const seedRealMap = (name = 'My Map') =>
    useDoc.setState({
      ...useDoc.getState(),
      name,
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['S'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
      stations: { S: stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
    });

  const clickNew = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'New' }));
  };

  const saveToLibrary = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Save revision' }));
  };

  it('Save revision writes a user revision of the serialized doc', async () => {
    const user = userEvent.setup();
    seedRealMap();
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    render(<Toolbar />);
    await saveToLibrary(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    expect(saveRevision).toHaveBeenCalledWith(
      'minted-1',
      'My Map',
      serialize(pickDocSnapshot(useDoc.getState())),
      'user',
      'data:image/png;base64,THUMB',
    );
  });

  // An empty canvas throws in buildExportSvg. That must cost the picture, not
  // the save.
  it('a thumbnail failure still saves, with no thumb and no error', async () => {
    const user = userEvent.setup();
    seedRealMap();
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    vi.mocked(captureThumbnail).mockRejectedValue(
      new Error('Nothing to export — the canvas is empty.'),
    );
    render(<Toolbar />);
    await saveToLibrary(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRevision).mock.calls[0][4]).toBeUndefined();
    // The only message is the success one — the failure never reaches the user.
    const alert = await screen.findByRole('alert');
    expect(alert.className).toContain('info');
  });

  it('surfaces a save failure and shows no confirmation', async () => {
    const user = userEvent.setup();
    seedRealMap();
    vi.mocked(saveRevision).mockRejectedValue(new Error('QuotaExceededError'));
    render(<Toolbar />);
    await saveToLibrary(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('QuotaExceededError');
    expect(alert.className).not.toContain('info');
  });

  it('confirms a successful save by name', async () => {
    const user = userEvent.setup();
    seedRealMap('Canal Line');
    render(<Toolbar />);
    await saveToLibrary(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Canal Line');
    expect(alert.className).toContain('info');
  });

  it('a second save reuses the id the first one minted', async () => {
    const user = userEvent.setup();
    seedRealMap();
    render(<Toolbar />);
    await saveToLibrary(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    await saveToLibrary(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(2));
    const ids = vi.mocked(saveRevision).mock.calls.map((c) => c[0]);
    expect(ids).toEqual(['minted-1', 'minted-1']);
    expect(newMapId).toHaveBeenCalledTimes(1);
  });

  it('New auto-saves the outgoing doc, then wipes it and mints a fresh id', async () => {
    const user = userEvent.setup();
    seedRealMap('Outgoing');
    useViewportStore.setState({ x: 100, y: 50, zoom: 3 });
    render(<Toolbar />);
    await clickNew(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRevision).mock.calls[0][3]).toBe('auto');
    expect(vi.mocked(saveRevision).mock.calls[0][1]).toBe('Outgoing');
    // A different document now: wiped, renamed to the default, undo reset, and
    // the camera back at the origin (fitCameraToDoc declines on an empty doc,
    // so the fallback is the only thing that recenters).
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
    expect(useDoc.getState().name).toBe(DEFAULT_DOC.name);
    expect(historyDepth()).toBe(0);
    expect(useViewportStore.getState()).toMatchObject({ x: 0, y: 0, zoom: 1 });
    expect(setCurrentMapId).toHaveBeenLastCalledWith('minted-2');
  });

  it('New ABORTS without wiping when the auto-save fails', async () => {
    const user = userEvent.setup();
    seedRealMap('Precious');
    vi.mocked(saveRevision).mockRejectedValue(new Error('QuotaExceededError'));
    const before = historyDepth();
    render(<Toolbar />);
    await clickNew(user);
    await screen.findByRole('alert');
    // The auto-save IS the backstop for a non-undoable wipe. No save, no wipe.
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
    expect(useDoc.getState().name).toBe('Precious');
    expect(historyDepth()).toBe(before);
  });

  /**
   * B1. The red that matters: a doc whose work lives in lines reads as EMPTY to
   * computeContentBounds (a camera hull that omits lines deliberately), so a
   * gate built on it writes nothing and New wipes the map for good. The byte
   * compare classifies it correctly.
   */
  it('New auto-saves a doc whose only content is lines', async () => {
    const user = userEvent.setup();
    seedLinesOnly();
    // Precondition: the camera hull genuinely calls this doc empty.
    expect(computeContentBounds(useDoc.getState())).toBeNull();
    render(<Toolbar />);
    await clickNew(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRevision).mock.calls[0][3]).toBe('auto');
    expect(vi.mocked(saveRevision).mock.calls[0][1]).toBe('Lines Only');
  });

  it('New on a virgin empty doc writes nothing', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await clickNew(user);
    await waitFor(() => expect(setCurrentMapId).toHaveBeenCalled());
    expect(saveRevision).not.toHaveBeenCalled();
  });

  it('New writes no second copy of a doc that has not changed since its save', async () => {
    const user = userEvent.setup();
    seedRealMap();
    // Load-bearing: without a canvas, tryCaptureThumbnail returns before it ever
    // reaches captureThumbnail, and the "not called" assertion below would pass
    // no matter what order the gate and the capture ran in.
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    render(<Toolbar />);
    await saveToLibrary(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    expect(captureThumbnail).toHaveBeenCalledTimes(1); // the explicit save paid for one
    vi.mocked(captureThumbnail).mockClear();

    await clickNew(user);
    await waitFor(() => expect(setCurrentMapId).toHaveBeenLastCalledWith('minted-2'));
    // Still just the explicit save — the auto-save deduped against it.
    expect(saveRevision).toHaveBeenCalledTimes(1);
    // And it deduped BEFORE paying for a thumbnail.
    expect(captureThumbnail).not.toHaveBeenCalled();
  });

  it('New re-saves once the doc changes again', async () => {
    const user = userEvent.setup();
    seedRealMap();
    render(<Toolbar />);
    await saveToLibrary(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    useDoc.getState().setDocName('Edited');
    await clickNew(user);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveRevision).mock.calls[1][3]).toBe('auto');
  });
});

describe('Toolbar — Export wiring', () => {
  const openExportSubmenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
  };

  it('Export → SVG forwards a faithful snapshot of the live canvas svg', async () => {
    const fakeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    // A distinctive child, so the snapshot assertion below can't pass merely
    // because any two empty <svg>s compare equal.
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    marker.setAttribute('data-marker', 'live-canvas');
    fakeSvg.appendChild(marker);
    vi.mocked(getCanvasSvg).mockReturnValue(fakeSvg);

    const user = userEvent.setup();
    render(<Toolbar />);
    await openExportSubmenu(user);
    // The leaf flyout is hover-driven; userEvent's pointer movement tears it
    // down before the click lands, so fire the click directly on the leaf.
    fireEvent.click(screen.getByRole('menuitem', { name: 'SVG' }));

    await waitFor(() => expect(exportCanvasSvg).toHaveBeenCalledTimes(1));
    const passed = vi.mocked(exportCanvasSvg).mock.calls[0][0];
    // A detached snapshot, NOT the live element — this asserted `toBe(fakeSvg)`
    // until captureExportSnapshot took over. The export applies and reverts view
    // state around the clone inside one synchronous task, so the live canvas is
    // deliberately not what travels into the async pipeline. Faithful content is
    // what the contract is really about.
    expect(passed).not.toBe(fakeSvg);
    expect(passed.isEqualNode(fakeSvg)).toBe(true);
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
