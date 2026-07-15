import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { resizeCursor, SvgImageView } from './SvgImageView';
import { makeSvgImage } from '../test/fixtures';
import { useLiveViewportStore, useViewportStore } from '../state/viewportStore';
import { useDoc } from '../state/store';
import type { SvgImage } from '../model/types';

const noop = () => {};

function renderView(
  image: SvgImage,
  opts: {
    layer?: 'body' | 'overlay' | 'hit';
    selected?: boolean;
    interactive?: boolean;
    onPointerDown?: (id: string) => void;
  } = {},
) {
  return render(
    <svg>
      <SvgImageView
        image={image}
        layer={opts.layer ?? 'body'}
        selected={opts.selected ?? false}
        interactive={opts.interactive ?? true}
        onPointerDown={opts.onPointerDown ?? noop}
        onClick={noop}
        onContextMenu={noop}
        onCornerPointerDown={noop}
        onEdgePointerDown={noop}
        onRotatePointerDown={noop}
      />
    </svg>,
  );
}

describe('<SvgImageView /> body', () => {
  beforeEach(() => {
    useDoc.setState({ darkMode: false });
    useViewportStore.setState({ zoom: 1 });
  });

  it('renders an <image> with the href, size, and a translate+rotate transform', () => {
    const { container } = renderView(
      makeSvgImage({
        id: 'i0',
        x: 100,
        y: 50,
        width: 80,
        height: 40,
        rotation: 30,
        href: 'data:image/svg+xml;base64,AAA',
      }),
    );
    const g = container.querySelector('g[data-svg-image-id="i0"]') as Element;
    expect(g.getAttribute('transform')).toBe('translate(100 50) rotate(30)');
    const img = g.querySelector('image') as Element;
    expect(img.getAttribute('href')).toBe('data:image/svg+xml;base64,AAA');
    expect(img.getAttribute('width')).toBe('80');
    expect(img.getAttribute('height')).toBe('40');
    expect(img.getAttribute('x')).toBe('-40');
    expect(img.getAttribute('y')).toBe('-20');
  });

  it('paints the body image at its opacity, and omits the attribute when unset', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0', opacity: 0.35 }));
    expect(
      container.querySelector('g[data-svg-image-id="i0"] image')?.getAttribute('opacity'),
    ).toBe('0.35');
    // Absent ⇒ fully opaque: no attribute at all, so the export SVG of an
    // untouched image stays byte-identical.
    const plain = renderView(makeSvgImage({ id: 'i1' }));
    expect(
      plain.container.querySelector('g[data-svg-image-id="i1"] image')?.hasAttribute('opacity'),
    ).toBe(false);
  });

  it('disables pointer events on the image when not interactive (placement fall-through)', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0' }), { interactive: false });
    const img = container.querySelector('g[data-svg-image-id="i0"] image') as Element;
    expect(img.getAttribute('pointer-events')).toBe('none');
  });

  it('marks a locked image with data-locked for the marquee gate', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0', locked: true }));
    const img = container.querySelector('g[data-svg-image-id="i0"] image') as Element;
    expect(img.getAttribute('data-locked')).toBe('true');
  });

  it('a locked, unselected image ignores pointer events (clicks land on what is beneath)', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0', locked: true }));
    const img = container.querySelector('g[data-svg-image-id="i0"] image') as Element;
    expect(img.getAttribute('pointer-events')).toBe('none');
  });

  it('a locked image stays clickable while selected (popover unlock stays reachable)', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0', locked: true }), { selected: true });
    const img = container.querySelector('g[data-svg-image-id="i0"] image') as Element;
    expect(img.getAttribute('pointer-events')).toBeNull();
  });

  it('fills the box non-uniformly (preserveAspectRatio="none") so edge resizes stretch the SVG', () => {
    // Without this, an <image> defaults to "xMidYMid meet" and re-fits the SVG
    // with its aspect ratio preserved — so a single-axis edge resize would only
    // shrink the box and letterbox the SVG instead of stretching it.
    const { container } = renderView(makeSvgImage({ id: 'i0' }));
    const img = container.querySelector('g[data-svg-image-id="i0"] image') as Element;
    expect(img.getAttribute('preserveAspectRatio')).toBe('none');
  });
});

