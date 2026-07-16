import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from '@testing-library/react';
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
 * no indexedDB, so a partial mock would leave the real getPayload/listVersions
 * reachable from the Toolbar and die on a ReferenceError rather than a useful
 * assertion.
 *
 * `newMapId` mints a fresh id per call rather than returning a constant: "the
 * second save reuses the id the first one minted" is unobservable otherwise.
 *
 * The library POINTER is deliberately NOT mocked — it is a plain zustand store
 * over localStorage, which jsdom has, so the tests below drive the real thing
 * and assert on its state. beforeEach resets it.
 */
const libState = vi.hoisted(() => ({ minted: 0 }));
vi.mock('../state/mapLibrary', () => ({
  saveVersion: vi.fn(async () => ({ id: 1, version: 1 })),
  listMaps: vi.fn(async () => []),
  listVersions: vi.fn(async () => []),
  getPayload: vi.fn(async () => undefined),
  renameMap: vi.fn(async () => {}),
  deleteMap: vi.fn(async () => {}),
  deleteVersion: vi.fn(async () => {}),
  setVersionName: vi.fn(async () => {}),
  setVersionStarred: vi.fn(async () => {}),
  newMapId: vi.fn(() => `minted-${++libState.minted}`),
}));

import { Toolbar } from './Toolbar';
import { StatusToasts } from './StatusToasts';
import { useToasts } from '../state/toastStore';
import {
  downloadBlob,
  getCanvasSvg,
  captureThumbnail,
  exportCanvasSvg,
  exportCanvasPng,
} from '../export/exportCanvas';
import { saveVersion, newMapId, getPayload, listMaps, listVersions } from '../state/mapLibrary';
import type { MapSummary, VersionMeta } from '../state/mapLibrary';
import { useLibraryPointer } from '../state/libraryPointer';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { pickDocSnapshot } from '../state/store';
import { serialize } from '../model/serialize';
import { markAdopted, markSaved, saveStatusOf, useSaveBaseline } from '../state/saveBaseline';
import { historyDepth } from '../state/history';
import { computeContentBounds } from '../geometry/contentBounds';
import { fitViewport } from './canvas/viewportMath';
import { makeDoc, makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

beforeEach(() => {
  localStorage.clear();
  libState.minted = 0;
  // Toasts persist in a module store, so one test's error would greet the next.
  useToasts.setState({ toasts: [] });
  useLibraryPointer.setState({ mapId: null, version: null });
  // Module state, so it outlives component mounts: without a reset, one test's
  // save vouches for the next test's doc.
  useSaveBaseline.setState({ baselineSnap: null, baselineJson: null, backed: false });
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
  vi.mocked(saveVersion).mockClear();
  vi.mocked(saveVersion).mockResolvedValue({ id: 1, version: 1 });
  vi.mocked(newMapId).mockClear();
  vi.mocked(getPayload).mockClear();
  // Values, not just call logs: mockClear keeps the implementation, so a test
  // that seeds library rows would leak them into every later dialog.
  vi.mocked(getPayload).mockResolvedValue(undefined);
  vi.mocked(listMaps).mockClear();
  vi.mocked(listMaps).mockResolvedValue([]);
  vi.mocked(listVersions).mockClear();
  vi.mocked(listVersions).mockResolvedValue([]);
});

/**
 * A canvas stand-in real enough to be cloned — captureExportSnapshot calls
 * cloneNode on it, so an object literal would throw and be swallowed as "no
 * thumbnail", quietly defeating any assertion about the thumb.
 */
const mountableSvg = () =>
  document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;

/** The live doc's tri-state save status, read the way the toolbar reads it. */
const statusNow = () => saveStatusOf(useDoc.getState(), useSaveBaseline.getState());

/** Toolbar plus the toast stack it reports outcomes to (App mounts both). */
const renderToolbar = () =>
  render(
    <>
      <Toolbar />
      <StatusToasts />
    </>,
  );

/** The visible status toasts, oldest first. Scoped by class rather than text
 *  or role: Radix mirrors each toast into a transient visually-hidden announce
 *  region, so a bare text/role query can match the same message twice. */
const toastsNow = () => Array.from(document.querySelectorAll<HTMLElement>('li.status-toast'));

const findToast = (pattern: RegExp) =>
  waitFor(() => {
    const hit = toastsNow().find((t) => pattern.test(t.textContent ?? ''));
    if (!hit) throw new Error(`no toast matching ${pattern}`);
    return hit;
  });

/** Anchor the baseline to the CURRENT doc, the way every save/adopt site does:
 *  json and snap captured together from one state. */
const anchor = (mark: typeof markSaved) => {
  const snap = pickDocSnapshot(useDoc.getState());
  mark(serialize(snap), snap);
};

describe('Toolbar — tool + view toggles', () => {
  it('switches to hand mode and back to arrow', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByTitle('Hand (H) — hold Space'));
    expect(useSelection.getState().toolMode).toBe('hand');
    await user.click(screen.getByTitle('Arrow (A)'));
    expect(useSelection.getState().toolMode).toBe('arrow');
  });

  it('toggles grid visibility', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Toggle grid'));
    expect(useViewportStore.getState().gridVisible).toBe(false);
  });

  it('cycles grid size 10 → 20 → 5 → 10', async () => {
    const user = userEvent.setup();
    renderToolbar();
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
    renderToolbar();
    await user.click(screen.getByLabelText('Toggle layering mode'));
    expect(useSelection.getState().uiMode.kind).toBe('layering');
  });

  // The toggle writes the DOCUMENT, not session state: a night map stays a
  // night map when the file is reopened, so the mode has to land in the doc.
  it('toggles dark mode, writing it to the doc', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Toggle dark mode'));
    expect(useDoc.getState().darkMode).toBe(true);
  });

  it('toggles waypoint visibility via the WP button', async () => {
    const user = userEvent.setup();
    renderToolbar();
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
    renderToolbar();
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
    renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Reset view' }));

    const bounds = computeContentBounds(useDoc.getState())!;
    expect(useViewportStore.getState()).toMatchObject(fitViewport(bounds, { w: 800, h: 600 }));
    // Sanity: the camera actually left the origin and landed on the content.
    expect(useViewportStore.getState().x).toBeGreaterThan(500);
  });

  it('Reset view falls back to the origin when the map is empty', async () => {
    const user = userEvent.setup();
    useViewportStore.setState({ x: 100, y: 50, zoom: 3 });
    renderToolbar();
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
    renderToolbar();
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
    renderToolbar();
    await user.click(screen.getByLabelText('Help'));
    expect(dialog()).toBeInTheDocument();
    await user.click(screen.getByLabelText('Help'));
    expect(dialog()).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Help'));
    expect(dialog()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
  });

  it('closes on a backdrop click but stays open on a click inside the panel', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText('Help'));
    await flushDismissListener();

    fireEvent.mouseDown(dialog()!);
    expect(dialog()).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(dialog()).toBeNull();
  });

  it('the ? key opens and closes it', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.keyboard('?');
    expect(dialog()).toBeInTheDocument();
    await user.keyboard('?');
    expect(dialog()).toBeNull();
  });

  it('the ? key is inert while typing in a text field', async () => {
    const user = userEvent.setup();
    renderToolbar();
    // The map-name button becomes a real text input on click (select-all on
    // focus); typing "?" there must edit the name, not open the guide.
    await user.click(screen.getByRole('button', { name: 'Untitled map' }));
    await user.keyboard('?');
    expect(dialog()).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('?');
  });

  it('lists core gestures', async () => {
    const user = userEvent.setup();
    renderToolbar();
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
    renderToolbar();

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
    // Clean — but the save-status dot is a hidden PLACEHOLDER, not absent
    // (it keeps its box so the toolbar never reflows), so the right-hand
    // divider sits after the dot rather than directly after the name.
    anchor(markSaved);
    renderToolbar();
    const field = screen.getByRole('button', { name: 'Untitled map' });
    expect(field.previousElementSibling).toHaveClass('tool-group-divider');
    expect(field.nextElementSibling).toHaveClass('map-save-dot');
    expect(field.nextElementSibling?.nextElementSibling).toHaveClass('tool-group-divider');
  });
});

