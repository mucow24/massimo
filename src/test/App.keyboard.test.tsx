import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { beginHistoryGroup, useDoc, useSelection } from '../state/store';
import { historyDepth, isHistoryGrouping, redoDepth } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import { readClipboard, writeClipboard, type ClipPayload } from '../model/clipboard';
import {
  makeLine,
  makePolygon,
  makeRouteBullet,
  makeSvgImage,
  makeTextLabel,
} from '../test/fixtures';
import type { RouteBullet } from '../model/types';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    // A stray vertex selection would take Delete/nudge priority in the next
    // test (which spreads the live selection), so reset it between tests.
    selectedVertices: null,
  });
});

describe('App keyboard shortcuts: Escape', () => {
  it('deselects a selected polygon, so its popover closes like the other item popovers', () => {
    render(<App />);
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p1: makePolygon({ id: 'p1' }) },
      backgroundOrder: ['p1'],
    });
    useSelection.getState().selectPolygon('p1');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
  });

  it('outside a field, deselects the selected label (popover closes)', () => {
    render(<App />);
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: makeTextLabel({ id: 'g1' }) } });
    useSelection.getState().selectLabel('g1');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useSelection.getState().selectedLabelIds).toEqual([]);
  });

  // Esc while typing belongs to the field (revert / unfocus per native
  // behavior) — it must not close popovers or cancel modes out from under an
  // in-progress edit. This guard used to live only inside TextLabelPopover,
  // where the global handler silently defeated it. (Selection and mode are
  // asserted separately: selecting an item exits any mode by design.)
  it('while typing in a text field, blurs the field but keeps the selection (two-step escape)', () => {
    render(<App />);
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: makeTextLabel({ id: 'g1' }) } });
    useSelection.getState().selectLabel('g1');
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
      // Plain inputs have no native Esc behavior, so a swallowed Esc would be
      // a dead key. Instead the first Esc leaves the field; a second Esc then
      // closes/cancels as usual.
      expect(document.activeElement).not.toBe(input);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(useSelection.getState().selectedLabelIds).toEqual([]);
    } finally {
      document.body.removeChild(input);
      useSelection.getState().selectLabel(null);
    }
  });

  it('while typing in a text field, an active mode stays put', () => {
    render(<App />);
    useSelection.getState().setUiMode({ kind: 'placing-station' });
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(useSelection.getState().uiMode.kind).toBe('placing-station');
    } finally {
      document.body.removeChild(input);
      useSelection.getState().setUiMode({ kind: 'idle' });
    }
  });

  // The guard deliberately excludes range/color inputs (like the Ctrl-combos):
  // they have no in-progress edit to protect, so Esc mid-slider still works.
  it('falls through on a focused range slider (Esc still deselects)', () => {
    render(<App />);
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: makeTextLabel({ id: 'g1' }) } });
    useSelection.getState().selectLabel('g1');
    const input = document.createElement('input');
    input.type = 'range';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(useSelection.getState().selectedLabelIds).toEqual([]);
    } finally {
      document.body.removeChild(input);
    }
  });
});

