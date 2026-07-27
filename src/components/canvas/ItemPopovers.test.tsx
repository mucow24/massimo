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

function leftTop(): { left: number; top: number } {
  const el = document.querySelector('.bullet-popover') as HTMLElement | null;
  if (!el) throw new Error('popover not rendered');
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, routeBullets: { b1: bullet } });
  useSelection.getState().selectRouteBullet('b1');
  useLiveViewportStore.setState({ pending: null });
  // Keep spawn arithmetic in the plain 800×600 box: the open sidebar
  // (default) would subtract its 320px strip from the placement box. The
  // sidebar-aware case has its own test below.
  useSelection.setState({ ...useSelection.getState(), sidebarOpen: false });
});

afterEach(() => {
  useLiveViewportStore.setState({ pending: null });
  useSelection.getState().selectRouteBullet(null);
});

describe('ItemPopovers — tracks the in-flight pan', () => {
  it('reprojects the popover through the live (pending) viewport mid-pan', () => {
    render(<ItemPopovers view={committedView} />);
    // Committed: the bullet's ±10 rect spans screen (390,290)–(410,310); the
    // spawn opens gap-diagonal below-left of it: (390−14−248, 310+14).
    expect(leftTop().left).toBeCloseTo(128, 9);
    expect(leftTop().top).toBeCloseTo(324, 9);

    // Mid middle-drag pan: the viewBox is written imperatively (no store commit),
    // so useViewport publishes the live viewport here. Center moved by (-50,-30)
    // → vb origin (-450,-330) → the frozen corner shifts by (+50,+30).
    act(() => useLiveViewportStore.setState({ pending: { x: -50, y: -30, zoom: 1 } }));
    expect(leftTop().left).toBeCloseTo(178, 9);
    expect(leftTop().top).toBeCloseTo(354, 9);

    // Pan commit clears the pending viewport; the popover falls back to the
    // (now-updated) committed view passed as a prop — no jump.
    act(() => useLiveViewportStore.setState({ pending: null }));
    expect(leftTop().left).toBeCloseTo(128, 9);
    expect(leftTop().top).toBeCloseTo(324, 9);
  });
});

describe('ItemPopovers — spawn placement wiring', () => {
  it('subtracts the open sidebar strip from the placement box', () => {
    // Bullet at world (110,0) → rect (500,290)–(520,310), so the below-left
    // diagonal x = 500−14−248 = 238. Sidebar open (320px overlay on the
    // host's right, painting ABOVE the popovers): 238 exceeds the reduced
    // x-limit 480−248−8 = 224, so x clamps to 224 — left of the panel strip.
    useDoc.setState({ ...useDoc.getState(), routeBullets: { b1: { ...bullet, x: 110 } } });
    useSelection.setState({ ...useSelection.getState(), sidebarOpen: true });
    render(<ItemPopovers view={committedView} />);
    expect(leftTop().left).toBeCloseTo(224, 9);
    expect(leftTop().top).toBeCloseTo(324, 9);
  });

  it('the station branch feeds the per-line stop width into the spawn rect', () => {
    // Waypoint station (no name label → no text measurement) with one stop on
    // a width-28 line: stop half 14 + HIT_PAD 2 → world box ±16 → screen rect
    // (384,284)–(416,316) → diagonal spawn (384−14−248, 316+14) = (122,330).
    // Under the default stop width the box is ±9 and the spawn (129,323) —
    // this pins that ItemPopovers threads stopHalfOf(doc.lines), not the
    // default, into stationWorldAABB.
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      stations: {
        a: {
          id: 'a',
          name: 'A',
          x: 0,
          y: 0,
          rotation: 0,
          isWaypoint: true,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        },
      },
      lines: {
        L1: makeLine({
          id: 'L1',
          service: '1',
          name: '1 line',
          color: '#111111',
          stations: ['a'],
          width: 28,
        }),
      },
      lineOrder: ['L1'],
    });
    useSelection.getState().selectRouteBullet(null);
    useSelection.getState().selectStation('a');
    render(<ItemPopovers view={committedView} />);
    const el = document.querySelector('.station-popover') as HTMLElement;
    expect(el).not.toBeNull();
    expect(parseFloat(el.style.left)).toBeCloseTo(122, 9);
    expect(parseFloat(el.style.top)).toBeCloseTo(330, 9);
    useSelection.getState().selectStation(null);
  });
});