describe('Toolbar — Add menu', () => {
  it('Add → Stations enters placing-station mode', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Stations' }));
    expect(useSelection.getState().uiMode.kind).toBe('placing-station');
  });

  it('Add → Line creates a line and enters append mode', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Line' }));
    expect(Object.keys(useDoc.getState().lines).length).toBe(1);
    expect(useSelection.getState().uiMode.kind).toBe('appending-to-line');
  });
});

describe('Toolbar — Canvas menu', () => {
  it('Export → JSON serializes and triggers a download', async () => {
    const user = userEvent.setup();
    renderToolbar();
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
    renderToolbar();
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
    expect(saveVersion).not.toHaveBeenCalled();
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
    renderToolbar();
    await openAdd(user);
    await user.click(screen.getByRole('menuitem', { name: item }));
    expect(useSelection.getState().uiMode.kind).toBe(expectedKind);
  });

  it('Add → Transfer enters creating-transfer with a null anchor', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await openAdd(user);
    await user.click(screen.getByRole('menuitem', { name: 'Transfer' }));
    const mode = useSelection.getState().uiMode;
    expect(mode.kind).toBe('creating-transfer');
    expect(mode.kind === 'creating-transfer' && mode.anchor).toBeNull();
  });

  it('clicking an active Add item again toggles back to idle', async () => {
    const user = userEvent.setup();
    renderToolbar();
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
    renderToolbar();
    const badFile = new File(['this is not json'], 'broken.json', { type: 'application/json' });
    fireEvent.change(fileInput(), { target: { files: [badFile] } });
    expect((await findToast(/./)).dataset.kind).toBe('error');
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
    renderToolbar();
    const goodFile = new File([json], 'map.massimo.json', { type: 'application/json' });
    fireEvent.change(fileInput(), { target: { files: [goodFile] } });

    await waitFor(() => {
      expect(useDoc.getState().stations.fromfile).toBeDefined();
    });
    // No error surfaced, and undo history was cleared by the load.
    expect(toastsNow()).toHaveLength(0);
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
    // The outgoing doc came from the library, so there is a pointer to drop —
    // the assertion below is vacuous against the null it starts at.
    useLibraryPointer.setState({ mapId: 'lib-map', version: 7 });
    renderToolbar();
    fireEvent.change(fileInput(), { target: { files: [validFile()] } });
    await waitFor(() => expect(useDoc.getState().stations.fromfile).toBeDefined());
    expect(saveVersion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveVersion).mock.calls[0][1]).toBe('Outgoing');
    expect(vi.mocked(saveVersion).mock.calls[0][3]).toBe('auto');
    // A file is not a library map — saving it must fork a new one (D2b). Both
    // halves go: a version with no map behind it is nothing the pill can show.
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: null, version: null });
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
    renderToolbar();
    fireEvent.change(fileInput(), { target: { files: [validFile()] } });
    await waitFor(() => expect(useDoc.getState().stations.fromfile).toBeDefined());
    expect(saveVersion).toHaveBeenCalledTimes(1); // the OUTGOING doc, correctly

    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'New' }));
    await waitFor(() => expect(Object.keys(useDoc.getState().stations)).toHaveLength(0));
    // Still just the outgoing doc's version — the untouched file was not copied.
    expect(saveVersion).toHaveBeenCalledTimes(1);
  });

  it('a loaded file reads unsaved — clean bytes, but the library has no copy', async () => {
    renderToolbar();
    fireEvent.change(fileInput(), { target: { files: [validFile()] } });
    await waitFor(() => expect(useDoc.getState().stations.fromfile).toBeDefined());
    expect(statusNow()).toBe('unsaved');
  });

  it('writes no auto-save for a file that fails to parse', async () => {
    seedOutgoing();
    renderToolbar();
    const badFile = new File(['not json'], 'broken.json', { type: 'application/json' });
    fireEvent.change(fileInput(), { target: { files: [badFile] } });
    expect((await findToast(/./)).dataset.kind).toBe('error');
    expect(saveVersion).not.toHaveBeenCalled();
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
    useLibraryPointer.setState({ mapId: 'lib-map', version: 7 });
    vi.mocked(saveVersion).mockRejectedValue(new Error('QuotaExceededError'));
    renderToolbar();
    fireEvent.change(fileInput(), { target: { files: [validFile()] } });
    await findToast(/QuotaExceededError/);
    expect(useDoc.getState().stations.fromfile).toBeUndefined();
    expect(useDoc.getState().name).toBe('Outgoing');
    // The doc stayed, so its pointer must stay with it — untouched, not cleared.
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'lib-map', version: 7 });
  });
});

