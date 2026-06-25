import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SvgImageView } from './SvgImageView';
import { makeSvgImage } from '../test/fixtures';
import { useViewportStore } from '../state/viewportStore';
import type { SvgImage } from '../model/types';

const noop = () => {};

function renderView(
  image: SvgImage,
  opts: { layer?: 'body' | 'overlay'; selected?: boolean; interactive?: boolean } = {},
) {
  return render(
    <svg>
      <SvgImageView
        image={image}
        layer={opts.layer ?? 'body'}
        selected={opts.selected ?? false}
        interactive={opts.interactive ?? true}
        onPointerDown={noop}
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
  beforeEach(() => useViewportStore.setState({ darkMode: false, zoom: 1 }));

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

  it('fills the box non-uniformly (preserveAspectRatio="none") so edge resizes stretch the SVG', () => {
    // Without this, an <image> defaults to "xMidYMid meet" and re-fits the SVG
    // with its aspect ratio preserved — so a single-axis edge resize would only
    // shrink the box and letterbox the SVG instead of stretching it.
    const { container } = renderView(makeSvgImage({ id: 'i0' }));
    const img = container.querySelector('g[data-svg-image-id="i0"] image') as Element;
    expect(img.getAttribute('preserveAspectRatio')).toBe('none');
  });
});

describe('<SvgImageView /> overlay', () => {
  beforeEach(() => useViewportStore.setState({ darkMode: false, zoom: 1 }));

  const handles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-svg-image-handle]'));

  it('renders nothing when not selected', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0' }), {
      layer: 'overlay',
      selected: false,
    });
    expect(container.querySelector('[data-svg-image-overlay]')).toBeNull();
  });

  it('renders a dashed box plus 8 resize handles and a rotation knob when selected', () => {
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

  it('hides handles but keeps the box for a locked image', () => {
    const { container } = renderView(makeSvgImage({ id: 'i0', locked: true }), {
      layer: 'overlay',
      selected: true,
    });
    expect(container.querySelector('[data-svg-image-overlay]')).not.toBeNull();
    expect(handles(container)).toHaveLength(0);
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
});
