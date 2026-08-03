import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SwapPreview } from './SwapPreview';
import { LAYOUT_RING_ACTIVE, LAYOUT_RING_PROJECT, RING_SCRIM } from './LayoutNodeHandle';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeLine } from '../../test/fixtures';
import type { Line, Station } from '../../model/types';

// L1 at (0,0) — the dragged stop; L2 one cell right at (0,1) — the swap
// partner. Cell centres are (0,0) and (14,0), so every number below is
// readable by hand.
const hubStation = (): Station => ({
  id: 'a',
  name: 'A',
  x: 100,
  y: 100,
  rotation: 0,
  stops: [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
    { lineId: 'L2', row: 0, col: 1, orientation: 'auto-horizontal' },
  ],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
});

const lines = (): Record<string, Line> => ({
  L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] }),
  L2: makeLine({ id: 'L2', service: '2', name: '2 line', color: '#222222', stations: ['a'] }),
});

const renderSwap = () =>
  render(
    <svg>
      <SwapPreview
        station={hubStation()}
        lines={lines()}
        source={{ kind: 'stop', lineId: 'L1' }}
        target={{ row: 0, col: 1, lineId: 'L2' }}
        circle={null}
      />
    </svg>,
  );

beforeEach(() => {
  useDoc.setState({ ...DEFAULT_DOC });
});

describe('<SwapPreview />', () => {
  it('shows the dragged stop AT the target cell, as the node it will become', () => {
    const { container } = renderSwap();
    const incoming = container.querySelector('[data-swap-role="incoming"]')!;
    const ring = incoming.querySelector('circle')!;
    expect(ring.getAttribute('cx')).toBe('14');
    expect(ring.getAttribute('cy')).toBe('0');
    expect(ring.getAttribute('stroke')).toBe(LAYOUT_RING_ACTIVE);
    expect(ring.getAttribute('fill')).toBe(RING_SCRIM);
    // L1's own axis arrow — this is S1 standing where S2 stands today, not a
    // stand-in circle.
    expect(incoming.querySelector('path[data-arrow-line="L1"]')).not.toBeNull();
  });

  it('shows the swap partner ghosted back at the source cell, blue-ringed', () => {
    const { container } = renderSwap();
    const outgoing = container.querySelector('[data-swap-role="outgoing"]') as SVGGElement;
    const ring = outgoing.querySelector('circle')!;
    expect(ring.getAttribute('cx')).toBe('0');
    expect(ring.getAttribute('cy')).toBe('0');
    expect(ring.getAttribute('stroke')).toBe(LAYOUT_RING_ACTIVE);
    // Ghosted: it isn't there yet.
    expect(Number(outgoing.getAttribute('opacity'))).toBeGreaterThan(0);
    expect(Number(outgoing.getAttribute('opacity'))).toBeLessThan(1);
    // L2's arrow, on L2's axis — the partner keeps its own identity.
    expect(outgoing.querySelector('path[data-arrow-line="L2"]')).not.toBeNull();
  });

  it('draws a pair of arrows, one each way, clear of both rings', () => {
    const { container } = renderSwap();
    const arrows = [...container.querySelectorAll('[data-swap-arrow]')];
    expect(arrows.map((a) => a.getAttribute('data-swap-arrow'))).toEqual(['incoming', 'outgoing']);
    // Both stops are default width (14), so each ring is r=7 and the arrows
    // run parallel to the swap axis, offset to opposite sides beyond it.
    expect(arrows[0].getAttribute('transform')).toBe('translate(0 10.5) rotate(0)');
    expect(arrows[1].getAttribute('transform')).toBe('translate(14 -10.5) rotate(180)');
  });

  it('offsets the arrows past the WIDEST ring, so a fat line can’t swallow them', () => {
    const wide = lines();
    wide.L2 = { ...wide.L2, width: 28 };
    const { container } = render(
      <svg>
        <SwapPreview
          station={hubStation()}
          lines={wide}
          source={{ kind: 'stop', lineId: 'L1' }}
          target={{ row: 0, col: 1, lineId: 'L2' }}
          circle={null}
        />
      </svg>,
    );
    const arrow = container.querySelector('[data-swap-arrow="incoming"]')!;
    // r = 14 for the width-28 stop, so the shaft sits at 14 + the clearance.
    expect(arrow.getAttribute('transform')).toBe('translate(0 17.5) rotate(0)');
  });

  it('paints nothing gold — a swap has no projection anchor to explain', () => {
    const { container } = renderSwap();
    expect(container.innerHTML).not.toContain(LAYOUT_RING_PROJECT);
  });

  it('rides the station’s own frame, so a rotated station swaps along its axes', () => {
    const { container } = render(
      <svg>
        <SwapPreview
          station={{ ...hubStation(), rotation: 2 }}
          lines={lines()}
          source={{ kind: 'stop', lineId: 'L1' }}
          target={{ row: 0, col: 1, lineId: 'L2' }}
          circle={null}
        />
      </svg>,
    );
    const frame = container.querySelector('[data-swap-preview="1"] > g')!;
    expect(frame.getAttribute('transform')).toBe('translate(100 100) rotate(90)');
  });
});
