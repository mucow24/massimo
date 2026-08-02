import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { StationLayoutEditor } from './StationLayoutEditor';
import { StationOrientationArrows, orientationArrowPath } from '../StationOrientationArrows';
import { useDoc, useSelection, dragState } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import type { Station } from '../../model/types';
import { makeLine } from '../../test/fixtures';
import { STOP_SIZE } from '../../geometry/orientation';
import { capCenterDy } from '../../geometry/textMeasure';

const hubStation = (): Station => ({
  id: 'a',
  name: 'A',
  x: 100,
  y: 100,
  rotation: 0,
  stops: [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
    { lineId: 'L2', row: 0, col: 1, orientation: 'auto-vertical' },
  ],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
});

const seed = () => {
  useDoc.setState({
    ...DEFAULT_DOC,
    stations: { a: hubStation() },
    lines: {
      L1: makeLine({ id: 'L1', service: '1', name: '1 line', color: '#111111', stations: ['a'] }),
      L2: makeLine({ id: 'L2', service: '2', name: '2 line', color: '#222222', stations: ['a'] }),
    },
    lineOrder: ['L1', 'L2'],
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: ['a'],
    uiMode: { kind: 'editing-station-layout', stationId: 'a' },
    selectedStopLineId: null,
    labelSelected: false,
    mirrorMatching: false,
    toolMode: 'arrow',
    spaceHeld: false,
  });
};

const renderEditor = (extra: Partial<Parameters<typeof StationLayoutEditor>[0]> = {}) => {
  const onStartNodeDrag = vi.fn();
  const station = useDoc.getState().stations.a;
  const lines = useDoc.getState().lines;
  const { container } = render(
    <svg>
      <StationLayoutEditor
        station={station}
        lines={lines}
        onStartNodeDrag={onStartNodeDrag}
        swapTarget={null}
        {...extra}
      />
    </svg>,
  );
  return { container, onStartNodeDrag };
};

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  dragState.suppressClick = false;
});

