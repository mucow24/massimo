import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { useDoc, useSelection } from '../state/store';
import { historyDepth, redoDepth } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import { readClipboard, writeClipboard, type ClipPayload } from '../model/clipboard';
import { makeTextLabel } from '../test/fixtures';
import type { RouteBullet } from '../model/types';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    spaceHeld: false,
    uiMode: { kind: 'idle' },
  });
});

describe('App keyboard shortcuts: inForm guard routing', () => {
  it('Ctrl+Z fires on a focused range slider (slider drag is undoable without click-away)', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Create an undoable entry so Ctrl+Z has something to pop.
    useDoc.getState().addStation(50, 50);
    const pastBefore = historyDepth();
    const stationsBefore = Object.keys(useDoc.getState().stations).length;

    await user.click(screen.getByRole('button', { name: 'Options' }));
    const slider = screen.getByRole('slider', { name: /font size/i });
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
    await user.click(screen.getByRole('button', { name: /color palettes/i }));
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
  it('Ctrl+Z mid-slider-drag commits the open useFieldHistory group, then undoes the drag', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const slider = screen.getByRole('slider', { name: /font size/i }) as HTMLInputElement;
    const initialFontSize = useDoc.getState().labelFontSize;
    const pastBaseline = historyDepth();

    // Simulate focus → mid-drag → Ctrl+Z without intervening blur. The focus
    // opens a useFieldHistory group (pauses zundo); the change mutates state
    // but no entry lands on pastStates yet; the Ctrl+Z handler must blur the
    // active element so commit() runs, *then* undo against the just-pushed
    // entry. Without blur-then-undo, undo would skip the in-progress edit.
    //
    // Note: use the real DOM .focus() (not fireEvent.focus) so jsdom updates
    // document.activeElement — the Ctrl+Z handler's blur target depends on it.
    slider.focus();
    fireEvent.change(slider, { target: { value: String(initialFontSize + 4) } });
    expect(useDoc.getState().labelFontSize).toBe(initialFontSize + 4);

    fireEvent.keyDown(slider, { key: 'z', ctrlKey: true });

    expect(useDoc.getState().labelFontSize).toBe(initialFontSize);
    expect(historyDepth()).toBe(pastBaseline);
    expect(redoDepth()).toBe(1);
  });
});

describe('App keyboard shortcuts: copy / paste / duplicate', () => {
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
    const b = useDoc.getState().addRouteBullet(0, 0, null);
    const l = useDoc.getState().addTextLabel(0, 0);
    const p = useDoc.getState().addPolygon(0, 0);
    useSelection.getState().setMixedSelection({ bullets: [b], labels: [l], polygons: [p] });
    const bulletsBefore = Object.keys(useDoc.getState().routeBullets).length;
    const pastBefore = historyDepth();

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
    expect(sel.selectedRouteBulletIds[0]).not.toBe(b);
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
      selectedVertex: null,
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
      selectedVertex: null,
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
