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
        hovered={false}
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
const rim = (svg: SVGSVGElement) => svg.querySelector('[data-line-circle-rim]');
const hoverCopy = (svg: SVGSVGElement) => svg.querySelector('[data-line-circle-hover]');

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

describe('LineCircleView — locked marking', () => {
  // A locked SELECTED ring still paints its grab surfaces (it is the one state
  // where they survive the click-through rule), so a press lands on them and
  // the drag hook correctly bails. Without data-locked the marquee gate doesn't
  // recognise the target as locked either, and the press is simply dead — the
  // recovery path every other lockable kind offers.
  it('marks the group [data-locked] when locked, so a press rubber-bands', () => {
    const { svg } = renderCircle({
      circle: makeLineCircle({ id: 'c1', x: 100, y: 50, radius: 60, locked: true }),
      selected: true,
    });
    expect(rim(svg)!.closest('[data-locked]')).not.toBeNull();
    expect(hit(svg)!.closest('[data-locked]')).not.toBeNull();
  });

  it('omits data-locked when unlocked', () => {
    const { svg } = renderCircle({ selected: true });
    expect(svg.querySelector('[data-locked]')).toBeNull();
  });
});

describe('LineCircleView — mouseover preview', () => {
  it('paints nothing extra when the pointer is elsewhere', () => {
    expect(hoverCopy(renderCircle().svg)).toBeNull();
  });

  it('previews the selection colour at half strength, over the guide-coloured marks', () => {
    const { svg } = renderCircle({ hovered: true, showCardinals: true });
    const copy = hoverCopy(svg);
    expect(copy).not.toBeNull();
    expect(copy!.getAttribute('opacity')).toBe('0.5');
    // The whole guide — ring, cardinal ticks, ⊕ — repeats in the accent, so the
    // mouseover reads as half-way to selected everywhere the selection would
    // recolour. Not a recolour of the marks themselves: the guide-coloured set
    // stays underneath, or hovering would make a ring FAINTER than at rest.
    const ring = copy!.querySelector('circle[stroke-dasharray]');
    expect(ring!.getAttribute('stroke')).toBe('#1a4ea8');
    expect(copy!.querySelectorAll('line')).toHaveLength(8 + 2);
    expect(mark(svg)!.getAttribute('stroke')).toBe('#b5b5b5');
  });

  it('leaves the addressable marks unduplicated — the copy is anonymous', () => {
    const { svg } = renderCircle({ hovered: true, showCardinals: true });
    expect(svg.querySelectorAll('[data-line-circle-center-mark]')).toHaveLength(1);
    expect(svg.querySelectorAll('[data-line-circle-cardinals]')).toHaveLength(1);
  });

  it('keeps the preview clear of pointer events, like every other painted mark', () => {
    const { svg } = renderCircle({ hovered: true });
    expect(hoverCopy(svg)!.getAttribute('pointer-events')).toBe('none');
  });

  it('reports the pointer arriving on either grab surface, and leaving', () => {
    const onHoverEnter = vi.fn();
    const onHoverLeave = vi.fn();
    const { svg } = renderCircle({ onHoverEnter, onHoverLeave });
    fireEvent.pointerOver(rim(svg)!);
    expect(onHoverEnter).toHaveBeenCalledWith('c1');
    fireEvent.pointerOut(rim(svg)!);
    expect(onHoverLeave).toHaveBeenCalledWith('c1');
    onHoverEnter.mockClear();
    fireEvent.pointerOver(hit(svg)!);
    expect(onHoverEnter).toHaveBeenCalledWith('c1');
  });

  it('does not report a leave when the pointer crosses from the rim to the centre', () => {
    // Pins the WIRING — one hover on the wrapper, not one per grab surface —
    // rather than a user-visible difference. The two surfaces only touch at an
    // on-screen radius ≤ 14px (RIM_HIT_PX/2 + CENTER_HIT_PX), and React
    // dispatches the leave and the enter chains in a single batch, so
    // per-surface handlers would settle on the same hover with nothing painted
    // in between. The wrapper is still the one to keep: three wiring points is
    // three chances to miss one.
    const onHoverLeave = vi.fn();
    const { svg } = renderCircle({ onHoverLeave });
    fireEvent.pointerOver(rim(svg)!);
    fireEvent.pointerOut(rim(svg)!, { relatedTarget: hit(svg)! });
    expect(onHoverLeave).not.toHaveBeenCalled();
  });
});