describe('App keyboard shortcuts: inForm guard routing', () => {
  it('Ctrl+Z fires on a focused range slider (slider drag is undoable without click-away)', async () => {
    render(<App />);
    // Any range slider exercises the guard; the line inspector's Curve
    // radius slider stands in for the retired Options one. Seed + select
    // BEFORE the baseline so the seeding write isn't what Ctrl+Z pops.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' }) },
      lineOrder: ['L1'],
    });
    useSelection.getState().selectLine('L1');
    // Create an undoable entry so Ctrl+Z has something to pop.
    useDoc.getState().addStation(50, 50);
    const pastBefore = historyDepth();
    const stationsBefore = Object.keys(useDoc.getState().stations).length;

    const slider = await screen.findByRole('slider', { name: /curve radius/i });
    slider.focus();

    fireEvent.keyDown(slider, { key: 'z', ctrlKey: true });

    expect(historyDepth()).toBe(pastBefore - 1);
    expect(Object.keys(useDoc.getState().stations).length).toBe(stationsBefore - 1);
  });

  it('Ctrl+Z is suppressed on a focused text input (preserves native text undo)', () => {
    render(<App />);
    useDoc.getState().addStation(50, 50);
    const pastBefore = historyDepth();

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      expect(historyDepth()).toBe(pastBefore);
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Ctrl+Z fires on a focused color picker (no native text undo to preserve)', () => {
    render(<App />);
    useDoc.getState().addStation(50, 50);
    const pastBefore = historyDepth();

    const input = document.createElement('input');
    input.type = 'color';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      expect(historyDepth()).toBe(pastBefore - 1);
    } finally {
      document.body.removeChild(input);
    }
  });

  // Regression for an a11y concern caught in self-review: an earlier draft of
  // the inForm narrowing included checkbox/radio/button-likes in the denylist,
  // which let the global Space handler preempt native checkbox toggling.
  it('Space on a focused palette checkbox does not trigger pan mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const bart = screen.getByRole('checkbox', { name: 'BART' });
    bart.focus();

    fireEvent.keyDown(bart, { key: ' ' });

    expect(useSelection.getState().spaceHeld).toBe(false);
  });

  // The non-modifier canvas shortcuts (Space-pan, a/h/l/t tools) must NOT fire
  // while a range slider or color picker is focused — `inForm` lets those
  // through for the Ctrl-combos, but `inFormControl` (the stricter test) gates
  // the bare shortcuts so adjusting a slider can't hijack the canvas.
  for (const type of ['range', 'color'] as const) {
    it(`Space on a focused ${type} input does not trigger pan mode`, () => {
      render(<App />);
      const input = document.createElement('input');
      input.type = type;
      document.body.appendChild(input);
      input.focus();
      try {
        fireEvent.keyDown(input, { key: ' ' });
        expect(useSelection.getState().spaceHeld).toBe(false);
      } finally {
        document.body.removeChild(input);
      }
    });

    it(`tool shortcut "t" on a focused ${type} input does not switch mode`, () => {
      render(<App />);
      const input = document.createElement('input');
      input.type = type;
      document.body.appendChild(input);
      input.focus();
      try {
        fireEvent.keyDown(input, { key: 't' });
        expect(useSelection.getState().uiMode.kind).toBe('idle');
      } finally {
        document.body.removeChild(input);
      }
    });
  }

  it('window blur resets a held Space (stuck-pan guard)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(useSelection.getState().spaceHeld).toBe(true);
    fireEvent.blur(window);
    expect(useSelection.getState().spaceHeld).toBe(false);
  });
});

