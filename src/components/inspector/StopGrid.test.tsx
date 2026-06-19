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
    );
    expect(cell).not.toBeNull();
    // Glyph lives in a <text> child; the <g> also contains a <title> sibling
    // so the group's full textContent is the concatenation of both.
    expect(cell?.querySelector('text')?.textContent).toBe(glyph);
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
    );
    expect(cell?.querySelector('title')?.textContent).toContain('auto-ne-sw');
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
      );
      allGlyphs.push(cell?.querySelector('text')?.textContent ?? '');
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
    ) as Element;

    fireEvent.contextMenu(cell);
    expect(onRotateStop).toHaveBeenCalledTimes(1);
    expect(onRotateStop).toHaveBeenCalledWith('L1');
    // Right-click also selects the stop so the inspector tracks the user's intent.
    expect(onSelectStop).toHaveBeenCalledWith('L1');
  });

  it('right-click on the background does NOT fire onRotateStop', () => {
    // Ghost slots only render during a drag now, so the idle background is
    // the only "non-node" area to right-click. It must not rotate anything.
    const { container, onRotateStop } = renderGrid({
      station: {
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
        label: { row: -1, col: -1, rotation: 0 },
      },
    });
    const bg = container.querySelector('svg > rect');
    expect(bg).not.toBeNull();
    fireEvent.contextMenu(bg!);
    expect(onRotateStop).not.toHaveBeenCalled();
  });
});

describe('<StopGrid /> — per-line widths', () => {
  const PITCH = 22;
  const RADIUS = PITCH / 2;

  // jsdom implements neither SVG geometry nor pointer capture; patch the
  // prototypes with an identity screen↔svg mapping so drags can run (mirrors
  // test/interaction.ts's fakeSvg, but StopGrid owns its ref internally).
  const patchSvgGeometry = () => {
    const proto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
    const elProto = Element.prototype as unknown as Record<string, unknown>;
    const restore: Array<() => void> = [];
    const put = (target: Record<string, unknown>, key: string, value: unknown) => {
      const prev = target[key];
      target[key] = value;
      restore.push(() => {
        target[key] = prev;
      });
    };
    put(proto, 'getScreenCTM', () => ({ inverse: () => ({}) }));
    put(proto, 'createSVGPoint', () => {
      const p = { x: 0, y: 0, matrixTransform: () => ({ x: p.x, y: p.y }) };
      return p;
    });
    if (!('setPointerCapture' in elProto)) put(elProto, 'setPointerCapture', () => {});
    return () => restore.forEach((f) => f());
  };

  const mixedLines: Record<string, { color: string; service: string; width?: number }> = {
    L1: { color: '#0039A6', service: 'L1' },
    L2: { color: '#EE352E', service: 'L2', width: 28 },
  };

  const mixedStation: GridStation = {
    rotation: 0,
    stops: [
      { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
      { lineId: 'L2', row: 2, col: 0, orientation: 'auto-horizontal' },
    ],
    label: { row: -3, col: -3, rotation: 0 },
  };

  const stopCircle = (container: HTMLElement, lineId: string) =>
    container.querySelector(`[data-cell-kind="stop"][data-line-id="${lineId}"] circle`)!;

  it('scales each stop node to its line width (label node stays unit-sized)', () => {
    const { container } = render(
      <StopGrid
        station={mixedStation}
        lines={mixedLines}
        selectedLineId={null}
        labelSelected={false}
        onSelectStop={() => {}}
        onSelectLabel={() => {}}
        onRotateStop={() => {}}
        onRotateLabel={() => {}}
        onMoveStop={() => {}}
        onMoveLabel={() => {}}
      />,
    );
    expect(Number(stopCircle(container, 'L1').getAttribute('r'))).toBeCloseTo(RADIUS, 5);
    expect(Number(stopCircle(container, 'L2').getAttribute('r'))).toBeCloseTo(
      (28 / 14) * RADIUS,
      5,
    );
    const labelCircle = container.querySelector('[data-cell-kind="label"] circle')!;
    expect(Number(labelCircle.getAttribute('r'))).toBeCloseTo(RADIUS, 5);
  });

  it('scales the ghost lattice to the drag-pair tangency', () => {
    const restoreSvg = patchSvgGeometry();
    try {
      const { container } = render(
        <StopGrid
          station={mixedStation}
          lines={mixedLines}
          selectedLineId={null}
          labelSelected={false}
          onSelectStop={() => {}}
          onSelectLabel={() => {}}
          onRotateStop={() => {}}
          onRotateLabel={() => {}}
          onMoveStop={() => {}}
          onMoveLabel={() => {}}
        />,
      );
      // Drag the wide L2 stop (row 2) toward L1 at the origin. With the
      // identity CTM, cursor (clientX, clientY) = (col·PITCH, row·PITCH).
      const cell = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]') as Element;
      fireEvent.pointerDown(cell, { button: 0, clientX: 0, clientY: 2 * PITCH });
      const svg = container.querySelector('svg')!;
      fireEvent.pointerMove(svg, { clientX: 0, clientY: 1.2 * PITCH });

      // Anchor = L1 at the origin; tangency factor t = (28+14)/(2·14) = 1.5,
      // so the ring-1 ghost below the anchor sits at row 1.5 — NOT the unit
      // row 1 of the legacy lattice.
      const ghostYs = Array.from(container.querySelectorAll('circle'))
        .filter((c) => Number(c.getAttribute('cx')) === 0)
        .map((c) => Number(c.getAttribute('cy')));
      expect(ghostYs.some((y) => Math.abs(y - 1.5 * PITCH) < 1e-6)).toBe(true);
      expect(ghostYs.some((y) => Math.abs(y - 1 * PITCH) < 1e-6)).toBe(false);
    } finally {
      restoreSvg();
    }
  });
});

