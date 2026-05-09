import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LineInspector } from './LineInspector';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../../test/fixtures';

const SELECTION_BLANK = {
  selectedStationIds: [] as string[],
  selectedRouteBulletIds: [] as string[],
  selectedLineId: null,
  appendingToLineId: null,
  insertAfterIndex: null,
  placingStation: false,
  selectedLineTagId: null,
  selectedTransferId: null,
  creatingLineTag: false,
  creatingRouteBullet: false,
  creatingTransfer: false,
  transferAnchor: null,
  mirrorMatching: false,
  selectedStopLineId: null,
  labelSelected: false,
  editingStationId: null,
};

describe('<LineInspector /> — segment style dividers', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  const seedThreeStationLine = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
          makeStation({ id: 's3', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
      }),
    });
  };

  it('renders one divider per adjacent station-pair (N-1 for N stations)', () => {
    seedThreeStationLine();
    const { container } = render(<LineInspector id="L1" />);
    const dividers = container.querySelectorAll('[data-segment-style-divider]');
    expect(dividers.length).toBe(2);
  });

  it('reflects the current style of each segment via data-style', () => {
    seedThreeStationLine();
    useDoc.getState().setLineSegmentStyle('L1', 's2', 's3', 'hatched');
    const { container } = render(<LineInspector id="L1" />);
    const dividers = container.querySelectorAll('[data-segment-style-divider]');
    expect(dividers[0].getAttribute('data-style')).toBe('solid');
    expect(dividers[1].getAttribute('data-style')).toBe('hatched');
  });

  it('clicking a divider cycles solid → dashed → hatched → solid', async () => {
    seedThreeStationLine();
    const user = userEvent.setup();
    render(<LineInspector id="L1" />);

    const divider = screen.getAllByRole('button', { name: /segment style/i })[0];

    await user.click(divider);
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({ 's1|s2': 'dashed' });

    await user.click(divider);
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({ 's1|s2': 'hatched' });

    await user.click(divider);
    // Back to solid -> entry deleted entirely.
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({});
  });

  it('renders no dividers for a line with fewer than two stations', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 's1', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['s1'] })],
      }),
    });
    const { container } = render(<LineInspector id="L1" />);
    expect(container.querySelectorAll('[data-segment-style-divider]').length).toBe(0);
  });
});