// The resize cursors must rotate WITH the image: the handle tables are in the
// image's local frame, so on a quarter-turned image the local top edge sits on
// the screen's left — a hardcoded ns-resize there points 90° wrong. Cursors
// repeat with period 180°, so the octant index shifts by the rotation in
// 45° steps.
describe('resizeCursor', () => {
  it('matches the compass at rotation 0', () => {
    expect(resizeCursor(0, 0)).toBe('ns-resize'); // n edge
    expect(resizeCursor(1, 0)).toBe('nesw-resize'); // ne corner
    expect(resizeCursor(2, 0)).toBe('ew-resize'); // e edge
    expect(resizeCursor(3, 0)).toBe('nwse-resize'); // se / nw corners
  });

  it('shifts by the image rotation: the local top edge of a quarter-turned image resizes horizontally', () => {
    expect(resizeCursor(0, 90)).toBe('ew-resize');
    expect(resizeCursor(2, 90)).toBe('ns-resize');
    expect(resizeCursor(0, -90)).toBe('ew-resize');
    expect(resizeCursor(0, 45)).toBe('nesw-resize');
  });

  it('rounds free-angle rotations to the nearest 45° step', () => {
    expect(resizeCursor(0, 100)).toBe('ew-resize'); // ≈90°
    expect(resizeCursor(0, 350)).toBe('ns-resize'); // ≈360°
  });
});

describe('<SvgImageView /> overlay', () => {
  beforeEach(() => {
    useDoc.setState({ darkMode: false });
    useViewportStore.setState({ zoom: 1 });
  });

  const handles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-svg-image-handle]'));

  // Corners scale proportionally; edges stretch one axis (distorting the
  // artwork). Identical squares gave no hint which was which — edges are
  // circles now so the two behaviors read as different controls.
  it('draws corner handles as squares and edge handles as circles', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0' }), {
      layer: 'overlay',
      selected: true,
    });
    expect(container.querySelector('[data-svg-image-handle="nw"]')!.tagName).toBe('rect');
    expect(container.querySelector('[data-svg-image-handle="n"]')!.tagName).toBe('circle');
  });

  it('rotates the resize cursors with the image and keeps a non-pan cursor on the knob', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0', rotation: 90 }), {
      layer: 'overlay',
      selected: true,
    });
    const top = container.querySelector('[data-svg-image-handle="n"]') as HTMLElement;
    expect(top.style.cursor).toBe('ew-resize');
    const knob = container.querySelector('[data-svg-image-handle="rotate"]') as HTMLElement;
    // 'grab' is the pan-hand cursor — the knob must not advertise panning.
    expect(knob.style.cursor).toBe('crosshair');
  });

  it('renders nothing when not selected', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0' }), {
      layer: 'overlay',
      selected: false,
    });
    expect(container.querySelector('[data-svg-image-overlay]')).toBeNull();
  });

  it('renders the selection box plus 8 resize handles and a rotation knob when selected', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0' }), {
      layer: 'overlay',
      selected: true,
    });
    expect(container.querySelector('g[data-svg-image-overlay="i0"]')).not.toBeNull();
    const names = handles(container).map((h) => h.getAttribute('data-svg-image-handle'));
    expect(names).toHaveLength(9);
    expect(names).toContain('rotate');
    for (const n of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) expect(names).toContain(n);
  });

  // The box is the shared two-tone no-snap ring: a 2px ink core over a 4px
  // underlay, screen-constant via vector-effect (no zoom subscription of its own
  // → no snap on commit), dashed. Flips with the theme (WBW light, BWB dark).
  it('draws the selection box as a two-tone dashed vector-effect ring (black core on light)', () => {
    // beforeEach sets darkMode: false → WBW.
    const { container } = renderView(makeSvgImage({ id: 'i0' }), {
      layer: 'overlay',
      selected: true,
    });
    const boxes = Array.from(container.querySelectorAll('[data-svg-image-box]'));
    expect(boxes).toHaveLength(2);
    const [edge, core] = boxes;
    expect(edge.getAttribute('stroke')).toBe('#ffffff');
    expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
    expect(core.getAttribute('stroke')).toBe('#000000');
    expect(Number(core.getAttribute('stroke-width'))).toBe(2);
    for (const b of boxes) {
      expect(b.getAttribute('fill')).toBe('none');
      expect(b.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(b.getAttribute('stroke-dasharray')).toBe('4 3');
    }
  });

  it('renders the handles GHOSTED (inactive) for a locked image, keeping the box', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0', locked: true }), {
      layer: 'overlay',
      selected: true,
    });
    expect(container.querySelector('[data-svg-image-overlay]')).not.toBeNull();
    // Handles render — a re-selected locked image would otherwise only show a
    // thin dashed box, far too easy to miss — but inert: no pointer events,
    // reduced opacity.
    const wrap = container.querySelector('[data-svg-image-adornments]')!;
    expect(wrap.getAttribute('data-svg-image-adornments')).toBe('inactive');
    expect(wrap.getAttribute('pointer-events')).toBe('none');
    expect(Number(wrap.getAttribute('opacity'))).toBeLessThan(1);
    expect(handles(container)).toHaveLength(9);
  });

  it('renders the handles fully active for an unlocked image (contrast)', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0' }), {
      layer: 'overlay',
      selected: true,
    });
    const wrap = container.querySelector('[data-svg-image-adornments]')!;
    expect(wrap.getAttribute('data-svg-image-adornments')).toBe('active');
    expect(wrap.getAttribute('pointer-events')).toBeNull();
    expect(wrap.getAttribute('opacity')).toBeNull();
  });

  it('keeps handle size constant on screen across zoom (handles scale 1/zoom, box does not)', () => {
    const sizeAt = (zoom: number) => {
      useViewportStore.setState({ zoom });
      const { container } = renderView(makeSvgImage({ id: 'i0', width: 100, height: 60 }), {
        layer: 'overlay',
        selected: true,
      });
      const corner = container.querySelector('[data-svg-image-handle="nw"]') as Element;
      const box = container.querySelector('[data-svg-image-box]') as Element;
      return {
        cornerW: parseFloat(corner.getAttribute('width') ?? '0'),
        boxW: parseFloat(box.getAttribute('width') ?? '0'),
      };
    };
    const z1 = sizeAt(1);
    const z2 = sizeAt(2);
    // Handle is constant on screen: world size halves when zoom doubles.
    expect(z1.cornerW * 1).toBeCloseTo(z2.cornerW * 2, 6);
    // The box tracks the real image size regardless of zoom.
    expect(z1.boxW).toBe(100);
    expect(z2.boxW).toBe(100);
  });

  // An in-flight wheel gesture publishes the live viewport as `pending` without
  // committing zoom. The handles size off that live zoom, so they stay
  // screen-constant through the gesture instead of snapping when it commits.
  it('sizes handles off the pending (live) zoom, not the committed zoom', () => {
    useViewportStore.setState({ zoom: 1 });
    useLiveViewportStore.setState({ pending: { x: 0, y: 0, zoom: 2 } });
    try {
      const { container } = renderView(makeSvgImage({ id: 'i0' }), {
        layer: 'overlay',
        selected: true,
      });
      const corner = container.querySelector('[data-svg-image-handle="nw"]') as Element;
      // HANDLE_HALF=5 → 10px box / live zoom 2 = 5 world units (committed 1 → 10).
      expect(parseFloat(corner.getAttribute('width') ?? '0')).toBeCloseTo(5);
    } finally {
      useLiveViewportStore.setState({ pending: null });
    }
  });
});

