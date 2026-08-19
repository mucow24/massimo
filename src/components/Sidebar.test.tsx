import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

// Scoped to the Sidebar-only logic the plan calls out (the rest is e2e):
//  - station sort-direction flip (clicking the active header toggles asc/desc)
//  - a station-row line badge → selectLine (and the stop-propagation that keeps
//    it from also selecting the station).

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    activeTab: 'stations',
    sidebarOpen: true,
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLineId: null,
    hoveredStationId: null,
    uiMode: { kind: 'idle' },
  });
});

const rowOrder = () =>
  Array.from(document.querySelectorAll('[data-station-row]')).map((el) =>
    el.getAttribute('data-station-row'),
  );

// The "Station" column header is a .sort-header button (distinct from the
// "Stations (N)" tab button, which would also match a /Station/ name query).
const stationHeader = (): HTMLButtonElement => {
  const el = Array.from(document.querySelectorAll('button.sort-header')).find((b) =>
    b.textContent?.startsWith('Station'),
  );
  if (!el) throw new Error('expected a Station sort header');
  return el as HTMLButtonElement;
};

describe('<Sidebar /> — station sort-direction flip', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          makeStation({ id: 'alpha', name: 'Alpha' }),
          makeStation({ id: 'beta', name: 'Beta' }),
          makeStation({ id: 'gamma', name: 'Gamma' }),
        ],
      }),
    });
  });

  // The arrow is a Radix triangle icon carrying its own accessible name, so
  // the assertion targets the rendered indicator (icon + label travel as a
  // unit — a flipped direction ternary reads "ascending" over reversed rows
  // and fails here).
  const sortDir = () =>
    stationHeader().querySelector('.sort-arrow [role="img"]')?.getAttribute('aria-label');

  it('defaults to name-ascending order with an ascending arrow on the Station header', () => {
    render(<Sidebar />);
    expect(rowOrder()).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortDir()).toBe('sorted ascending');
  });

  it('clicking the active Station header once flips to descending and reverses the rows', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(stationHeader());
    expect(rowOrder()).toEqual(['gamma', 'beta', 'alpha']);
    expect(sortDir()).toBe('sorted descending');

    // A second click flips back to ascending.
    await user.click(stationHeader());
    expect(rowOrder()).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortDir()).toBe('sorted ascending');
  });
});

describe('<Sidebar /> — sorts by cleaned station name', () => {
  it('orders by the display text, ignoring leading tags and bullets', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          makeStation({ id: 'zeb', name: '<b>Zebra</b>' }),
          makeStation({ id: 'app', name: 'Apple' }),
          makeStation({ id: 'mango', name: '|1| Mango' }),
        ],
      }),
    });
    render(<Sidebar />);
    // Cleaned keys are Apple < Mango < Zebra. Sorting the raw markup would put
    // "<b>Zebra…" first (punctuation sorts before letters) — the leading <b>/|1|
    // must not influence the order.
    expect(rowOrder()).toEqual(['app', 'mango', 'zeb']);
  });
});

describe('<Sidebar /> — empty / nontraditional names sink to the bottom', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          makeStation({ id: 'air', name: '✈ Airport' }),
          makeStation({ id: 'ban', name: 'Banana' }),
          makeStation({ id: 'empty', name: '' }),
          makeStation({ id: 'app', name: 'Apple' }),
        ],
      }),
    });
  });

  it('ascending: letter-leading names first, then empty / nontraditional names', () => {
    render(<Sidebar />);
    // Apple, Banana lead (letters, sorted A→Z); empty then ✈ sink below them.
    expect(rowOrder()).toEqual(['app', 'ban', 'empty', 'air']);
  });

  it('descending: the sunk group stays at the bottom, above-flip only reorders the rest', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(stationHeader());
    // Letter names flip to Z→A (Banana, Apple); empty / ✈ remain pinned below.
    expect(rowOrder()).toEqual(['ban', 'app', 'air', 'empty']);
  });
});

// The tab bar buttons carry class `.tab` (distinct from the `.sort-header`
// column buttons, which also start with "Station").
const tabButton = (label: 'Stations' | 'Lines'): HTMLButtonElement => {
  const el = Array.from(document.querySelectorAll('button.tab')).find((b) =>
    b.textContent?.startsWith(label),
  );
  if (!el) throw new Error(`expected a ${label} tab`);
  return el as HTMLButtonElement;
};

const lineRows = () =>
  Array.from(document.querySelectorAll('[data-line-row]')).map((el) =>
    el.getAttribute('data-line-row'),
  );