/**
 * Opening a version is the third and last way a document gets replaced, and it
 * carries the same non-undoable wipe as New and Load — but nothing exercised its
 * auto-save: MapLibraryDialog.test.tsx mocks onOpenVersion wholesale, so it only
 * proves the callback fires, and the Load block above only ever reaches the file
 * path. These drive the real dialog, so the Toolbar's own wiring is under test.
 */
describe('Toolbar — Load from library', () => {
  const SAVED_AT = Date.parse('2026-07-14T10:00:00Z');

  const seedLibraryRow = () => {
    vi.mocked(listMaps).mockResolvedValue([
      { id: 'm1', name: 'Saved Map', updatedAt: SAVED_AT, versionCount: 1 },
    ] satisfies MapSummary[]);
    vi.mocked(listVersions).mockResolvedValue([
      { id: 7, mapId: 'm1', savedAt: SAVED_AT, source: 'user', version: 3 },
    ] satisfies VersionMeta[]);
  };

  // Outgoing work that belongs to a DIFFERENT map, so "the pointer moved to the
  // opened version" and "the pointer was left alone" are distinguishable.
  const seedOutgoing = () => {
    useDoc.setState({
      ...useDoc.getState(),
      name: 'Outgoing',
      lines: { L9: makeLine({ id: 'L9' as LineId, stations: ['S9'] as StationId[] }) },
      lineOrder: ['L9' as LineId],
      stations: { S9: stationWithStop('S9' as StationId, 'L9' as LineId, { x: 0, y: 0 }) },
    });
    useLibraryPointer.setState({ mapId: 'other-map', version: 9 });
  };

  const libraryPayload = () =>
    serialize(
      makeDoc({
        name: 'From Library',
        stations: [makeStation({ id: 'fromlib', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['fromlib'] })],
      }),
    );

  const clickOpen = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Load' }));
    // The leaf flyout is hover-driven; userEvent's pointer movement tears it
    // down before the click lands, so fire the click directly on the leaf.
    fireEvent.click(screen.getByRole('menuitem', { name: 'From library…' }));
    await user.click(await screen.findByText('Saved Map'));
    await user.click(await screen.findByRole('button', { name: 'Open version 3' }));
  };

  it('auto-saves the outgoing doc before adopting a version, and moves the pointer', async () => {
    const user = userEvent.setup();
    seedLibraryRow();
    vi.mocked(getPayload).mockResolvedValue(libraryPayload());
    seedOutgoing();
    renderToolbar();
    await clickOpen(user);

    await waitFor(() => expect(useDoc.getState().stations.fromlib).toBeDefined());
    expect(saveVersion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveVersion).mock.calls[0][0]).toBe('other-map'); // under ITS map
    expect(vi.mocked(saveVersion).mock.calls[0][1]).toBe('Outgoing');
    expect(vi.mocked(saveVersion).mock.calls[0][3]).toBe('auto');
    // Unlike a file, a version IS a library map: keep working in its history,
    // and show the version the document actually came from.
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'm1', version: 3 });
  });

  it('a version opened from the library reads clean — it IS the library copy', async () => {
    const user = userEvent.setup();
    seedLibraryRow();
    vi.mocked(getPayload).mockResolvedValue(libraryPayload());
    seedOutgoing();
    renderToolbar();
    await clickOpen(user);
    await waitFor(() => expect(useDoc.getState().stations.fromlib).toBeDefined());
    expect(statusNow()).toBe('clean');
  });

  /**
   * The fetch precedes the auto-save, and it is not a stylistic ordering. The
   * auto-save writes an 'auto' under the OUTGOING map and prunes in the same
   * transaction, so on a map already at AUTO_VERSION_LIMIT the prune can take
   * the very row that was just clicked — fetching first means the bytes are
   * already in hand. Nothing else pins that order, and reversing it costs a
   * junk version on every failed open too, which is what these two catch.
   */
  it('writes no auto-save when the version is gone from the library', async () => {
    const user = userEvent.setup();
    seedLibraryRow();
    vi.mocked(getPayload).mockResolvedValue(undefined);
    seedOutgoing();
    renderToolbar();
    await clickOpen(user);

    expect(
      await screen.findByText('That version is no longer in the library.'),
    ).toBeInTheDocument();
    expect(saveVersion).not.toHaveBeenCalled();
    expect(useDoc.getState().name).toBe('Outgoing');
  });

  it('writes no auto-save when the version payload fails to parse', async () => {
    const user = userEvent.setup();
    seedLibraryRow();
    vi.mocked(getPayload).mockResolvedValue('not json');
    seedOutgoing();
    renderToolbar();
    await clickOpen(user);

    // The dialog's own inline alert, not a status toast — onOpenVersion throws
    // for the dialog to show.
    await screen.findByRole('alert');
    expect(saveVersion).not.toHaveBeenCalled();
    expect(useDoc.getState().name).toBe('Outgoing');
  });

  /**
   * The auto-save IS the backstop for a non-undoable wipe, so a storage failure
   * has to cost the open rather than the document — the same contract the file
   * path's own abort test pins.
   */
  it('aborts the open and surfaces the error when the auto-save fails', async () => {
    const user = userEvent.setup();
    seedLibraryRow();
    vi.mocked(getPayload).mockResolvedValue(libraryPayload());
    vi.mocked(saveVersion).mockRejectedValue(new Error('QuotaExceededError'));
    seedOutgoing();
    renderToolbar();
    await clickOpen(user);

    expect(await screen.findByText('QuotaExceededError')).toBeInTheDocument();
    expect(useDoc.getState().stations.fromlib).toBeUndefined();
    expect(useDoc.getState().name).toBe('Outgoing');
    // The doc stayed, so its pointer stays with it.
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'other-map', version: 9 });
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
    await user.click(screen.getByRole('menuitem', { name: 'Save version' }));
  };

  it('Save version writes a user version of the serialized doc', async () => {
    const user = userEvent.setup();
    seedRealMap();
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    renderToolbar();
    await saveToLibrary(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(saveVersion).toHaveBeenCalledWith(
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
    renderToolbar();
    await saveToLibrary(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveVersion).mock.calls[0][4]).toBeUndefined();
    // The only message is the success one — the failure never reaches the user.
    const toast = await findToast(/Saved/);
    expect(toast.dataset.kind).toBe('info');
    expect(toastsNow()).toHaveLength(1);
  });

  it('surfaces a save failure and shows no confirmation', async () => {
    const user = userEvent.setup();
    seedRealMap();
    vi.mocked(saveVersion).mockRejectedValue(new Error('QuotaExceededError'));
    renderToolbar();
    await saveToLibrary(user);
    const toast = await findToast(/QuotaExceededError/);
    expect(toast.dataset.kind).toBe('error');
    expect(toastsNow().some((t) => /Saved/.test(t.textContent ?? ''))).toBe(false);
  });

  it('confirms a successful save by name and version', async () => {
    const user = userEvent.setup();
    seedRealMap('Canal Line');
    // A distinctive number, so "v32" can only have come from the save's result.
    vi.mocked(saveVersion).mockResolvedValue({ id: 9, version: 32 });
    renderToolbar();
    await saveToLibrary(user);
    const toast = await findToast(/Canal Line/);
    expect(toast).toHaveTextContent('v32');
    expect(toast.dataset.kind).toBe('info');
    // The pill's number is the same fact, and it comes from the same result.
    expect(useLibraryPointer.getState().version).toBe(32);
  });

  it('a second save reuses the id the first one minted', async () => {
    const user = userEvent.setup();
    seedRealMap();
    renderToolbar();
    await saveToLibrary(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    // A clean doc greys Save version out, so re-arm it with an edit first.
    useDoc.getState().setDocName('Edited between saves');
    await saveToLibrary(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(2));
    const ids = vi.mocked(saveVersion).mock.calls.map((c) => c[0]);
    expect(ids).toEqual(['minted-1', 'minted-1']);
    expect(newMapId).toHaveBeenCalledTimes(1);
  });

  it('New auto-saves the outgoing doc, then wipes it and mints a fresh id', async () => {
    const user = userEvent.setup();
    seedRealMap('Outgoing');
    useViewportStore.setState({ x: 100, y: 50, zoom: 3 });
    renderToolbar();
    await clickNew(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveVersion).mock.calls[0][3]).toBe('auto');
    expect(vi.mocked(saveVersion).mock.calls[0][1]).toBe('Outgoing');
    // A different document now: wiped, renamed to the default, undo reset, and
    // the camera back at the origin (fitCameraToDoc declines on an empty doc,
    // so the fallback is the only thing that recenters).
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
    expect(useDoc.getState().name).toBe(DEFAULT_DOC.name);
    expect(historyDepth()).toBe(0);
    expect(useViewportStore.getState()).toMatchObject({ x: 0, y: 0, zoom: 1 });
    // A fresh map: an id of its own (not the one the auto-save just wrote
    // under), and no version until something is saved beneath it.
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'minted-2', version: null });
  });

  it('New ABORTS without wiping when the auto-save fails', async () => {
    const user = userEvent.setup();
    seedRealMap('Precious');
    vi.mocked(saveVersion).mockRejectedValue(new Error('QuotaExceededError'));
    const before = historyDepth();
    renderToolbar();
    await clickNew(user);
    expect((await findToast(/./)).dataset.kind).toBe('error');
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
    renderToolbar();
    await clickNew(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveVersion).mock.calls[0][3]).toBe('auto');
    expect(vi.mocked(saveVersion).mock.calls[0][1]).toBe('Lines Only');
  });

  it('New on a virgin empty doc writes nothing', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await clickNew(user);
    // minted-1, not minted-2: New's own id is the first this test mints, which
    // is exactly the evidence that no auto-save ran ahead of it.
    await waitFor(() => expect(useLibraryPointer.getState().mapId).toBe('minted-1'));
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it('New writes no second copy of a doc that has not changed since its save', async () => {
    const user = userEvent.setup();
    seedRealMap();
    // Load-bearing: without a canvas, tryCaptureThumbnail returns before it ever
    // reaches captureThumbnail, and the "not called" assertion below would pass
    // no matter what order the gate and the capture ran in.
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    renderToolbar();
    await saveToLibrary(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(captureThumbnail).toHaveBeenCalledTimes(1); // the explicit save paid for one
    vi.mocked(captureThumbnail).mockClear();

    await clickNew(user);
    await waitFor(() => expect(useLibraryPointer.getState().mapId).toBe('minted-2'));
    // Still just the explicit save — the auto-save deduped against it.
    expect(saveVersion).toHaveBeenCalledTimes(1);
    // And it deduped BEFORE paying for a thumbnail.
    expect(captureThumbnail).not.toHaveBeenCalled();
  });

  it('New re-saves once the doc changes again', async () => {
    const user = userEvent.setup();
    seedRealMap();
    renderToolbar();
    await saveToLibrary(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    useDoc.getState().setDocName('Edited');
    await clickNew(user);
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveVersion).mock.calls[1][3]).toBe('auto');
  });
});