describe('<StopGrid /> — drag-move commits the cell delta', () => {
  const PITCH = 22;

  // Copied from the per-line-widths suite: jsdom implements neither SVG
  // geometry nor pointer capture, so patch the prototypes with an identity
  // screen↔svg mapping (cursor (clientX, clientY) → svg (row=clientY/PITCH,
  // col=clientX/PITCH)).
  const patchSvgGeometry = () => {
    const proto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
    const elProto = Element.prototype as unknown as Record<string, unknown>;
    const restore: Array<() => void> = [];
    const put = (target: Record<string, unknown>, key: string, value: unknown) => {
      const prev = target[key];
      target[key] = value;
      restore.push(() => {
        target[key] = prev;
      });
    };
    put(proto, 'getScreenCTM', () => ({ inverse: () => ({}) }));
    put(proto, 'createSVGPoint', () => {
      const p = { x: 0, y: 0, matrixTransform: () => ({ x: p.x, y: p.y }) };
      return p;
    });
    if (!('setPointerCapture' in elProto)) put(elProto, 'setPointerCapture', () => {});
    return () => restore.forEach((f) => f());
  };

  it('pointerUp on a ghost fires onMoveStop with the (over - source) row/col delta', () => {
    const restoreSvg = patchSvgGeometry();
    const onMoveStop = vi.fn();
    try {
      // Two default-width stops; drag L2 (row 5) toward L1 (the origin anchor).
      // The default-default tangency factor is 1, so the ring-1 ghost directly
      // below the anchor sits at (row 1, col 0).
      const station: GridStation = {
        rotation: 0,
        stops: [
          { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
          { lineId: 'L2', row: 5, col: 0, orientation: 'auto-horizontal' },
        ],
        label: { row: -3, col: -3, rotation: 0 },
      };
      const { container } = render(
        <StopGrid
          station={station}
          lines={{ L1: { color: '#0039A6', service: 'L1' }, L2: { color: '#EE352E', service: 'L2' } }}
          selectedLineId={null}
          labelSelected={false}
          onSelectStop={() => {}}
          onSelectLabel={() => {}}
          onRotateStop={() => {}}
          onRotateLabel={() => {}}
          onMoveStop={onMoveStop}
          onMoveLabel={() => {}}
        />,
      );

      const cell = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]') as Element;
      const svg = container.querySelector('svg')!;
      // Press on L2 (row 5), move past the threshold to (row 1.2, col 0) which
      // snaps to the ghost at (row 1, col 0), then release.
      fireEvent.pointerDown(cell, { button: 0, clientX: 0, clientY: 5 * PITCH });
      fireEvent.pointerMove(svg, { clientX: 0, clientY: 1.2 * PITCH });
      fireEvent.pointerUp(svg);

      // dRow = over.row(1) - source.row(5) = -4; dCol = 0 - 0 = 0.
      expect(onMoveStop).toHaveBeenCalledTimes(1);
      expect(onMoveStop).toHaveBeenCalledWith('L2', -4, 0);
    } finally {
      restoreSvg();
    }
  });
});

describe('<StopGrid /> — selection on click', () => {
  it('clicking the background deselects (onSelectStop(null))', () => {
    const { container, onSelectStop } = renderGrid({
      station: {
        rotation: 0,
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
        label: { row: -1, col: -1, rotation: 0 },
      },
    });
    // The first <rect> in the SVG is the transparent background that captures
    // clicks on empty area and dispatches a deselect.
    const bg = container.querySelector('svg > rect');
    expect(bg).not.toBeNull();
    fireEvent.click(bg!);
    expect(onSelectStop).toHaveBeenCalledWith(null);
  });
});