describe('<Sidebar /> — collapsible list', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [makeStation({ id: 's1', name: 'Alpha' })],
        lines: [makeLine({ id: 'L1', service: 'A', stations: ['s1'] })],
      }),
    });
  });

  it('clicking the active Stations tab collapses the whole panel', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    expect(rowOrder()).toEqual(['s1']);
    expect(document.querySelector('.sidebar')).not.toBeNull();

    await user.click(tabButton('Stations'));

    // The panel is gone entirely — no tabs, no list — so its grid column can
    // collapse and the map reclaims the space.
    expect(document.querySelector('.sidebar')).toBeNull();
    expect(rowOrder()).toEqual([]);
    expect(useSelection.getState().sidebarOpen).toBe(false);
  });

  it('clicking Lines while Stations is shown swaps the list (panel stays open)', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    expect(rowOrder()).toEqual(['s1']);
    expect(lineRows()).toEqual([]);

    await user.click(tabButton('Lines'));

    expect(rowOrder()).toEqual([]); // stations gone
    expect(lineRows()).toEqual(['L1']); // lines shown
    expect(document.querySelector('.sidebar')).not.toBeNull(); // still open
    expect(useSelection.getState().sidebarOpen).toBe(true);
    expect(useSelection.getState().activeTab).toBe('lines');
  });
});

describe('<Sidebar /> — hidden while the station layout editor is open', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [makeStation({ id: 's1', name: 'Alpha' })] }),
    });
  });

  it('renders nothing while editing-station-layout is active, even with sidebarOpen', () => {
    useSelection.setState({
      ...useSelection.getState(),
      sidebarOpen: true,
      uiMode: { kind: 'editing-station-layout', stationId: 's1' },
    });
    render(<Sidebar />);
    // The layout-edit popover pins to the top-right, directly over the sidebar;
    // the sidebar collapses for the duration so the editor's controls aren't
    // trapped behind it (the canvas layer stacks below the sidebar).
    expect(document.querySelector('.sidebar')).toBeNull();
  });

  it('reappears when the layout editor exits (sidebarOpen untouched)', () => {
    useSelection.setState({
      ...useSelection.getState(),
      sidebarOpen: true,
      uiMode: { kind: 'editing-station-layout', stationId: 's1' },
    });
    render(<Sidebar />);
    expect(document.querySelector('.sidebar')).toBeNull();

    // Leaving layout-edit brings the panel straight back — no saved flag, it's
    // derived purely from uiMode plus the untouched sidebarOpen.
    act(() => useSelection.setState({ uiMode: { kind: 'idle' } }));

    expect(document.querySelector('.sidebar')).not.toBeNull();
    expect(useSelection.getState().sidebarOpen).toBe(true);
  });
});

describe('<Sidebar /> — clicking a station row centers the viewport on it', () => {
  const stationRow = (id: string): HTMLElement => {
    const el = document
      .querySelector(`[data-station-row="${id}"]`)
      ?.querySelector<HTMLElement>('.list-row');
    if (!el) throw new Error(`expected a row for station ${id}`);
    return el;
  };

  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [makeStation({ id: 's1', name: 'Hub', x: 300, y: -150 })] }),
    });
    // A camera parked somewhere else, zoomed in, so both the pan and the
    // zoom-preservation are observable.
    useViewportStore.setState({ x: 0, y: 0, zoom: 2 });
  });

  it('pans to the station origin, keeping the current zoom', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(stationRow('s1'));

    const cam = useViewportStore.getState();
    expect({ x: cam.x, y: cam.y }).toEqual({ x: 300, y: -150 });
    expect(cam.zoom).toBe(2); // centers (pans) — does not reframe/zoom
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
  });

  it('does not re-center when the click deselects the sole-selected station', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    // First click selects + centers on the station.
    await user.click(stationRow('s1'));
    // Simulate the user panning away afterward.
    useViewportStore.setState({ x: 999, y: 999, zoom: 2 });

    // Second click on the sole-selected row deselects; it must not yank the
    // camera back to the station.
    await user.click(stationRow('s1'));

    const cam = useViewportStore.getState();
    expect({ x: cam.x, y: cam.y }).toEqual({ x: 999, y: 999 });
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });
});

