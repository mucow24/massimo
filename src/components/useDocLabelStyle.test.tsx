import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDocLabelStyle } from './useDocLabelStyle';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
});

describe('useDocLabelStyle', () => {
  it("returns the doc's global label fields as a LabelStyle", () => {
    useDoc.setState({
      labelFontSize: 17,
      labelWeight: 700,
      labelItalic: true,
      labelLeading: 1.4,
      labelTracking: 0.08,
    });
    const { result } = renderHook(() => useDocLabelStyle());
    expect(result.current).toEqual({
      fontSize: 17,
      weight: 700,
      italic: true,
      leading: 1.4,
      tracking: 0.08,
    });
  });

  it('tracks a store update to a single field', () => {
    const { result } = renderHook(() => useDocLabelStyle());
    act(() => useDoc.setState({ labelFontSize: 21 }));
    expect(result.current.fontSize).toBe(21);
  });
});
