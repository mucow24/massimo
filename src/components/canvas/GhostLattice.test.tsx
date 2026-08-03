import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { GhostLattice } from './GhostLattice';
import { LAYOUT_RING_ACTIVE, RING_SCRIM } from './LayoutNodeHandle';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeLine } from '../../test/fixtures';
import type { Line, Station } from '../../model/types';
import type { LayoutDragSource } from './useStationLayoutDrag';

const station = (): Station => ({
  id: 'a',
  name: 'A',
  x: 100,
  y: 100,
  rotation: 0,
  stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
});

const lines = (): Record<string, Line> => ({
  L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] }),
});

const renderLattice = (
  over: { row: number; col: number } | null = null,
  source: LayoutDragSource = { kind: 'stop', lineId: 'L1' },
) =>
  render(
    <svg>
      <GhostLattice
        ghosts={[
          { row: 1, col: 0 },
          { row: 1, col: 1 },
        ]}
        over={over}
        station={station()}
        lines={lines()}
        source={source}
        circle={null}
        zoom={1}
      />
    </svg>,
  );

beforeEach(() => {
  useDoc.setState({ ...DEFAULT_DOC });
});

describe('<GhostLattice />', () => {
  it('paints candidate slots in white', () => {
    const { container } = renderLattice();
    const dots = [...container.querySelectorAll('circle')];
    expect(dots).toHaveLength(2);
    for (const d of dots) expect(d.getAttribute('fill')).toBe('#fff');
  });

  it('draws the dragged stop on the snapped slot as its own selected handle', () => {
    const { container } = renderLattice({ row: 1, col: 0 });
    const preview = container.querySelector('[data-drop-preview="1"]')!;
    const ring = preview.querySelector('circle')!;
    expect(ring.getAttribute('stroke')).toBe(LAYOUT_RING_ACTIVE);
    expect(ring.getAttribute('fill')).toBe(RING_SCRIM);
    // The stop's own axis arrow, in white — the node exactly as it will land.
    const arrow = preview.querySelector('path[data-arrow-line="L1"]')!;
    expect(arrow.getAttribute('fill')).toBe('#fff');
    // The slot it occupies no longer carries a lattice dot.
    expect(container.querySelectorAll('circle[fill="#fff"]')).toHaveLength(1);
  });

  it('draws the dragged label on the snapped slot as the selected label handle', () => {
    const { container } = renderLattice({ row: 1, col: 0 }, { kind: 'label' });
    const preview = container.querySelector('[data-drop-preview="1"]')!;
    expect(preview.querySelector('text')!.textContent).toBe('L');
    expect(preview.querySelector('path[data-arrow-line]')).toBeNull();
  });
});
