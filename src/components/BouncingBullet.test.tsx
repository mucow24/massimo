import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BouncingBullet } from './BouncingBullet';
import { useFunMode } from '../state/funMode';
import { DEFAULT_PARAMS } from '../fun/ballPhysics';

/**
 * The easter egg's MODE behavior — how it opens, what it swallows while it's
 * open, and how it closes. The physics it runs on is pinned separately in
 * fun/ballPhysics.test.ts; this file only cares that the overlay is modal and
 * that it always gives the badge back.
 *
 * jsdom drives requestAnimationFrame here, so the frame loop really does run.
 * That is deliberate: a loop that throws on a zero-size viewport would take the
 * app's whole render down, and only a real mount would catch it.
 */
const enter = () => act(() => useFunMode.getState().enter({ x: 100, y: 20 }));

const scrim = () => document.querySelector('.fun-scrim')!;
const ball = () => document.querySelector('.fun-ball')!;
const transformOf = (el: Element) => (el as HTMLElement).style.transform;

/** The ball's node is the grab circle, so its transform offsets by the reach
 *  rather than the ball's own radius. */
const REACH = Math.max(DEFAULT_PARAMS.radius, DEFAULT_PARAMS.grabRadius);

describe('BouncingBullet', () => {
  beforeEach(() => {
    useFunMode.setState({ phase: 'off', origin: { x: 0, y: 0 } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing at all until the badge is knocked loose', () => {
    render(<BouncingBullet />);
    expect(document.querySelector('.fun-root')).toBeNull();
    enter();
    expect(document.querySelector('.fun-root')).not.toBeNull();
  });

  it('drops the ball from the origin it was given', () => {
    render(<BouncingBullet />);
    enter();
    // Painted in a layout effect before the first frame, so it is never briefly
    // in the window's corner. The node is the grab circle, hence the reach
    // offset rather than the ball's own radius.
    expect(transformOf(ball())).toContain(`translate(${100 - REACH}px, ${20 - REACH}px)`);
  });

  it('drops focus on the way in, so keystrokes cannot reach a field behind it', () => {
    // The scrim eats pointers but not keys. Whatever was focused when the badge
    // came loose would otherwise take everything typed at the bouncing ball —
    // and would eat the Escape meant to end it.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    render(<BouncingBullet />);
    enter();
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it('does not name itself Massimo a second time while loose', () => {
    // The toolbar badge owns that accessible name; a second element wearing it
    // would break every getByRole('img', { name: 'Massimo' }) in the suite.
    render(<BouncingBullet />);
    enter();
    expect(screen.queryByRole('img', { name: 'Massimo' })).toBeNull();
  });

  it('takes its walls from the overlay box, not window.innerHeight', () => {
    // innerHeight COUNTS the classic scrollbar, so a floor measured from it sits
    // below the visible bottom and the ball rolls away underneath a horizontal
    // scrollbar. Staged here as the two disagreeing: the overlay is the shorter,
    // right answer, and the ball must come to rest on ITS floor.
    const overlayH = 400;
    window.innerHeight = 600;
    window.innerWidth = 800;
    const proto = Object.getPrototypeOf(document.createElement('div')) as HTMLElement;
    const spy = vi.spyOn(proto, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('fun-root') ? overlayH : 0;
    });
    const wSpy = vi.spyOn(proto, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('fun-root') ? 800 : 0;
    });

    render(<BouncingBullet />);
    enter();
    // Long enough to fall, bounce out, and settle.
    act(() => vi.advanceTimersByTime(8000));

    const y = Number(/translate\([^,]+,\s*(-?[\d.]+)px/.exec(transformOf(ball()))![1]) + REACH;
    expect(y).toBeLessThanOrEqual(overlayH - DEFAULT_PARAMS.radius + 1);
    expect(y).toBeGreaterThan(overlayH / 2); // it really did fall, not hover

    spy.mockRestore();
    wSpy.mockRestore();
  });

  it('closes on a click anywhere on the map, then hands the badge back', () => {
    render(<BouncingBullet />);
    enter();
    fireEvent.pointerDown(scrim());
    // The ball fades out over the same beat the badge fades in, so the mode is
    // only fully retired once that has played.
    expect(useFunMode.getState().phase).toBe('exiting');
    act(() => vi.advanceTimersByTime(DEFAULT_PARAMS.dimMs + 10));
    expect(useFunMode.getState().phase).toBe('off');
    expect(document.querySelector('.fun-root')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<BouncingBullet />);
    enter();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useFunMode.getState().phase).toBe('exiting');
  });

  // Holds because the scrim is a SIBLING of the ball, not an ancestor, so the
  // press never bubbles through it — not because of the stopPropagation in the
  // handler, which is only keeping the press off `.app`.
  it('keeps the ball out of it: pressing the ball must not close the mode', () => {
    render(<BouncingBullet />);
    enter();
    fireEvent.pointerDown(ball(), { button: 0, clientX: 100, clientY: 20 });
    expect(useFunMode.getState().phase).toBe('live');
  });

  it('stops listening for Escape once it is gone', () => {
    // The listener is bound on window, so a stale one would eat Escape for the
    // whole app — the exact bug that makes an easter egg a real problem.
    const { unmount } = render(<BouncingBullet />);
    enter();
    unmount();
    // Left at 'live', NOT reset to 'off': beginExit only moves 'live' onwards,
    // so a reset here would make a leaked listener indistinguishable from a
    // cleaned-up one and the assertion below would hold either way.
    expect(useFunMode.getState().phase).toBe('live');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useFunMode.getState().phase).toBe('live');
  });
});
