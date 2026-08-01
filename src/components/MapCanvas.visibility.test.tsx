import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import {
  setVisibility,
  VISIBILITY_ITEMS,
  type VisibilityItem,
  type VisibilityKey,
} from '../state/visibility';
import type { UiMode } from '../state/selection';
import { lockedDispatchTarget } from './canvas/hitStack';
import {
  makeDoc,
  makeLine,
  makeLineCircle,
  makePolygon,
  makeRouteBullet,
  makeSvgImage,
  makeTextLabel,
  makeTransfer,
  stationWithStop,
} from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// jsdom reports clientWidth/clientHeight as 0, which collapses the canvas viewBox
// and would leave every query matching nothing whether the gate works or not.
const sizeProps = ['clientWidth', 'clientHeight'] as const;
const originals: Partial<Record<(typeof sizeProps)[number], PropertyDescriptor>> = {};
beforeEach(() => {
  for (const prop of sizeProps) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useViewportStore.setState({
    x: 0,
    y: 0,
    zoom: 1,
    showNetwork: true,
    showAnchors: false,
    showWaypoints: false,
    showLineCircles: true,
    showTransfers: true,
    showSvgImages: true,
    showTextLabels: true,
    showPolygons: true,
    showRouteBullets: true,
  });
  useSelection.setState({
    selectedLineId: null,
    selectedStationIds: [],
    selectedPolygonIds: [],
    uiMode: { kind: 'idle' },
  });
});
afterEach(() => {
  for (const prop of sizeProps) {
    const d = originals[prop];
    if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

// One of every kind the View menu can hide, all at distinct points so nothing
// overlaps into a false hit.
const seed = () =>
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          stationWithStop('s1' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
          stationWithStop('s2' as StationId, 'L1' as LineId, { x: 200, y: 0 }),
        ],
        lines: [makeLine({ id: 'L1' as LineId, stations: ['s1', 's2'] as StationId[] })],
        lineOrder: ['L1' as LineId],
        transfers: [makeTransfer({ id: 'x1' })],
        polygons: [makePolygon({ id: 'p1' })],
        svgImages: [makeSvgImage({ id: 'i1', x: 400, y: 400 })],
        textLabels: [makeTextLabel({ id: 'g1', x: 500, y: 100 })],
        routeBullets: [makeRouteBullet({ id: 'b1', x: 300, y: 300 })],
        lineCircles: [makeLineCircle({ id: 'c1', x: -300, y: -300, radius: 80 })],
      }),
    });
  });

/** The DOM hook that proves each kind painted. */
const PAINTED: Partial<Record<VisibilityKey, string>> = {
  showLineCircles: '[data-line-circle="c1"]',
  showTransfers: '[data-transfer-id="x1"]',
  showSvgImages: '[data-svg-image-id="i1"]',
  showTextLabels: '[data-text-label-id="g1"]',
  showPolygons: '[data-polygon-id="p1"]',
  showRouteBullets: '[data-bullet-id="b1"]',
};

const count = (selector: string) => document.querySelectorAll(selector).length;

