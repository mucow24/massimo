import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import {
  makeDoc,
  makeLine,
  makeLineTag,
  makePolygon,
  makeTransfer,
  stationWithStop,
} from '../test/fixtures';
import type { LineId, StationId } from '../model/types';
import { stubCanvasHostSize } from '../test/interaction';

// jsdom reports clientWidth/clientHeight as 0, which would collapse the canvas
// viewBox to 0×0 and leave every query below matching nothing whether the
// toggle works or not. Give the canvas host a real size, restoring it after.
stubCanvasHostSize();

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useViewportStore.setState({ x: 0, y: 0, zoom: 1, showNetwork: true });
  useSelection.setState({
    selectedLineId: null,
    selectedStationIds: [],
    selectedPolygonIds: [],
    uiMode: { kind: 'idle' },
  });
});

// Two stops on a line, a tag riding that line's stripe, a transfer joining the
// two stations, and a polygon standing in for the background art the toggle
// exists to uncover.
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
        lineTags: [makeLineTag({ id: 'tag1', lineId: 'L1' as LineId })],
        transfers: [makeTransfer({ id: 'x1' })],
        polygons: [makePolygon({ id: 'p1' })],
      }),
    });
  });

// Every kind the toggle claims to hide, by the DOM hook that proves it painted.
// `station hit areas` is the load-bearing one: [data-station-id] is the
// transparent rect that swallows clicks meant for the art underneath (the
// proxy-only [data-station-hit] is a different, selected-station layer), so
// hiding the network without hiding it would look right and fix nothing.
const NETWORK: Record<string, string> = {
  'line stripes': '[data-band-stripe]',
  'stop dots': '[data-stop-station]',
  'station hit areas': '[data-station-id]',
  'line tags': '[data-line-tag-id]',
  transfers: '[data-transfer-id]',
};

const count = (selector: string) => document.querySelectorAll(selector).length;

describe('MapCanvas — the lines/stations toggle', () => {
  it('draws the whole network, and the background art, by default', () => {
    render(<App />);
    seed();
    // Guards every assertion below from passing vacuously: if the seed didn't
    // paint in the first place, "it disappeared" would prove nothing.
    for (const [what, selector] of Object.entries(NETWORK)) {
      expect(count(selector), what).toBeGreaterThan(0);
    }
    expect(count('[data-polygon-id="p1"]')).toBeGreaterThan(0);
  });

  it('hiding takes the network off the canvas but leaves the background art', () => {
    render(<App />);
    seed();
    act(() => {
      useViewportStore.getState().setShowNetwork(false);
    });
    for (const [what, selector] of Object.entries(NETWORK)) {
      expect(count(selector), what).toBe(0);
    }
    // The whole point: the polygon that was buried under the line survives, and
    // with the station hit areas gone it's now reachable by a plain click.
    expect(count('[data-polygon-id="p1"]')).toBeGreaterThan(0);
  });

  it('brings the network back on toggle', () => {
    render(<App />);
    seed();
    act(() => {
      useViewportStore.getState().setShowNetwork(false);
    });
    act(() => {
      useViewportStore.getState().setShowNetwork(true);
    });
    for (const [what, selector] of Object.entries(NETWORK)) {
      expect(count(selector), what).toBeGreaterThan(0);
    }
  });

  it("hides a selected station's editor panel, without dropping the selection", () => {
    // The popover is a DOM overlay, not canvas content, so it doesn't vanish
    // with the station — it would hang there offering to edit dots the user
    // can't see. `hidden` (display:none, still mounted) is the mechanism the
    // panel already uses for mode excursions: it keeps the DOM node — and with
    // it the width usePinnedPopover measured to right-align the dock — across
    // the excursion, so the panel comes back exactly where it was instead of
    // re-measuring from the nominal fallback.
    render(<App />);
    seed();
    act(() => {
      useSelection.getState().selectStation('s1' as StationId);
    });
    const panel = () => document.querySelector('.station-popover');
    expect(panel()).toBeVisible();

    act(() => {
      useViewportStore.getState().setShowNetwork(false);
    });
    expect(panel()).not.toBeVisible();
    // Still selected: this is a peek, not a deselect. Toggling back restores
    // the panel rather than making the user re-find the station.
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);

    act(() => {
      useViewportStore.getState().setShowNetwork(true);
    });
    expect(panel()).toBeVisible();
  });

  it('paints no dim wash when a line is selected while the network is hidden', () => {
    // HighlightedLineLayer washes the FULL viewport to focus the selected line.
    // Ungated, hiding the network would leave the wash behind with no line under
    // it — blacking out the very background art the toggle exists to expose.
    render(<App />);
    seed();
    act(() => {
      useSelection.getState().selectLine('L1' as LineId);
    });
    expect(document.querySelector('[data-dim]')).not.toBeNull();
    act(() => {
      useViewportStore.getState().setShowNetwork(false);
    });
    expect(document.querySelector('[data-dim]')).toBeNull();
  });
});
