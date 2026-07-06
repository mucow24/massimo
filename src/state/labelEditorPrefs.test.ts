import { describe, it, expect, beforeEach } from 'vitest';
import { useLabelEditorPrefs } from './labelEditorPrefs';

describe('useLabelEditorPrefs', () => {
  beforeEach(() => {
    // Reset both the in-memory state and the localStorage backing so each
    // test starts clean.
    localStorage.clear();
    useLabelEditorPrefs.setState({ wrapText: false });
  });

  it('defaults wrapText to false (matches the historic wrap="off" textarea)', () => {
    // Assert the store's OWN initializer, not what beforeEach just wrote, so a
    // broken default would still be caught.
    expect(useLabelEditorPrefs.getInitialState().wrapText).toBe(false);
  });

  it('setWrapText flips the flag', () => {
    useLabelEditorPrefs.getState().setWrapText(true);
    expect(useLabelEditorPrefs.getState().wrapText).toBe(true);
    useLabelEditorPrefs.getState().setWrapText(false);
    expect(useLabelEditorPrefs.getState().wrapText).toBe(false);
  });

  it('persists wrapText to localStorage so it survives a reload', () => {
    useLabelEditorPrefs.getState().setWrapText(true);
    const raw = localStorage.getItem('massimo-label-editor-prefs-v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).state.wrapText).toBe(true);
  });
});
