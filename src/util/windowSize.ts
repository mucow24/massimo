/**
 * The window's CLIENT box — what is left of it beside the scrollbars, which is
 * the edge every piece of screen-space chrome has to stay inside.
 *
 * `clientWidth`/`clientHeight`, not `innerWidth`/`innerHeight`: the narrow-
 * window regime raises a horizontal scrollbar (`.toolbar { min-width:
 * max-content }` floors the app grid at the toolbar's natural width, so the
 * page scrolls sideways), and the `inner` numbers count that bar — clamping
 * a panel's bottom against `innerHeight` parks its edge underneath it. Same
 * for `innerWidth` and a vertical bar, whenever some OS/zoom state produces
 * one. (`.app` itself dodges the bar the same way, sizing by `height: 100%`
 * — which subtracts scrollbars — rather than `100vh`, which doesn't.)
 *
 * jsdom has no layout and reports 0 for every `client*`; the window's own
 * numbers, which it does report, stand in there.
 */
export function windowClientSize(): { w: number; h: number } {
  return {
    w: document.documentElement.clientWidth || window.innerWidth,
    h: document.documentElement.clientHeight || window.innerHeight,
  };
}