describe('App keyboard shortcuts: layering mode', () => {
  it("L toggles uiMode to 'layering', then back to 'idle'", () => {
    render(<App />);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    fireEvent.keyDown(window, { key: 'l' });
    expect(useSelection.getState().uiMode.kind).toBe('layering');
    fireEvent.keyDown(window, { key: 'l' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('L is case-insensitive (Shift+L behaves the same)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'L' });
    expect(useSelection.getState().uiMode.kind).toBe('layering');
  });

  it('Esc exits layering mode', () => {
    render(<App />);
    useSelection.setState({ uiMode: { kind: 'layering' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('L on a focused text input is suppressed (typing "l" in the input keeps mode untouched)', () => {
    render(<App />);
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'l' });
      expect(useSelection.getState().uiMode.kind).toBe('idle');
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Ctrl+L is NOT bound (e.g. browser focus-address-bar gestures pass through)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});

describe('App keyboard shortcuts: add-transfer mode', () => {
  it("T toggles uiMode to 'creating-transfer', then back to 'idle'", () => {
    render(<App />);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    fireEvent.keyDown(window, { key: 't' });
    expect(useSelection.getState().uiMode.kind).toBe('creating-transfer');
    fireEvent.keyDown(window, { key: 't' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('T is case-insensitive (Shift+T behaves the same)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'T' });
    expect(useSelection.getState().uiMode.kind).toBe('creating-transfer');
  });

  it('Esc exits add-transfer mode', () => {
    render(<App />);
    useSelection.setState({ uiMode: { kind: 'creating-transfer', anchor: null } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('T on a focused text input is suppressed (typing "t" keeps mode untouched)', () => {
    render(<App />);
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 't' });
      expect(useSelection.getState().uiMode.kind).toBe('idle');
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Ctrl+T is NOT bound (browser new-tab gesture passes through)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 't', ctrlKey: true });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});

describe('App keyboard shortcuts: blur-then-undo', () => {
  it('Ctrl+Z mid-slider-drag commits the open field-history group, then undoes the drag', async () => {
    render(<App />);
    // The line inspector's Curve radius slider (NumericFieldRow) drives its
    // own field-history group — the same blur-then-undo contract the retired
    // Options curve slider exercised.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' }) },
      lineOrder: ['L1'],
    });
    useSelection.getState().selectLine('L1');
    const slider = (await screen.findByRole('slider', {
      name: /curve radius/i,
    })) as HTMLInputElement;
    const initial = Number(slider.value);
    const pastBaseline = historyDepth();

    // Simulate focus → mid-drag → Ctrl+Z without intervening blur. The focus
    // opens a field-history group (pauses zundo); the change mutates state
    // but no entry lands on pastStates yet; the Ctrl+Z handler must blur the
    // active element so commit() runs, *then* undo against the just-pushed
    // entry. Without blur-then-undo, undo would skip the in-progress edit.
    //
    // Note: use the real DOM .focus() (not fireEvent.focus) so jsdom updates
    // document.activeElement — the Ctrl+Z handler's blur target depends on it.
    slider.focus();
    fireEvent.change(slider, { target: { value: String(initial + 4) } });
    expect(useDoc.getState().lines.L1.curveRadius).toBe(initial + 4);

    fireEvent.keyDown(slider, { key: 'z', ctrlKey: true });

    expect(useDoc.getState().lines.L1.curveRadius).toBeUndefined(); // back to default
    expect(historyDepth()).toBe(pastBaseline);
    expect(redoDepth()).toBe(1);
  });
});

describe('App keyboard shortcuts: copy / cut / paste / duplicate', () => {
  let writeText: ReturnType<typeof vi.fn>;
  let readText: ReturnType<typeof vi.fn>;

  // jsdom has no real clipboard — stub one. Copy is synchronous (writeText is
  // fire-and-forget); paste reads through a promise, so those tests `waitFor`.
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    readText = vi.fn().mockResolvedValue('');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, readText },
      configurable: true,
    });
    // The outer beforeEach doesn't reset the selection id-lists; clear them so
    // stale selection from a prior test can't leak into these assertions.
    useSelection.getState().selectStation(null);
  });

  const labelClip = (): ClipPayload => ({
    kind: 'text-label',
    data: {
      x: 0,
      y: 0,
      rotation: 0,
      text: 't',
      fontSize: 24,
      weight: 400,
      italic: false,
      align: 'left',
      color: '#111111',
      darkColor: '#ffffff',
    },
  });
  const polygonClip = (): ClipPayload => ({
    kind: 'polygon',
    data: {
      vertices: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      fill: '#ffffff',
      stroke: '#000000',
      darkFill: '#ffffff',
      darkStroke: '#000000',
      strokeWidth: 1,
    },
  });
  const bulletClip = (): ClipPayload => ({
    kind: 'route-bullet',
    data: { x: 0, y: 0, rotation: 0, lineId: null, shape: 'circle', size: 10 },
  });

  it('Ctrl+C writes the selected label + polygon to the clipboard', () => {
    render(<App />);
    const labelId = useDoc.getState().addTextLabel(10, 10);
    const polyId = useDoc.getState().addPolygon(20, 20);
    useSelection.getState().setMixedSelection({ labels: [labelId], polygons: [polyId] });

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });

    expect(writeText).toHaveBeenCalledTimes(1);
    const items = readClipboard(writeText.mock.calls[0][0] as string);
    expect(items?.map((i) => i.kind).sort()).toEqual(['polygon', 'text-label']);
    // Beyond the kinds: each payload must carry ITS OWN item's data. Compare the
    // serialized data against the live doc (minus the id) so a payload swap —
    // which keeps the kinds intact — is caught.
    const labelItem = items?.find((i) => i.kind === 'text-label');
    const polyItem = items?.find((i) => i.kind === 'polygon');
    const { id: _lid, ...labelData } = useDoc.getState().textLabels[labelId];
    const { id: _pid, ...polyData } = useDoc.getState().polygons[polyId];
    expect(labelItem?.data).toMatchObject({
      x: 10,
      y: 10,
      text: labelData.text,
      color: labelData.color,
    });
    expect(polyItem?.data).toMatchObject({
      vertices: polyData.vertices,
      fill: polyData.fill,
    });
  });

  it('Ctrl+C is a no-op when only a station is selected (native copy survives)', () => {
    render(<App />);
    const s = useDoc.getState().addStation(10, 10);
    useSelection.getState().selectStation(s);

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });

    expect(writeText).not.toHaveBeenCalled();
  });

  it('Ctrl+V pastes a mixed clipboard as ONE undo step and selects the new items', async () => {
    render(<App />);
    readText.mockResolvedValue(writeClipboard([bulletClip(), labelClip(), polygonClip()]));
    const bulletsBefore = Object.keys(useDoc.getState().routeBullets).length;
    const labelsBefore = Object.keys(useDoc.getState().textLabels).length;
    const polysBefore = Object.keys(useDoc.getState().polygons).length;
    const pastBefore = historyDepth();

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    await waitFor(() =>
      expect(Object.keys(useDoc.getState().routeBullets).length).toBe(bulletsBefore + 1),
    );
    expect(Object.keys(useDoc.getState().textLabels).length).toBe(labelsBefore + 1);
    expect(Object.keys(useDoc.getState().polygons).length).toBe(polysBefore + 1);
    // One grouped history entry for the whole paste.
    expect(historyDepth()).toBe(pastBefore + 1);
    const sel = useSelection.getState();
    expect(sel.selectedRouteBulletIds).toHaveLength(1);
    expect(sel.selectedLabelIds).toHaveLength(1);
    expect(sel.selectedPolygonIds).toHaveLength(1);
  });

  it('Ctrl+V ignores a foreign / unparseable clipboard', async () => {
    render(<App />);
    readText.mockResolvedValue('not our clipboard');
    const labelsBefore = Object.keys(useDoc.getState().textLabels).length;

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    // Give the promise a chance to resolve, then assert nothing changed.
    await Promise.resolve();
    await Promise.resolve();
    expect(Object.keys(useDoc.getState().textLabels).length).toBe(labelsBefore);
  });

  it('Ctrl+D duplicates a mixed selection as ONE undo step and selects the copies', () => {
    render(<App />);
    // Give the source items non-default fields so a "copies defaults instead of
    // source" bug is visible in the duplicate.
    const b = useDoc.getState().addRouteBullet(40, 40, null);
    useDoc.getState().updateRouteBullet(b, { shape: 'diamond', size: 18 });
    const l = useDoc.getState().addTextLabel(40, 40);
    useDoc.getState().updateTextLabel(l, { text: 'SRC', color: '#abcdef' });
    const p = useDoc.getState().addPolygon(40, 40);
    useSelection.getState().setMixedSelection({ bullets: [b], labels: [l], polygons: [p] });
    const bulletsBefore = Object.keys(useDoc.getState().routeBullets).length;
    const pastBefore = historyDepth();
    // Snapshot the source field values to compare the duplicates against.
    const srcBullet = useDoc.getState().routeBullets[b];
    const srcLabel = useDoc.getState().textLabels[l];
    const srcPoly = useDoc.getState().polygons[p];

    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });

    expect(Object.keys(useDoc.getState().routeBullets).length).toBe(bulletsBefore + 1);
    expect(Object.keys(useDoc.getState().textLabels).length).toBe(2);
    expect(Object.keys(useDoc.getState().polygons).length).toBe(2);
    expect(historyDepth()).toBe(pastBefore + 1);
    const sel = useSelection.getState();
    expect(sel.selectedRouteBulletIds).toHaveLength(1);
    expect(sel.selectedLabelIds).toHaveLength(1);
    expect(sel.selectedPolygonIds).toHaveLength(1);
    // Selection points at the duplicates, not the sources.
    const dupBulletId = sel.selectedRouteBulletIds[0];
    const dupLabelId = sel.selectedLabelIds[0];
    const dupPolyId = sel.selectedPolygonIds[0];
    expect(dupBulletId).not.toBe(b);
    expect(dupLabelId).not.toBe(l);
    expect(dupPolyId).not.toBe(p);

    // Each duplicate carries the SOURCE's field values, with a +15 drop offset
    // on position (DROP_OFFSET). Catches a "copy defaults instead of source" bug
    // that the count assertions miss.
    const dupBullet = useDoc.getState().routeBullets[dupBulletId];
    expect(dupBullet).toMatchObject({
      shape: srcBullet.shape,
      size: srcBullet.size,
      rotation: srcBullet.rotation,
      lineId: srcBullet.lineId,
      x: srcBullet.x + 15,
      y: srcBullet.y + 15,
    });
    const dupLabel = useDoc.getState().textLabels[dupLabelId];
    expect(dupLabel).toMatchObject({
      text: srcLabel.text,
      color: srcLabel.color,
      x: srcLabel.x + 15,
      y: srcLabel.y + 15,
    });
    const dupPoly = useDoc.getState().polygons[dupPolyId];
    expect(dupPoly.fill).toBe(srcPoly.fill);
    expect(dupPoly.vertices).toEqual(srcPoly.vertices.map((v) => ({ x: v.x + 15, y: v.y + 15 })));
  });

  it('Ctrl+D is a no-op when nothing copyable is selected', () => {
    render(<App />);
    const pastBefore = historyDepth();

    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });

    expect(historyDepth()).toBe(pastBefore);
  });

  it('Ctrl+D on a focused text input is suppressed (inForm guard)', () => {
    render(<App />);
    const b = useDoc.getState().addRouteBullet(0, 0, null);
    useSelection.getState().selectRouteBullet(b);
    const before = Object.keys(useDoc.getState().routeBullets).length;

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'd', ctrlKey: true });
      expect(Object.keys(useDoc.getState().routeBullets).length).toBe(before);
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Ctrl+X copies the selection to the clipboard AND deletes it as ONE undo step, clearing selection', () => {
    render(<App />);
    const b = useDoc.getState().addRouteBullet(30, 30, null);
    const l = useDoc.getState().addTextLabel(30, 30);
    const p = useDoc.getState().addPolygon(30, 30);
    useSelection.getState().setMixedSelection({ bullets: [b], labels: [l], polygons: [p] });
    const pastBefore = historyDepth();

    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });

    // Copied: the clipboard carries all three kinds (payload built pre-delete).
    expect(writeText).toHaveBeenCalledTimes(1);
    const items = readClipboard(writeText.mock.calls[0][0] as string);
    expect(items?.map((i) => i.kind).sort()).toEqual(['polygon', 'route-bullet', 'text-label']);
    // Deleted: the originals are gone from the doc.
    expect(useDoc.getState().routeBullets[b]).toBeUndefined();
    expect(useDoc.getState().textLabels[l]).toBeUndefined();
    expect(useDoc.getState().polygons[p]).toBeUndefined();
    // One grouped history entry for the whole cut, and selection cleared so no
    // dangling id points at a now-deleted item.
    expect(historyDepth()).toBe(pastBefore + 1);
    const sel = useSelection.getState();
    expect(sel.selectedRouteBulletIds).toEqual([]);
    expect(sel.selectedLabelIds).toEqual([]);
    expect(sel.selectedPolygonIds).toEqual([]);
  });

  it('Ctrl+X cuts only the unlocked items — locked ones are neither copied nor deleted', () => {
    render(<App />);
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        lockB: makeRouteBullet({ id: 'lockB', x: 0, y: 0, lineId: null, locked: true }),
        freeB: makeRouteBullet({ id: 'freeB', x: 100, y: 0, lineId: null }),
      },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: [],
      selectedLabelIds: [],
      selectedPolygonIds: [],
      selectedSvgImageIds: [],
      selectedRouteBulletIds: ['lockB', 'freeB'],
    });

    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });

    // Only the unlocked bullet reaches the clipboard.
    const items = readClipboard(writeText.mock.calls[0][0] as string);
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: 'route-bullet', data: { x: 100 } });
    // Unlocked deleted, locked kept in place.
    expect(useDoc.getState().routeBullets['freeB']).toBeUndefined();
    expect(useDoc.getState().routeBullets['lockB']).toBeDefined();
  });

  it('Ctrl+X is a no-op when only a station is selected (native cut survives, station stays)', () => {
    render(<App />);
    const s = useDoc.getState().addStation(10, 10);
    useSelection.getState().selectStation(s);
    const pastBefore = historyDepth();

    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });

    expect(writeText).not.toHaveBeenCalled();
    expect(useDoc.getState().stations[s]).toBeDefined();
    expect(historyDepth()).toBe(pastBefore);
  });

  it('Ctrl+X on a focused text input is suppressed (inForm guard, native cut preserved)', () => {
    render(<App />);
    const b = useDoc.getState().addRouteBullet(0, 0, null);
    useSelection.getState().selectRouteBullet(b);

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'x', ctrlKey: true });
      expect(useDoc.getState().routeBullets[b]).toBeDefined();
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(input);
    }
  });
});

