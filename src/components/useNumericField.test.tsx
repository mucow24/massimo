import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNumericField } from './useNumericField';
import { useDoc } from '../state/store';
import { historyDepth, undo } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import { LINE_WIDTH_STEP, lineWidthOf } from '../model/lineWidth';

// A stand-in for the element the wheel ref attaches to. Records the bound
// native listener + its options so tests can assert the non-passive binding
// (React's onWheel prop is passive — preventDefault there warns and no-ops)
// and invoke a wheel tick directly. Mirrors the fakeSvg pattern in useViewport.
function fakeWheelTarget() {
  const state: { entry?: { listener: (e: unknown) => void; options?: unknown } } = {};
  const el = {
    addEventListener: (_type: string, listener: (e: unknown) => void, options?: unknown) => {
      state.entry = { listener, options };
    },
    removeEventListener: () => {
      state.entry = undefined;
    },
  } as unknown as HTMLElement;
  return {
    el,
    get entry() {
      return state.entry;
    },
  };
}

// useNumericField mirrors a store value into a local `text` state and guards
// that mirror while the field is focused: an EXTERNAL value change (e.g. an
// undo, a sibling edit) must not clobber text the user is mid-way through
// typing. The hook's own `focusedRef` is that guard. A wheel tick is
// NOT external — it's a deliberate adjustment of THIS field — so it updates the
// mirror immediately even while focused (see the wheel-while-focused test).
// These tests drive the hook directly via renderHook, mutating the `value` prop
// to simulate the external store update.

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

  it('DOES update the mirror on a wheel tick while the field is focused', () => {
    // Regression: while the spinbutton is focused, a wheel tick used to bump the
    // store value but leave the text mirror frozen until blur. A wheel tick is a
    // deliberate adjustment of THIS field, not a foreign update, so the mirror
    // must track every increment — even focused.
    let live = 9;
    const onChange = vi.fn((n: number) => {
      live = n;
    });
    const { result } = renderHook(() => useNumericField(live, onChange, () => live));
    const target = fakeWheelTarget();
    act(() => result.current.attachWheel(target.el));

    act(() => result.current.onNumberFocus());
    expect(result.current.text).toBe('9');

    act(() => target.entry!.listener({ deltaY: -1, preventDefault() {} }));

    expect(onChange).toHaveBeenLastCalledWith(10);
    // Immediately, not on blur.
    expect(result.current.text).toBe('10');
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

  it('defaults the wheel step to 1 and the mirror to a bare integer string', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useNumericField(9, onChange, () => 9));
    expect(result.current.text).toBe('9');
    const target = fakeWheelTarget();
    act(() => result.current.attachWheel(target.el));
    target.entry!.listener({ deltaY: -1, preventDefault() {} });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });
});

