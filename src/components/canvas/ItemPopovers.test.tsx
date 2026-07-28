import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { ItemPopovers } from './ItemPopovers';
import { useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useLiveViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import type { RouteBullet } from '../../model/types';
import { makeLine } from '../../test/fixtures';

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

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, routeBullets: { b1: bullet } });
  useSelection.getState().selectRouteBullet('b1');
  useLiveViewportStore.setState({ pending: null });
  // This file is about which popover MOUNTS; the dock's own geometry (and its
  // sidebar inset) lives in popoverPinned.test.tsx.
  useSelection.setState({ ...useSelection.getState(), sidebarOpen: false });
});

afterEach(() => {
  useLiveViewportStore.setState({ pending: null });
  useSelection.getState().selectRouteBullet(null);
});

describe('ItemPopovers — transfer popover', () => {
  const seedTransfer = () => {
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
          stops: [],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
        b: {
          id: 'b',
          name: 'Beta',
          x: 100,
          y: 0,
          rotation: 0,
          stops: [],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
      transfers: {
        x1: { id: 'x1', a: { stationId: 'a', lineId: null }, b: { stationId: 'b', lineId: null } },
      },
    });
    useSelection.getState().selectTransfer('x1');
  };

  afterEach(() => {
    useSelection.getState().selectTransfer(null);
  });

  it('mounts for the selected transfer (a single-id primary outside soleSelection)', () => {
    seedTransfer();
    render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.transfer-popover')).not.toBeNull();
  });

  it('unmounts on deselect, and never co-shows with a list-selection popover', () => {
    seedTransfer();
    const { rerender } = render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.transfer-popover')).not.toBeNull();

    // Selecting a bullet clears the transfer primary (SIBLING_PRIMARY_CLEAR):
    // its popover replaces the transfer's.
    act(() => {
      useDoc.setState({ ...useDoc.getState(), routeBullets: { b1: bullet } });
      useSelection.getState().selectRouteBullet('b1');
    });
    rerender(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.transfer-popover')).toBeNull();
    expect(document.querySelector('.bullet-popover:not(.transfer-popover)')).not.toBeNull();

    act(() => {
      useSelection.getState().selectRouteBullet(null);
    });
    rerender(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.transfer-popover')).toBeNull();
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
        L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] }),
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
    render(<ItemPopovers hostSize={committedView.size} />);
    const pop = document.querySelector('.station-popover');
    expect(pop).not.toBeNull();
    // The inspector's Name field is inside.
    expect(pop?.querySelector('textarea')).not.toBeNull();
  });

  it('is hidden (mounted, display:none) during sticky placing-station mode', () => {
    seedStation();
    // placing-station wipes selection on entry; re-select to simulate the
    // sticky-mode click-an-existing-station case. The editor must not show
    // under every placement click — but it stays MOUNTED (display:none), so it
    // keeps its DOM node across the excursion.
    act(() => {
      useSelection.getState().setUiMode({ kind: 'placing-station' });
      useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['a'] });
    });
    render(<ItemPopovers hostSize={committedView.size} />);
    const pop = document.querySelector('.station-popover');
    expect(pop).not.toBeNull();
    expect(pop).not.toBeVisible();
  });

  it("stays mounted while editing THIS station's layout", () => {
    seedStation();
    act(() => useSelection.getState().startEditingStationLayout('a'));
    render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.station-popover')).not.toBeNull();
  });

  it('still shows the editor for a station selected off-screen', () => {
    // Sidebar-selecting an off-screen station has to open its editor: the dock
    // is screen-space, so the panel is on the host no matter where the station
    // is (the old spawn-beside-the-item placement had to clamp for this).
    seedStation(100000, 100000); // far outside the 800×600 view
    render(<ItemPopovers hostSize={committedView.size} />);
    const el = document.querySelector('.station-popover') as HTMLElement;
    expect(el).not.toBeNull();
    expect(parseFloat(el.style.left)).toBeCloseTo(800 - 320 - 8, 9);
    expect(parseFloat(el.style.top)).toBeCloseTo(8, 9);
  });
});

