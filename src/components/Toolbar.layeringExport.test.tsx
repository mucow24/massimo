import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Same shape as Toolbar.exportSnapshot.test.tsx: stub only the export ENTRY
// POINTS so getCanvasSvg stays real and the export runs against the live
// <App/> canvas, letting each test inspect exactly what would be serialized.
vi.mock('../export/exportCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../export/exportCanvas')>();
  return {
    ...actual,
    downloadBlob: vi.fn(),
    exportCanvasSvg: vi.fn(async () => {}),
    captureThumbnail: vi.fn(async () => 'data:image/png;base64,THUMB'),
  };
});

// jsdom has no indexedDB; a partial mock would leave the real module reachable.
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
  setMapStarred: vi.fn(async () => {}),
  sortMaps: (rows: unknown[]) => rows,
  newMapId: vi.fn(() => 'minted-1'),
}));

import App from '../App';
import { exportCanvasSvg, captureThumbnail, EXPORT_EXCLUDE_ATTR } from '../export/exportCanvas';
import { saveVersion } from '../state/mapLibrary';
import { useLibraryPointer } from '../state/libraryPointer';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makeTextLabel, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';
import { stubCanvasHostSize } from '../test/interaction';

stubCanvasHostSize();

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useViewportStore.setState({ x: 0, y: 0, zoom: 1, showNetwork: true });
  useSelection.setState({ selectedLineId: null, selectedStationIds: [], uiMode: { kind: 'idle' } });
  vi.mocked(exportCanvasSvg).mockClear();
  vi.mocked(captureThumbnail).mockClear();
  vi.mocked(saveVersion).mockClear();
  useLibraryPointer.setState({ mapId: null, version: null });
});
afterEach(() => {
  useSelection.setState({ uiMode: { kind: 'idle' } });
});

const seed = () =>
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          stationWithStop('s1' as StationId, 'L1' as LineId, { x: 0, y: 0 }, { name: 'Bond St' }),
          stationWithStop('s2' as StationId, 'L1' as LineId, { x: 200, y: 0 }, { name: 'Oxford' }),
        ],
        lines: [makeLine({ id: 'L1' as LineId, stations: ['s1', 's2'] as StationId[] })],
        lineOrder: ['L1' as LineId],
        textLabels: [makeTextLabel({ id: 't1', text: 'River Thames', x: 60, y: 60 })],
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

/** buildExportSvg's own strip pass (exportCanvas.ts), applied to a snapshot. */
const stripChrome = (svg: SVGSVGElement): SVGSVGElement => {
  svg
    .querySelectorAll(`[data-bg],[${EXPORT_EXCLUDE_ATTR}],foreignObject`)
    .forEach((el) => el.remove());
  return svg;
};

/** Effective opacity of `el`: the product of every `opacity` attribute from the
 *  element up to the (detached) root — exactly how SVG composites it. */
const effectiveOpacity = (el: Element): number => {
  let o = 1;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const a = n.getAttribute('opacity');
    if (a !== null) o *= Number(a);
  }
  return o;
};

/** The painted <text> carrying `name` in a captured snapshot. */
const labelTextNamed = (svg: SVGSVGElement, name: string): SVGTextElement => {
  const hit = Array.from(svg.querySelectorAll('text')).find((t) =>
    (t.textContent ?? '').includes(name),
  );
  if (!hit) throw new Error(`no <text> containing "${name}" in the snapshot`);
  return hit;
};

describe('export must not bake layering mode’s focus fade into the file', () => {
  it('exports station names, text labels at full opacity while layering mode is on', async () => {
    render(<App />);
    seed();
    act(() => {
      useSelection.getState().setUiMode({ kind: 'layering' });
    });
    // Precondition: the mode really is on, so the assertions can't pass vacuously.
    expect(useSelection.getState().uiMode.kind).toBe('layering');

    const captured = stripChrome(await exportSvg());

    // Layering mode is an editing aid — a focus dim so the eye stays on the
    // band layers. It is not a decision about the map's content, so, like the
    // line-selection dim and the lines/stations toggle, it must not reach the
    // file.
    expect(effectiveOpacity(labelTextNamed(captured, 'Bond St'))).toBe(1);
    expect(effectiveOpacity(captured.querySelector('[data-text-label-id="t1"]')!)).toBe(1);
  });

  it('baseline: exports them at full opacity outside layering mode', async () => {
    render(<App />);
    seed();
    const captured = stripChrome(await exportSvg());
    expect(effectiveOpacity(labelTextNamed(captured, 'Bond St'))).toBe(1);
    expect(effectiveOpacity(captured.querySelector('[data-text-label-id="t1"]')!)).toBe(1);
  });

  it('captures a library thumbnail at full opacity while layering mode is on', async () => {
    render(<App />);
    seed();
    act(() => {
      useSelection.getState().setUiMode({ kind: 'layering' });
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Save version' }));
    await waitFor(() => expect(captureThumbnail).toHaveBeenCalledTimes(1));

    const captured = stripChrome(vi.mocked(captureThumbnail).mock.calls[0][0]);
    expect(effectiveOpacity(labelTextNamed(captured, 'Bond St'))).toBe(1);
  });
});
