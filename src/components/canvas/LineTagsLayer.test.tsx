import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { LineTagsLayer, resolveTag } from './LineTagsLayer';
import { cancelOpenHistoryGroup, useDoc, useSelection } from '../../state/store';
import { isHistoryGrouping } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeBandSpec, makeLine, makeStation, makeStop } from '../../test/fixtures';
import { dispatchWindowPointer, fakeSvgRef } from '../../test/interaction';
import type { LineTag } from '../../model/types';
import { capCenterDy } from '../../geometry/textMeasure';

// These specs don't drag, so the cursor→world map is never called; identity
// satisfies the prop.
const identityScreenToWorld = (x: number, y: number) => ({ x, y });

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
// ThemeColors.accent): accent wash at 0.2 and the two-tone no-snap ring (an ink
// core over an underlay, held screen-constant by vector-effect, flipping with
// the theme — WBW on light).
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
    useDoc.setState({ darkMode: false });
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
          screenToWorld={identityScreenToWorld}
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

  it('rings with the two-tone no-snap outline (black ink core over white underlay on light)', () => {
    // beforeEach sets darkMode: false → WBW: white underlay (4px), black core (2px).
    const c = renderAtZoom(1);
    const edge = c.querySelector('rect[stroke="#ffffff"]')!;
    const core = c.querySelector('rect[stroke="#000000"]')!;
    expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
    expect(Number(core.getAttribute('stroke-width'))).toBe(2);
    for (const el of [edge, core]) {
      expect(el.getAttribute('fill')).toBe('none');
      expect(el.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(el.getAttribute('stroke-dasharray')).toBeNull();
    }
  });

  it('is zoom-independent: the ring widths do not change with committed zoom', () => {
    const edge2 = renderAtZoom(2).querySelector('rect[stroke="#ffffff"]')!;
    expect(Number(edge2.getAttribute('stroke-width'))).toBe(4);
  });
});

// While the line editor is open (Edit Stops), clicking a tag exits the editor
// (back to the main view — there is no selected-not-editing state) AND selects
// the tag. Mirrors the label/polygon/transfer cases in
// MapCanvas.itemClick.test.tsx — this one lives here because the guard is
// wired inside LineTagsLayer itself.
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
    useSelection.getState().startAppend('L2');
  });
  afterEach(() => {
    useSelection.getState().setAppending(null);
    useSelection.getState().selectLineTag(null);
  });

  it('exits the editor and selects the tag', () => {
    const { ref } = fakeSvgRef();
    const { container } = render(
      <svg>
        <LineTagsLayer
          bands={[mixedBand()]}
          zoom={1}
          svgRef={ref}
          screenToWorld={identityScreenToWorld}
        />
      </svg>,
    );
    fireEvent.click(container.querySelector('rect[fill="transparent"]')!);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedLineId).toBeNull();
    expect(useSelection.getState().selectedLineTagId).toBe('T');
  });
});

// Every other draggable bails out of its pointerdown in hand/space mode so the
// press bubbles to the svg pan. The tag handler must match: without the guard,
// a pan starting over a tag ALSO armed the tag drag — both gestures ran, the
// pan wrote a doc edit per move (defeating the imperative-viewBox pan), and
// releasing committed a tag nudge the user never made (junk undo entry).
describe('<LineTagsLayer> — hand/space pan does not start a tag drag', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: { L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }) },
      lineOrder: ['L2'],
      lineTags: { T: tagOnL2() },
    });
    useDoc.temporal.getState().clear();
  });
  afterEach(() => {
    // A failed assertion must not strand an open history group across tests.
    cancelOpenHistoryGroup();
    useSelection.setState({ ...useSelection.getState(), toolMode: 'arrow', spaceHeld: false });
  });

  const renderLayer = () => {
    const { ref } = fakeSvgRef();
    return render(
      <svg>
        <LineTagsLayer
          bands={[mixedBand()]}
          zoom={1}
          svgRef={ref}
          screenToWorld={identityScreenToWorld}
        />
      </svg>,
    ).container;
  };

  // `dominantBaseline="central"` centers the font's ascent..descent box, which
  // Chrome sources per-platform (usWin on Windows, hhea on macOS) — the tag
  // rendered ~0.09em lower on a Mac. Centered on the alphabetic baseline instead.
  it('centers the tag glyphs on the alphabetic baseline, not via dominant-baseline', () => {
    const c = renderLayer();
    // Scope to the tag's own <g> — a bare `text` selector picks up the
    // offscreen width measurer, which is unpositioned by design.
    const tagG = c.querySelector('[data-line-tag-id]')!.parentElement!;
    const text = tagG.querySelector('text')!;
    // The tag's <g> carries the translate + rotate, so the text is local-origin.
    const fontSize = Number(text.getAttribute('font-size'));
    expect(Number(text.getAttribute('y'))).toBeCloseTo(capCenterDy(fontSize), 6);
    expect(text.getAttribute('dominant-baseline')).toBeNull();
  });

  it('a left press on a tag in hand mode arms no drag (no history group opens)', () => {
    useSelection.setState({ ...useSelection.getState(), toolMode: 'hand' });
    const c = renderLayer();
    fireEvent.pointerDown(c.querySelector('rect[fill="transparent"]')!, { button: 0 });
    expect(isHistoryGrouping()).toBe(false);
  });

  it('same while Space is held', () => {
    useSelection.setState({ ...useSelection.getState(), spaceHeld: true });
    const c = renderLayer();
    fireEvent.pointerDown(c.querySelector('rect[fill="transparent"]')!, { button: 0 });
    expect(isHistoryGrouping()).toBe(false);
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
        <LineTagsLayer
          bands={[mixedBand()]}
          zoom={1}
          svgRef={ref}
          screenToWorld={identityScreenToWorld}
        />
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
          <LineTagsLayer
            bands={[mixedBand()]}
            zoom={1}
            svgRef={ref}
            screenToWorld={identityScreenToWorld}
          />
        </svg>,
      );
      expect(tagRotation(container)).toBeCloseTo(ORIENTATION_OFFSET_DEG[orientation], 6);
    });
  }

  it('the four expected offsets are themselves distinct', () => {
    // With each orientation pinned to its own offset above, four distinct
    // rendered rotations follow from the table being distinct — so assert that
    // directly instead of paying four more renders to rediscover it.
    expect(new Set(Object.values(ORIENTATION_OFFSET_DEG)).size).toBe(4);
  });
});