/**
 * The save gate is the menu item's enabled state: Save version is greyed out
 * exactly when the doc byte-for-byte matches a library version (clean), and
 * armed when it is dirty (edits) or unsaved (clean bytes the library holds no
 * copy of — a loaded file, a fresh New). The dot beside the version pill is
 * the same predicate, so the two can never disagree.
 */
describe('Toolbar — save gating (clean / dirty / unsaved)', () => {
  const seedMap = () =>
    useDoc.setState({
      ...useDoc.getState(),
      name: 'Gated',
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['S'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
      stations: { S: stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
    });

  const openCanvasMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
  };
  const saveItem = () => screen.getByRole('menuitem', { name: 'Save version' });

  it('greys out Save version when the doc matches its library baseline', async () => {
    const user = userEvent.setup();
    seedMap();
    anchor(markSaved);
    renderToolbar();
    await openCanvasMenu(user);
    expect(saveItem()).toHaveAttribute('aria-disabled', 'true');
  });

  it('arms Save version on an edit; saving greys it out again', async () => {
    const user = userEvent.setup();
    seedMap();
    anchor(markSaved);
    useDoc.getState().addStation(200, 0);
    renderToolbar();
    await openCanvasMenu(user);
    expect(saveItem()).not.toHaveAttribute('aria-disabled');
    await user.click(saveItem());
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(statusNow()).toBe('clean');
    await openCanvasMenu(user);
    expect(saveItem()).toHaveAttribute('aria-disabled', 'true');
  });

  it('arms Save version for a clean-but-unsaved doc, and saving imports it', async () => {
    const user = userEvent.setup();
    seedMap();
    anchor(markAdopted); // a loaded file: clean bytes, no library copy
    renderToolbar();
    await openCanvasMenu(user);
    expect(saveItem()).not.toHaveAttribute('aria-disabled');
    await user.click(saveItem());
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveVersion).mock.calls[0][3]).toBe('user');
    expect(statusNow()).toBe('clean');
  });

  it('an edit that lands during an in-flight save leaves the doc dirty', async () => {
    const user = userEvent.setup();
    seedMap();
    let resolveSave: (v: { id: number; version: number }) => void = () => {};
    vi.mocked(saveVersion).mockImplementation(
      () =>
        new Promise((res) => {
          resolveSave = res;
        }),
    );
    renderToolbar();
    await openCanvasMenu(user);
    await user.click(saveItem());
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    useDoc.getState().addStation(500, 500); // lands while the save is in flight
    resolveSave({ id: 1, version: 1 });
    await findToast(/Saved/); // the save confirmation
    // The save vouched for the bytes it captured, not for the mid-flight edit.
    expect(statusNow()).toBe('dirty');
  });

  it('New leaves a fresh map unsaved — armed to save, but not "changed"', async () => {
    const user = userEvent.setup();
    renderToolbar();
    await openCanvasMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'New' }));
    await waitFor(() => expect(statusNow()).toBe('unsaved'));
  });
});