describe('<SvgImageView /> hit proxy (selected-on-top drag target)', () => {
  beforeEach(() => {
    useDoc.setState({ darkMode: false });
    useViewportStore.setState({ zoom: 1 });
  });

  const hit = (c: HTMLElement) => c.querySelector('[data-svg-image-hit="i0"]');

  it('a selected, unlocked, interactive image renders a transparent box proxy with the box transform', () => {
    const { container } = renderView(
      makeSvgImage({ id: 'i0', x: 100, y: 50, width: 80, height: 40, rotation: 30 }),
      { layer: 'hit', selected: true },
    );
    const g = hit(container)!;
    expect(g).not.toBeNull();
    // Matches the image box footprint (same translate+rotate as the body).
    expect(g.getAttribute('transform')).toBe('translate(100 50) rotate(30)');
    // Must NOT reuse data-svg-image-id (would break the body's id-keyed locators).
    expect(g.getAttribute('data-svg-image-id')).toBeNull();
    const rect = g.querySelector('rect')!;
    expect(rect.getAttribute('fill')).toBe('transparent');
    expect(rect.getAttribute('pointer-events')).toBe('all');
    expect(rect.getAttribute('width')).toBe('80');
    expect(rect.getAttribute('height')).toBe('40');
  });

  it('routes a pointer-down to the image move handler with the id', () => {
    const onPointerDown = vi.fn();
    const { container } = renderView(makeSvgImage({ id: 'i0' }), {
      layer: 'hit',
      selected: true,
      onPointerDown,
    });
    fireEvent.pointerDown(hit(container)!.querySelector('rect')!);
    expect(onPointerDown).toHaveBeenCalledWith('i0', expect.anything());
  });

  it('renders no proxy when not selected, locked, or non-interactive', () => {
    expect(
      hit(renderView(makeSvgImage({ id: 'i0' }), { layer: 'hit', selected: false }).container),
    ).toBeNull();
    expect(
      hit(
        renderView(makeSvgImage({ id: 'i0', locked: true }), { layer: 'hit', selected: true })
          .container,
      ),
    ).toBeNull();
    expect(
      hit(
        renderView(makeSvgImage({ id: 'i0' }), { layer: 'hit', selected: true, interactive: false })
          .container,
      ),
    ).toBeNull();
  });
});