// The layer mounts its own SnapGuides for the tag drag's neighbour guide, so
// it needs the label box threaded through it like the canvas-level mount does
// — otherwise a tag-drag distance label rides the whole-span midpoint and goes
// off screen the moment an end is past the edge, which is the bug the box
// exists to fix.
describe('LineTagsLayer — the tag drag readout honours the label box', () => {
  // Two interlined lines over the fixture's s1→s2 corridor, a tag on each.
  // Dragging L1's tag near L2's snaps it across the corridor and draws the
  // labelled guide between the two stripes.
  const corridorTag = {
    fromStationId: 's1',
    toStationId: 's2',
    anchorEnd: 'from' as const,
    orientation: 0 as const,
  };
  const seedInterlined = () => {
    const stops = () => [
      makeStop('L1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
      makeStop('L2', { row: 1, col: 0, orientation: 'auto-horizontal' }),
    ];
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: {
        L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        L2: makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      },
      lineOrder: ['L1', 'L2'],
      stations: {
        s1: makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
        s2: makeStation({ id: 's2', x: 100, y: 0, stops: stops() }),
      },
      lineTags: {
        T: { ...corridorTag, id: 'T', lineId: 'L1', distance: 20 },
        N: { ...corridorTag, id: 'N', lineId: 'L2', distance: 50 },
      },
    });
    useDoc.temporal.getState().clear();
  };

  // Drag T onto N's cross-section, then read back the guide the layer drew:
  // the dashed span's own endpoints plus where the label landed on it. Taking
  // the span from the DOM keeps the expectation calibrated against the real
  // stripe geometry instead of a hard-coded offset.
  const dragAndReadGuide = (labelBox?: { vbX: number; vbY: number; vbW: number; vbH: number }) => {
    seedInterlined();
    const { ref } = fakeSvgRef();
    const { container } = render(
      <svg>
        <LineTagsLayer
          bands={[makeBandSpec(['L1', 'L2'])]}
          zoom={1}
          svgRef={ref}
          screenToWorld={identityScreenToWorld}
          labelBox={labelBox}
        />
      </svg>,
    );
    fireEvent.pointerDown(container.querySelector('rect[data-line-tag-id="T"]')!, {
      button: 0,
      clientX: 20,
      clientY: 0,
    });
    act(() => dispatchWindowPointer('pointermove', { clientX: 50, clientY: 0 }));
    const span = Array.from(container.querySelectorAll('line')).find((l) =>
      l.getAttribute('stroke-dasharray'),
    )!;
    const label = Array.from(container.querySelectorAll('text')).find(
      (t) => t.getAttribute('paint-order') === 'stroke',
    )!;
    const out = {
      y1: Number(span.getAttribute('y1')),
      y2: Number(span.getAttribute('y2')),
      labelY: Number(label.getAttribute('y')) - capCenterDy(14),
    };
    dispatchWindowPointer('pointerup', { clientX: 50, clientY: 0 });
    return out;
  };

  it('rides the whole-span midpoint with no box, and the visible run with one', () => {
    const plain = dragAndReadGuide();
    const mid = (plain.y1 + plain.y2) / 2;
    // The guide crosses the corridor, so it is a real two-ended span.
    expect(plain.y1).not.toBeCloseTo(plain.y2, 3);
    expect(plain.labelY).toBeCloseTo(mid, 3);

    // A box whose top edge cuts the corridor at that midpoint leaves only the
    // lower half of the span on screen; the label has to move to the middle of
    // THAT. (The half-span is far shorter than the inset, so this exercises the
    // bare-box fallback — the point here is that the box arrives at all.)
    const clipped = dragAndReadGuide({ vbX: -1000, vbY: mid, vbW: 2000, vbH: 1000 });
    expect(clipped.labelY).toBeCloseTo((mid + Math.max(clipped.y1, clipped.y2)) / 2, 3);
    expect(clipped.labelY).toBeGreaterThan(mid);
  });
});
