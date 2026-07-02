import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { LineTagsLayer, resolveTag } from './LineTagsLayer';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeBandSpec, makeLine } from '../../test/fixtures';
import { fakeSvgRef } from '../../test/interaction';
import type { LineTag } from '../../model/types';

// Mixed-width band over the fixture's default s1|s2 corridor: L1 at 14,
// L2 at 28 → baked offsets ±10.5.
const mixedBand = () => makeBandSpec(['L1', 'L2'], { stripeWidths: [14, 28] });

const tagOnL2 = (over: Partial<LineTag> = {}): LineTag => ({
  id: 'T',
  lineId: 'L2',
  fromStationId: 's1',
  toStationId: 's2',
  anchorEnd: 'from',
  distance: 50,
  orientation: 0,
  ...over,
});

describe('resolveTag — per-stripe geometry', () => {
  it('lands the tag on the stripe’s baked offset and carries the stripe width', () => {
    const lines = { L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }) };
    const r = resolveTag(tagOnL2(), { lines }, [mixedBand()])!;
    expect(r).not.toBeNull();
    // The wide stripe sits at |offset| = 10.5 off the horizontal centerline —
    // the legacy stripeOffset(k, 2) math would put it at ±7.
    expect(Math.abs(r.p.y)).toBeCloseTo(10.5, 6);
    expect(r.stripeWidth).toBe(28);
  });

  it('resolves a tag whose endpoints are stored in non-canonical order', () => {
    const lines = { L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }) };
    // The band's pairKey is canonical (s1|s2). A tag stored from→to as s2→s1
    // must still find its band — resolution keys on the unordered station-pair,
    // not the literal from|to concatenation.
    const reversed = tagOnL2({ fromStationId: 's2', toStationId: 's1' });
    const r = resolveTag(reversed, { lines }, [mixedBand()]);
    expect(r).not.toBeNull();
    expect(Math.abs(r!.p.y)).toBeCloseTo(10.5, 6);
  });
});

// Selection chrome speaks the shared vocabulary (selectionStyle.ts +
// ThemeColors.accent): accent wash at 0.2 and a zoom-compensated ring —
// previously drifted local copies (#f0ff00 at 0.3, 1.5px world-unit stroke).
describe('<LineTagsLayer> — selection chrome', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: { L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }) },
      lineOrder: ['L2'],
      lineTags: { T: tagOnL2({ kind: 'chevron' }) },
    });
    useDoc.temporal.getState().clear();
    useSelection.getState().selectLineTag('T');
  });
  afterEach(() => useSelection.getState().selectLineTag(null));

  const renderAtZoom = (zoom: number) => {
    const { ref } = fakeSvgRef();
    return render(
      <svg>
        <LineTagsLayer
          bands={[makeBandSpec(['L2'], { stripeWidths: [28] })]}
          zoom={zoom}
          svgRef={ref}
        />
      </svg>,
    ).container;
  };

  it('washes the selected tag with the accent at the shared opacity', () => {
    const c = renderAtZoom(1);
    const wash = c.querySelector('rect[fill="#1a4ea8"]')!;
    expect(wash).not.toBeNull();
    expect(Number(wash.getAttribute('fill-opacity'))).toBe(0.2);
  });

  it('rings with the theme selection stroke, zoom-compensated', () => {
    const ring1 = renderAtZoom(1).querySelector('rect[stroke="#000000"]')!;
    expect(Number(ring1.getAttribute('stroke-width'))).toBe(2);
    const ring2 = renderAtZoom(2).querySelector('rect[stroke="#000000"]')!;
    expect(Number(ring2.getAttribute('stroke-width'))).toBe(1);
  });
});

// While the line editor is open (appending-to-line mode), clicking a tag is
// "click off the line to exit": dismiss the editor, don't select the tag.
// Mirrors the label/polygon/transfer cases in MapCanvas.itemClick.test.tsx —
// this one lives here because the guard is wired inside LineTagsLayer itself.
describe('<LineTagsLayer> — clicking a tag while the line editor is open', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: { L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }) },
      lineOrder: ['L2'],
      lineTags: { T: tagOnL2() },
    });
    useDoc.temporal.getState().clear();
    useSelection.getState().setUiMode({
      kind: 'appending-to-line',
      lineId: 'L2',
      insertAfterIndex: null,
    });
  });
  afterEach(() => {
    useSelection.getState().setUiMode({ kind: 'idle' });
    useSelection.getState().selectLineTag(null);
  });

  it('exits append mode without selecting the tag', () => {
    const { ref } = fakeSvgRef();
    const { container } = render(
      <svg>
        <LineTagsLayer bands={[mixedBand()]} zoom={1} svgRef={ref} />
      </svg>,
    );
    fireEvent.click(container.querySelector('rect[fill="transparent"]')!);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedLineTagId).toBeNull();
  });
});

