// Shared helpers for unit-testing the pointer/drag/selection hooks. The hooks
// are tested by calling their returned handlers directly with synthetic event
// objects (see useItemDrag.test.tsx for the original pattern) and reading the
// resulting Zustand state back. These builders centralize the event stubs and
// a fake <svg> element so the harder hooks (viewport, line-tag drag) can run
// under jsdom, which doesn't implement getBoundingClientRect layout, pointer
// capture, or SVG geometry (createSVGPoint/getScreenCTM).

import { afterEach, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

export interface PointerOpts {
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  button?: number;
  /** The held-button bitmask (`e.buttons`). Defaults to 1 — a live primary
   *  contact, which is what nearly every gesture test simulates. Pass 0 to
   *  simulate a move after a LOST pointerup (alt-tab mid-press), which the
   *  drag hooks treat as a pointercancel. */
  buttons?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  detail?: number;
  /** The event target — set to a fake-svg / data-bg element for hit testing. */
  target?: unknown;
}

/** A `React.PointerEvent`-shaped stub carrying only the fields the hooks read. */
export function pointerEvent(opts: PointerOpts = {}): React.PointerEvent {
  return {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    pointerId: opts.pointerId ?? 1,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? 1,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    detail: opts.detail ?? 0,
    target: opts.target ?? null,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as unknown as React.PointerEvent;
}

/** A `React.WheelEvent`-shaped stub for the viewport wheel-zoom handler. */
export function wheelEvent(opts: {
  clientX?: number;
  clientY?: number;
  deltaY?: number;
}): React.WheelEvent {
  return {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    deltaY: opts.deltaY ?? 0,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as unknown as React.WheelEvent;
}

/**
 * jsdom reports clientWidth/clientHeight as 0, which collapses the canvas host
 * to a zero box — MapCanvas and ItemPopovers both bail out of laying anything
 * out at that size, so a test that renders <App /> sees an empty canvas.
 *
 * Call at module scope. Installs the patch in `beforeEach` and restores the
 * original descriptors in `afterEach`, so a file that throws mid-test cannot
 * leave a patched `HTMLElement.prototype` behind for the rest of the run.
 */
export function stubCanvasHostSize({ w = 800, h = 600 }: { w?: number; h?: number } = {}): void {
  const sizeProps = ['clientWidth', 'clientHeight'] as const;
  const originals: Partial<Record<(typeof sizeProps)[number], PropertyDescriptor>> = {};
  beforeEach(() => {
    for (const prop of sizeProps) {
      originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    }
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: w });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: h });
  });
  afterEach(() => {
    for (const prop of sizeProps) {
      const d = originals[prop];
      if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
  });
}

/**
 * jsdom implements no SVG layout, so `getBBox` is absent entirely — every
 * content-bounds measurement (`buildExportSvg`'s, above all) throws or reads
 * nothing without it. Stub it on `SVGGraphicsElement.prototype`, which every
 * `<svg>`/`<g>`/`<circle>` inherits, so the measurement runs against `box`.
 *
 * Returns the restore, since a caller may want a second box within one file;
 * call it from `afterEach` so a throwing test cannot leave the prototype
 * patched for the rest of the run.
 */
export function stubGetBBox(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): () => void {
  const proto = (
    globalThis as unknown as { SVGGraphicsElement: { prototype: Record<string, unknown> } }
  ).SVGGraphicsElement.prototype;
  const had = Object.prototype.hasOwnProperty.call(proto, 'getBBox');
  const prev = proto.getBBox;
  proto.getBBox = () => box;
  return () => {
    if (had) proto.getBBox = prev;
    else delete proto.getBBox;
  };
}

export interface FakeSvgOpts {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  /**
   * Live translation applied to this svg's client rect, in px. In the real DOM
   * the svg sits INSIDE `.canvas-pan-layer`, so mid-pan it rides the layer's
   * composited transform and `getBoundingClientRect()` reports it moved — while
   * the layer's parent (`.canvas-host`) stays put. `fakeSvgRef` wires this to
   * the fake pan layer's `style.transform` so the two rects actually differ,
   * which is the whole distinction `useViewport`'s `hostRect()` exists to make.
   */
  panOffset?: () => { dx: number; dy: number };
}

export interface FakeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  x: number;
  y: number;
  toJSON(): unknown;
}

export interface FakeSvg {
  getBoundingClientRect(): FakeRect;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  setPointerCapture(id: number): void;
  releasePointerCapture(id: number): void;
  hasPointerCapture(id: number): boolean;
  addEventListener(type: string, listener: (e: unknown) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (e: unknown) => void, options?: unknown): void;
  /** Test introspection: the listener (and its options) bound for an event type. */
  eventListener(type: string): { listener: (e: unknown) => void; options?: unknown } | undefined;
  parentElement: { clientWidth: number; clientHeight: number };
  createSVGPoint(): { x: number; y: number; matrixTransform(m: unknown): { x: number; y: number } };
  getScreenCTM(): { inverse(): unknown };
}

/**
 * A stand-in for `svgRef.current`. Uses an **identity** screen↔world mapping
 * (createSVGPoint + getScreenCTM both pass coordinates through unchanged) so a
 * pointer at screen (x, y) lands at world (x, y) — keeping drag-math
 * assertions predictable. Pointer capture is tracked so tests can assert it.
 */
