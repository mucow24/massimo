import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import * as textMeasure from '../geometry/textMeasure';
import { makeTextLabel } from './fixtures';
import { stubTextMetrics } from './textMetrics';

// A real 2D context for the whole file. The narrowing test below is vacuous
// without it: under jsdom's absent canvas a measurement never builds a font
// declaration, so every cache entry records an EMPTY face set, and an empty set
// invalidates on anything — the test would pass whatever App did.
stubTextMetrics((s, px) => ({
  width: s.length * px * 0.5,
  actualBoundingBoxLeft: 0,
  actualBoundingBoxRight: s.length * px * 0.5,
}));

// Regression: label glyph metrics are measured via canvas and cached by
// text+style. On first paint the web font (Söhne) usually hasn't
// loaded yet, so those measurements use the fallback font, whose side bearings
// differ by a pixel or two. The cache was never invalidated when the real font
// arrived, so labels stayed at the fallback positions until some later edit
// re-measured them — at which point the whole label visibly jumped. App must
// drop the stale measurements once fonts finish loading so the labels settle
// at load time, not on the next keystroke.

type FontHandler = (e?: unknown) => void;

let origDescriptor: PropertyDescriptor | undefined;
let loadingDoneHandlers: FontHandler[];
let readyResolve: () => void;

function stubFonts() {
  loadingDoneHandlers = [];
  const fakeFonts = {
    ready: new Promise<void>((res) => {
      readyResolve = res;
    }),
    addEventListener: (ev: string, cb: FontHandler) => {
      if (ev === 'loadingdone') loadingDoneHandlers.push(cb);
    },
    removeEventListener: (ev: string, cb: FontHandler) => {
      if (ev === 'loadingdone') loadingDoneHandlers = loadingDoneHandlers.filter((h) => h !== cb);
    },
  };
  origDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { value: fakeFonts, configurable: true });
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), stations: {}, lines: {}, lineOrder: [] });
  stubFonts();
});

afterEach(() => {
  if (origDescriptor) Object.defineProperty(document, 'fonts', origDescriptor);
  else delete (document as unknown as { fonts?: unknown }).fonts;
  vi.restoreAllMocks();
});

describe('App — invalidates text measurements once web fonts load', () => {
  it('clears the measurement cache when fonts.ready resolves', async () => {
    const spy = vi.spyOn(textMeasure, '_clearTextMeasureCache');
    render(<App />);
    expect(spy).not.toHaveBeenCalled();
    readyResolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalled();
  });

  it('clears the measurement cache on a later font loadingdone event', async () => {
    const spy = vi.spyOn(textMeasure, '_clearTextMeasureCache');
    render(<App />);
    spy.mockClear();
    expect(loadingDoneHandlers.length).toBeGreaterThan(0);
    loadingDoneHandlers.forEach((h) => h());
    expect(spy).toHaveBeenCalled();
  });

  // The branch above is the FALLBACK — an event naming no faces. Every real
  // browser event names them, so this is the path production actually takes,
  // and until it was covered, misspelling the `fontfaces` read reverted the
  // whole narrowing to a full clear with every test still green.
  it('a loadingdone naming one weight re-measures only the labels using it', () => {
    render(<App />);
    textMeasure._clearTextMeasureCache();
    const light = makeTextLabel({ id: 'g', text: 'Canal St', weight: 400 });
    const bold = makeTextLabel({ id: 'g', text: 'Canal St', weight: 700 });
    const lightSeeded = textMeasure.measureTextLabel(light);
    const boldSeeded = textMeasure.measureTextLabel(bold);

    expect(loadingDoneHandlers.length).toBeGreaterThan(0);
    loadingDoneHandlers.forEach((h) =>
      h({ fontfaces: [{ family: 'Soehne', weight: '700', style: 'normal' }] }),
    );

    // A hit hands back the object it stored; a miss re-measures into a fresh one.
    expect(textMeasure.measureTextLabel(bold)).not.toBe(boldSeeded);
    expect(textMeasure.measureTextLabel(light)).toBe(lightSeeded);
  });
});