describe('ItemPopovers — selection popover (multi-select) gating', () => {
  // The multi-selection gate: the selection popover mounts when ≥2 items are
  // selected across the five lists (any mix of kinds), idle mode only —
  // exactly one selected item stays the per-item popovers' territory.
  const seedSecondBullet = () => {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: { b1: bullet, b2: { ...bullet, id: 'b2', x: 50, y: 20 } },
    });
  };

  afterEach(() => {
    useSelection.getState().setRouteBulletSelection([]);
    useSelection.getState().setStationSelection([]);
    useSelection.getState().setUiMode({ kind: 'idle' });
  });

  it('mounts for two selected items of one kind, with the count summary', () => {
    seedSecondBullet();
    useSelection.getState().setRouteBulletSelection(['b1', 'b2']);
    render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.selection-popover .selection-summary')?.textContent).toBe(
      '2 items · 0 locked',
    );
  });

  it('mounts for a mixed-kind selection and counts locked members', () => {
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: { b1: { ...bullet, locked: true } },
      stations: {
        a: {
          id: 'a',
          name: 'Alpha',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
    });
    useSelection.getState().setStationSelection(['a']);
    useSelection.getState().addRouteBulletsToSelection(['b1']);
    render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.selection-popover .selection-summary')?.textContent).toBe(
      '2 items · 1 locked',
    );
  });

  it('does NOT mount for a sole selection (the item popover owns it)', () => {
    // The global beforeEach selects just b1.
    render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.selection-popover')).toBeNull();
    expect(document.querySelector('.bullet-popover')).not.toBeNull();
  });

  it('does NOT mount outside idle mode', () => {
    seedSecondBullet();
    useSelection.getState().setRouteBulletSelection(['b1', 'b2']);
    // placing-label keeps a marquee selection alive (the one non-idle mode
    // where rect-select still runs) — set the mode directly, since setUiMode
    // wipes selections on entry.
    act(() => useSelection.setState({ uiMode: { kind: 'placing-label' } }));
    render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.selection-popover')).toBeNull();
  });
});

describe('ItemPopovers — line popover (Edit Stops)', () => {
  const seedLine = () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: {
        L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: [] }),
      },
      lineOrder: ['L1'],
    });
  };

  afterEach(() => {
    useSelection.getState().setAppending(null);
  });

  it('mounts pinned to the host top-right while appending-to-line is active', () => {
    seedLine();
    act(() => useSelection.getState().startAppend('L1'));
    render(<ItemPopovers hostSize={committedView.size} />);
    const el = document.querySelector('.line-popover') as HTMLElement;
    expect(el).not.toBeNull();
    // Host is 800 wide; popover is 320 wide + 8px edge pad — the same pin the
    // station layout editor uses.
    expect(el.style.left).toBe('472px');
    expect(el.style.top).toBe('8px');
  });

  it('unmounts when the mode exits', () => {
    seedLine();
    act(() => useSelection.getState().startAppend('L1'));
    const { rerender } = render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.line-popover')).not.toBeNull();

    act(() => useSelection.getState().setAppending(null));
    rerender(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.line-popover')).toBeNull();
  });

  it('renders nothing for a dangling lineId (transient mid-delete render)', () => {
    seedLine();
    act(() => useSelection.getState().startAppend('L1'));
    act(() =>
      useSelection.setState({
        uiMode: { kind: 'appending-to-line', lineId: 'GONE', cursor: null },
      }),
    );
    render(<ItemPopovers hostSize={committedView.size} />);
    expect(document.querySelector('.line-popover')).toBeNull();
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
        L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] }),
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
    render(<ItemPopovers hostSize={committedView.size} />);
    const el = document.querySelector('.station-popover') as HTMLElement;
    expect(el).not.toBeNull();
    // Host is 800 wide; popover is 320 wide + 8px edge pad.
    expect(el.style.left).toBe('472px');
    expect(el.style.top).toBe('8px');
  });
});
