import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { LineCircleView, type LineCirclePart } from './LineCircleView';
import { makeLineCircle } from '../test/fixtures';

/** The ⊕ at a line circle's centre — see the LineCircleView doc comment for
 *  what it is, what it buys over the alt-click deep-pick, and what it doesn't.
 *  Reachability under a real band is pinned in e2e/lineCircleCenter.spec.ts,
 *  since jsdom has no hit-testing. */

const renderCircle = (
  props: Partial<Parameters<typeof LineCircleView>[0]> = {},
): { svg: SVGSVGElement; onPointerDown: ReturnType<typeof vi.fn> } => {
  const onPointerDown = vi.fn();
  const { container } = render(
    <svg>
      <LineCircleView
        circle={makeLineCircle({ id: 'c1', x: 100, y: 50, radius: 60 })}
        zoom={1}
        guideColor="#b5b5b5"
        accentColor="#1a4ea8"
        selected={false}
        interactive
        inHandMode={false}
        showCardinals={false}
        onPointerDown={onPointerDown}
        {...props}
      />
    </svg>,
  );
  return { svg: container.querySelector('svg')!, onPointerDown };
};

const mark = (svg: SVGSVGElement) => svg.querySelector('[data-line-circle-center-mark]');
const hit = (svg: SVGSVGElement) => svg.querySelector('[data-line-circle-center]');

describe('LineCircleView — centre handle', () => {
  it('paints the mark at the circle centre', () => {
    const { svg } = renderCircle();
    const g = mark(svg);
    expect(g).not.toBeNull();
    // The whole glyph is positioned by one translate, so the centre is stated
    // once rather than repeated across each of its strokes.
    expect(g!.getAttribute('transform')).toBe('translate(100 50)');
  });

  it('offers a grab surface at the centre, wired to the circle', () => {
    const { svg, onPointerDown } = renderCircle();
    const h = hit(svg);
    expect(h).not.toBeNull();
    expect(h!.getAttribute('data-line-circle-center')).toBe('c1');
    fireEvent.pointerDown(h!);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    // 'center' rather than 'rim': the drag hook branches on the part, and the
    // two behave the same only by accident today.
    const part: LineCirclePart = onPointerDown.mock.calls[0][2];
    expect(part).toBe('center');
  });

  it('carries the click and right-click contracts the rim has', () => {
    const onClick = vi.fn();
    const onContextMenu = vi.fn();
    const { svg } = renderCircle({ onClick, onContextMenu });
    fireEvent.click(hit(svg)!);
    expect(onClick).toHaveBeenCalledWith('c1', expect.anything());
    fireEvent.contextMenu(hit(svg)!);
    expect(onContextMenu).toHaveBeenCalledWith('c1', expect.anything());
  });

  it('takes the accent while selected, and the guide colour otherwise', () => {
    const plain = renderCircle().svg;
    expect(mark(plain)!.getAttribute('stroke')).toBe('#b5b5b5');
    const chosen = renderCircle({ selected: true }).svg;
    expect(mark(chosen)!.getAttribute('stroke')).toBe('#1a4ea8');
  });

  it('sizes itself in screen px, so it reads the same at every zoom', () => {
    // World-unit sizing would make the handle a dot when zoomed out and a
    // dinner plate when zoomed in — the convention every other affordance here
    // follows (selectionStyle.ts).
    const one = mark(renderCircle({ zoom: 1 }).svg)!.getAttribute('stroke-width');
    const four = mark(renderCircle({ zoom: 4 }).svg)!.getAttribute('stroke-width');
    expect(Number(four)).toBeCloseTo(Number(one) / 4, 9);
  });

  // The three click-through cases, one plain `it` each. Both halves matter every
  // time: the grab must go (a locked circle must not swallow clicks meant for
  // whatever is under it), and the glyph must STAY — it is scaffolding, like the
  // dashed ring, which paints whether or not it can be grabbed.
  it('drops the grab surface when locked and unselected, keeping the mark', () => {
    const { svg } = renderCircle({
      circle: makeLineCircle({ id: 'c1', x: 100, y: 50, radius: 60, locked: true }),
      selected: false,
    });
    expect(hit(svg)).toBeNull();
    expect(mark(svg)).not.toBeNull();
  });

  it('drops the grab surface in hand mode, keeping the mark', () => {
    const { svg } = renderCircle({ inHandMode: true });
    expect(hit(svg)).toBeNull();
    expect(mark(svg)).not.toBeNull();
  });

  it('drops the grab surface while another mode owns the canvas, keeping the mark', () => {
    const { svg } = renderCircle({ interactive: false });
    expect(hit(svg)).toBeNull();
    expect(mark(svg)).not.toBeNull();
  });

  it('keeps the mark clear of pointer events so it cannot shadow its own grab', () => {
    const { svg } = renderCircle();
    expect(mark(svg)!.getAttribute('pointer-events')).toBe('none');
  });
});