describe('<StationLayoutEditor />', () => {
  it('renders a grab handle per stop and one for the label, with cell metadata', () => {
    seed();
    const { container } = renderEditor();
    const stops = container.querySelectorAll('[data-cell-kind="stop"]');
    expect(stops).toHaveLength(2);
    expect(container.querySelectorAll('[data-cell-kind="label"]')).toHaveLength(1);
    const l2 = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]');
    expect(l2?.getAttribute('data-cell-col')).toBe('1');
  });

  it('gives each stop handle a tooltip naming its line', () => {
    seed();
    const { container } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]');
    const l2 = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]');
    expect(l1?.querySelector('title')?.textContent).toBe('1 line');
    expect(l2?.querySelector('title')?.textContent).toBe('2 line');
  });

  it('pointerdown on a stop handle starts a node drag with that source', () => {
    seed();
    const { container, onStartNodeDrag } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]') as Element;
    fireEvent.pointerDown(l1, { button: 0 });
    expect(onStartNodeDrag).toHaveBeenCalledTimes(1);
    expect(onStartNodeDrag.mock.calls[0][0]).toBe('a');
    expect(onStartNodeDrag.mock.calls[0][1]).toEqual({ kind: 'stop', lineId: 'L1' });
  });

  it('right-click on a stop handle selects it and cycles its orientation — not the station', () => {
    seed();
    const { container } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]') as Element;
    fireEvent.contextMenu(l1);
    const st = useDoc.getState().stations.a;
    expect(st.stops.find((s) => s.lineId === 'L1')!.orientation).toBe('auto-ne-sw');
    expect(st.rotation).toBe(0);
    expect(useSelection.getState().selectedStopLineId).toBe('L1');
  });

  it('right-click on the label handle rotates the label', () => {
    seed();
    const { container } = renderEditor();
    const label = container.querySelector('[data-cell-kind="label"]') as Element;
    fireEvent.contextMenu(label);
    expect(useDoc.getState().stations.a.label.rotation).toBe(1);
  });

  it('the shield swallows clicks (clears the sub-selection, never rotates the station)', () => {
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L1' });
    const { container } = renderEditor();
    const shield = container.querySelector('[data-layout-shield="1"]') as Element;
    expect(shield).not.toBeNull();
    fireEvent.contextMenu(shield);
    expect(useDoc.getState().stations.a.rotation).toBe(0);
    fireEvent.click(shield);
    expect(useSelection.getState().selectedStopLineId).toBeNull();
    // A near-miss click inside the painted border stays in the mode.
    expect(useSelection.getState().uiMode.kind).toBe('editing-station-layout');
  });

  it('a plain click on the halo (outside the painted border) exits the mode, keeping the selection', () => {
    seed();
    const { container } = renderEditor();
    const halo = container.querySelector('[data-layout-shield="halo"]') as Element;
    expect(halo).not.toBeNull();
    fireEvent.click(halo);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedStationIds).toEqual(['a']);
  });

  it('right-click on the halo stays swallowed (no whole-station rotate, no exit)', () => {
    seed();
    const { container } = renderEditor();
    const halo = container.querySelector('[data-layout-shield="halo"]') as Element;
    fireEvent.contextMenu(halo);
    expect(useDoc.getState().stations.a.rotation).toBe(0);
    expect(useSelection.getState().uiMode.kind).toBe('editing-station-layout');
  });

  it('the halo renders beneath the inner shield and reaches past it', () => {
    // Document order IS hit-test priority: the inner shield must come after
    // the halo so near-miss clicks inside the border keep hitting the inner
    // (stay-in-mode) rect where the two overlap.
    seed();
    const { container } = renderEditor();
    const shields = Array.from(container.querySelectorAll('[data-layout-shield]'));
    expect(shields.map((s) => s.getAttribute('data-layout-shield'))).toEqual(['halo', '1', '1']);
    const [halo, cells] = shields;
    expect(Number(halo.getAttribute('x'))).toBeLessThan(Number(cells.getAttribute('x')));
    expect(Number(halo.getAttribute('width'))).toBeGreaterThan(Number(cells.getAttribute('width')));
  });

  it('the halo covers an anchor parked outside the cells box', () => {
    // Label pushed out to col −3 makes the cells box lopsided: x ∈ [−51, 23].
    // The anchor at col 3 sits 19 past its RIGHT edge but only 5 past its
    // half-extent, so a half-extent pad leaves the anchor exposed — and a
    // near-miss right-click there rotates the whole station beneath.
    seed();
    useDoc.setState((s) => ({
      stations: {
        ...s.stations,
        a: {
          ...s.stations.a,
          label: { ...s.stations.a.label, col: -3 },
          transferAnchors: [{ id: 'an0', row: 0, col: 3 }],
        },
      },
    }));
    const { container } = renderEditor();
    const halo = container.querySelector('[data-layout-shield="halo"]') as Element;
    const right = Number(halo.getAttribute('x')) + Number(halo.getAttribute('width'));
    // Must reach the far edge of the anchor's own cell, not just its centre.
    expect(right).toBeGreaterThanOrEqual(3 * STOP_SIZE + STOP_SIZE / 2);
  });

  it('marks the selected stop handle', () => {
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L2' });
    const { container } = renderEditor();
    const l2 = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]');
    expect(l2?.getAttribute('data-selected')).toBe('true');
  });

  it('paints every orientation arrow white, whatever the dot underneath', () => {
    // The ring carries a heavy black scrim over the dot, so the arrow contrasts
    // the SCRIM, not the dot: white everywhere, including on a white dot, where
    // the old flip-to-black would now paint black on near-black.
    useDoc.setState({
      ...DEFAULT_DOC,
      stations: { a: hubStation() },
      lines: {
        // White-filled dot — the case that used to flip the arrow to black.
        L1: makeLine({
          id: 'L1',
          service: '1',
          name: '1 line',
          color: '#ffffff',
          stations: ['a'],
          // 'a' is a hub (L1 + L2), so L1's dot there is a shared stop.
          multiDotStyle: DOT_SHAPE_PRESETS['filled-white'],
        }),
        // Black-filled dot — white either way.
        L2: makeLine({ id: 'L2', service: '2', name: '2 line', color: '#111111', stations: ['a'] }),
      },
      lineOrder: ['L1', 'L2'],
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['a'],
      uiMode: { kind: 'editing-station-layout', stationId: 'a' },
      selectedStopLineId: null,
      labelSelected: false,
      toolMode: 'arrow',
      spaceHeld: false,
    });
    const { container } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"] path');
    const l2 = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"] path');
    expect(l1?.getAttribute('fill')).toBe('#fff');
    expect(l2?.getAttribute('fill')).toBe('#fff');
    // No contrast halo in the editor — the scrim does that job.
    expect(l1?.getAttribute('stroke')).toBeNull();
  });

  it('rotates the "L" glyph to match the label rotation', () => {
    seed();
    // Turn the label a quarter turn (rotation step 2 = 90°); the actual label
    // text rotates about its cell, so the "L" preview must too.
    useDoc.setState((s) => ({
      stations: {
        ...s.stations,
        a: { ...s.stations.a, label: { ...s.stations.a.label, rotation: 2 } },
      },
    }));
    const { container } = renderEditor();
    const labelText = container.querySelector('[data-cell-kind="label"] text') as Element;
    expect(labelText).not.toBeNull();
    // Cell center for row=0,col=-1 is (-14, 0); the glyph pivots there.
    expect(labelText.getAttribute('transform')).toBe('rotate(90 -14 0)');
  });
});