describe('App keyboard: locked bullets and labels resist Delete and arrow-nudge', () => {
  const bullet = (over: Partial<RouteBullet> & { id: string }): RouteBullet => ({
    x: 0,
    y: 0,
    rotation: 0,
    lineId: null,
    shape: 'circle',
    size: 8,
    ...over,
  });

  // Seed two bullets + two labels (one of each locked), all four selected.
  function seedMixed() {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: {
        lockB: bullet({ id: 'lockB', x: 0, y: 0, locked: true }),
        freeB: bullet({ id: 'freeB', x: 100, y: 0 }),
      },
      textLabels: {
        lockL: makeTextLabel({ id: 'lockL', x: 0, y: 0, locked: true }),
        freeL: makeTextLabel({ id: 'freeL', x: 100, y: 0 }),
      },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: [],
      selectedPolygonIds: [],
      selectedVertices: null,
      selectedRouteBulletIds: ['lockB', 'freeB'],
      selectedLabelIds: ['lockL', 'freeL'],
    });
  }

  it('Delete removes the unlocked bullet/label but keeps the locked ones', () => {
    render(<App />);
    seedMixed();
    fireEvent.keyDown(window, { key: 'Delete' });
    const doc = useDoc.getState();
    expect(doc.routeBullets['freeB']).toBeUndefined();
    expect(doc.textLabels['freeL']).toBeUndefined();
    expect(doc.routeBullets['lockB']).toBeDefined();
    expect(doc.textLabels['lockL']).toBeDefined();
  });

  it('Arrow nudge moves the unlocked bullet/label but not the locked ones', () => {
    render(<App />);
    seedMixed();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const doc = useDoc.getState();
    expect(doc.routeBullets['freeB'].x).toBe(101);
    expect(doc.textLabels['freeL'].x).toBe(101);
    expect(doc.routeBullets['lockB'].x).toBe(0);
    expect(doc.textLabels['lockL'].x).toBe(0);
  });
});