describe('useNumericField — wheel binding', () => {
  it('binds a NON-passive native wheel listener that preventDefaults', () => {
    // React registers its onWheel prop as a PASSIVE root listener, so
    // preventDefault() inside it warns ("Unable to preventDefault inside
    // passive event listener invocation") and the popover/page scrolls anyway.
    // The hook must bind its own non-passive wheel listener instead.
    const onChange = vi.fn();
    const { result } = renderHook(() => useNumericField(9, onChange, () => 9));
    const target = fakeWheelTarget();
    act(() => result.current.attachWheel(target.el));
    expect(target.entry).toBeDefined();
    expect((target.entry!.options as { passive?: boolean }).passive).toBe(false);
    // Non-passive is the whole point — only then can preventDefault cancel the
    // scroll — and the tick still increments.
    const preventDefault = vi.fn();
    target.entry!.listener({ deltaY: -1, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  // A HORIZONTAL wheel — a two-finger trackpad swipe, or Shift+wheel — carries
  // deltaY 0 (or a deltaY dwarfed by deltaX on a diagonal flick). Treating "not
  // scrolling up" as "scrolling down" walked every numeric field steadily
  // downward on a gesture the user meant as a page scroll. And the page scroll
  // is real: the toolbar's min-width floors the app wider than a narrow window,
  // so the handler must not preventDefault one it isn't acting on.
  it.each([
    ['a pure horizontal swipe', { deltaY: 0, deltaX: -30 }],
    ['a mostly-horizontal diagonal', { deltaY: 1, deltaX: -30 }],
    ['a null wheel event', { deltaY: 0, deltaX: 0 }],
  ])('ignores %s, leaving the scroll to the page', (_name, delta) => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useNumericField(9, onChange, () => 9));
    const target = fakeWheelTarget();
    act(() => result.current.attachWheel(target.el));
    const preventDefault = vi.fn();
    act(() => target.entry!.listener({ ...delta, preventDefault }));
    expect(onChange).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('still steps on a mostly-vertical diagonal', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useNumericField(9, onChange, () => 9));
    const target = fakeWheelTarget();
    act(() => result.current.attachWheel(target.el));
    act(() => target.entry!.listener({ deltaY: -30, deltaX: 1, preventDefault() {} }));
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('removes the wheel listener when the ref detaches', () => {
    const { result } = renderHook(() => useNumericField(9, vi.fn(), () => 9));
    const target = fakeWheelTarget();
    act(() => result.current.attachWheel(target.el));
    expect(target.entry).toBeDefined();
    act(() => result.current.attachWheel(null));
    expect(target.entry).toBeUndefined();
  });
});

describe('useNumericField — wheel burst coalescing', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
  });

  // A trackpad delivers DOZENS of wheel events per flick. Each tick writes the
  // doc outside any history group, so ungrouped they each became their own undo
  // entry — and Ctrl+Z after an accidental scroll unwound a single 0.25 step and
  // looked like it did nothing. The whole burst must collapse to one entry.
  it('records ONE undo entry for a burst of wheel ticks over an unfocused field', () => {
    const lineId = useDoc.getState().addLine();
    useDoc.getState().setLineWidth(lineId, 10);
    useDoc.temporal.getState().clear();
    const live = () => lineWidthOf(useDoc.getState().lines[lineId]);

    const { result } = renderHook(() =>
      useNumericField(
        live(),
        (n) => useDoc.getState().setLineWidth(lineId, n),
        live,
        LINE_WIDTH_STEP,
      ),
    );
    const target = fakeWheelTarget();
    act(() => result.current.attachWheel(target.el));

    // Never focused — the wheel is over the row, not in it.
    for (let i = 0; i < 8; i++) {
      act(() => target.entry!.listener({ deltaY: -1, preventDefault() {} }));
    }

    expect(live()).toBe(12);
    expect(historyDepth()).toBe(1);
    // And one Ctrl+Z takes the whole accidental scroll back.
    undo();
    expect(live()).toBe(10);
  });
});

describe('useNumericField — fractional step (0.5)', () => {
  it('pads the mirror to one decimal place', () => {
    const { result } = renderHook(() => useNumericField(9, vi.fn(), () => 9, 0.5));
    expect(result.current.text).toBe('9.0');
  });

  it('resyncs an external value to one decimal while not focused', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useNumericField(value, vi.fn(), () => value, 0.5),
      { initialProps: { value: 9 } },
    );
    rerender({ value: 7.5 });
    expect(result.current.text).toBe('7.5');
  });

  it('wheel increments by the step (0.5) from the live value', () => {
    const onChange = vi.fn();
    let live = 9;
    const { result } = renderHook(() => useNumericField(live, onChange, () => live, 0.5));
    const target = fakeWheelTarget();
    act(() => result.current.attachWheel(target.el));
    target.entry!.listener({ deltaY: -1, preventDefault() {} });
    expect(onChange).toHaveBeenLastCalledWith(9.5);
    target.entry!.listener({ deltaY: 1, preventDefault() {} });
    expect(onChange).toHaveBeenLastCalledWith(8.5);
  });

  it('blur re-syncs the mirror formatted to one decimal', () => {
    let live = 9;
    const { result } = renderHook(() => useNumericField(9, vi.fn(), () => live, 0.5));
    act(() => result.current.onNumberFocus());
    live = 9.5;
    act(() => result.current.onNumberBlur());
    expect(result.current.text).toBe('9.5');
  });
});
