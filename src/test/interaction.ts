// Shared helpers for unit-testing the pointer/drag/selection hooks. The hooks
// are tested by calling their returned handlers directly with synthetic event
// objects (see useItemDrag.test.tsx for the original pattern) and reading the
// resulting Zustand state back. These builders centralize the event stubs and
// a fake <svg> element so the harder hooks (viewport, line-tag drag) can run
// under jsdom, which doesn't implement getBoundingClientRect layout, pointer
// capture, or SVG geometry (createSVGPoint/getScreenCTM).

export interface PointerOpts {
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  button?: number;
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

export interface FakeSvgOpts {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
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

/** A `{ current }` ref wrapping a fake svg, typed for the hooks under test. */
export function fakeSvgRef(opts: FakeSvgOpts = {}): {
  ref: { current: SVGSVGElement | null };
  svg: FakeSvg;
} {
  const svg = fakeSvg(opts);
  return { ref: { current: svg as unknown as SVGSVGElement }, svg };
}

/**
 * Dispatch a window-level pointer event. `useLineTagDrag` wires its move/up
 * handlers onto `window` (not the returned API), so its tests drive the drag
 * by dispatching here. The shared drag primitives read clientX/clientY AND
 * pointerId (for capture), so we carry pointerId on the MouseEvent (jsdom has
 * no PointerEvent ctor; the property name matches what the handlers read).
 */
export function dispatchWindowPointer(
  type: 'pointermove' | 'pointerup',
  opts: PointerOpts = {},
): void {
  const ev = new MouseEvent(type, {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
  Object.assign(ev, { pointerId: opts.pointerId ?? 1 });
  window.dispatchEvent(ev);
}