describe('App keyboard: locked stations resist Delete and arrow-nudge', () => {
  // Seed one locked + one unlocked station, both selected.
  function seedStations() {
    const locked = useDoc.getState().addStation(0, 0);
    const free = useDoc.getState().addStation(100, 0);
    useDoc.getState().setStationLocked(locked, true);
    useSelection.setState({
      ...useSelection.getState(),
      selectedRouteBulletIds: [],
      selectedLabelIds: [],
      selectedPolygonIds: [],
      selectedVertices: null,
      selectedStationIds: [locked, free],
    });
    return { locked, free };
  }

  it('Delete removes the unlocked station but keeps the locked one', () => {
    render(<App />);
    const { locked, free } = seedStations();
    fireEvent.keyDown(window, { key: 'Delete' });
    const doc = useDoc.getState();
    expect(doc.stations[free]).toBeUndefined();
    expect(doc.stations[locked]).toBeDefined();
  });

  it('Arrow nudge moves the unlocked station but not the locked one', () => {
    render(<App />);
    const { locked, free } = seedStations();
    const lockedX = useDoc.getState().stations[locked].x;
    const freeX = useDoc.getState().stations[free].x;
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const doc = useDoc.getState();
    expect(doc.stations[free].x).toBe(freeX + 1);
    expect(doc.stations[locked].x).toBe(lockedX);
  });
});

