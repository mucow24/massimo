import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { loadClipper } from '../geometry/clip';

// Every polygon boolean goes through the one clipper engine (see clip.ts), and
// it loads asynchronously, so nothing geometric can run until this resolves.
// It REJECTS rather than degrading if the engine is missing — which fails the
// suite loudly instead of quietly testing something that cannot ship.
beforeAll(async () => {
  await loadClipper();
}, 30000);

// jsdom doesn't ship ResizeObserver. The canvas hook needs a (no-op) one.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver ?? NoopResizeObserver;

// jsdom's SVGElement doesn't implement pointer-capture methods either, and it
// has no scrollIntoView — Radix's menu/select primitives call it when moving
// the active item, alongside the pointer-capture methods stubbed below.
if (typeof Element !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = Element.prototype as any;
  proto.setPointerCapture ??= function () {};
  proto.releasePointerCapture ??= function () {};
  proto.hasPointerCapture ??= function () {
    return false;
  };
  proto.scrollIntoView ??= function () {};
}

afterEach(() => {
  cleanup();
});