describe('<StationLayoutEditor /> — label handle glyph', () => {
  // `dominantBaseline="central"` centers the font's ascent..descent box, which
  // Chrome sources per-platform (usWin on Windows, hhea on macOS) — the "L"
  // rendered ~0.09em lower on a Mac. Centered on the alphabetic baseline instead.
  it('centers the "L" on the alphabetic baseline, not via dominant-baseline', () => {
    seed();
    const { container } = renderEditor();
    const handle = container.querySelector('[data-cell-kind="label"]')!;
    const circle = handle.querySelector('circle')!;
    const text = handle.querySelector('text')!;
    expect(text.textContent).toBe('L');
    const fontSize = Number(text.getAttribute('font-size'));
    const cy = Number(circle.getAttribute('cy'));
    expect(Number(text.getAttribute('y'))).toBeCloseTo(cy + capCenterDy(fontSize), 6);
    expect(text.getAttribute('dominant-baseline')).toBeNull();
  });
});

describe('<StationLayoutEditor /> — map-fixed chrome', () => {
  // The handles are sized in WORLD units (the component reads no zoom at all),
  // so they grow and shrink with the map instead of holding a screen size off
  // the committed zoom — which snapped on every gesture commit and, zoomed out,
  // left a handful of chunky dashes that didn't read as a circle. The stroke
  // WEIGHT scales too: a screen-constant weight over world-sized dashes smears
  // the dotted ring into a solid one as you zoom out.
  it('sizes the stop grab ring in world units, weight included', () => {
    seed();
    const { container } = renderEditor();
    const ring = container.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"] circle',
    ) as Element;
    // Half the stripe width (default 14) — the stop cell, in world units.
    expect(ring.getAttribute('r')).toBe('7');
    // A world-unit hairline — NOT pinned to the screen by vector-effect.
    expect(ring.getAttribute('stroke-width')).toBe('0.5');
    expect(ring.getAttribute('vector-effect')).toBeNull();
    // Solid: a dashed ring this small read as a handful of chunky arcs.
    expect(ring.getAttribute('stroke-dasharray')).toBeNull();
    // And a scrim over the dot, so a service-code disc can't fight the arrow.
    expect(ring.getAttribute('fill')).toBe('rgba(0, 0, 0, 0.8)');
  });

  it('keeps the active ring solid, one step heavier', () => {
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedStopLineId: 'L1' });
    const { container } = renderEditor();
    const ring = container.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"] circle',
    ) as Element;
    expect(ring.getAttribute('stroke-dasharray')).toBeNull();
    expect(ring.getAttribute('stroke-width')).toBe('0.75');
    expect(ring.getAttribute('vector-effect')).toBeNull();
  });

  it('fits the arrow to its ring — close to the stroke, never through it', () => {
    // The map's hover badge sizes off the DOT, which on a service-code disc
    // (12) runs longer than this ring's 14 diameter. In here the ring is the
    // container, so the arrow is measured against it instead.
    seed();
    const { container } = renderEditor();
    const stop = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]') as Element;
    const r = Number(stop.querySelector('circle')!.getAttribute('r'));
    const arrow = stop.querySelector('path') as Element;
    expect(arrow.getAttribute('d')).toBe(orientationArrowPath(r * 2 * 0.88));
    // Tip to tip stays inside the ring.
    expect(r * 2 * 0.88).toBeLessThan(2 * r);
  });

  it('draws the same arrow shape as the map’s hover badge, on the same axis', () => {
    seed();
    const { container } = renderEditor();
    const station = useDoc.getState().stations.a;
    const lines = useDoc.getState().lines;
    const hover = render(
      <svg>
        <StationOrientationArrows station={station} lines={lines} />
      </svg>,
    );
    const inEditor = container.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"] path',
    ) as Element;
    const onHover = hover.container.querySelector('[data-arrow-line="L1"]') as Element;
    expect(onHover.getAttribute('d')).toBe(orientationArrowPath(12));
    // Same axis rotation in both surfaces; only the length differs.
    expect(inEditor.getAttribute('transform')).toBe(onHover.getAttribute('transform'));
  });

  it('sizes the label handle and its glyph in world units', () => {
    seed();
    const { container } = renderEditor();
    const ring = container.querySelector('[data-cell-kind="label"] circle') as Element;
    expect(ring.getAttribute('r')).toBe('7');
    expect(ring.getAttribute('stroke-width')).toBe('0.5');
    expect(ring.getAttribute('vector-effect')).toBeNull();
    const glyph = container.querySelector('[data-cell-kind="label"] text') as Element;
    expect(glyph.getAttribute('font-size')).toBe('12');
  });
});