describe('<Sidebar /> — line badge selects the line', () => {
  it('clicking a station-row line badge calls selectLine (not selectStation)', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [makeStation({ id: 's1', name: 'Hub', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', service: 'A', name: 'Broadway Express', stations: ['s1'] })],
      }),
    });
    render(<Sidebar />);

    // The badge carries the service code "A" and is titled by the line's
    // display NAME — a name deliberately unlike the "<service> line" fallback,
    // so finding it proves the title came from `lineDisplayName`.
    const badge = screen.getByTitle('Edit Broadway Express');
    await user.click(badge);

    const sel = useSelection.getState();
    expect(sel.selectedLineId).toBe('L1');
    // The badge's stopPropagation kept the row's onClick (selectStation) from
    // firing, so no station got selected.
    expect(sel.selectedStationIds).toEqual([]);
    // selectLine also switches the active tab to lines.
    expect(sel.activeTab).toBe('lines');
  });

  it('falls back to "<service> line" on an unnamed line, like every other surface', () => {
    // The other half of `lineDisplayName`: a deliberately-cleared name reads
    // by service code. Both halves are asserted because only the pair
    // distinguishes the helper from a hand-spelled fallback.
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [makeStation({ id: 's1', name: 'Hub', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', service: 'A', name: '', stations: ['s1'] })],
      }),
    });
    render(<Sidebar />);

    expect(screen.getByTitle('Edit A line')).toBeTruthy();
  });
});

describe('<Sidebar /> — station name rendering', () => {
  it('renders names as cleaned plain text: tags stripped, bullets dropped, symbols except <xfer>', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', name: '<b>Foo</b> |A| Bar<tm><xfer>', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', service: 'A', stations: ['s1'] })],
      }),
    });
    render(<Sidebar />);

    // The name cell shows the cleaned text — no <b>, no |A| bullet, ™ kept, ↔ gone.
    const nameCell = document.querySelector('[data-station-row="s1"] .grow');
    expect(nameCell?.textContent).toBe('Foo Bar™');
    // No inline bullet badge renders in the list anymore.
    expect(document.querySelector('[data-inline-bullet]')).toBeNull();
  });

  it('renders the WP waypoint pill before the station name, only for a waypoint', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', name: 'Hub', isWaypoint: true }),
          makeStation({ id: 's2', name: 'Stop' }),
        ],
      }),
    });
    render(<Sidebar />);

    // Only the waypoint row carries a pill.
    const wpRow = document.querySelector('[data-station-row="s1"]');
    const plainRow = document.querySelector('[data-station-row="s2"]');
    const pill = wpRow?.querySelector('.wp-pill');
    expect(pill).not.toBeNull();
    expect(plainRow?.querySelector('.wp-pill')).toBeNull();

    // The pill precedes the name within the row.
    // DOCUMENT_POSITION_FOLLOWING = 4: the argument follows the receiver.
    const name = wpRow!.querySelector('.grow')!;
    expect(pill!.compareDocumentPosition(name) & 4).toBe(4);
  });

  it('shows a "(No name)" placeholder for a station with an empty name', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [makeStation({ id: 's1', name: '' })] }),
    });
    render(<Sidebar />);

    const nameCell = document.querySelector('[data-station-row="s1"] .grow');
    expect(nameCell?.textContent).toBe('(No name)');
    // The placeholder is styled (grey italics) via a dedicated class, so a real
    // station literally named "(No name)" wouldn't be dimmed.
    expect(nameCell?.classList.contains('no-name')).toBe(true);
  });

  it('treats a name that cleans to empty (only tags/bullets) as no name', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [makeStation({ id: 's1', name: '<b></b> |A|' })] }),
    });
    render(<Sidebar />);

    const nameCell = document.querySelector('[data-station-row="s1"] .grow');
    expect(nameCell?.textContent).toBe('(No name)');
    expect(nameCell?.classList.contains('no-name')).toBe(true);
  });

  it('does not dim a real station whose name is the placeholder text', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [makeStation({ id: 's1', name: '(No name)' })] }),
    });
    render(<Sidebar />);

    const nameCell = document.querySelector('[data-station-row="s1"] .grow');
    expect(nameCell?.textContent).toBe('(No name)');
    expect(nameCell?.classList.contains('no-name')).toBe(false);
  });

  it('wraps each Lines-column badge code in a .line-badge__code span (inline-bullet sizing)', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [makeStation({ id: 's1', name: 'Hub', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', service: 'A', stations: ['s1'] })],
      }),
    });
    render(<Sidebar />);

    const code = document.querySelector('.line-badges .line-badge .line-badge__code');
    expect(code?.textContent).toBe('A');
  });
});

