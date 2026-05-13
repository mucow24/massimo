import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StopGrid } from './StopGrid';
import type { StopOrientation } from '../../model/types';

// Minimal station shape that StopGrid consumes. The component imports the
// canonical `StopOrientation` type from the model and reads each stop's
// orientation to pick a glyph.
type GridStation = {
  rotation: number;
  stops: { lineId: string; row: number; col: number; orientation: StopOrientation }[];
  label: { row: number; col: number; rotation: number };
};

const baseLines: Record<string, { color: string; service: string }> = {
  L1: { color: '#0039A6', service: 'L1' },
};

const ORIENTATION_GLYPH: Record<StopOrientation, string> = {
  'auto-vertical': '↕',
  'auto-ne-sw': '⤢',
  'auto-horizontal': '↔',
  'auto-nw-se': '⤡',
};

function renderGrid(opts: {
  station: GridStation;
  selectedLineId?: string | null;
  onSelectStop?: (lineId: string | null) => void;
  onRotateStop?: (lineId: string) => void;
}) {
  const onSelectStop = opts.onSelectStop ?? vi.fn();
  const onRotateStop = opts.onRotateStop ?? vi.fn();
  const result = render(
    <StopGrid
      station={opts.station}
      lines={baseLines}
      selectedLineId={opts.selectedLineId ?? null}
      labelSelected={false}
      onSelectStop={onSelectStop}
      onSelectLabel={() => {}}
      onRotateStop={onRotateStop}
      onRotateLabel={() => {}}
      onMoveStop={() => {}}
      onMoveLabel={() => {}}
    />,
  );
  return { ...result, onSelectStop, onRotateStop };
}

describe('<StopGrid /> — orientation glyphs', () => {
  it.each<[StopOrientation, string]>([
    ['auto-vertical', '↕'],
    ['auto-ne-sw', '⤢'],
    ['auto-horizontal', '↔'],
    ['auto-nw-se', '⤡'],
  ])('renders the %s glyph (%s) for the stop cell', (orientation, glyph) => {
    const { container } = renderGrid({
      station: {
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation }],
        label: { row: -1, col: -1, rotation: 0 },
      },
    });
    const cell = container.querySelector(
      '[data-cell-row="0"][data-cell-col="0"][data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement | null;
    expect(cell).not.toBeNull();
    expect(cell?.textContent).toBe(glyph);
  });

  it('cell title reflects the orientation string for accessibility', () => {
    const { container } = renderGrid({
      station: {
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-ne-sw' }],
        label: { row: -1, col: -1, rotation: 0 },
      },
    });
    const cell = container.querySelector(
      '[data-cell-row="0"][data-cell-col="0"][data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement;
    expect(cell.getAttribute('title')).toContain('auto-ne-sw');
  });

  it('covers all four canonical orientations in its glyph map', () => {
    // Defensive: if a new orientation is added to the model, this test
    // forces the StopGrid map to grow alongside it.
    const expectedGlyphs = new Set(Object.values(ORIENTATION_GLYPH));
    const allGlyphs: string[] = [];
    for (const o of Object.keys(ORIENTATION_GLYPH) as StopOrientation[]) {
      const { container, unmount } = renderGrid({
        station: {
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: o }],
          label: { row: -1, col: -1, rotation: 0 },
        },
      });
      const cell = container.querySelector(
        '[data-cell-row="0"][data-cell-col="0"][data-cell-kind="stop"]',
      ) as HTMLElement;
      allGlyphs.push(cell.textContent ?? '');
      unmount();
    }
    expect(new Set(allGlyphs)).toEqual(expectedGlyphs);
  });
});

describe('<StopGrid /> — right-click rotates', () => {
  it("right-click on a stop cell fires onRotateStop with the stop's lineId", () => {
    const { container, onRotateStop, onSelectStop } = renderGrid({
      station: {
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
        label: { row: -1, col: -1, rotation: 0 },
      },
    });
    const cell = container.querySelector(
      '[data-cell-row="0"][data-cell-col="0"][data-cell-kind="stop"]',
    ) as HTMLElement;

    fireEvent.contextMenu(cell);
    expect(onRotateStop).toHaveBeenCalledTimes(1);
    expect(onRotateStop).toHaveBeenCalledWith('L1');
    // Right-click also selects the stop so the inspector tracks the user's intent.
    expect(onSelectStop).toHaveBeenCalledWith('L1');
  });

  it('right-click on an empty cell does NOT fire onRotateStop', () => {
    const { container, onRotateStop } = renderGrid({
      station: {
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
        label: { row: -1, col: -1, rotation: 0 },
      },
    });
    // The 3×3 padded grid includes empty cells; pick one well away from (0,0).
    const empty = container.querySelector('[data-cell-kind="empty"]') as HTMLElement | null;
    expect(empty).not.toBeNull();
    fireEvent.contextMenu(empty!);
    expect(onRotateStop).not.toHaveBeenCalled();
  });
});

describe('<StopGrid /> — selection on click', () => {
  it('clicking an empty cell deselects (onSelectStop(null))', () => {
    const { container, onSelectStop } = renderGrid({
      station: {
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
        label: { row: -1, col: -1, rotation: 0 },
      },
    });
    const empty = container.querySelector('[data-cell-kind="empty"]') as HTMLElement | null;
    expect(empty).not.toBeNull();
    fireEvent.click(empty!);
    expect(onSelectStop).toHaveBeenCalledWith(null);
  });
});