describe('<StationLayoutEditor /> — live-drag chrome', () => {
  it('hides the dragged stop handle — it rides the cursor as ghosts instead', () => {
    seed();
    const { container } = renderEditor({ draggingSource: { kind: 'stop', lineId: 'L1' } });
    expect(container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]')).toBeNull();
    // The other stop stays put.
    expect(container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]')).not.toBeNull();
  });

  it('hides the label handle while the label is being dragged', () => {
    seed();
    const { container } = renderEditor({ draggingSource: { kind: 'label' } });
    expect(container.querySelector('[data-cell-kind="label"]')).toBeNull();
  });

  it('haloes the projection-anchor stop so it reads as the drop reference', () => {
    seed();
    // Grid projected from L2 at (0,1): it wears the amber halo; L1 does not.
    const { container } = renderEditor({ anchorCell: { row: 0, col: 1 } });
    const l2 = container.querySelector('[data-cell-kind="stop"][data-line-id="L2"]')!;
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]')!;
    expect(l2.querySelector('[data-cell-role="projection-anchor"]')).not.toBeNull();
    expect(l1.querySelector('[data-cell-role="projection-anchor"]')).toBeNull();
  });

  it('haloes the label when the grid is projected from it (lone-stop drag)', () => {
    seed();
    // hubStation's label sits at (0,-1); anchoring there haloes the label cell.
    const { container } = renderEditor({ anchorCell: { row: 0, col: -1 } });
    const label = container.querySelector('[data-cell-kind="label"]')!;
    expect(label.querySelector('[data-cell-role="projection-anchor"]')).not.toBeNull();
  });
});

describe('<StationLayoutEditor /> — hand mode passes through', () => {
  it('handles and shield drop pointer events so drag-to-pan works', () => {
    seed();
    useSelection.setState({ ...useSelection.getState(), toolMode: 'hand' });
    const { container, onStartNodeDrag } = renderEditor();
    const l1 = container.querySelector('[data-cell-kind="stop"][data-line-id="L1"]') as Element;
    fireEvent.pointerDown(l1, { button: 0 });
    expect(onStartNodeDrag).not.toHaveBeenCalled();
    // The hit surfaces are pointer-transparent in hand mode.
    expect(l1.querySelector('circle')?.getAttribute('pointer-events')).toBe('none');
    const shields = Array.from(container.querySelectorAll('[data-layout-shield]'));
    expect(shields.length).toBeGreaterThan(0);
    for (const s of shields) expect(s.getAttribute('pointer-events')).toBe('none');
  });
});