/**
 * Ctrl/Cmd+S is a keyboard accelerator for Canvas ▸ Save version — it writes a
 * library version, NOT a JSON download, and never lets the browser's Save-page
 * dialog open. It honours the same clean-state gate the menu item's disabled
 * state enforces.
 */
describe('Toolbar — Ctrl+S saves a version', () => {
  const seedMap = (name = 'My Map') =>
    useDoc.setState({
      ...useDoc.getState(),
      name,
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['S'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
      stations: { S: stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
    });

  it('writes a user version to the library — never a JSON download — and swallows the dialog', async () => {
    seedMap('Canal Line'); // no baseline anchored → dirty → armed
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    renderToolbar();

    // fireEvent returns dispatchEvent's result: false when a handler called
    // preventDefault, which is how the browser Save-page dialog is suppressed.
    const notPrevented = fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(notPrevented).toBe(false);

    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveVersion).mock.calls[0][1]).toBe('Canal Line');
    expect(vi.mocked(saveVersion).mock.calls[0][3]).toBe('user');
    // It saved to the library, not to a downloaded file.
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('also fires on Cmd+S (metaKey), for mac', async () => {
    seedMap();
    renderToolbar();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
  });

  it('is a no-op on a clean doc (mirrors the greyed-out menu item) but still suppresses the dialog', () => {
    seedMap();
    anchor(markSaved); // clean: byte-for-byte a library version
    renderToolbar();
    const notPrevented = fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(notPrevented).toBe(false); // dialog still suppressed...
    expect(saveVersion).not.toHaveBeenCalled(); // ...but nothing minted
  });

  it('commits an in-progress rename before serializing (blur-first)', async () => {
    const user = userEvent.setup();
    seedMap('Original');
    anchor(markSaved); // clean, so ONLY the rename can arm the save
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    renderToolbar();

    await user.click(screen.getByRole('button', { name: 'Original' }));
    const input = screen.getByRole('textbox', { name: 'Map name' });
    await user.clear(input);
    await user.type(input, 'Renamed');
    // Uncommitted: the store still holds the old name, so the doc reads clean.
    expect(useDoc.getState().name).toBe('Original');
    expect(statusNow()).toBe('clean');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    // Blur committed the rename, flipping the doc dirty, so the save ran and
    // captured the NEW name rather than the stale one.
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
    expect(useDoc.getState().name).toBe('Renamed');
    expect(vi.mocked(saveVersion).mock.calls[0][1]).toBe('Renamed');
  });

  it('the Save version menu item advertises its Ctrl+S accelerator (name stays clean)', async () => {
    const user = userEvent.setup();
    seedMap();
    renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    // Found by the unpolluted name (the hint is aria-hidden), and it shows the key.
    const item = screen.getByRole('menuitem', { name: 'Save version' });
    expect(item).toHaveTextContent('Ctrl+S');
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
    renderToolbar();
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
    renderToolbar();
    await openExportSubmenu(user);
    fireEvent.click(screen.getByRole('menuitem', { name: 'SVG' }));

    await findToast(/Canvas not ready/);
    expect(exportCanvasSvg).not.toHaveBeenCalled();
  });
});

/**
 * The status surface: toolbar actions report outcomes as toasts. The contract
 * that separates toasts from the old single inline span: messages STACK (one
 * failure never overwrites another), and the save confirmation expires on its
 * own while errors stay until dismissed.
 */
describe('Toolbar — status toasts', () => {
  const seedRealMap = (name = 'My Map') =>
    useDoc.setState({
      ...useDoc.getState(),
      name,
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['S'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
      stations: { S: stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
    });

  const saveToLibrary = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Save version' }));
  };

  const openExportSubmenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
  };

  it('stacks outcomes: a save failure is still on screen after a later export failure', async () => {
    const user = userEvent.setup();
    seedRealMap();
    vi.mocked(saveVersion).mockRejectedValue(new Error('QuotaExceededError'));
    renderToolbar();
    await saveToLibrary(user);
    expect((await screen.findAllByText(/QuotaExceededError/)).length).toBeGreaterThan(0);
    // A second, unrelated failure must not clobber the first message.
    vi.mocked(getCanvasSvg).mockReturnValue(null);
    await openExportSubmenu(user);
    fireEvent.click(screen.getByRole('menuitem', { name: 'SVG' }));
    expect((await screen.findAllByText(/Canvas not ready/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/QuotaExceededError/).length).toBeGreaterThan(0);
  });

  it('the save confirmation dismisses itself', async () => {
    const user = userEvent.setup();
    seedRealMap('Canal Line');
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    // The short-duration seam: the contract is "expires on its own", asserted
    // with real timers that must not wait out the real three seconds.
    render(
      <>
        <Toolbar />
        <StatusToasts infoDurationMs={40} />
      </>,
    );
    await saveToLibrary(user);
    await findToast(/Saved “Canal Line”/);
    await waitForElementToBeRemoved(() => screen.queryAllByText(/Saved “Canal Line”/), {
      timeout: 2000,
    });
  });

  it('keeps the screen-reader announcement inside the anchor, off document.body', async () => {
    const user = userEvent.setup();
    seedRealMap();
    vi.mocked(getCanvasSvg).mockReturnValue(mountableSvg());
    renderToolbar();
    await saveToLibrary(user);
    await findToast(/Saved/);
    // Radix portals a visually-hidden announce element per toast to
    // document.body by default; at body's end its absolute box flickered a
    // scrollbar in and out (a ~10px page shift). announcerContainer must keep
    // it inside the fixed, clipped anchor, where it can't touch page layout.
    const anchor = document.querySelector('.status-toast-anchor')!;
    await waitFor(() => expect(anchor.querySelector('[aria-live]')).toBeTruthy());
    expect(document.body.querySelector(':scope > [aria-live]')).toBeNull();
  });

  it('an error outlives the info lifetime and leaves on click', async () => {
    const user = userEvent.setup();
    seedRealMap();
    vi.mocked(saveVersion).mockRejectedValue(new Error('QuotaExceededError'));
    render(
      <>
        <Toolbar />
        <StatusToasts infoDurationMs={40} />
      </>,
    );
    await saveToLibrary(user);
    const toast = await findToast(/QuotaExceededError/);
    // Well past the info lifetime: errors have no timer at all.
    await new Promise((r) => setTimeout(r, 120));
    expect(toastsNow()).toHaveLength(1);
    await user.click(toast);
    await waitFor(() => expect(toastsNow()).toHaveLength(0));
  });
});
