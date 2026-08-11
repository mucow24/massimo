import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeStation, makeStop, makeLine, makeTextLabel } from '../test/fixtures';
import { _clearTextMeasureCache } from '../geometry/textMeasure';
import { stubCanvasHostSize } from './interaction';
import { stubTextMetrics } from './textMetrics';

// App's font-load effect clears the text-measure cache and bumps the font epoch
// when the web fonts arrive. ARCHITECTURE.md "Gotchas & footguns" documents the
// intent: "without it, first-paint labels (measured against the fallback font)
// stay a pixel off until the next edit".
//
// This probe drives the REAL <App /> with a real named station and swaps the
// canvas metrics underneath it (fallback font -> web font) at the moment the
// font-load event fires — exactly what happens in the browser. If the fix works,
// the station's label geometry must settle at the NEW metrics on font load.

// Mutable per-character advance: stands in for the fallback font vs Söhne. Its
// own model rather than a shared one, because the mutability IS the fixture and
// the recorded texts are what the assertions read.
let charWidth = 6;
const measuredTexts: string[] = [];
stubTextMetrics((s: string) => {
  measuredTexts.push(s);
  const advance = s.length * charWidth;
  const hasInk = s.trim().length > 0;
  return {
    width: advance,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: hasInk ? advance : 0,
  };
});

// --- document.fonts stub (same shape as src/test/App.fontLoad.test.tsx) ---
type FontHandler = () => void;
let origFontsDescriptor: PropertyDescriptor | undefined;
let loadingDoneHandlers: FontHandler[] = [];

function stubFonts() {
  loadingDoneHandlers = [];
  const fakeFonts = {
    ready: new Promise<void>(() => {}), // never resolves; we drive `loadingdone`
    addEventListener: (ev: string, cb: FontHandler) => {
      if (ev === 'loadingdone') loadingDoneHandlers.push(cb);
    },
    removeEventListener: (ev: string, cb: FontHandler) => {
      if (ev === 'loadingdone') loadingDoneHandlers = loadingDoneHandlers.filter((h) => h !== cb);
    },
  };
  origFontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { value: fakeFonts, configurable: true });
}

// jsdom reports clientWidth/clientHeight as 0, which collapses the viewBox.

stubCanvasHostSize();

beforeEach(() => {
  charWidth = 6;
  measuredTexts.length = 0;
  // The measure cache is module-level and would otherwise leak between tests.
  _clearTextMeasureCache();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: [],
    selectedLineId: null,
    uiMode: { kind: 'idle' as const },
  });
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
  stubFonts();
});

afterEach(() => {
  if (origFontsDescriptor) Object.defineProperty(document, 'fonts', origFontsDescriptor);
  else delete (document as unknown as { fonts?: unknown }).fonts;
});

const STATION_NAME = 'Kensington';

function seedStation() {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        s1: makeStation({ id: 's1', name: STATION_NAME, x: 0, y: 0, stops: [makeStop('L1')] }),
      },
      lines: { L1: makeLine({ id: 'L1', stations: ['s1'] }) },
      lineOrder: ['L1'],
    });
  });
}

// The station's label hit rect (StationHitArea): the rotated one, whose width
// comes straight from labelLayoutLocal -> measureTextLabel.
function labelHitRect(): SVGRectElement {
  const g = document.querySelector('g[data-station-id="s1"]')!;
  const rects = Array.from(g.querySelectorAll(':scope > rect'));
  const rect = rects.find((r) => r.hasAttribute('transform'));
  return rect as unknown as SVGRectElement;
}
const labelHitWidth = () => parseFloat(labelHitRect().getAttribute('width')!);

function fireFontsLoaded() {
  expect(loadingDoneHandlers.length).toBeGreaterThan(0); // App really subscribed
  act(() => {
    loadingDoneHandlers.forEach((h) => h());
  });
}

describe('PROBE controls (must PASS — proves the harness is honest)', () => {
  it('the fake-canvas metric swap DOES change the geometry once anything re-renders', () => {
    render(<App />);
    seedStation();
    const before = labelHitWidth();

    charWidth = 20;
    fireFontsLoaded(); // clears the measure cache (App's font-load effect)

    // Force an unrelated re-render of the station subtree (a doc nudge). The
    // cache really was cleared and the new metrics really are wider — so the
    // ONLY thing missing above is the re-render itself.
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: {
          s1: { ...useDoc.getState().stations.s1, x: 1 },
        },
      });
    });
    expect(labelHitWidth()).toBeGreaterThan(before);
  });

  it("a FREE TextLabel (LabelView is not memo'd) DOES re-measure on font load", () => {
    render(<App />);
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        textLabels: { g1: makeTextLabel({ id: 'g1', text: 'Midtown' }) },
      });
    });
    expect(measuredTexts).toContain('Midtown');

    measuredTexts.length = 0;
    charWidth = 20;
    fireFontsLoaded();

    // Proves App re-renders MapCanvas on the epoch bump — the re-render itself
    // is fine. Only the memo'd StationView subtree is skipped.
    expect(measuredTexts.filter((t) => t === 'Midtown').length).toBeGreaterThan(0);
  });
});

describe('web-font load must re-lay-out STATION labels, not just clear the cache', () => {
  it('re-measures the station name after the fonts arrive', () => {
    render(<App />);
    seedStation();
    expect(measuredTexts).toContain(STATION_NAME); // first paint measured it

    // The real font lands: metrics change, cache is dropped, App bumps its epoch.
    measuredTexts.length = 0;
    charWidth = 20;
    fireFontsLoaded();

    // The station label must be re-measured against the real font.
    expect(measuredTexts.filter((t) => t === STATION_NAME).length).toBeGreaterThan(0);
  });

  it("moves the station label's geometry to the real-font metrics on font load", () => {
    render(<App />);
    seedStation();
    const before = labelHitWidth();
    expect(before).toBeGreaterThan(0);

    charWidth = 20; // web font is materially wider than the fallback
    fireFontsLoaded();

    // Labels must settle at their real metrics up front (App's font-load
    // effect), not stay pinned at the fallback geometry until the next edit.
    expect(labelHitWidth()).not.toBe(before);
  });
});
