import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StationGraph, type StationGraphProps } from './StationGraph';
import { makeLine, makeStation, makeStop } from '../../test/fixtures';
import type { Station } from '../../model/types';

const stationsFor = (ids: string[]): Record<string, Station> => {
  const m: Record<string, Station> = {};
  ids.forEach((id) => (m[id] = makeStation({ id, name: id, stops: [makeStop('L1')] })));
  return m;
};

const baseProps = (): Omit<StationGraphProps, 'line' | 'stations'> => ({
  color: '#cc0000',
  underlayColor: '#ffffff',
  isAppending: false,
  cursorStationId: null,
  appendDraw: false,
  hovered: null,
  onSelectStation: vi.fn(),
  onRemoveStation: vi.fn(),
  onCycleSegment: vi.fn(),
  onInsertAfter: vi.fn(),
  onBranchFrom: vi.fn(),
  onHoverSegment: vi.fn(),
  onHoverStation: vi.fn(),
});

describe('StationGraph', () => {
  it('renders a row and a dot per stop, and a connector per edge', () => {
    const ids = ['s1', 's2', 'J', 's3', 's4'];
    const line = makeLine({
      id: 'L1',
      stations: ids,
      edges: ['s1|s2', 's2|J', 'J|s3', 'J|s4'],
    });
    const { container } = render(
      <StationGraph {...baseProps()} line={line} stations={stationsFor(ids)} />,
    );
    for (const id of ids) expect(screen.getByText(id)).toBeInTheDocument();
    expect(container.querySelectorAll('circle')).toHaveLength(5); // one dot per stop
    // Each edge has a transparent hit-target connector.
    expect(container.querySelectorAll('path[stroke="transparent"]')).toHaveLength(4);
  });

  it('clicking a connector cycles that segment style', () => {
    const props = baseProps();
    // A loop, so one connector is an off-chain (loop) edge — still clickable.
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      edges: ['s1|s2', 's2|s3', 's1|s3'],
    });
    const { container } = render(
      <StationGraph {...props} line={line} stations={stationsFor(['s1', 's2', 's3'])} />,
    );
    const hits = container.querySelectorAll('path[stroke="transparent"]');
    expect(hits.length).toBe(3);
    fireEvent.click(hits[0]);
    expect(props.onCycleSegment).toHaveBeenCalledTimes(1);
  });

  it('shows remove / insert / branch controls only while editing', () => {
    const ids = ['s1', 's2'];
    const line = makeLine({ id: 'L1', stations: ids });
    const { rerender } = render(
      <StationGraph {...baseProps()} line={line} stations={stationsFor(ids)} />,
    );
    expect(screen.queryByRole('button', { name: /Remove s1/ })).toBeNull();

    rerender(<StationGraph {...baseProps()} isAppending line={line} stations={stationsFor(ids)} />);
    expect(screen.getByRole('button', { name: /Remove s1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Branch from s1/ })).toBeInTheDocument();
  });
});
