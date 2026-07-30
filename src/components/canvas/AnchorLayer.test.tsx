import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AnchorLayer, ANCHOR_SIZE } from './AnchorLayer';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeStation } from '../../test/fixtures';
import { STOP_SIZE } from '../../geometry/orientation';
import type { Station, TransferAnchor } from '../../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, darkMode: false });
});

const FREE: Record<string, TransferAnchor> = { a1: { id: 'a1', x: 40, y: -10 } };
const HOSTED: Record<string, Station> = {
  s1: makeStation({
    id: 's1',
    x: 100,
    y: 200,
    transferAnchors: [{ id: 'h1', row: 0, col: 1 }],
  }),
};

function renderLayer(props: Partial<Parameters<typeof AnchorLayer>[0]> = {}): SVGSVGElement {
  const { container } = render(
    <svg>
      <AnchorLayer
        transferAnchors={FREE}
        stations={HOSTED}
        lineCircles={{}}
        selectedIds={[]}
        hoveredKey={null}
        onHover={vi.fn()}
        freeLive
        picking
        dimHostedExcept={null}
        onPointerDown={vi.fn()}
        onClick={vi.fn()}
        {...props}
      />
    </svg>,
  );
  return container.querySelector('svg')!;
}

// The disc is the one element per anchor that carries the pointer surface;
// everything else in the group is decoration (note the anchor MARK contains a
// <circle> of its own — its ring — so a bare `circle` selector is ambiguous).
const disc = (svg: SVGSVGElement, id: string) =>
  svg.querySelector(`[data-anchor-id="${id}"] [data-anchor-disc]`);

describe('AnchorLayer', () => {
  it('draws a free anchor at its world point', () => {
    const svg = renderLayer();
    const c = disc(svg, 'a1')!;
    expect(c.getAttribute('cx')).toBe('40');
    expect(c.getAttribute('cy')).toBe('-10');
    expect(Number(c.getAttribute('r'))).toBe(ANCHOR_SIZE / 2);
  });

  it('draws a hosted anchor at its station-grid position, not the station anchor', () => {
    // col 1 on an unrotated station is one lattice cell right of the anchor.
    // Drawing it at the station's own (x, y) would put every hosted anchor on
    // top of its station, which is exactly the bug this pins.
    const svg = renderLayer();
    const circles = [...svg.querySelectorAll('circle')].map((c) => [
      c.getAttribute('cx'),
      c.getAttribute('cy'),
    ]);
    expect(circles).toContainEqual([String(100 + STOP_SIZE), '200']);
  });

  it('gives a hosted anchor a (station, cell) identity, not a selection id', () => {
    // It is not independently SELECTABLE — selection is a free-anchor concept —
    // but it must still be addressable, because it is a transfer endpoint and
    // clicking one is the entire reason anchors exist.
    const svg = renderLayer();
    const hostedDisc = svg.querySelector(`[data-anchor-disc][cx="${100 + STOP_SIZE}"]`)!;
    expect(hostedDisc.closest('[data-anchor-id]')).toBeNull();
    expect(hostedDisc.closest('[data-anchor-station="s1"][data-anchor-cell="h1"]')).not.toBeNull();
  });

  it('makes a hosted anchor clickable when picking transfer ends, and reports its END', () => {
    const onClick = vi.fn();
    const svg = renderLayer({ picking: true, onClick });
    const hostedDisc = svg.querySelector(`[data-anchor-disc][cx="${100 + STOP_SIZE}"]`)!;
    expect(hostedDisc.getAttribute('pointer-events')).toBe('all');
    hostedDisc.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick.mock.calls[0][0]).toEqual({ stationId: 's1', anchorId: 'h1' });
  });

  it('leaves a hosted anchor click-through when NOT picking', () => {
    // The stop-dot rule for the idle case: a click lands on the station
    // beneath rather than being swallowed by a station-internal cell.
    const svg = renderLayer({ picking: false });
    const hostedDisc = svg.querySelector(`[data-anchor-disc][cx="${100 + STOP_SIZE}"]`)!;
    expect(hostedDisc.getAttribute('pointer-events')).toBe('none');
  });

  it('reports a free anchor by its own end shape', () => {
    const onClick = vi.fn();
    const svg = renderLayer({ onClick });
    disc(svg, 'a1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick.mock.calls[0][0]).toEqual({ anchorId: 'a1' });
  });

  it('drops the free anchor pointer surface when the layer is inert', () => {
    // Every non-idle mode that owns the background click needs anchors to stop
    // swallowing it, or the mode loses its exit.
    const svg = renderLayer({ freeLive: false });
    expect(disc(svg, 'a1')!.getAttribute('pointer-events')).toBe('none');
  });

  it('renders a two-tone selection ring only for a selected anchor', () => {
    const bare = renderLayer();
    expect(bare.querySelectorAll('[data-anchor-id="a1"] [data-sel-tone]').length).toBe(0);
    const armed = renderLayer({ selectedIds: ['a1'] });
    const rings = armed.querySelectorAll('[data-anchor-id="a1"] [data-sel-tone]');
    // Two tones: a dark underlay under a light ink core (or the reverse in dark
    // mode), so the ring contrasts whatever it sits on.
    expect(rings.length).toBe(2);
    // The ring must never take pointer events, or it shadows the disc's own
    // entry in the hit stack under the same id.
    expect(rings[0].getAttribute('pointer-events')).toBe('none');
  });

  it('dims hosted anchors to half opacity when a dim regime is active', () => {
    // "View anchors" on, idle canvas: the whole network paints, but a hosted
    // anchor belongs to its station — at rest it sits back at half opacity and
    // only comes forward when its station is hovered/selected, so mouseover
    // still reads as "this mark is part of THAT station".
    const svg = renderLayer({ dimHostedExcept: new Set<string>() });
    const hosted = svg.querySelector('[data-anchor-station="s1"]')!;
    expect(hosted.getAttribute('opacity')).toBe('0.5');
  });

  it('keeps a hosted anchor at full opacity while its station is revealed', () => {
    const svg = renderLayer({ dimHostedExcept: new Set(['s1']) });
    const hosted = svg.querySelector('[data-anchor-station="s1"]')!;
    expect(hosted.getAttribute('opacity')).toBeNull();
  });

  it('never dims free anchors or dims at all outside the regime', () => {
    const dimmed = renderLayer({ dimHostedExcept: new Set<string>() });
    expect(dimmed.querySelector('[data-anchor-id="a1"]')!.getAttribute('opacity')).toBeNull();
    const off = renderLayer({ dimHostedExcept: null });
    expect(off.querySelector('[data-anchor-station="s1"]')!.getAttribute('opacity')).toBeNull();
  });

  it('renders nothing at all when there are no anchors', () => {
    const svg = renderLayer({ transferAnchors: {}, stations: {} });
    expect(svg.querySelector('circle')).toBeNull();
  });
});
