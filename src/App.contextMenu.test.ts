import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cancelModeOnContextMenu } from './App';
import { useDoc, useSelection } from './state/store';
import { DEFAULT_DOC } from './model/transforms';
import type { LineId } from './model/types';

// The document-level "right-click cancels an active mode" handler, exercised
// through real DOM dispatch so `e.target` is the element under the click.
// The sidebar owns its own right-click gestures — a right-click landing there
// must NOT be claimed by the cancel gesture, while a canvas right-click still
// cancels non-passthrough modes. Edit Stops is a PASSTHROUGH mode: right-click
// is its remove-station / remove-segment gesture, so the cancel handler must
// leave it alone entirely.

let sidebar: HTMLDivElement;
let connector: HTMLDivElement;
let canvasish: HTMLDivElement;

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'idle' } });

  sidebar = document.createElement('div');
  sidebar.className = 'sidebar';
  connector = document.createElement('div');
  sidebar.appendChild(connector);
  canvasish = document.createElement('div');
  document.body.append(sidebar, canvasish);
  document.addEventListener('contextmenu', cancelModeOnContextMenu, true);
});

afterEach(() => {
  document.removeEventListener('contextmenu', cancelModeOnContextMenu, true);
  sidebar.remove();
  canvasish.remove();
});

const enterPlacingMode = () => {
  useSelection.getState().setUiMode({ kind: 'placing-station' });
};

const rightClick = (el: Element) =>
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

describe('cancelModeOnContextMenu', () => {
  it('a right-click inside the sidebar leaves the active mode alone', () => {
    enterPlacingMode();
    const propagated = rightClick(connector);
    expect(useSelection.getState().uiMode.kind).toBe('placing-station');
    // Not claimed: the event keeps propagating (and keeps its default) so
    // sidebar elements' own handlers still run.
    expect(propagated).toBe(true);
  });

  it('a right-click outside the sidebar cancels the mode', () => {
    enterPlacingMode();
    const propagated = rightClick(canvasish);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(propagated).toBe(false); // preventDefault: no native menu
  });

  it('passthrough modes are never touched (layering owns right-click)', () => {
    useSelection.getState().setUiMode({ kind: 'layering' });
    rightClick(canvasish);
    expect(useSelection.getState().uiMode.kind).toBe('layering');
  });

  it('Edit Stops is a passthrough: right-click never backs out of the editor', () => {
    useSelection.getState().setUiMode({
      kind: 'appending-to-line',
      lineId: 'L1' as LineId,
      cursor: null,
    });
    const propagated = rightClick(canvasish);
    expect(useSelection.getState().uiMode.kind).toBe('appending-to-line');
    // The event keeps its default/propagation so the station and segment
    // remove handlers own the gesture.
    expect(propagated).toBe(true);
  });
});