export function fakeSvg(opts: FakeSvgOpts = {}): FakeSvg {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const left = opts.left ?? 0;
  const top = opts.top ?? 0;
  const captured = new Set<number>();
  const attrs = new Map<string, string>();
  const listeners = new Map<string, { listener: (e: unknown) => void; options?: unknown }>();
  return {
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    getBoundingClientRect: (): FakeRect => {
      const { dx, dy } = opts.panOffset?.() ?? { dx: 0, dy: 0 };
      const l = left + dx;
      const t = top + dy;
      return {
        left: l,
        top: t,
        right: l + width,
        bottom: t + height,
        width,
        height,
        x: l,
        y: t,
        toJSON: () => ({}),
      };
    },
    setPointerCapture: (id: number) => {
      captured.add(id);
    },
    releasePointerCapture: (id: number) => {
      captured.delete(id);
    },
    hasPointerCapture: (id: number) => captured.has(id),
    // The viewport hook binds a non-passive native wheel listener. Record it so
    // tests can assert the binding (and its passive flag) and invoke it.
    addEventListener: (type: string, listener: (e: unknown) => void, options?: unknown) => {
      listeners.set(type, { listener, options });
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (listeners.get(type)?.listener === listener) listeners.delete(type);
    },
    eventListener: (type: string) => listeners.get(type),
    parentElement: { clientWidth: width, clientHeight: height },
    createSVGPoint: () => {
      const p = {
        x: 0,
        y: 0,
        matrixTransform: (_m: unknown) => ({ x: p.x, y: p.y }),
      };
      return p;
    },
    getScreenCTM: () => ({ inverse: () => ({}) }),
  };
}

/** The pan-layer stand-in useViewport writes its composited transform to: a
 *  bare `style` bag to assert transform/will-change writes, plus a
 *  `parentElement` (the canvas host) that sizes the viewport and anchors
 *  screenToWorld — the STATIONARY box, unlike the svg's rect, which moves
 *  with the transform in a real browser. */
export interface FakePanLayer {
  style: { transform: string; willChange: string };
  parentElement: {
    clientWidth: number;
    clientHeight: number;
    getBoundingClientRect(): FakeRect;
    /** `.canvas-host`. The pan's `.panning` cursor class is written HERE, not
     *  on the svg: a class on the svg makes Blink recompute inherited style
     *  across its whole subtree (22ms on a 464-station map). */
    classList: { toggle(name: string, on?: boolean): void; contains(name: string): boolean };
  };
}

/** A `{ current }` ref wrapping a fake svg, typed for the hooks under test.
 *  Also builds the sibling fake pan layer for hooks that take one — consumers
 *  that don't can ignore it.
 *
 *  The host rect (pan layer's parent) is STATIONARY; the svg's rect rides the
 *  layer's `style.transform`, exactly as a child element does in a real
 *  browser. Both used to return the same rect, which made `useViewport`'s
 *  host-vs-svg choice unobservable: reverting `hostRect()` to measure the svg —
 *  reintroducing the double-counted-pan bug it documents — left every test in
 *  useViewport.test.tsx green. */
export function fakeSvgRef(opts: FakeSvgOpts = {}): {
  ref: { current: SVGSVGElement | null };
  svg: FakeSvg;
  panLayerRef: { current: HTMLDivElement | null };
  panLayer: FakePanLayer;
} {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const left = opts.left ?? 0;
  const top = opts.top ?? 0;
  // useViewport writes `translate(<tx>px, <ty>px)`; anything else reads as 0.
  const panTranslate = (): { dx: number; dy: number } => {
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(panLayer.style.transform);
    return m ? { dx: Number(m[1]), dy: Number(m[2]) } : { dx: 0, dy: 0 };
  };
  const svg = fakeSvg({ ...opts, panOffset: () => panTranslate() });
  const hostClasses = new Set<string>();
  const panLayer: FakePanLayer = {
    style: { transform: '', willChange: '' },
    parentElement: {
      classList: {
        toggle: (name: string, on?: boolean) => {
          const next = on ?? !hostClasses.has(name);
          if (next) hostClasses.add(name);
          else hostClasses.delete(name);
        },
        contains: (name: string) => hostClasses.has(name),
      },
      clientWidth: width,
      clientHeight: height,
      getBoundingClientRect: (): FakeRect => ({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }),
    },
  };
  return {
    ref: { current: svg as unknown as SVGSVGElement },
    svg,
    panLayerRef: { current: panLayer as unknown as HTMLDivElement },
    panLayer,
  };
}

/**
 * Dispatch a window-level pointer event. `useLineTagDrag` wires its move/up
 * handlers onto `window` (not the returned API), so its tests drive the drag
 * by dispatching here. The shared drag primitives read clientX/clientY AND
 * pointerId (for capture), so we carry pointerId on the MouseEvent (jsdom has
 * no PointerEvent ctor; the property name matches what the handlers read).
 */
export function dispatchWindowPointer(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  opts: PointerOpts = {},
): void {
  const ev = new MouseEvent(type, {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? 1,
    shiftKey: opts.shiftKey ?? false,
  });
  Object.assign(ev, { pointerId: opts.pointerId ?? 1 });
  window.dispatchEvent(ev);
}

/**
 * Step a Radix slider (the `role="slider"` thumb) by `steps` arrow-key
 * presses — negative steps left. The old native ranges took a synthetic
 * `change` with any value; a Radix thumb only moves on the step grid, so
 * tests assert relative moves (or Home/End for the rails).
 */
export function stepSlider(slider: HTMLElement, steps: number): void {
  slider.focus();
  const key = steps < 0 ? 'ArrowLeft' : 'ArrowRight';
  for (let i = 0; i < Math.abs(steps); i++) {
    fireEvent.keyDown(slider, { key });
  }
}

/**
 * Pick an option in a Radix Select by clicking the trigger, then the option.
 * (A native select took a synthetic `change`; the Radix panel is real DOM.)
 */
export async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  comboName: string | RegExp,
  optionName: string | RegExp,
): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboName }));
  await user.click(await screen.findByRole('option', { name: optionName }));
}