describe('App keyboard: polygon vertices (multi-select)', () => {
  // A pentagon so two vertices can be deleted while staying above the 3-floor.
  const seedPentagon = (indices: number[], locked = false) => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        p0: makePolygon({
          id: 'p0',
          locked,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 5, y: 15 },
            { x: 0, y: 10 },
          ],
        }),
      },
      backgroundOrder: ['p0'],
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: [],
      selectedRouteBulletIds: [],
      selectedLabelIds: [],
      selectedSvgImageIds: [],
      selectedPolygonIds: ['p0'],
      selectedVertices: { polygonId: 'p0', indices },
    });
  };

  it('Delete removes every selected vertex and keeps the polygon selected', () => {
    render(<App />);
    seedPentagon([1, 3]);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(useDoc.getState().polygons['p0'].vertices).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    // Polygon stays selected (popover open); the vertex handles clear.
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p0']);
    expect(useSelection.getState().selectedVertices).toBeNull();
  });

  it('Arrow nudges every selected vertex together, leaving the rest put', () => {
    render(<App />);
    seedPentagon([0, 2]);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const verts = useDoc.getState().polygons['p0'].vertices;
    expect(verts[0]).toEqual({ x: 1, y: 0 }); // moved +1 x
    expect(verts[2]).toEqual({ x: 11, y: 10 }); // moved +1 x
    expect(verts[1]).toEqual({ x: 10, y: 0 }); // untouched
    expect(verts[3]).toEqual({ x: 5, y: 15 });
    expect(verts[4]).toEqual({ x: 0, y: 10 });
  });

  it('a locked polygon ignores vertex Delete and nudge', () => {
    render(<App />);
    seedPentagon([1, 3], true);
    const before = useDoc.getState().polygons['p0'].vertices;
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(useDoc.getState().polygons['p0'].vertices).toEqual(before);
  });
});

