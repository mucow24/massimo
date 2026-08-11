/**
 * The window's CLIENT box — what is left of it beside the scrollbars, which is
 * the edge every piece of screen-space chrome has to stay inside.
 *
 * `clientWidth`/`clientHeight`, not `innerWidth`/`innerHeight`, because the
 * window this matters in has scrollbars on both axes: `.toolbar { min-width:
 * max-content }` floors the app grid at the toolbar's natural width, so a narrow
 * window leaves the app wider than itself and the page scrolls sideways — and
 * `.app` being `100vh`, which doesn't count that horizontal scrollbar, overflows
 * it vertically as well. The `inner` numbers count both bars, so clamping
 * against them parks a panel's edge underneath one and past the window.
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
