import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../../App';
import { useDoc } from '../../state/store';
import * as interlining from '../../geometry/interlining';
import { DEFAULT_DOC } from '../../model/transforms';
import type { Line, Station } from '../../model/types';
import { makeLine } from '../../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Same warning-producing geometry as MapCanvas.warning.test.tsx: two stations
// very close together with a large curve radius, so both bands route through
// corners too tight for a clean fillet and warn.
const seedWarningDoc = () => {
  const stops: Station['stops'] = [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
    { lineId: 'L2', row: 0, col: 5, orientation: 'auto-vertical' },
  ];
  const label: Station['label'] = {
    row: 0,
    col: -1,
    rotation: 0,
    offset: 0,
    align: 'auto',
    valign: 'middle',
  };
  const s1: Station = { id: 's1', name: 'Alpha', x: 0, y: 0, rotation: 0, stops, label };
  const s2: Station = { id: 's2', name: 'Beta', x: 0, y: 20, rotation: 2, stops, label };
  const mkLine = (id: string, color: string): Line =>
    makeLine({
      id,
      service: id,
      name: `${id} line`,
      color,
      stations: ['s1', 's2'],
    });
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1, s2 },
      lines: { L1: mkLine('L1', '#0039A6'), L2: mkLine('L2', '#EE352E') },
      lineOrder: ['L1', 'L2'],
      curveRadius: 80,
    });
  });
};

describe('WarningToasts', () => {
  it('shows one toast per warning band, naming the band’s stations', () => {
    render(<App />);
    seedWarningDoc();

    const toasts = Array.from(document.querySelectorAll('.warning-toasts .toast'));
    expect(toasts).toHaveLength(2);
    for (const t of toasts) {
      expect(t.textContent).toContain('Alpha');
      expect(t.textContent).toContain('Beta');
    }
  });

  it('reuses the canvas’s memoized bands instead of re-running the router', () => {
    // buildBands is the standalone convenience wrapper around
    // buildBandGeometry + assignLinePriorities. MapCanvas builds its bands
    // through the two-level memo, so nothing in the render tree should call
    // the wrapper — a second router run per frame is pure waste (it's the
    // most expensive pure computation in the app, and it used to run twice
    // on every station-drag frame).
    const spy = vi.spyOn(interlining, 'buildBands');
    render(<App />);
    seedWarningDoc();

    expect(document.querySelectorAll('.warning-toasts .toast')).toHaveLength(2);
    expect(spy).not.toHaveBeenCalled();
  });
});
