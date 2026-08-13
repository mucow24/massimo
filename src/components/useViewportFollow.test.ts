import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useViewportFollow } from './useViewportFollow';

// A scroll of a nested container: dispatched on the element and NOT bubbling,
// which is the whole reason the document listener runs in the capture phase.
function scrollNested() {
  const box = document.createElement('div');
  document.body.appendChild(box);
  box.dispatchEvent(new globalThis.Event('scroll', { bubbles: false }));
  box.remove();
}

// A page scroll: dispatched at `document` and bubbling up to `window`.
const scrollPage = () => document.dispatchEvent(new globalThis.Event('scroll', { bubbles: true }));

describe('useViewportFollow', () => {
  it('fires on a page scroll, a nested container scroll, and a resize', () => {
    const onChange = vi.fn();
    renderHook(() => useViewportFollow(true, onChange));

    act(() => scrollPage());
    // Both listeners see a page scroll — the consumer's value-equal bailout is
    // what makes the second one free, not a missing registration.
    expect(onChange).toHaveBeenCalledTimes(2);

    onChange.mockClear();
    act(() => scrollNested());
    expect(onChange).toHaveBeenCalledTimes(1);

    onChange.mockClear();
    act(() => window.dispatchEvent(new globalThis.Event('resize')));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('holds no listeners at all while inactive', () => {
    const onChange = vi.fn();
    renderHook(() => useViewportFollow(false, onChange));
    act(() => {
      scrollPage();
      scrollNested();
      window.dispatchEvent(new globalThis.Event('resize'));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls the LATEST callback, without re-registering on a fresh closure', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useViewportFollow(true, cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    act(() => window.dispatchEvent(new globalThis.Event('resize')));
    // The stale closure is never called — a consumer measuring through a prop
    // that changed would otherwise place chrome off last render's numbers.
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drops every listener on unmount and on going inactive', () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useViewportFollow(true, onChange));
    unmount();
    act(() => {
      scrollPage();
      scrollNested();
      window.dispatchEvent(new globalThis.Event('resize'));
    });
    expect(onChange).not.toHaveBeenCalled();

    const active = vi.fn();
    const { rerender } = renderHook(({ on }) => useViewportFollow(on, active), {
      initialProps: { on: true },
    });
    rerender({ on: false });
    act(() => scrollPage());
    expect(active).not.toHaveBeenCalled();
  });
});
