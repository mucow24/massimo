import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StationShapePicker } from './StationShapePicker';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeStation, makeStop } from '../test/fixtures';

describe('<StationShapePicker />', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState({ selectedStationIds: [] });
  });

  it('trigger has aria-disabled=true with no selection; click does not open the menu', async () => {
    const user = userEvent.setup();
    render(<StationShapePicker />);
    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('trigger becomes enabled once a station is selected', () => {
    useSelection.setState({ selectedStationIds: ['a'] });
    render(<StationShapePicker />);
    expect(screen.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('clicking the enabled trigger opens a menu with 9 menuitems', async () => {
    const user = userEvent.setup();
    useSelection.setState({ selectedStationIds: ['a'] });
    render(<StationShapePicker />);
    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(9);
  });

  it('menu items carry human-readable aria-labels for every shape', async () => {
    const user = userEvent.setup();
    useSelection.setState({ selectedStationIds: ['a'] });
    render(<StationShapePicker />);
    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    expect(screen.getByRole('menuitem', { name: 'Filled black' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open black' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Filled black with white stroke' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filled white' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open white' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Filled white with black stroke' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filled black diamond' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Filled white diamond' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'None' })).toBeInTheDocument();
  });

  it('clicking a menu item writes the new shape to all selected stations and closes the menu', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', stops: [makeStop('L1')] }),
        ],
      }),
    });
    useSelection.setState({ selectedStationIds: ['a', 'b'] });
    render(<StationShapePicker />);

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filled black diamond' }));

    const doc = useDoc.getState();
    expect(doc.stations.a.stops[0].dotShape).toBe('filled-black-diamond');
    expect(doc.stations.b.stops[0].dotShape).toBe('filled-black-diamond');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape closes the menu without mutating state', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      }),
    });
    useSelection.setState({ selectedStationIds: ['a'] });
    render(<StationShapePicker />);

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useDoc.getState().stations.a.stops[0].dotShape).toBeUndefined();
  });

  it('outside click closes the menu without mutating state', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({ stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })] }),
    });
    useSelection.setState({ selectedStationIds: ['a'] });
    render(
      <div>
        <StationShapePicker />
        <button data-testid="outside">outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useDoc.getState().stations.a.stops[0].dotShape).toBeUndefined();
  });
});
