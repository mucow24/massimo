import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLabel, makeLine, makeStation, makeStop } from '../test/fixtures';
import { STOP_SIZE } from '../geometry/orientation';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { measureTextLabel, BASELINE_FRACTION } from '../geometry/textMeasure';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
  useViewportStore.setState({ darkMode: false });
});

function renderLabel() {
  const station = makeStation({ id: 's1', name: 'Foo', x: 100, y: 100 });
  const { container } = render(
    <svg>
      <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
    </svg>,
  );
  // The first <text> rendered by the label layer is the station name.
  const text = container.querySelector('text');
  if (!text) throw new Error('expected <text> for station label');
  return { text, station };
}

describe('<StationView /> — label color follows the theme', () => {
  it('paints the label near-black in light mode', () => {
    useViewportStore.setState({ darkMode: false });
    expect(renderLabel().text.getAttribute('fill')).toBe('#111111');
  });

  it('paints the label white in dark mode', () => {
    useViewportStore.setState({ darkMode: true });
    expect(renderLabel().text.getAttribute('fill')).toBe('#ffffff');
  });
});

describe('<StationView /> — label styling', () => {
  it('uses the document defaults: fontSize 12, weight 400, no italic', () => {
    const { text } = renderLabel();
    expect(text.getAttribute('font-size')).toBe('12');
    expect(text.getAttribute('font-weight')).toBe('400');
    expect(text.getAttribute('font-style')).toBeNull();
  });

  it('applies labelFontSize, labelWeight, and labelItalic from the store', () => {
    useDoc.setState({
      ...useDoc.getState(),
      labelFontSize: 18,
      labelWeight: 500,
      labelItalic: true,
    });
    const { text } = renderLabel();
    expect(text.getAttribute('font-size')).toBe('18');
    expect(text.getAttribute('font-weight')).toBe('500');
    expect(text.getAttribute('font-style')).toBe('italic');
  });

  it('per-station labelItalic renders italic even when the doc default is upright', () => {
    useDoc.setState({ ...useDoc.getState(), labelItalic: false });
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelItalic: true as const };
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-style')).toBe('italic');
  });

  it('per-station labelBold bumps the rendered weight two indices heavier (Regular → Bold)', () => {
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelBold: true as const };
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('700'); // 400 → 700
  });

  it('per-station labelBold bumps two indices from a non-default labelWeight (Light → Medium)', () => {
    useDoc.setState({ ...useDoc.getState(), labelWeight: 300 });
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelBold: true as const };
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('500'); // 300 → 500
  });

  it('per-station labelBold saturates at Black (900) when the default is near the top', () => {
    useDoc.setState({ ...useDoc.getState(), labelWeight: 800 });
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelBold: true as const };
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('900');
  });

  it('hover bumps the rendered weight two indices heavier from the current weight (Regular → Bold)', () => {
    const station = makeStation({ id: 's1', name: 'Foo' });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('700');
  });

  it('hover stacks on top of per-station bold (400 → 700 → 900), saturating at Black', () => {
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelBold: true as const };
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    // 400 → +2 (station bold) → 700 → +2 (hover) → 900.
    expect(text?.getAttribute('font-weight')).toBe('900');
  });

  it('non-hovered labels render no underline geometry and no text-decoration attribute', () => {
    // The renderer draws the hover underline as an explicit <line> element
    // (not the SVG `text-decoration` attribute, which leaks paint residue
    // on rotated <text> in Chromium). When hover is off, there should be
    // neither the line element nor the attribute.
    const station = makeStation({ id: 's1', name: 'Foo' });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('text-decoration')).toBeNull();
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('hovered labels render one <line> underline per text line (replaces text-decoration)', () => {
    const station = makeStation({ id: 's1', name: 'Foo\nBar' });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    // No SVG text-decoration attribute on the <text> — the underline is its
    // own geometry.
    const text = container.querySelector('text');
    expect(text?.getAttribute('text-decoration')).toBeNull();
    // One <line> per visible text line.
    const lines = Array.from(container.querySelectorAll('line'));
    expect(lines).toHaveLength(2);
  });

  it('hovered labels with an inline bullet still render <line> underlines (bullet render path)', () => {
    const station = makeStation({ id: 's1', name: 'Hub <A1>' });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const lines = {
      L1: makeLine({ id: 'L1', service: 'A1', color: '#abc123' }),
    };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    expect(container.querySelector('text')?.getAttribute('text-decoration')).toBeNull();
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(1);
  });

  it('hover saturates at Black (900) when the doc default is already 900', () => {
    useDoc.setState({ ...useDoc.getState(), labelWeight: 900 });
    const station = makeStation({ id: 's1', name: 'Foo' });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('900');
  });
});

