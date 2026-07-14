import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StationGraph, laneCenterX, type StationGraphProps } from './StationGraph';
import { lineGraphLayout } from './lineGraphLayout';
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
  onRemoveSegment: vi.fn(),
  onSetDotStyle: vi.fn(),
  onInsertAfter: vi.fn(),
  onBranchFrom: vi.fn(),
  onHoverSegment: vi.fn(),
  onHoverStation: vi.fn(),
});

describe('StationGraph', () => {
  it('renders the reported lasso (tail + loop) without crashing', () => {
    // Tail A6–A5–A4–A3 + 5-cycle A3–A2–A1–B2–B1(–A3): 8 stops, 8 edges (7 tree +
    // 1 loop back-edge). Guards against a render crash on a real branch+loop line.
    const ids = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2'];
    const line = makeLine({
      id: 'L1',
      stations: ids,
      edges: ['A1|A2', 'A2|A3', 'A3|A4', 'A4|A5', 'A5|A6', 'A3|B1', 'B1|B2', 'B2|A1'],
    });
    const { container } = render(
      <StationGraph {...baseProps()} line={line} stations={stationsFor(ids)} />,
    );
    for (const id of ids) expect(screen.getByText(id)).toBeInTheDocument();
    expect(container.querySelectorAll('circle')).toHaveLength(8); // one dot per stop
    expect(container.querySelectorAll('path[stroke="transparent"]')).toHaveLength(8); // one per edge
  });

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

  it('right-clicking a connector removes that segment (how a loop/branch edge is deleted)', () => {
    const props = baseProps();
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      edges: ['s1|s2', 's2|s3', 's1|s3'], // loop
    });
    const { container } = render(
      <StationGraph {...props} line={line} stations={stationsFor(['s1', 's2', 's3'])} />,
    );
    const hits = container.querySelectorAll('path[stroke="transparent"]');
    fireEvent.contextMenu(hits[0]);
    expect(props.onRemoveSegment).toHaveBeenCalledTimes(1);
    expect(props.onCycleSegment).not.toHaveBeenCalled();
  });

  it('editor: clicking a dot opens the shape picker; picking sets that stop dot style', () => {
    const props = baseProps();
    const ids = ['s1', 's2'];
    const line = makeLine({ id: 'L1', stations: ids });
    const { container } = render(
      <StationGraph {...props} isAppending line={line} stations={stationsFor(ids)} />,
    );
    // The clickable dot hit-targets are the transparent circles (editor only).
    const hit = Array.from(container.querySelectorAll('circle')).find(
      (c) => c.getAttribute('fill') === 'transparent',
    );
    expect(hit).toBeTruthy();
    fireEvent.click(hit!);
    // The shape picker opens; pick the first shape.
    fireEvent.click(screen.getAllByRole('menuitem')[0]);
    expect(props.onSetDotStyle).toHaveBeenCalledWith('s1', expect.anything()); // dot of stop s1
  });

  it('draws a merge connector jogging in the blank row ABOVE its target', () => {
    // End-of-line bypass t–J–P with E between J and P: the layout emits a
    // 'merge' edge E→P whose jog must sit in the blank row above P (jogRow),
    // NOT at E's own row (the tree-edge fallback, which would draw the
    // horizontal through E's dot row).
    const ids = ['t', 'J', 'P', 'E'];
    const line = makeLine({
      id: 'L1',
      stations: ids,
      edges: ['J|t', 'J|P', 'E|J', 'E|P'],
    });
    const layout = lineGraphLayout(line);
    const merge = layout.edges.find((e) => e.kind === 'merge')!;
    expect(merge.pairKey).toBe('E|P');
    const rowY = (row: number) => row * 26 + 13; // ROW_H grid, matching StationGraph
    const { container } = render(
      <StationGraph {...baseProps()} line={line} stations={stationsFor(ids)} />,
    );
    const hit = Array.from(container.querySelectorAll('path[stroke="transparent"]')).find((p) =>
      p.querySelector('title')?.textContent?.startsWith('Segment E → P'),
    )!;
    expect(hit).toBeTruthy();
    const d = hit.getAttribute('d')!;
    expect(d).toContain(` ${rowY(merge.jogRow!)}`); // jog in the blank above P
    expect(d).not.toContain(` ${rowY(merge.fromRow)} L`); // no horizontal at E's row
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
    expect(screen.getByRole('button', { name: /Insert after s1/ })).toBeInTheDocument();
  });

  it('offers Branch everywhere except the tail end (where it is identical to Insert after)', () => {
    // Linear s1-s2-s3-s4. Branch is distinct from "Insert after" wherever the
    // line continues below the stop (Insert splices in-line, Branch forks/extends
    // out). They only coincide at the TAIL (s4) — nothing below it, both just
    // extend. So Branch shows on s1 (head), s2, s3 but not s4. Degree is NOT the
    // test: s1 is a degree-1 endpoint yet still branchable, because it's the head
    // (s2 renders below it — Insert splices inward while Branch extends outward).
    const ids = ['s1', 's2', 's3', 's4'];
    const line = makeLine({ id: 'L1', stations: ids }); // linear edges backfilled
    render(<StationGraph {...baseProps()} isAppending line={line} stations={stationsFor(ids)} />);
    expect(screen.getByRole('button', { name: /Branch from s1/ })).toBeInTheDocument(); // head
    expect(screen.getByRole('button', { name: /Branch from s2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Branch from s3/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Branch from s4/ })).toBeNull(); // tail
    // Insert-after stays available everywhere, the tail included.
    expect(screen.getByRole('button', { name: /Insert after s4/ })).toBeInTheDocument();
  });
});

describe('StationGraph lane mapping (stops hug the name column)', () => {
  it('renders the trunk closest to the names, branches bowing away', () => {
    // Trunk s1-s2-J-s3 in lane 0 with a branch J-s4 in lane 1. The name column
    // sits to the RIGHT of the gutter, so the trunk (lane 0) must render at a
    // LARGER x than the branch (lane 1): stops sit next to their names and the
    // branch line is no longer stranded between the trunk dots and the text.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['s1', 's2', 'J', 's3', 's4'],
        edges: ['s1|s2', 's2|J', 'J|s3', 'J|s4'],
      }),
    );
    const lane = Object.fromEntries(layout.nodes.map((n) => [n.stationId, n.lane]));
    expect(lane.s3).toBe(0); // trunk
    expect(lane.s4).toBe(1); // branch
    expect(laneCenterX(lane.s3, layout.laneCount)).toBeGreaterThan(
      laneCenterX(lane.s4, layout.laneCount),
    );
  });

  it('mirrors the axis so each further lane steps away from the text', () => {
    // Lane 0 (trunk, nearest the names) is rightmost; every further lane steps left.
    expect(laneCenterX(0, 3)).toBeGreaterThan(laneCenterX(1, 3));
    expect(laneCenterX(1, 3)).toBeGreaterThan(laneCenterX(2, 3));
  });
});
