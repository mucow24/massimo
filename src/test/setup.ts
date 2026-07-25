import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { loadWasmClipper } from '../geometry/clip';

// Production runs every polygon boolean through the WebAssembly clipper (see
// clip.ts). The JS engine is only a startup fallback, and the two are
// equivalent rather than bit-identical — so tests that pin exact geometry must
// run on the same engine the app does, or they pin something nobody ships.
beforeAll(async () => {
  await loadWasmClipper();
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
// has no scrollIntoView (the sidebar scrolls the selected station row into view).
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