describe('<StationView /> — whitespace is not collapsed', () => {
  // Typed leading/trailing spaces must render at their real width. The
  // proven mechanism (used by free-floating <LabelView /> text) is the CSS
  // `white-space: pre` property; the deprecated `xml:space` attribute does
  // not reliably preserve leading whitespace in inline SVG.
  it('renders the plain-text label with white-space: pre', () => {
    const station = makeStation({ id: 's1', name: '     Foo', x: 0, y: 0 });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text') as SVGTextElement;
    expect(text).toBeTruthy();
    expect(text.style.whiteSpace).toBe('pre');
  });

  it('renders bullet-path text segments with white-space: pre', () => {
    const station = makeStation({ id: 's1', name: '  Hub <A1>  ', x: 0, y: 0 });
    const lines = { L1: makeLine({ id: 'L1', service: 'A1', color: '#abc123' }) };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const segTexts = Array.from(container.querySelectorAll('text')).filter(
      (t) => !t.closest('[data-inline-bullet]'),
    );
    expect(segTexts.length).toBeGreaterThan(0);
    for (const t of segTexts) {
      expect((t as SVGTextElement).style.whiteSpace).toBe('pre');
    }
  });
});

describe('<StationView /> — inline label editor matches the painted label', () => {
  // Open the inline rename editor for `station` and hand back its DOM nodes.
  // The textarea lives directly inside the <foreignObject>, so its parent IS
  // the foreignObject — read positioning attrs off that.
  function renderEditor(station: ReturnType<typeof makeStation>) {
    useSelection.setState({ ...useSelection.getState(), editingStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const ta = container.querySelector('textarea');
    if (!ta) throw new Error('expected a <textarea> for the inline editor');
    const fo = ta.parentElement;
    if (!fo) throw new Error('expected the textarea to live inside a <foreignObject>');
    return { ta, fo };
  }

  // The style the renderer feeds labelLayoutLocal with the default doc:
  // 12px / Regular / upright. Mirrored here to derive the editor's expected
  // geometry from the same source of truth the label uses.
  const defaultStyle = { fontSize: 12, weight: 400, italic: false };

  it('drops the hardcoded bold — editor weight matches the label weight (400)', () => {
    const { ta } = renderEditor(makeStation({ id: 's1', name: 'Foo', x: 100, y: 100 }));
    expect(ta.style.fontWeight).toBe('400');
  });

  it('matches a bold label default (700) instead of forcing a fixed weight', () => {
    useDoc.setState({ ...useDoc.getState(), labelWeight: 700 });
    const { ta } = renderEditor(makeStation({ id: 's1', name: 'Foo' }));
    expect(ta.style.fontWeight).toBe('700');
  });

  it('renders the editor at the document label font size', () => {
    useDoc.setState({ ...useDoc.getState(), labelFontSize: 18 });
    const { ta } = renderEditor(makeStation({ id: 's1', name: 'Foo' }));
    expect(ta.style.fontSize).toBe('18px');
  });

  it('renders the editor italic when the label is italic', () => {
    useDoc.setState({ ...useDoc.getState(), labelItalic: true });
    const { ta } = renderEditor(makeStation({ id: 's1', name: 'Foo' }));
    expect(ta.style.fontStyle).toBe('italic');
  });

  it('rotates the editor to match a rotated label', () => {
    const station = makeStation({
      id: 's1',
      name: 'Foo',
      x: 100,
      y: 100,
      label: makeLabel({ rotation: 2 }),
    });
    const layout = labelLayoutLocal(station, defaultStyle);
    const { fo } = renderEditor(station);
    expect(fo.getAttribute('transform')).toBe(`rotate(90 ${layout.anchorX} ${layout.anchorY})`);
  });

  it('positions + sizes the editor over the painted label box, not the cell center', () => {
    const station = makeStation({ id: 's1', name: 'Foo', x: 100, y: 100 });
    const layout = labelLayoutLocal(station, defaultStyle);
    const { fo } = renderEditor(station);
    expect(parseFloat(fo.getAttribute('x')!)).toBeCloseTo(layout.hitX, 5);
    expect(parseFloat(fo.getAttribute('y')!)).toBeCloseTo(layout.hitY, 5);
    expect(parseFloat(fo.getAttribute('width')!)).toBeCloseTo(layout.hitW, 5);
    expect(parseFloat(fo.getAttribute('height')!)).toBeCloseTo(layout.hitH, 5);
  });

  it('right-aligns the editor text for an end-anchored label', () => {
    const station = makeStation({ id: 's1', name: 'Foo' });
    expect(labelLayoutLocal(station, defaultStyle).textAnchor).toBe('end'); // premise
    const { ta } = renderEditor(station);
    expect(ta.style.textAlign).toBe('right');
  });

  it('left-aligns the editor text for a start-anchored label', () => {
    const station = makeStation({
      id: 's1',
      name: 'Foo',
      stops: [makeStop('L1', { row: 0, col: -2 })],
    });
    expect(labelLayoutLocal(station, defaultStyle).textAnchor).toBe('start'); // premise
    const { ta } = renderEditor(station);
    expect(ta.style.textAlign).toBe('left');
  });

  it('center-aligns the editor text for a middle-anchored label', () => {
    const station = makeStation({ id: 's1', name: 'Foo', label: makeLabel({ align: 'middle' }) });
    expect(labelLayoutLocal(station, defaultStyle).textAnchor).toBe('middle'); // premise
    const { ta } = renderEditor(station);
    expect(ta.style.textAlign).toBe('center');
  });

  it('grows the editor box to fit expanded <CODE> tokens so they never clip', () => {
    // The textarea shows the raw "<A1>" tokens, which are wider than the
    // bullets they render as. The box must be sized to that literal text, not
    // the collapsed-bullet label hit rect, or the tokens overflow/clip.
    const station = makeStation({ id: 's1', name: 'Hub <A1> <B2>', x: 100, y: 100 });
    const collapsed = labelLayoutLocal(station, defaultStyle);
    const literal = labelLayoutLocal(station, { ...defaultStyle, literalBullets: true });
    const { fo } = renderEditor(station);
    expect(parseFloat(fo.getAttribute('width')!)).toBeCloseTo(literal.hitW, 5);
    expect(parseFloat(fo.getAttribute('x')!)).toBeCloseTo(literal.hitX, 5);
    // Sanity: the literal box is genuinely wider than the rendered label box.
    expect(literal.hitW).toBeGreaterThan(collapsed.hitW);
  });
});

describe('<StationView /> — selection silhouette during inline edit', () => {
  function renderSilhouette(
    station: ReturnType<typeof makeStation>,
    layer: 'wash' | 'stroke',
    editing: boolean,
  ) {
    if (editing) {
      useSelection.setState({ ...useSelection.getState(), editingStationId: station.id });
    }
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer={layer} />
      </svg>,
    );
    return container;
  }

  it('draws the silhouette for a selected, non-editing station (premise)', () => {
    const station = makeStation({ id: 's1', name: 'Hub <A1>' });
    expect(renderSilhouette(station, 'stroke', false).querySelector('path')).not.toBeNull();
  });

  it('suppresses the stroke silhouette while the station is being edited', () => {
    // The grown editor box already delineates the edit area; the collapsed
    // silhouette would otherwise overdraw the expanded textbox.
    const station = makeStation({ id: 's1', name: 'Hub <A1>' });
    expect(renderSilhouette(station, 'stroke', true).querySelector('path')).toBeNull();
  });

  it('suppresses the wash silhouette while the station is being edited', () => {
    const station = makeStation({ id: 's1', name: 'Hub <A1>' });
    expect(renderSilhouette(station, 'wash', true).querySelector('path')).toBeNull();
  });
});

describe('<StationView /> — inline bullets in station names', () => {
  it('renders no bullets and a single <text> for plain station names', () => {
    const station = makeStation({ id: 's1', name: 'Plain', x: 0, y: 0 });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    expect(container.querySelectorAll('[data-inline-bullet]')).toHaveLength(0);
    // Plain text path is intentionally kept as a single <text> + <tspan>s so
    // the wash silhouette and hit-test rect stay byte-for-byte the same.
    expect(container.querySelectorAll('text')).toHaveLength(1);
  });

  it('emits a colored inline bullet when the name contains <CODE>', () => {
    const station = makeStation({ id: 's1', name: 'Hub <A1>', x: 0, y: 0 });
    const lines = {
      L1: makeLine({ id: 'L1', service: 'A1', color: '#abc123' }),
    };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    expect(bullets[0].querySelector('circle')?.getAttribute('fill')).toBe('#abc123');
  });

  it('emits a square bullet when the name uses the [CODE] form', () => {
    const station = makeStation({ id: 's1', name: 'Hub [A1]', x: 0, y: 0 });
    const lines = {
      L1: makeLine({ id: 'L1', service: 'A1', color: '#abc123' }),
    };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    expect(bullets[0].querySelector('rect')?.getAttribute('fill')).toBe('#abc123');
  });

  it('falls back to a gray "?" bullet for an unknown code', () => {
    const station = makeStation({ id: 's1', name: '<ZZ>', x: 0, y: 0 });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const bullet = container.querySelector('[data-inline-bullet]');
    expect(bullet?.querySelector('circle')?.getAttribute('fill')).toBe('#888');
    expect(bullet?.querySelector('text')?.textContent).toBe('?');
  });
});

describe('<StationView /> — dot layer renders at cell-grid positions', () => {
  it('every dot sits at stopPosWorld(cell, station) — no neighbor-aware nudging', () => {
    // Mix of cardinal and diagonal orientations. Each dot's cx/cy is the
    // station anchor + the cell offset rotated by the station rotation.
    // Nothing about a stop's neighbors affects its rendered position.
    const station = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 1, col: 2, orientation: 'auto-nw-se' }),
        makeStop('L2', { row: 2, col: 1, orientation: 'auto-nw-se' }),
        makeStop('L3', { row: 3, col: 0, orientation: 'auto-nw-se' }),
        makeStop('L4', { row: 4, col: -1, orientation: 'auto-horizontal' }),
      ],
    });
    const lines = {
      L1: makeLine({ id: 'L1', service: 'L1', color: '#0039A6' }),
      L2: makeLine({ id: 'L2', service: 'L2', color: '#EE352E' }),
      L3: makeLine({ id: 'L3', service: 'L3', color: '#00933C' }),
      L4: makeLine({ id: 'L4', service: 'L4', color: '#808080' }),
    };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="dots" />
      </svg>,
    );

    const readDot = (lineId: string) => {
      const el = container.querySelector(`[data-stop-station="s1"][data-stop-line="${lineId}"]`);
      if (!el) throw new Error(`no dot for ${lineId}`);
      return { cx: parseFloat(el.getAttribute('cx')!), cy: parseFloat(el.getAttribute('cy')!) };
    };

    for (const cell of station.stops) {
      const got = readDot(cell.lineId);
      // Cell-grid world position: rotation 0 station at (0,0) → (col, row) * STOP_SIZE.
      expect(got.cx).toBeCloseTo(cell.col * STOP_SIZE, 5);
      expect(got.cy).toBeCloseTo(cell.row * STOP_SIZE, 5);
    }
  });
});