describe('<LineTagsLayer> — chevron scales to its stripe', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: {
        L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }),
      },
      lineOrder: ['L1', 'L2'],
      lineTags: { T: tagOnL2({ kind: 'chevron' }) },
    });
    useDoc.temporal.getState().clear();
  });

  it('sizes the chevron arms AND its hit box to the stripe height', () => {
    const { ref } = fakeSvgRef();
    const { container } = render(
      <svg>
        <LineTagsLayer bands={[mixedBand()]} zoom={1} svgRef={ref} />
      </svg>,
    );
    // Arms reach the wide stripe's edges: half-height = 28/2 (+ the small
    // antialias bleed), not the legacy hardcoded 7.
    const poly = container.querySelector('polygon')!;
    expect(poly).not.toBeNull();
    const ys = poly
      .getAttribute('points')!
      .split(' ')
      .map((p) => Number(p.split(',')[1]));
    expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(14.33, 2);
    // The invisible hit rect must track the scaled arms or clicks on the
    // arm tips miss (its height is the full stripe height).
    const hit = container.querySelector('rect[fill="transparent"]')!;
    expect(hit).not.toBeNull();
    expect(Number(hit.getAttribute('height'))).toBeCloseTo(28, 6);
  });
});

describe('<LineTagsLayer> — orientation rotation (E5a)', () => {
  // TagShape rotates the tag by tangentAngleDeg + ORIENTATION_OFFSET_DEG[o].
  // For the fixture's horizontal s1→s2 corridor the line-forward tangent is
  // +x (angle 0), so the rendered rotate() is exactly the orientation offset:
  // {0: 0, 1: -90, 2: 180, 3: 90}. We read it off the text-tag's transform.
  const ORIENTATION_OFFSET_DEG: Record<0 | 1 | 2 | 3, number> = {
    0: 0,
    1: -90,
    2: 180,
    3: 90,
  };

  const seedTag = (orientation: 0 | 1 | 2 | 3) => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: { L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }) },
      lineOrder: ['L2'],
      lineTags: { T: tagOnL2({ orientation }) },
    });
    useDoc.temporal.getState().clear();
  };

  // The text-tag's outer <g> is the one carrying the move cursor; the hit rect
  // lives inside it. Grab that group's rotate angle.
  const tagRotation = (container: HTMLElement): number => {
    const g = Array.from(container.querySelectorAll('g')).find(
      (el) => (el as SVGGElement).style.cursor === 'move',
    );
    if (!g) throw new Error('expected the tag group');
    const m = /rotate\(([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '');
    if (!m) throw new Error('expected a rotate() in the tag transform');
    return Number(m[1]);
  };

  for (const orientation of [0, 1, 2, 3] as const) {
    it(`rotates the tag by ${ORIENTATION_OFFSET_DEG[orientation]}° at orientation ${orientation}`, () => {
      seedTag(orientation);
      const { ref } = fakeSvgRef();
      const { container } = render(
        <svg>
          <LineTagsLayer bands={[mixedBand()]} zoom={1} svgRef={ref} />
        </svg>,
      );
      expect(tagRotation(container)).toBeCloseTo(ORIENTATION_OFFSET_DEG[orientation], 6);
    });
  }

  it('the four orientations yield four distinct rotations', () => {
    const seen = new Set<number>();
    for (const orientation of [0, 1, 2, 3] as const) {
      seedTag(orientation);
      const { ref } = fakeSvgRef();
      const { container } = render(
        <svg>
          <LineTagsLayer bands={[mixedBand()]} zoom={1} svgRef={ref} />
        </svg>,
      );
      seen.add(tagRotation(container));
    }
    expect(seen.size).toBe(4);
  });
});
