import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNumericField } from './useNumericField';

// useNumericField mirrors a store value into a local `text` state and guards
// that mirror while the field is focused: an external value change (e.g. an
// undo, a sibling edit, a wheel tick that lands a new value) must not clobber
// text the user is mid-way through typing. focusedRef (useNumericField.ts:24-27)
// is the guard. These tests drive the hook directly via renderHook, mutating
// the `value` prop to simulate the external store update.

describe('useNumericField — external-update focus guard', () => {
  it('does NOT clobber in-progress text while the field is focused', () => {
    const onChange = vi.fn();
    const getCurrent = () => 5;
    const { result, rerender } = renderHook(
      ({ value }) => useNumericField(value, onChange, getCurrent),
      { initialProps: { value: 5 } },
    );
    // Mirror starts at the initial value.
    expect(result.current.text).toBe('5');

    // User focuses and begins typing a new (not-yet-committed) value.
    act(() => result.current.onNumberFocus());
    act(() =>
      result.current.onNumberChange({
        target: { value: '12' },
      } as React.ChangeEvent<HTMLInputElement>),
    );
    expect(result.current.text).toBe('12');

    // An EXTERNAL store update arrives while focused (value prop changes).
    // The focus guard must keep the in-progress text intact.
    rerender({ value: 99 });
    expect(result.current.text).toBe('12');
  });

  it('DOES resync the mirror to an external value while NOT focused', () => {
    const onChange = vi.fn();
    const getCurrent = () => 5;
    const { result, rerender } = renderHook(
      ({ value }) => useNumericField(value, onChange, getCurrent),
      { initialProps: { value: 5 } },
    );
    expect(result.current.text).toBe('5');

    // No focus: an external value change flows straight into the mirror.
    rerender({ value: 42 });
    expect(result.current.text).toBe('42');
  });

  it('blur re-syncs the mirror to the live value via getCurrent', () => {
    const onChange = vi.fn();
    let live = 5;
    const getCurrent = () => live;
    const { result } = renderHook(() => useNumericField(5, onChange, getCurrent));

    act(() => result.current.onNumberFocus());
    act(() =>
      result.current.onNumberChange({
        target: { value: '7' },
      } as React.ChangeEvent<HTMLInputElement>),
    );
    // onChange fired with the parsed number while typing a valid value.
    expect(onChange).toHaveBeenCalledWith(7);

    // The committed live value diverges from the typed text…
    live = 7;
    act(() => result.current.onNumberBlur());
    // …and blur snaps the mirror to it (and un-guards future external updates).
    expect(result.current.text).toBe('7');
  });
});