describe('<StationView /> — transfer-pick hover highlight', () => {
  // closestStopLineId falls back to `station.stops[0].lineId` when there's no
  // `.canvas-host svg` ancestor; these tests rely on that, so the picked
  // lineId is just the first stop on each station.

  function renderBg(station: ReturnType<typeof makeStation>) {
    return render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="bg" />
      </svg>,
    );
  }

  it('first pick: pointerMove over a station sets hoveredLineStop', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const station = makeStation({
      id: 's1',
      stops: [makeStop('L1')],
    });
    useSelection.setState({
      ...useSelection.getState(),
      uiMode: { kind: 'creating-transfer', anchor: null },
      hoveredLineStop: null,
    });
    const { container } = renderBg(station);
    const hitRect = container.querySelector('[data-station-id="s1"] rect');
    if (!hitRect) throw new Error('no bg hit-rect');
    fireEvent.pointerMove(hitRect);
    expect(useSelection.getState().hoveredLineStop).toEqual({ stationId: 's1', lineId: 'L1' });
  });

  it('second pick: pointerMove over a different station still sets hoveredLineStop', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const stationB = makeStation({
      id: 's2',
      stops: [makeStop('L2')],
    });
    useSelection.setState({
      ...useSelection.getState(),
      uiMode: {
        kind: 'creating-transfer',
        anchor: { stationId: 's1', lineId: 'L1' },
      },
      hoveredLineStop: null,
    });
    const { container } = renderBg(stationB);
    const hitRect = container.querySelector('[data-station-id="s2"] rect');
    if (!hitRect) throw new Error('no bg hit-rect');
    fireEvent.pointerMove(hitRect);
    expect(useSelection.getState().hoveredLineStop).toEqual({ stationId: 's2', lineId: 'L2' });
  });

  it('second pick: pointerMove over the anchor dot itself does NOT highlight (self-transfer guard)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const station = makeStation({
      id: 's1',
      stops: [makeStop('L1')],
    });
    useSelection.setState({
      ...useSelection.getState(),
      uiMode: {
        kind: 'creating-transfer',
        anchor: { stationId: 's1', lineId: 'L1' },
      },
      hoveredLineStop: null,
    });
    const { container } = renderBg(station);
    const hitRect = container.querySelector('[data-station-id="s1"] rect');
    if (!hitRect) throw new Error('no bg hit-rect');
    fireEvent.pointerMove(hitRect);
    expect(useSelection.getState().hoveredLineStop).toBeNull();
  });
});

