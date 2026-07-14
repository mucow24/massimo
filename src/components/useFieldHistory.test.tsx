import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFieldHistory } from './useFieldHistory';
import { useDoc } from '../state/store';
import { historyDepth, isHistoryGrouping } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

// The hook's safety nets only fire in edge cases, so no happy-path test covers
// them. A regression here fails silently and badly: the open group leaves
// recording paused forever, so the in-flight edit is lost from history and
// every LATER edit stops creating undo entries.
describe('useFieldHistory — group-commit safety nets', () => {
  it('commits the open group when the field unmounts while focused', () => {
    const { result, unmount } = renderHook(() => useFieldHistory());
    act(() => result.current.onFocus());
    act(() => useDoc.getState().setDocName('Mid-edit name'));
    expect(isHistoryGrouping()).toBe(true);
    const before = historyDepth();

    // e.g. selecting a different station collapses the inspector mid-edit —
    // blur never fires on the field.
    unmount();

    expect(historyDepth() - before).toBe(1); // the edit sealed as one entry
    expect(isHistoryGrouping()).toBe(false); // recording resumed
  });

  it('re-focusing without a blur commits the previous group before opening a new one', () => {
    const { result } = renderHook(() => useFieldHistory());
    act(() => result.current.onFocus());
    act(() => useDoc.getState().setDocName('Mid-edit name'));
    const before = historyDepth();

    // Focus lands again with no intervening blur (e.g. focus jumped straight
    // from another field sharing the hook instance).
    act(() => result.current.onFocus());

    expect(historyDepth() - before).toBe(1); // first group committed…
    expect(isHistoryGrouping()).toBe(true); // …and a fresh group is open
    act(() => result.current.onBlur());
  });
});