describe('App keyboard: svg images', () => {
  it('Delete removes unlocked selected svg images but keeps locked ones', () => {
    render(<App />);
    useDoc.setState({
      ...useDoc.getState(),
      svgImages: { a: makeSvgImage({ id: 'a' }), b: makeSvgImage({ id: 'b', locked: true }) },
      backgroundOrder: ['a', 'b'],
    });
    useSelection.setState({ ...useSelection.getState(), selectedSvgImageIds: ['a', 'b'] });
    fireEvent.keyDown(window, { key: 'Delete' });
    const doc = useDoc.getState();
    expect(doc.svgImages.a).toBeUndefined();
    expect(doc.svgImages.b).toBeDefined();
  });

  it('Arrow nudge moves a selected svg image by its center', () => {
    render(<App />);
    useDoc.setState({
      ...useDoc.getState(),
      svgImages: { a: makeSvgImage({ id: 'a', x: 10, y: 10 }) },
      backgroundOrder: ['a'],
    });
    useSelection.setState({ ...useSelection.getState(), selectedSvgImageIds: ['a'] });
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(useDoc.getState().svgImages.a).toMatchObject({ x: 15, y: 10 });
  });
});

describe('App keyboard: stop/label lattice nudge (station sub-selection)', () => {
  const seedHub = (over: { mirror?: boolean } = {}) => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      stations: {
        a: {
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
        },
        b: {
          id: 'b',
          name: 'B',
          x: 400,
          y: 100,
          rotation: 0,
          stops: [
            { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
            { lineId: 'L2', row: 0, col: 1, orientation: 'auto-vertical' },
          ],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
      lines: {
        L1: makeLine({
          id: 'L1',
          service: '1',
          name: '1 line',
          color: '#111111',
          stations: ['a', 'b'],
        }),
        L2: makeLine({
          id: 'L2',
          service: '2',
          name: '2 line',
          color: '#222222',
          stations: ['a', 'b'],
        }),
      },
      lineOrder: ['L1', 'L2'],
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['a'],
      selectedStopLineId: null,
      labelSelected: false,
      mirrorMatching: over.mirror ?? false,
    });
    useDoc.temporal.getState().clear();
  };

  it('ArrowUp moves the selected stop one lattice slot and leaves the station put', () => {
    render(<App />);
    seedHub();
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L1' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const st = useDoc.getState().stations.a;
    const stop = st.stops.find((s) => s.lineId === 'L1')!;
    expect(stop.row).toBeCloseTo(-1, 3);
    expect(stop.col).toBeCloseTo(0, 3);
    // The station itself did NOT move (the old behavior nudged it 1px).
    expect(st.x).toBe(100);
    expect(st.y).toBe(100);
  });

  it('each arrow press is one undo entry', () => {
    render(<App />);
    seedHub();
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L1' });
    const before = historyDepth();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(historyDepth() - before).toBe(1);
  });

  it('label cell nudges too, hopping over stops per moveLabel', () => {
    render(<App />);
    seedHub();
    useSelection.setState({ ...useSelection.getState(), labelSelected: true });
    // Label at (0,-1); Right passes THROUGH the stops at (0,0) and (0,1) and
    // lands at (0,2) via moveLabel's step-past-occupied rule.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const st = useDoc.getState().stations.a;
    expect(st.label.row).toBeCloseTo(0, 3);
    expect(st.label.col).toBeCloseTo(2, 3);
  });

  it('Alt+Arrow fine-nudges the label offset in screen pixels (Shift ×5)', () => {
    render(<App />);
    seedHub();
    useSelection.setState({ ...useSelection.getState(), labelSelected: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    let st = useDoc.getState().stations.a;
    expect(st.label.offset).toBeCloseTo(1, 6);
    expect(st.label.col).toBe(-1); // cell untouched
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true, shiftKey: true });
    st = useDoc.getState().stations.a;
    expect(st.label.offset).toBeCloseTo(1, 6);
    expect(st.label.offsetPerp ?? 0).toBeCloseTo(5, 6);
  });

  it('Alt offset nudge is one undo entry per press (two field writes collapse)', () => {
    render(<App />);
    seedHub();
    useSelection.setState({ ...useSelection.getState(), labelSelected: true });
    // A diagonal-reading label writes BOTH offset and offsetPerp in one press.
    useDoc.setState((s) => ({
      stations: {
        ...s.stations,
        a: { ...s.stations.a, label: { ...s.stations.a.label, rotation: 1 } },
      },
    }));
    useDoc.temporal.getState().clear();
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    expect(historyDepth()).toBe(1);
  });

  it('Alt offset nudge inside an already-open history group neither commits nor resumes it', () => {
    // Groups don't nest (store.ts): a drag gesture's group can be open when
    // the keyboard fires (global listener, no drag-in-flight guard). The
    // Alt+arrow fan-out must gate on isHistoryGrouping() like
    // dispatchMirrored does, or its inner commit() resumes tracking
    // mid-gesture and the drag lands as one undo entry per write.
    render(<App />);
    seedHub({ mirror: true });
    useSelection.setState({ ...useSelection.getState(), labelSelected: true });
    useDoc.temporal.getState().clear();

    const outer = beginHistoryGroup();
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    // The broadcast landed on both mirror targets...
    expect(useDoc.getState().stations.a.label.offset).toBeCloseTo(1, 6);
    expect(useDoc.getState().stations.b.label.offset).toBeCloseTo(1, 6);
    // ...but the outer group is still the one open arc: nothing recorded,
    // grouping still active.
    expect(isHistoryGrouping()).toBe(true);
    expect(historyDepth()).toBe(0);
    outer.commit();
    expect(historyDepth()).toBe(1);
  });

  it('R rotates the selected stop orientation (and the label with labelSelected)', () => {
    render(<App />);
    seedHub();
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L1' });
    fireEvent.keyDown(window, { key: 'r' });
    expect(useDoc.getState().stations.a.stops.find((s) => s.lineId === 'L1')!.orientation).toBe(
      'auto-ne-sw',
    );

    useSelection.setState({
      ...useSelection.getState(),
      selectedStopLineId: null,
      labelSelected: true,
    });
    fireEvent.keyDown(window, { key: 'r' });
    expect(useDoc.getState().stations.a.label.rotation).toBe(1);
  });

  it('mirror matching broadcasts the nudge to the matching station in one entry', () => {
    render(<App />);
    seedHub({ mirror: true });
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L1' });
    const before = historyDepth();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const doc = useDoc.getState();
    const aStop = doc.stations.a.stops.find((s) => s.lineId === 'L1')!;
    const bStop = doc.stations.b.stops.find((s) => s.lineId === 'L1')!;
    expect(aStop.row).toBeCloseTo(-1, 3);
    expect(bStop.row).toBeCloseTo(-1, 3);
    expect(historyDepth() - before).toBe(1);
  });
});