describe('<StationView /> — hit proxy (selected-on-top drag target)', () => {
  function renderHit(station: ReturnType<typeof makeStation>, onStartDrag = vi.fn()) {
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={onStartDrag} layer="hit" />
      </svg>,
    );
    return { container, onStartDrag };
  }

  it('renders a proxy hit group under data-station-hit, NOT data-station-id, with no data-locked', () => {
    const { container } = renderHit(makeStation({ id: 's1', name: 'Foo' }));
    const g = container.querySelector('[data-station-hit="s1"]') as HTMLElement;
    expect(g).not.toBeNull();
    // Distinct attribute so the e2e [data-station-id] locators stay single-match.
    expect(container.querySelector('[data-station-id]')).toBeNull();
    // No data-locked: it would make the rect-select gate treat the proxy as
    // marquee-background and swallow the drag.
    expect(g.getAttribute('data-locked')).toBeNull();
    // The footprint rect is the same transparent, all-hit surface as the bg.
    const rect = g.querySelector('rect') as Element;
    expect(rect.getAttribute('fill')).toBe('transparent');
    expect(rect.getAttribute('pointer-events')).toBe('all');
  });

  it('renders no proxy for a locked station (self-gate: not draggable)', () => {
    const { container } = renderHit({ ...makeStation({ id: 's1', name: 'Foo' }), locked: true });
    expect(container.querySelector('[data-station-hit]')).toBeNull();
  });

  it('routes a pointer-down through useStationInteraction to onStartDrag with the id', () => {
    const { container, onStartDrag } = renderHit(makeStation({ id: 's1', name: 'Foo' }));
    const rect = container.querySelector('[data-station-hit="s1"] rect') as HTMLElement;
    fireEvent.pointerDown(rect, { button: 0 });
    expect(onStartDrag).toHaveBeenCalledWith('s1', expect.anything(), undefined);
  });
});

