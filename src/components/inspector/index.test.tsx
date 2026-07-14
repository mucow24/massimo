import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useSelection } from '../../state/store';
import type { LineId, StationId } from '../../model/types';

// Stub the heavy child inspectors so this test exercises only Inspector's
// selection-driven branching, not the editors themselves.
vi.mock('./StationInspector', () => ({
  StationInspector: ({ id }: { id: string }) => <div data-testid="station-inspector">{id}</div>,
}));
vi.mock('./LineInspector', () => ({
  LineInspector: ({ id }: { id: string }) => <div data-testid="line-inspector">{id}</div>,
}));

import { Inspector } from './index';

beforeEach(() => {
  useSelection.setState({
    ...useSelection.getState(),
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLineId: null,
  });
});

describe('Inspector', () => {
  it('shows the line inspector (sticky) while appending to a line', () => {
    useSelection.setState({
      ...useSelection.getState(),
      uiMode: { kind: 'appending-to-line', lineId: 'L9' as LineId, cursor: null },
      selectedStationIds: ['S' as StationId],
    });
    render(<Inspector />);
    expect(screen.getByTestId('line-inspector')).toHaveTextContent('L9');
    expect(screen.queryByTestId('station-inspector')).toBeNull();
  });

  it('shows the station inspector for a single station with no bullet selected', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['S' as StationId] });
    render(<Inspector />);
    expect(screen.getByTestId('station-inspector')).toHaveTextContent('S');
  });

  it('hides the station inspector when a route bullet is also selected', () => {
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['S' as StationId],
      selectedRouteBulletIds: ['b1'],
    });
    render(<Inspector />);
    expect(screen.queryByTestId('station-inspector')).toBeNull();
  });

  it('shows the line inspector when a line is selected', () => {
    useSelection.setState({ ...useSelection.getState(), selectedLineId: 'L1' as LineId });
    render(<Inspector />);
    expect(screen.getByTestId('line-inspector')).toHaveTextContent('L1');
  });

  it('renders nothing with an empty selection', () => {
    const { container } = render(<Inspector />);
    expect(container).toBeEmptyDOMElement();
  });
});
