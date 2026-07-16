import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StationPopover } from './StationPopover';
import { useDoc, useSelection } from '../state/store';
import { historyDepth, undo } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeStation, makeStop, makeLine } from '../test/fixtures';

const VIEW = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };

// Live-subscribing host: clicks re-render the popover from the store, like
// MapCanvas does in the app.
function LivePopover({ id = 'a' }: { id?: string }) {
  const station = useDoc((s) => s.stations[id]);
  return station ? (
    <StationPopover
      station={station}
      worldRect={{ x0: 0, y0: 0, x1: 0, y1: 0 }}
      view={VIEW}
      onClose={() => {}}
    />
  ) : null;
}

const seed = (over: Partial<ReturnType<typeof makeStation>> = {}) => {
  useDoc.setState({
    ...DEFAULT_DOC,
    ...makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')], ...over })],
      lines: [makeLine({ id: 'L1', stations: ['a'] })],
    }),
  });
  useSelection.setState({ selectedStationIds: ['a'], mirrorMatching: false });
};

const header = () => document.querySelector('.station-popover .header') as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('<StationPopover /> — titlebar', () => {
  it('shows the station name as the panel title; the body has no Name field', () => {
    seed({ name: 'Central' });
    render(<LivePopover />);
    expect(header().textContent).toContain('Central');
    // The old body Name section is gone: no label, no always-mounted textarea.
    expect(screen.queryByText('Name')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it("falls back to 'Station' when the station has no name", () => {
    seed({ name: '' });
    render(<LivePopover />);
    expect(header().textContent).toContain('Station');
  });

  it('keeps a multi-line name intact in the title', () => {
    seed({ name: 'King’s\nCross' });
    render(<LivePopover />);
    expect(header().textContent).toContain('King’s\nCross');
  });

  it('double-click on the title opens the rename editor; edits write through live', () => {
    seed({ name: 'Old' });
    render(<LivePopover />);
    fireEvent.dblClick(screen.getByText('Old'));
    const ta = screen.getByRole('textbox', { name: 'Station name' });
    fireEvent.change(ta, { target: { value: 'New Name' } });
    expect(useDoc.getState().stations.a.name).toBe('New Name');
  });

  it('opens the editor when the dblclick TARGETS the header band itself', () => {
    // The real-browser case: the header's drag handler pointer-captures on
    // pointerdown, which retargets the synthesized click/dblclick to the
    // header div — a handler on the title span alone never fires outside
    // jsdom. The rename handler must live on the band.
    seed({ name: 'Old' });
    render(<LivePopover />);
    fireEvent.dblClick(header());
    expect(screen.getByRole('textbox', { name: 'Station name' })).toBeInTheDocument();
  });

  it('a double-click on the WP pill does NOT open the rename editor', () => {
    seed({ name: 'Old' });
    render(<LivePopover />);
    fireEvent.dblClick(screen.getByRole('button', { name: 'Waypoint' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Enter commits the whole rename as ONE undo entry and closes the editor', () => {
    seed({ name: 'Old' });
    useDoc.temporal.getState().clear();
    render(<LivePopover />);
    const before = historyDepth();
    fireEvent.dblClick(screen.getByText('Old'));
    const ta = screen.getByRole('textbox', { name: 'Station name' });
    fireEvent.change(ta, { target: { value: 'N' } });
    fireEvent.change(ta, { target: { value: 'New' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(header().textContent).toContain('New');
    expect(historyDepth() - before).toBe(1);
    undo();
    expect(useDoc.getState().stations.a.name).toBe('Old');
  });

  it('Shift+Enter does not commit (newline stays possible)', () => {
    seed({ name: 'Old' });
    render(<LivePopover />);
    fireEvent.dblClick(screen.getByText('Old'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Station name' }), {
      key: 'Enter',
      shiftKey: true,
    });
    expect(screen.getByRole('textbox', { name: 'Station name' })).toBeInTheDocument();
  });

  it('Escape closes the editor', () => {
    seed({ name: 'Old' });
    render(<LivePopover />);
    fireEvent.dblClick(screen.getByText('Old'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Station name' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('a locked station cannot be renamed from the title', () => {
    seed({ name: 'Old', locked: true });
    render(<LivePopover />);
    fireEvent.dblClick(screen.getByText('Old'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('advertises rename on hover (renameable class) unless locked', () => {
    // The class drives the map-name-style hover underline in CSS.
    seed({ name: 'Old' });
    const { unmount } = render(<LivePopover />);
    expect(screen.getByText('Old')).toHaveClass('renameable');
    unmount();
    seed({ name: 'Old', locked: true });
    render(<LivePopover />);
    expect(screen.getByText('Old')).not.toHaveClass('renameable');
  });
});

describe('<StationPopover /> — WP pill in the titlebar', () => {
  it('sits in the titlebar and toggles aria-pressed + isWaypoint', async () => {
    const user = userEvent.setup();
    seed();
    render(<LivePopover />);
    const wpBtn = screen.getByRole('button', { name: 'Waypoint' });
    expect(wpBtn.closest('.header')).not.toBeNull();
    expect(wpBtn).toHaveAttribute('aria-pressed', 'false');
    expect(wpBtn).not.toHaveClass('active');

    await user.click(wpBtn);
    expect(useDoc.getState().stations.a.isWaypoint).toBe(true);
    const wpBtnOn = screen.getByRole('button', { name: 'Waypoint' });
    expect(wpBtnOn).toHaveAttribute('aria-pressed', 'true');
    expect(wpBtnOn).toHaveClass('active');

    await user.click(screen.getByRole('button', { name: 'Waypoint' }));
    expect(useDoc.getState().stations.a.isWaypoint).toBe(false);
  });

  it('starts pressed when the station is already a waypoint', () => {
    seed({ isWaypoint: true });
    render(<LivePopover />);
    const wpBtn = screen.getByRole('button', { name: 'Waypoint' });
    expect(wpBtn).toHaveAttribute('aria-pressed', 'true');
    expect(wpBtn).toHaveClass('active');
  });

  it('does NOT mirror-propagate to matching stations', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', x: 200, stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({ selectedStationIds: ['a'], mirrorMatching: true });

    render(<LivePopover />);
    await user.click(screen.getByRole('button', { name: 'Waypoint' }));

    const doc = useDoc.getState();
    expect(doc.stations.a.isWaypoint).toBe(true);
    expect(doc.stations.b.isWaypoint).toBeFalsy();
  });

  it('is disabled while the station is locked', () => {
    seed({ locked: true });
    render(<LivePopover />);
    expect(screen.getByRole('button', { name: 'Waypoint' })).toBeDisabled();
  });
});
