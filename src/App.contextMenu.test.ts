import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cancelModeOnContextMenu } from './App';
import { useDoc, useSelection } from './state/store';
import { DEFAULT_DOC } from './model/transforms';
import type { LineId } from './model/types';

// The document-level "right-click cancels an active mode" handler, exercised
// through real DOM dispatch so `e.target` is the element under the click.
// The sidebar owns its own right-click gestures (removing a tree edge in the
// line editor's Edit Stops mode) — a right-click landing there must NOT be
// claimed by the cancel gesture, while a canvas right-click still cancels.

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

const enterAppendMode = () => {
  useSelection.getState().setUiMode({
    kind: 'appending-to-line',
    lineId: 'L1' as LineId,
    insertAfterIndex: null,
  });
};

const rightClick = (el: Element) =>
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

describe('cancelModeOnContextMenu', () => {
  it('a right-click inside the sidebar leaves the active mode alone', () => {
    enterAppendMode();
    const propagated = rightClick(connector);
    expect(useSelection.getState().uiMode.kind).toBe('appending-to-line');
    // Not claimed: the event keeps propagating (and keeps its default) so the
    // sidebar element's own handler — the tree's edge-remove — still runs.
    expect(propagated).toBe(true);
  });

  it('a right-click outside the sidebar cancels the mode', () => {
    enterAppendMode();
    const propagated = rightClick(canvasish);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(propagated).toBe(false); // preventDefault: no native menu
  });

  it('passthrough modes are never touched (layering owns right-click)', () => {
    useSelection.getState().setUiMode({ kind: 'layering' });
    rightClick(canvasish);
    expect(useSelection.getState().uiMode.kind).toBe('layering');
  });
});