describe('ItemPopovers — spawn avoids covering the item', () => {
  it('opens beside a large svg image, fully inside the host', () => {
    // A 300×200 image centered at the origin: screen rect (250,200)–(550,400).
    // Every candidate clamps into the image at this size/host — below-left
    // diagonal (−12,414)→(8,344), above-left diagonal (−12,−62)→(8,8), above
    // (250,−62)→(250,8), below (250,414)→(250,344), left (−12,200)→(8,200)
    // pokes 6px into the image's left edge, and the right-side trio clamps
    // to x 544 < the image's right edge 550 — so the fallback is the clamped
    // below-left diagonal (8,344): fully visible, overlap accepted.
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      svgImages: {
        i1: {
          id: 'i1',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          rotation: 0,
          href: 'data:image/svg+xml;base64,PHN2Zy8+',
        },
      },
      backgroundOrder: ['i1'],
    });
    useSelection.getState().selectRouteBullet(null); // sole selection = the image
    useSelection.getState().selectSvgImage('i1');
    render(<ItemPopovers view={committedView} />);
    const el = document.querySelector('.svg-image-popover') as HTMLElement;
    expect(el).not.toBeNull();
    expect(parseFloat(el.style.left)).toBeCloseTo(8, 9);
    expect(parseFloat(el.style.top)).toBeCloseTo(344, 9);
    useSelection.getState().selectSvgImage(null);
  });

  it('opens gap-diagonal off a small svg image when there is room', () => {
    // 100×60 at the origin → screen rect (350,270)–(450,330); the below-left
    // diagonal fits and clears: (350−14−248, 330+14).
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      svgImages: {
        i1: {
          id: 'i1',
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          rotation: 0,
          href: 'data:image/svg+xml;base64,PHN2Zy8+',
        },
      },
      backgroundOrder: ['i1'],
    });
    useSelection.getState().selectRouteBullet(null); // sole selection = the image
    useSelection.getState().selectSvgImage('i1');
    render(<ItemPopovers view={committedView} />);
    const el = document.querySelector('.svg-image-popover') as HTMLElement;
    expect(el).not.toBeNull();
    expect(parseFloat(el.style.left)).toBeCloseTo(88, 9);
    expect(parseFloat(el.style.top)).toBeCloseTo(344, 9);
    useSelection.getState().selectSvgImage(null);
  });
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
    render(<ItemPopovers view={committedView} />);
    expect(document.querySelector('.transfer-popover')).not.toBeNull();
  });

  it('unmounts on deselect, and never co-shows with a list-selection popover', () => {
    seedTransfer();
    const { rerender } = render(<ItemPopovers view={committedView} />);
    expect(document.querySelector('.transfer-popover')).not.toBeNull();

    // Selecting a bullet clears the transfer primary (SIBLING_PRIMARY_CLEAR):
    // its popover replaces the transfer's.
    act(() => {
      useDoc.setState({ ...useDoc.getState(), routeBullets: { b1: bullet } });
      useSelection.getState().selectRouteBullet('b1');
    });
    rerender(<ItemPopovers view={committedView} />);
    expect(document.querySelector('.transfer-popover')).toBeNull();
    expect(document.querySelector('.bullet-popover:not(.transfer-popover)')).not.toBeNull();

    act(() => {
      useSelection.getState().selectRouteBullet(null);
    });
    rerender(<ItemPopovers view={committedView} />);
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
    render(<ItemPopovers view={committedView} />);
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
    render(<ItemPopovers view={committedView} />);
    expect(document.querySelector('.selection-popover .selection-summary')?.textContent).toBe(
      '2 items · 1 locked',
    );
  });

  it('does NOT mount for a sole selection (the item popover owns it)', () => {
    // The global beforeEach selects just b1.
    render(<ItemPopovers view={committedView} />);
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
    render(<ItemPopovers view={committedView} />);
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
    render(<ItemPopovers view={committedView} />);
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
    const { rerender } = render(<ItemPopovers view={committedView} />);
    expect(document.querySelector('.line-popover')).not.toBeNull();

    act(() => useSelection.getState().setAppending(null));
    rerender(<ItemPopovers view={committedView} />);
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
    render(<ItemPopovers view={committedView} />);
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
    render(<ItemPopovers view={committedView} />);
    const el = document.querySelector('.station-popover') as HTMLElement;
    expect(el).not.toBeNull();
    // Host is 800 wide; popover is 320 wide + 8px edge pad.
    expect(el.style.left).toBe('472px');
    expect(el.style.top).toBe('8px');
  });
});