describe('<Sidebar /> — line list drives Edit Stops (editor lives in the pinned popover)', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [makeStation({ id: 's1', name: 'Hub', stops: [makeStop('L1')] })],
        lines: [
          makeLine({ id: 'L1', service: 'A', stations: ['s1'] }),
          makeLine({ id: 'L2', service: 'B', stations: ['s1'] }),
        ],
      }),
    });
    useSelection.setState({ ...useSelection.getState(), activeTab: 'lines' });
  });

  it('clicking a line row enters Edit Stops for that line', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(document.querySelector('[data-line-row="L1"] .list-row')!);

    const s = useSelection.getState();
    expect(s.uiMode).toEqual({ kind: 'appending-to-line', lineId: 'L1', cursor: null });
    expect(s.selectedLineId).toBe('L1');
  });

  it('hides the whole panel while Edit Stops is active (popover owns the corner), and never hosts an inline editor', () => {
    useSelection.setState({
      ...useSelection.getState(),
      sidebarOpen: true,
      selectedLineId: 'L1',
      uiMode: { kind: 'appending-to-line', lineId: 'L1', cursor: null },
    });
    render(<Sidebar />);
    // Same rule as editing-station-layout: the pinned line popover sits over
    // the sidebar's corner, so the panel cedes it for the duration.
    expect(document.querySelector('.sidebar')).toBeNull();
    expect(document.querySelector('.inline-editor')).toBeNull();
  });

  it('reappears when Edit Stops exits (sidebarOpen untouched)', () => {
    useSelection.setState({
      ...useSelection.getState(),
      sidebarOpen: true,
      selectedLineId: 'L1',
      uiMode: { kind: 'appending-to-line', lineId: 'L1', cursor: null },
    });
    render(<Sidebar />);
    expect(document.querySelector('.sidebar')).toBeNull();

    act(() => useSelection.getState().setAppending(null));

    expect(document.querySelector('.sidebar')).not.toBeNull();
    expect(useSelection.getState().sidebarOpen).toBe(true);
  });
});

describe('<Sidebar /> — deleting a selected station via the row ×', () => {
  // The one delete path that didn't clear the selection first (the popover
  // delete and the Delete key both do). The dangling id had no visible sign —
  // the popover unmounts — but the next shift-click built a selection with a
  // ghost member ("2 items" with one visible).
  it('leaves no dangling selection id behind', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [makeStation({ id: 'alpha', name: 'Alpha' })] }),
    });
    useSelection.getState().selectStation('alpha');
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete station' }));

    expect(useDoc.getState().stations['alpha']).toBeUndefined();
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });
});

// Revealing the selected row must move the sidebar's OWN list and nothing else.
// `scrollIntoView` cannot do that: it walks every scrollable ancestor up to the
// document, and the sidebar sits at the right edge of an app grid floored at the
// toolbar's max-content width — so in a window narrower than that, the row is
// outside the window entirely and the browser satisfies the request by scrolling
// the whole PAGE sideways to it. The map lurches ~490px out from under the click
// that selected the station, and (until useDock stopped measuring on every
// commit) the animated page took the canvas dock down with it.
describe('<Sidebar /> — revealing the selected row scrolls the list, not the page', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [makeStation({ id: 'alpha', name: 'Alpha' })] }),
    });
  });

  // jsdom has no layout: every rect is zeros and nothing scrolls. Stub the one
  // relationship this reads — a row sitting below the bottom of its box.
  function stubBelowTheFold(): () => void {
    const orig = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Element) {
        const box = this.classList.contains('scroll');
        // Box spans y 0..300; the row sits at 400..420, eighty past the bottom.
        return box
          ? { top: 0, bottom: 300, left: 0, right: 320, width: 320, height: 300 }
          : { top: 400, bottom: 420, left: 0, right: 320, width: 320, height: 20 };
      },
    });
    return () => Object.defineProperty(Element.prototype, 'getBoundingClientRect', orig);
  }

  it("scrolls the list box to the row and never calls the page's scrollIntoView", () => {
    const restore = stubBelowTheFold();
    const intoView: string[] = [];
    const origInto = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')!;
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: Element) {
        intoView.push(this.className || this.tagName);
      },
    });
    const scrolled: { top?: number; behavior?: string }[] = [];
    const origTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo');
    Object.defineProperty(Element.prototype, 'scrollTo', {
      configurable: true,
      value(this: Element, opts: { top?: number; behavior?: string }) {
        scrolled.push(opts);
      },
    });
    try {
      render(<Sidebar />);
      // Selected from OUTSIDE the sidebar — the canvas click this exists for.
      act(() => useSelection.getState().selectStation('alpha'));

      // The box scrolled by exactly the overhang: bottom 420 − 300 = 120.
      expect(scrolled).toEqual([{ top: 120, behavior: 'smooth' }]);
      // And the page was never asked to go anywhere.
      expect(intoView).toEqual([]);
    } finally {
      restore();
      Object.defineProperty(Element.prototype, 'scrollIntoView', origInto);
      if (origTo) Object.defineProperty(Element.prototype, 'scrollTo', origTo);
      else delete (Element.prototype as unknown as Record<string, unknown>).scrollTo;
    }
  });
});
