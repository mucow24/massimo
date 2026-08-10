import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import * as textMeasure from '../geometry/textMeasure';

// Regression: label glyph metrics are measured via canvas and cached by
// text+style. On first paint the web font (Söhne) usually hasn't
// loaded yet, so those measurements use the fallback font, whose side bearings
// differ by a pixel or two. The cache was never invalidated when the real font
// arrived, so labels stayed at the fallback positions until some later edit
// re-measured them — at which point the whole label visibly jumped. App must
// drop the stale measurements once fonts finish loading so the labels settle
// at load time, not on the next keystroke.

type FontHandler = () => void;

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
});