describe('<StationView /> — locked station hit area (bg layer)', () => {
  function renderBgLayer(station: ReturnType<typeof makeStation>) {
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="bg" />
      </svg>,
    );
    const g = container.querySelector('[data-station-id="s1"]');
    if (!g) throw new Error('no station hit group');
    return g as HTMLElement;
  }

  it('marks the hit group [data-locked] and uses the pointing-hand cursor when locked', () => {
    const g = renderBgLayer({ ...makeStation({ id: 's1', name: 'Foo' }), locked: true as const });
    expect(g).toHaveAttribute('data-locked', 'true');
    expect(g.style.cursor).toBe('pointer');
  });

  it('omits data-locked and uses the move cursor when unlocked', () => {
    const g = renderBgLayer(makeStation({ id: 's1', name: 'Foo' }));
    expect(g).not.toHaveAttribute('data-locked');
    expect(g.style.cursor).toBe('move');
  });
});

describe('<StationView /> — hover underline geometry (E1)', () => {
  // The hover underline is drawn as an explicit <line> (renderStationLabelText
  // draws it instead of the SVG text-decoration attribute). Earlier tests only
  // count the <line>s; this pins the actual geometry: x1/x2 hug the ink extent
  // off lineStartX, y sits UNDERLINE_OFFSET below the first baseline, stroke =
  // the label fill. The expected values are derived from the SAME measurement +
  // layout the renderer uses, so the test is an exact oracle (not a tautology:
  // it re-derives the formula independently).
  const UNDERLINE_OFFSET = 4;
  const UNDERLINE_STROKE = 2;
  const defaultStyle = { fontSize: 12, weight: 400, italic: false };

  it('positions the <line> at the ink extent and one offset below the baseline', () => {
    const station = makeStation({ id: 's1', name: 'Foo', x: 100, y: 100 });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );

    const line = container.querySelector('line');
    if (!line) throw new Error('expected a hover <line> underline');

    // Re-derive the expected geometry from the same primitives the renderer
    // uses: labelLayoutLocal for the anchor/textAnchor/baseline, and
    // measureTextLabel for the ink bearings/width.
    const lay = labelLayoutLocal(station, defaultStyle);
    const m = measureTextLabel({ text: 'Foo', fontSize: 12, weight: 400, italic: false });
    const lm = m.lines[0];
    expect(lm.inkWidth).toBeGreaterThan(0); // premise: there's an underline to draw

    // lineStartX for an end-anchored label: anchorX − bearingRight.
    expect(lay.textAnchor).toBe('end'); // premise for this station's layout
    const expX1 = lay.anchorX - lm.bearingRight;
    const expX2 = expX1 + lm.inkWidth;

    // First baseline for the central-baseline path (the default label uses
    // dominantBaseline='central'): anchorY + fontSize*(BASELINE_FRACTION−0.5)
    // + firstLineDyPx. Single line ⇒ i=0, so y = baseline + UNDERLINE_OFFSET.
    expect(lay.baseline).toBe('central'); // premise
    const baselineY = lay.anchorY + 12 * (BASELINE_FRACTION - 0.5) + lay.firstLineDyPx;
    const expY = baselineY + UNDERLINE_OFFSET;

    expect(Number(line.getAttribute('x1'))).toBeCloseTo(expX1, 5);
    expect(Number(line.getAttribute('x2'))).toBeCloseTo(expX2, 5);
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(expY, 5);
    expect(Number(line.getAttribute('y2'))).toBeCloseTo(expY, 5);
    // Underline paints in the label color (light-mode near-black) at the
    // documented stroke width.
    expect(line.getAttribute('stroke')).toBe('#111111');
    expect(Number(line.getAttribute('stroke-width'))).toBe(UNDERLINE_STROKE);
  });
});