describe('App keyboard: dangling stop sub-selection falls back to station nudge', () => {
  it('arrows nudge the STATION when selectedStopLineId no longer matches a stop', () => {
    render(<App />);
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      stations: {
        a: {
          id: 'a',
          name: 'A',
          x: 100,
          y: 100,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
      lines: {
        L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] }),
      },
      lineOrder: ['L1'],
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['a'],
      // A stale sub-selection: the line exists in the doc, but this station
      // has no stop for it (e.g. after undoing an add-to-line).
      selectedStopLineId: 'L9',
      labelSelected: false,
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    // Falls through to the whole-station nudge instead of dying silently.
    expect(useDoc.getState().stations.a.x).toBe(101);
  });
});

describe('App keyboard: station-editor Escape step-out ladder', () => {
  const seedStation = () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      stations: {
        a: {
          id: 'a',
          name: 'A',
          x: 100,
          y: 100,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
      lines: {
        L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] }),
      },
      lineOrder: ['L1'],
    });
  };

  it('Esc clears the sub-selection, then exits the mode, then deselects', () => {
    render(<App />);
    seedStation();
    useSelection.getState().startEditingStationLayout('a');
    useSelection.setState({ ...useSelection.getState(), labelSelected: true });

    // Rung 1: the armed label sub-selection clears; mode + station survive.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSelection.getState().labelSelected).toBe(false);
    expect(useSelection.getState().uiMode.kind).toBe('editing-station-layout');
    expect(useSelection.getState().selectedStationIds).toEqual(['a']);

    // Rung 2: the layout-edit mode exits; the station stays selected.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedStationIds).toEqual(['a']);

    // Rung 3: the global wipe deselects (closing the popover).
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });
});
