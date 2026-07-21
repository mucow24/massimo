import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { EditingBanner } from './EditingBanner';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeLine } from '../../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.getState().setUiMode({ kind: 'idle' });
});

const frame = () => document.querySelector('.append-frame');
const banner = () => document.querySelector('.append-banner') as HTMLElement | null;

// EVERY placement mode gets the same chrome: colored frame + instruction
// banner + cancel hint. creating-polygon and placing-svg used to fall out the
// bottom of the switch (no feedback at all), and placing-label explicitly
// returned null — half the "click to drop a thing" modes shouted, half were
// silent.
describe('<EditingBanner /> — every non-idle mode gets chrome', () => {
  it('renders nothing when idle', () => {
    render(<EditingBanner />);
    expect(banner()).toBeNull();
    expect(frame()).toBeNull();
  });

  it.each([
    ['placing-station', /place a new station/i],
    ['creating-line-tag', /place a tag/i],
    ['creating-route-bullet', /route bullet/i],
    ['placing-label', /text label/i],
    ['creating-polygon', /polygon/i],
  ] as const)('%s shows a frame + banner with the cancel hint', (kind, re) => {
    useSelection.getState().setUiMode({ kind });
    render(<EditingBanner />);
    expect(frame()).not.toBeNull();
    expect(banner()!.textContent).toMatch(re);
    // Right-click cancels every non-passthrough mode (App.tsx) — say so.
    expect(banner()!.textContent).toMatch(/Esc or right-click/);
  });

  it('placing-svg (payload-carrying variant) shows the banner too', () => {
    useSelection
      .getState()
      .setUiMode({ kind: 'placing-svg', image: { href: 'data:', width: 10, height: 10 } });
    render(<EditingBanner />);
    expect(banner()!.textContent).toMatch(/imported image/i);
    expect(banner()!.textContent).toMatch(/Esc or right-click/);
  });

  it('creating-transfer keeps its two-step copy', () => {
    useSelection.getState().setUiMode({ kind: 'creating-transfer', anchor: null });
    render(<EditingBanner />);
    expect(banner()!.textContent).toMatch(/first station/i);
  });

  it('layering wears its own class — no inline color overriding "placing"', () => {
    useSelection.getState().setUiMode({ kind: 'layering' });
    render(<EditingBanner />);
    expect(banner()!.classList.contains('layering')).toBe(true);
    expect(banner()!.classList.contains('placing')).toBe(false);
    expect(banner()!.getAttribute('style')).toBeNull();
    expect(frame()!.classList.contains('layering')).toBe(true);
    // Layering repurposes right-click (layer decrement) — Esc is the only exit.
    expect(banner()!.textContent).toMatch(/Esc/);
    expect(banner()!.textContent).not.toMatch(/right-click to cancel/);
  });

  it('appending keeps the line color inline (genuinely dynamic per line)', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', service: 'A', color: '#ff0000' }) },
      lineOrder: ['L1'],
    });
    useSelection.getState().setUiMode({
      kind: 'appending-to-line',
      lineId: 'L1',
      cursor: null,
    });
    render(<EditingBanner />);
    expect(banner()!.textContent).toMatch(/Editing line A/);
    // The line's OWN color — a truthy-only check would also pass on a
    // hardcoded accent, which is exactly the regression this guards against.
    // (jsdom normalizes #ff0000 to rgb.)
    expect(banner()!.style.background).toBe('rgb(255, 0, 0)');
  });
});

// The Edit Stops banner tail tracks the invisible three-state cursor machine
// — nothing armed / pen on a station / inserting into an edge — so the user
// never has to infer "armed" from canvas chrome alone. Names are the compact
// list form (markup + bullet tokens stripped).
describe('<EditingBanner /> — Edit Stops copy tracks the cursor state', () => {
  const seed = () => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        S: {
          id: 'S',
          name: 'Union |A| Square',
          x: 0,
          y: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' as const }],
          label: { row: 1, col: 0, rotation: 0 as const, offset: 0, align: 'auto' as const, valign: 'auto-down' as const },
        },
        T: {
          id: 'T',
          name: 'Astor Place',
          x: 100,
          y: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' as const }],
          label: { row: 1, col: 0, rotation: 0 as const, offset: 0, align: 'auto' as const, valign: 'auto-down' as const },
        },
      },
      lines: { L1: makeLine({ id: 'L1', service: 'A', color: '#ff0000', stations: ['S', 'T'] }) },
      lineOrder: ['L1'],
    });
  };
  const appending = (cursor: import('./appendGestures').AppendCursor) =>
    useSelection.getState().setUiMode({ kind: 'appending-to-line', lineId: 'L1', cursor });

  it('nothing armed: the starting instructions, with the right-click exit', () => {
    seed();
    appending(null);
    render(<EditingBanner />);
    expect(banner()!.textContent).toMatch(/click a station or segment/i);
    expect(banner()!.textContent).toMatch(/right-click exits/i);
  });

  it('station cursor: names the pen station and offers connect/remove', () => {
    seed();
    appending({ kind: 'station', stationId: 'S' });
    render(<EditingBanner />);
    expect(banner()!.textContent).toMatch(/Union Square/); // bullet token stripped
    expect(banner()!.textContent).toMatch(/connect/i);
  });

  it('edge cursor: names the armed corridor endpoints', () => {
    seed();
    appending({ kind: 'edge', from: 'S', to: 'T' });
    render(<EditingBanner />);
    expect(banner()!.textContent).toMatch(/Union Square/);
    expect(banner()!.textContent).toMatch(/Astor Place/);
    expect(banner()!.textContent).toMatch(/insert/i);
  });

  it('a stale cursor (undo stripped it) falls back to the starting copy', () => {
    seed();
    appending({ kind: 'station', stationId: 'GONE' });
    render(<EditingBanner />);
    expect(banner()!.textContent).toMatch(/click a station or segment/i);
  });
});
