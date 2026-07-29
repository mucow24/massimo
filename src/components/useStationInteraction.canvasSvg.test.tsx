import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStationInteraction } from './useStationInteraction';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, LineId, Station } from '../model/types';

/**
 * A transfer pick maps the click to the nearest stop dot, which means
 * projecting screen → world through the MAP's `<svg>`. That element has one
 * owner, `getCanvasSvg()` — the item popovers also live inside `.canvas-host`
 * and carry little icon `<svg>`s, so "the first svg under the host" is not the
 * map surface, it is whichever svg happens to come first in the DOM.
 *
 * Here a chrome svg is mounted BEFORE the pan layer, sized and viewBox'd
 * differently, so a lookup that settles for it projects the click through the
 * wrong box and picks the wrong dot.
 */

// Two stops one lattice row apart: at station-local scale, a click near the
// top of the station belongs to L1 and one near the bottom to L2.
const station: Station = makeStation({
  id: 'S',
  x: 0,
  y: 0,
  stops: [makeStop('L1', { row: -1 }), makeStop('L2', { row: 1 })],
});
const lines: Record<string, Line> = {
  L1: makeLine({ id: 'L1', stations: ['S'] }),
  L2: makeLine({ id: 'L2', stations: ['S'] }),
};

function mountCanvas() {
  const host = document.createElement('div');
  host.className = 'canvas-host';
  // Popover chrome: an icon svg with its own tiny viewBox, mounted first.
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 16, height: 16 }) as ReturnType<Element['getBoundingClientRect']>;
  host.appendChild(icon);

  const layer = document.createElement('div');
  layer.className = 'canvas-pan-layer';
  const map = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // The pan surface: 400x400 of world centred on the origin, drawn into a
  // 400x400 box, so screen (x, y) maps to world (x - 200, y - 200).
  map.setAttribute('viewBox', '-200 -200 400 400');
  map.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 400 }) as ReturnType<Element['getBoundingClientRect']>;
  layer.appendChild(map);
  host.appendChild(layer);
  document.body.appendChild(host);
  return host;
}

let host: HTMLElement;

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.setState({ stations: { S: station }, lines });
  useSelection.getState().setUiMode({ kind: 'creating-transfer', firstEnd: null });
  host = mountCanvas();
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

const clickAt = (clientY: number) => {
  const { result } = renderHook(() =>
    useStationInteraction(station, () => {}, lines as Record<LineId, Line>),
  );
  result.current.handlers.onClick?.({
    clientX: 200,
    clientY,
    stopPropagation: () => {},
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
  } as unknown as React.MouseEvent);
};

describe('transfer pick projects through the map svg, not the first svg in the host', () => {
  it('picks the upper stop for a click above the station centre', () => {
    clickAt(180); // world y = -20, nearest the row -1 stop
    const mode = useSelection.getState().uiMode;
    expect(mode.kind).toBe('creating-transfer');
    if (mode.kind === 'creating-transfer')
      expect(mode.firstEnd).toEqual({
        stationId: 'S',
        lineId: 'L1',
      });
  });

  it('picks the lower stop for a click below the station centre', () => {
    clickAt(220); // world y = +20, nearest the row +1 stop
    const mode = useSelection.getState().uiMode;
    expect(mode.kind).toBe('creating-transfer');
    if (mode.kind === 'creating-transfer')
      expect(mode.firstEnd).toEqual({
        stationId: 'S',
        lineId: 'L2',
      });
  });
});