describe('<StationView /> — selection silhouette geometry (E2)', () => {
  // The stroke/wash/match-stroke silhouette paints a smoothed union path. Prior
  // tests only assert the <path> is present; this pins the wash fill/opacity and
  // the match-stroke width to their documented constants, plus a non-empty `d`
  // for a multi-cell station.
  const multiCellStation = () =>
    makeStation({
      id: 's1',
      name: 'Hub',
      x: 0,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L2', { row: 0, col: 1 })],
    });

  function renderLayer(layer: 'wash' | 'stroke' | 'match-stroke') {
    return render(
      <svg>
        <StationView
          station={multiCellStation()}
          lines={{}}
          zoom={1}
          onStartDrag={vi.fn()}
          layer={layer}
        />
      </svg>,
    ).container;
  }

  it('draws a non-empty union path for a multi-cell station (wash layer)', () => {
    const path = renderLayer('wash').querySelector('path');
    if (!path) throw new Error('expected a silhouette <path>');
    const d = path.getAttribute('d') ?? '';
    expect(d.length).toBeGreaterThan(0);
    // A real area, not a single point: at least one move + one line/curve.
    expect(d).toMatch(/M/);
    expect(d).toMatch(/[LCQ]/);
  });

  it('paints the wash fill with the theme accent at 0.2 opacity', () => {
    const path = renderLayer('wash').querySelector('path')!;
    expect(path.getAttribute('fill')).toBe('#1a4ea8');
    expect(Number(path.getAttribute('fill-opacity'))).toBe(0.2);
  });

  it('paints the gray match-stroke at width 1.5, no fill', () => {
    const path = renderLayer('match-stroke').querySelector('path')!;
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke')).toBe('#888');
    expect(Number(path.getAttribute('stroke-width'))).toBe(1.5);
  });

  // Selection chrome holds a constant SCREEN weight: the stroke divides by
  // the committed zoom (the 1/zoom idiom PolygonView established). At fit-map
  // zooms a world-unit ring degraded to a sub-pixel ghost.
  it('divides the selection stroke by zoom so its screen weight is constant', () => {
    useViewportStore.setState({ zoom: 2 });
    try {
      const path = renderLayer('stroke').querySelector('path')!;
      expect(Number(path.getAttribute('stroke-width'))).toBe(1);
      // The mirror-match outline is the same class of chrome — compensated too.
      const match = renderLayer('match-stroke').querySelector('path')!;
      expect(Number(match.getAttribute('stroke-width'))).toBe(0.75);
    } finally {
      useViewportStore.setState({ zoom: 1 });
    }
  });
});
