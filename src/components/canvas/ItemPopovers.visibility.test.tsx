import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { ItemPopovers } from './ItemPopovers';
import { useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { setVisibility, type VisibilityKey } from '../../state/visibility';
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
} from '../../test/fixtures';
import type { LineId, StationId } from '../../model/types';

/**
 * A popover is a DOM overlay, not canvas content, so hiding a layer does not
 * take its editor away — the panel hangs there offering to edit, and Delete, an
 * item that is no longer on screen. ItemPopovers' own comment has always named
 * that failure for the lines/stations toggle; these pin it for every other kind
 * the View menu can hide.
 *
 * Rendered directly, like the sibling ItemPopovers.test.tsx. The gate under
 * test reads the visibility store, so a full <App /> mount bought nothing here
 * beyond a host box — which is now just the hostSize prop.
 */

// zoom 1, centered on the world origin, matching ItemPopovers.test.tsx.
const HOST = { w: 800, h: 600 };

beforeEach(() => {
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
    selectedSvgImageIds: [],
    selectedLabelIds: [],
    selectedRouteBulletIds: [],
    selectedLineCircleIds: [],
    selectedTransferId: null,
    uiMode: { kind: 'idle' },
    sidebarOpen: false,
  });
});

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

/** Each kind: the flag that hides it, how it gets selected, and its panel. */
const CASES: {
  key: VisibilityKey;
  select: () => void;
  panel: string;
}[] = [
  {
    key: 'showPolygons',
    select: () => useSelection.getState().selectPolygon('p1'),
    panel: '.polygon-popover',
  },
  {
    key: 'showTextLabels',
    select: () => useSelection.getState().selectLabel('g1'),
    panel: '.text-label-popover',
  },
  {
    key: 'showSvgImages',
    select: () => useSelection.getState().selectSvgImage('i1'),
    panel: '.svg-image-popover',
  },
  {
    key: 'showRouteBullets',
    select: () => useSelection.getState().selectRouteBullet('b1'),
    panel: '.bullet-popover',
  },
  {
    key: 'showLineCircles',
    select: () => useSelection.getState().selectLineCircle('c1'),
    panel: '.line-circle-popover',
  },
  {
    key: 'showTransfers',
    select: () => useSelection.getState().selectTransfer('x1'),
    panel: '.transfer-popover',
  },
];

const count = (sel: string) => document.querySelectorAll(sel).length;

describe('ItemPopovers — a hidden kind takes its editor with it', () => {
  it.each(CASES)('$key closes the $panel', ({ key, select, panel }) => {
    render(<ItemPopovers hostSize={HOST} />);
    seed();
    act(select);
    // Guards the assertion below from passing vacuously.
    expect(count(panel), `${panel} never opened`).toBe(1);
    act(() => setVisibility(key, false));
    expect(count(panel), `${panel} survived hiding ${key}`).toBe(0);
    // Hiding is a PEEK, not a deselect — unhiding brings the editor straight
    // back rather than making the user re-find the item.
    act(() => setVisibility(key, true));
    expect(count(panel), `${panel} did not come back`).toBe(1);
  });

  it('drops hidden items from the multi-select group count', () => {
    // The bulk panel offers Delete all: a tally that silently includes items
    // the user cannot see makes that a trap.
    render(<ItemPopovers hostSize={HOST} />);
    seed();
    act(() => {
      useSelection.setState({
        selectedPolygonIds: ['p1'],
        selectedLabelIds: ['g1'],
        selectedRouteBulletIds: ['b1'],
      });
    });
    const group = () => document.querySelector('.selection-popover');
    expect(group()).not.toBeNull();
    const before = group()!.textContent ?? '';
    expect(before).toContain('3');
    act(() => setVisibility('showPolygons', false));
    expect(group()!.textContent, 'hidden polygon still counted').toContain('2');
    // Down to one visible item: no group panel, and NOT a promotion to that
    // item's own editor either.
    act(() => setVisibility('showTextLabels', false));
    expect(group()).toBeNull();
    expect(count('.bullet-popover')).toBe(0);
  });
});
