import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { ItemPopovers } from './ItemPopovers';
import { useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useLiveViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import type { RouteBullet } from '../../model/types';

// zoom 1, centered on the world origin: world (0,0) projects to screen (400,300).
const committedView = { vbX: -400, vbY: -300, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

const bullet: RouteBullet = {
  id: 'b1',
  x: 0,
  y: 0,
  rotation: 0,
  lineId: null,
  shape: 'circle',
  size: 10,
};

function leftTop(): { left: number; top: number } {
  const el = document.querySelector('.bullet-popover') as HTMLElement | null;
  if (!el) throw new Error('popover not rendered');
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, routeBullets: { b1: bullet } });
  useSelection.getState().selectRouteBullet('b1');
  useLiveViewportStore.setState({ pending: null });
});

afterEach(() => {
  useLiveViewportStore.setState({ pending: null });
  useSelection.getState().selectRouteBullet(null);
});

describe('ItemPopovers — tracks the in-flight pan', () => {
  it('reprojects the popover through the live (pending) viewport mid-pan', () => {
    render(<ItemPopovers view={committedView} />);
    // Committed: world (0,0) → screen (400,300), + the popover's 14px gap.
    expect(leftTop().left).toBeCloseTo(414, 9);
    expect(leftTop().top).toBeCloseTo(314, 9);

    // Mid middle-drag pan: the viewBox is written imperatively (no store commit),
    // so useViewport publishes the live viewport here. Center moved by (-50,-30)
    // → vb origin (-450,-330) → world (0,0) now projects to screen (450,330).
    act(() => useLiveViewportStore.setState({ pending: { x: -50, y: -30, zoom: 1 } }));
    expect(leftTop().left).toBeCloseTo(464, 9);
    expect(leftTop().top).toBeCloseTo(344, 9);

    // Pan commit clears the pending viewport; the popover falls back to the
    // (now-updated) committed view passed as a prop — no jump.
    act(() => useLiveViewportStore.setState({ pending: null }));
    expect(leftTop().left).toBeCloseTo(414, 9);
    expect(leftTop().top).toBeCloseTo(314, 9);
  });
});

describe('ItemPopovers — station popover', () => {
  const seedStation = (x = 0, y = 0) => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      stations: {
        a: {
          id: 'a',
          name: 'Alpha',
          x,
          y,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
      lines: {
        L1: { id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] },
      },
      lineOrder: ['L1'],
    });
    useSelection.getState().selectStation('a');
  };

  afterEach(() => {
    useSelection.getState().selectStation(null);
    useSelection.getState().setUiMode({ kind: 'idle' });
  });

  it('mounts for a sole-selected station in idle mode, hosting the inspector', () => {
    seedStation();
    render(<ItemPopovers view={committedView} />);
    const pop = document.querySelector('.station-popover');
    expect(pop).not.toBeNull();
    // The inspector's Name field is inside.
    expect(pop?.querySelector('textarea')).not.toBeNull();
  });

  it('is hidden (mounted, display:none) during sticky placing-station mode', () => {
    seedStation();
    // placing-station wipes selection on entry; re-select to simulate the
    // sticky-mode click-an-existing-station case. The editor must not show
    // under every placement click — but it stays MOUNTED so its frozen anchor
    // survives the excursion (see popoverCanvasLock.test.tsx).
    act(() => {
      useSelection.getState().setUiMode({ kind: 'placing-station' });
      useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['a'] });
    });
    render(<ItemPopovers view={committedView} />);
    const pop = document.querySelector('.station-popover');
    expect(pop).not.toBeNull();
    expect(pop).not.toBeVisible();
  });

  it("stays mounted while editing THIS station's layout", () => {
    seedStation();
    act(() => useSelection.getState().startEditingStationLayout('a'));
    render(<ItemPopovers view={committedView} />);
    expect(document.querySelector('.station-popover')).not.toBeNull();
  });

  it('clamps the anchor into the canvas host for off-screen stations', () => {
    seedStation(100000, 100000); // far outside the 800×600 view
    render(<ItemPopovers view={committedView} />);
    const el = document.querySelector('.station-popover') as HTMLElement;
    expect(el).not.toBeNull();
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(800);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(600);
  });
});

describe('ItemPopovers — station popover, layout-edit interplay', () => {
  const seedStation = () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      stations: {
        a: {
          id: 'a',
          name: 'Alpha',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
      lines: {
        L1: { id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] },
      },
      lineOrder: ['L1'],
    });
    useSelection.getState().selectStation('a');
  };

  afterEach(() => {
    useSelection.getState().selectStation(null);
    useSelection.getState().setUiMode({ kind: 'idle' });
  });

  it('pins to the top-right of the host during layout-edit so it cannot cover the handles', () => {
    seedStation();
    act(() => useSelection.getState().startEditingStationLayout('a'));
    render(<ItemPopovers view={committedView} />);
    const el = document.querySelector('.station-popover') as HTMLElement;
    expect(el).not.toBeNull();
    // Host is 800 wide; popover is 320 wide + 8px edge pad.
    expect(el.style.left).toBe('472px');
    expect(el.style.top).toBe('8px');
  });
});