describe('MapCanvas — per-kind visibility', () => {
  it('paints every kind by default', () => {
    render(<App />);
    seed();
    // Guards every case below from passing vacuously.
    for (const [key, selector] of Object.entries(PAINTED)) {
      expect(count(selector), key).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(PAINTED))('%s hides only its own kind', (key, selector) => {
    render(<App />);
    seed();
    act(() => setVisibility(key as VisibilityKey, false));
    expect(count(selector), `${key} still painted`).toBe(0);
    // Every OTHER kind survives — a gate wired to the wrong flag, or a group
    // element gated one level too high, shows up here and nowhere else.
    for (const [other, otherSelector] of Object.entries(PAINTED)) {
      if (other === key) continue;
      expect(count(otherSelector), `${key} took ${other} with it`).toBeGreaterThan(0);
    }
    act(() => setVisibility(key as VisibilityKey, true));
    expect(count(selector), `${key} did not come back`).toBeGreaterThan(0);
  });

  it('hiding the network takes transfers with it, ring guides staying put', () => {
    // Transfers hang off stations, so the master switch owns them too — the same
    // nesting anchors already have. Line circles are deliberately NOT nested:
    // hiding the network to reach a ring a line sits on is the case they exist
    // for, so the master switch must leave them standing.
    render(<App />);
    seed();
    act(() => setVisibility('showNetwork', false));
    expect(count('[data-transfer-id="x1"]')).toBe(0);
    expect(count('[data-line-circle="c1"]')).toBeGreaterThan(0);
  });

  it('leaves the circle rim grabbable with the network hidden', () => {
    // The whole point of the feature: a line riding lane 0 buries the rim, and
    // clearing the lines is what hands it back. A guide with no rim hit stroke
    // would look right and still be unclickable.
    render(<App />);
    seed();
    act(() => setVisibility('showNetwork', false));
    expect(count('[data-line-circle-rim="c1"]')).toBeGreaterThan(0);
  });

  it('keeps a hidden kind SELECTED — hiding is a peek, not a deselect', () => {
    render(<App />);
    seed();
    act(() => useSelection.getState().selectPolygon('p1'));
    act(() => setVisibility('showPolygons', false));
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p1']);
    act(() => setVisibility('showPolygons', true));
    expect(count('[data-polygon-id="p1"]')).toBeGreaterThan(0);
  });

  // A valid UiMode per mode a reveal names. Spelled out because half the union's
  // members carry a required payload, so a bare `{ kind }` doesn't type — and
  // the entry-coverage check below fails loudly if a new `revealedBy` lands here
  // without one, rather than silently skipping its case.
  const MODE_FOR: Partial<Record<NonNullable<VisibilityItem['revealedBy']>, UiMode>> = {
    'placing-line-circle': { kind: 'placing-line-circle', center: null },
    'creating-transfer': { kind: 'creating-transfer', firstEnd: null },
    'placing-svg': { kind: 'placing-svg', image: { href: 'data:,', width: 10, height: 10 } },
    'placing-label': { kind: 'placing-label' },
    'creating-polygon': { kind: 'creating-polygon' },
    'creating-route-bullet': { kind: 'creating-route-bullet' },
  };

  it('has a test mode for every reveal the registry declares', () => {
    const missing = VISIBILITY_ITEMS.filter((i) => i.revealedBy && !MODE_FOR[i.revealedBy]);
    expect(missing.map((i) => i.key)).toEqual([]);
  });

  // The mode that PLACES a kind must reveal it, or the tool drops an item the
  // user cannot see — the same rule anchorsRevealedByMode already applies, and
  // for the same reason. Registry-driven so a new kind can't miss it.
  it.each(VISIBILITY_ITEMS.filter((i) => i.revealedBy).map((i) => [i.key, i.revealedBy!] as const))(
    '%s is revealed while its placing mode (%s) is active',
    (key, mode) => {
      render(<App />);
      seed();
      act(() => setVisibility(key, false));
      expect(count(PAINTED[key]!), `${key} should be hidden while idle`).toBe(0);
      act(() => useSelection.getState().setUiMode(MODE_FOR[mode]!));
      expect(count(PAINTED[key]!), `${key} stayed hidden in ${mode}`).toBeGreaterThan(0);
      // ...and goes away again on exit: the reveal is a derivation, never a
      // write to the user's own toggle.
      act(() => useSelection.getState().setUiMode({ kind: 'idle' }));
      expect(count(PAINTED[key]!), `${key} survived the mode exit`).toBe(0);
      expect(useViewportStore.getState()[key], `${key} flag was written`).toBe(false);
    },
  );

  it('puts a hidden LOCKED item out of the alt-click deep-pick', () => {
    // The deep-pick reaches locked items through a geometric point test
    // (lockedHitsAt) precisely BECAUSE they are click-through and so absent from
    // elementsFromPoint — a probe that could just as easily reach a hidden one.
    // What stops it is the dispatch-target lookup: a hidden kind has no element
    // in the DOM, so the entry is dropped before it can join the cycle. Asserted
    // here rather than trusted, since nothing in lockedHitsAt itself says so.
    render(<App />);
    seed();
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        polygons: { p1: { ...useDoc.getState().polygons.p1, locked: true } },
      });
    });
    expect(lockedDispatchTarget({ kind: 'polygon', id: 'p1' })).not.toBeNull();
    act(() => setVisibility('showPolygons', false));
    expect(lockedDispatchTarget({ kind: 'polygon', id: 'p1' })).toBeNull();
  });

  it('every registry flag has a canvas gate or is accounted for', () => {
    // showNetwork, showAnchors and showWaypoints predate this suite and own
    // their own test files; the rest must each appear above, or a flag could
    // ship with a menu row and no gate behind it.
    const covered = new Set([
      ...Object.keys(PAINTED),
      'showNetwork',
      'showAnchors',
      'showWaypoints',
    ]);
    expect(VISIBILITY_ITEMS.filter((i) => !covered.has(i.key))).toEqual([]);
  });
});
