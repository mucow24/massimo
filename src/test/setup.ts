import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

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

// jsdom's SVGElement doesn't implement pointer-capture methods either.
if (typeof Element !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = Element.prototype as any;
  proto.setPointerCapture ??= function () {};
  proto.releasePointerCapture ??= function () {};
  proto.hasPointerCapture ??= function () {
    return false;
  };
}

afterEach(() => {
  cleanup();
});
