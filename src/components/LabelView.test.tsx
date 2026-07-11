import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { LabelView } from './LabelView';
import { useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC, updateTextLabel } from '../model/transforms';
import { makeTextLabel } from '../test/fixtures';
import { BASELINE_FRACTION } from '../geometry/textMeasure';
import type { Line, TextLabel, TextLabelAlign } from '../model/types';

const seedLine = (overrides: Partial<Line> & Pick<Line, 'id' | 'service'>): Line => ({
  id: overrides.id,
  service: overrides.service,
  name: overrides.name ?? overrides.service,
  color: overrides.color ?? '#ff0000',
  stations: overrides.stations ?? [],
});

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useViewportStore.setState({ darkMode: false });
});

// The selection ring is a two-tone rect: a 2px ink core over a 4px underlay,
// screen-constant via vector-effect (no zoom subscription → no snap on gesture
// commit), dashed like the other free-item rings (bullets, polygons, svg
// images). It flips with the theme (WBW on light, BWB on dark). Stations and
// line tags stay solid.
describe('<LabelView /> — selection ring', () => {
  afterEach(() => useViewportStore.setState({ zoom: 1 }));

  const ringRects = () =>
    Array.from(
      render(
        <svg>
          <LabelView label={makeTextLabel({ id: 'g1', text: 'Hi' })} selected layer="stroke" />
        </svg>,
      ).container.querySelectorAll('[data-text-label-stroke] rect'),
    );

  it('renders a black core over a white underlay on the light canvas, vector-effect, dashed', () => {
    // beforeEach sets darkMode: false.
    const [edge, core] = ringRects();
    expect(edge.getAttribute('stroke')).toBe('#ffffff');
    expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
    expect(core.getAttribute('stroke')).toBe('#000000');
    expect(Number(core.getAttribute('stroke-width'))).toBe(2);
    for (const r of [edge, core]) {
      expect(r.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(r.getAttribute('stroke-dasharray')).toBe('4 3');
    }
  });

  // No zoom subscription: identical markup at any committed zoom (nothing to
  // snap when a gesture commits).
  it('is zoom-independent: identical widths at committed zoom 2', () => {
    useViewportStore.setState({ zoom: 2 });
    const [edge, core] = ringRects();
    expect(Number(edge.getAttribute('stroke-width'))).toBe(4);
    expect(Number(core.getAttribute('stroke-width'))).toBe(2);
  });
});

describe('<LabelView /> — text color follows the theme', () => {
  const renderPlain = () =>
    render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: 'Midtown' })} selected={false} />
      </svg>,
    );

  it('paints text near-black in light mode', () => {
    useViewportStore.setState({ darkMode: false });
    expect(renderPlain().container.querySelector('text')?.getAttribute('fill')).toBe('#111111');
  });

  it('paints text white in dark mode', () => {
    useViewportStore.setState({ darkMode: true });
    expect(renderPlain().container.querySelector('text')?.getAttribute('fill')).toBe('#ffffff');
  });
});

describe('<LabelView /> — per-label day/night colors', () => {
  const renderColored = () =>
    render(
      <svg>
        <LabelView
          label={makeTextLabel({
            id: 'g1',
            text: 'Midtown',
            color: '#ff0000',
            darkColor: '#00ff00',
          })}
          selected={false}
        />
      </svg>,
    );

  it('paints the day color in light mode', () => {
    useViewportStore.setState({ darkMode: false });
    expect(renderColored().container.querySelector('text')?.getAttribute('fill')).toBe('#ff0000');
  });

  it('paints the night color in dark mode', () => {
    useViewportStore.setState({ darkMode: true });
    expect(renderColored().container.querySelector('text')?.getAttribute('fill')).toBe('#00ff00');
  });
});

describe('<LabelView /> — inline bullets', () => {
  it('renders an inline bullet with the line color when text contains |CODE|', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: seedLine({ id: 'L1', service: 'A1', color: '#00ff00' }) },
      lineOrder: ['L1'],
    });
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: '|A1|' })} selected={false} />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    expect(bullets[0].getAttribute('data-inline-bullet')).toBe('A1');
    const circle = bullets[0].querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#00ff00');
  });

  it('renders an unfilled diamond bullet for a {{CODE}} token', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: seedLine({ id: 'L1', service: 'A1', color: '#00ff00' }) },
      lineOrder: ['L1'],
    });
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: '{{A1}}' })} selected={false} />
      </svg>,
    );
    const poly = container.querySelector('[data-inline-bullet] polygon');
    expect(poly?.getAttribute('stroke')).toBe('#00ff00');
    expect(poly?.getAttribute('fill')).toBe('#ffffff');
  });

  it('renders a gray "?" bullet when the code does not match any line', () => {
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: '|NOPE|' })} selected={false} />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    const circle = bullets[0].querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#888');
    expect(bullets[0].querySelector('text')?.textContent).toBe('?');
  });

  it('renders no bullet when text has no bullet tokens', () => {
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: 'plain text' })} selected={false} />
      </svg>,
    );
    expect(container.querySelectorAll('[data-inline-bullet]')).toHaveLength(0);
  });

  it('renders text segments around an inline bullet', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: seedLine({ id: 'L1', service: 'A1' }) },
      lineOrder: ['L1'],
    });
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: 'Take |A1| uptown' })} selected={false} />
      </svg>,
    );
    // The label group contains TWO text segments (before and after the bullet),
    // plus the bullet's own internal <text>. We assert on the segment texts.
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Take ');
    expect(texts).toContain(' uptown');
    expect(container.querySelectorAll('[data-inline-bullet]')).toHaveLength(1);
  });
});

describe('<LabelView /> — formatting tags', () => {
  const renderLabel = (label: TextLabel) =>
    render(
      <svg>
        <LabelView label={label} selected={false} />
      </svg>,
    ).container;
  const textByContent = (c: HTMLElement, content: string) =>
    Array.from(c.querySelectorAll('text')).find((t) => t.textContent === content)!;

  it('renders <b> two ladder steps up from the base weight', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: '<b>Bold</b> plain', weight: 400 }));
    expect(textByContent(c, 'Bold').getAttribute('font-weight')).toBe('700');
    expect(textByContent(c, ' plain').getAttribute('font-weight')).toBe('400');
  });

  it('renders an absolute <w=Name> at that weight, overriding the base', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: '<w=Light>L</w> plain', weight: 700 }));
    expect(textByContent(c, 'L').getAttribute('font-weight')).toBe('300');
    expect(textByContent(c, ' plain').getAttribute('font-weight')).toBe('700');
  });

  it('renders a relative <w=+N>/<w=-N> as a step from the base weight', () => {
    const up = renderLabel(makeTextLabel({ id: 'g1', text: '<w=+2>up</w>', weight: 400 }));
    expect(textByContent(up, 'up').getAttribute('font-weight')).toBe('700');
    const down = renderLabel(makeTextLabel({ id: 'g2', text: '<w=-1>dn</w>', weight: 400 }));
    expect(textByContent(down, 'dn').getAttribute('font-weight')).toBe('300');
    // Relative to THIS label's base: +1 from Light lands on Roman.
    const rel = renderLabel(makeTextLabel({ id: 'g3', text: '<w=+1>r</w>', weight: 300 }));
    expect(textByContent(rel, 'r').getAttribute('font-weight')).toBe('400');
  });

  it('adds <b> on top of a <w=Name> run', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: '<b><w=Light>x</w></b>', weight: 400 }));
    expect(textByContent(c, 'x').getAttribute('font-weight')).toBe('500');
  });

  it('renders <i> as an italic run', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: '<i>lean</i> up' }));
    expect(textByContent(c, 'lean').getAttribute('font-style')).toBe('italic');
    expect(textByContent(c, ' up').getAttribute('font-style')).toBe('normal');
  });

  it('renders <color=...> as the segment fill, leaving other runs on the label color', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: '<color=red>R</color>N' }));
    expect(textByContent(c, 'R').getAttribute('fill')).toBe('red');
    expect(textByContent(c, 'N').getAttribute('fill')).toBe('#111111');
  });

  it('draws underline and strikethrough as explicit line elements', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: '<u>under</u> <s>gone</s>' }));
    expect(c.querySelectorAll('line[data-text-decoration="underline"]')).toHaveLength(1);
    expect(c.querySelectorAll('line[data-text-decoration="strike"]')).toHaveLength(1);
  });

  it('substitutes <air> with the plane glyph', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: '<air> JFK' }));
    expect(textByContent(c, '✈ JFK')).toBeDefined();
  });
});

describe('<LabelView /> — inline <size> tags', () => {
  const renderLabel = (label: TextLabel) =>
    render(
      <svg>
        <LabelView label={label} selected={false} />
      </svg>,
    ).container;
  const textByContent = (c: HTMLElement, content: string) =>
    Array.from(c.querySelectorAll('text')).find((t) => t.textContent === content)!;

  it('renders an absolute <size=N> run at that font size, others at the base', () => {
    const c = renderLabel(
      makeTextLabel({ id: 'g1', text: '<size=24>big</size> base', fontSize: 10 }),
    );
    expect(textByContent(c, 'big').getAttribute('font-size')).toBe('24');
    expect(textByContent(c, ' base').getAttribute('font-size')).toBe('10');
  });

  it('renders a relative <size=+N> run at base + delta', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: '<size=+5>x</size>', fontSize: 10 }));
    expect(textByContent(c, 'x').getAttribute('font-size')).toBe('15');
  });

  it('sits differently-sized runs on one shared baseline', () => {
    const c = renderLabel(
      makeTextLabel({ id: 'g1', text: '<size=6>a</size><size=24>b</size>', fontSize: 10 }),
    );
    // Each run is anchored (dominantBaseline="hanging") at baseline −
    // BASELINE_FRACTION·size, so adding BASELINE_FRACTION·size back must recover
    // the same baseline for both runs.
    const baseline = (el: Element, size: number) =>
      parseFloat(el.getAttribute('y')!) + BASELINE_FRACTION * size;
    expect(baseline(textByContent(c, 'a'), 6)).toBeCloseTo(baseline(textByContent(c, 'b'), 24), 5);
  });

  it('scales an underline decoration with the run size', () => {
    const small = renderLabel(makeTextLabel({ id: 'g1', text: '<u>u</u>', fontSize: 10 }));
    const big = renderLabel(
      makeTextLabel({ id: 'g2', text: '<u><size=40>u</size></u>', fontSize: 10 }),
    );
    const strokeOf = (c: HTMLElement) =>
      parseFloat(
        c.querySelector('line[data-text-decoration="underline"]')!.getAttribute('stroke-width')!,
      );
    // Underline thickness is size * 0.07, so the 40px run's rule is far heavier.
    expect(strokeOf(big)).toBeGreaterThan(strokeOf(small));
  });
});

describe('<LabelView /> — leading and tracking', () => {
  const renderLabel = (label: TextLabel) =>
    render(
      <svg>
        <LabelView label={label} selected={false} />
      </svg>,
    ).container;

  it('spaces lines by fontSize * LINE_HEIGHT * leading', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: 'aa\nbb', fontSize: 10, leading: 2 }));
    const y = (i: number) =>
      parseFloat(c.querySelector(`[data-label-line="${i}"] text`)!.getAttribute('y')!);
    expect(y(1) - y(0)).toBeCloseTo(10 * 1.2 * 2, 5);
  });

  it('applies tracking as letter-spacing in px of the font size', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: 'aa', fontSize: 10, tracking: 0.5 }));
    expect(c.querySelector('[data-label-line] text')!.getAttribute('letter-spacing')).toBe('5');
  });

  it('omits letter-spacing at the default tracking', () => {
    const c = renderLabel(makeTextLabel({ id: 'g1', text: 'aa', fontSize: 10 }));
    expect(c.querySelector('[data-label-line] text')!.getAttribute('letter-spacing')).toBeNull();
  });
});

describe('<LabelView /> — editing one line never shifts a sibling line', () => {
  // Regression: a multiline label's (x, y) is its bbox CENTER, and per-line
  // horizontal placement keys off the shared bbox width. So a width-changing
  // edit to one line (e.g. typing a leading space, now that whitespace counts)
  // recenters the box and drags the *other* lines sideways. updateTextLabel's
  // re-anchor must pin the alignment edge that the line positions key off:
  // left edge for 'left', center for 'center', right edge for 'right'.
  const ALIGNS: TextLabelAlign[] = ['left', 'center', 'right'];

  // World-space x of the first text segment on `lineIndex`. The label is drawn
  // inside a translate(x y) group, so the segment's local x must be lifted by
  // label.x to compare across edits that move the center.
  function lineWorldX(label: TextLabel, lineIndex: number): number {
    const { container } = render(
      <svg>
        <LabelView label={label} selected={false} />
      </svg>,
    );
    const text = container.querySelector(`[data-label-line="${lineIndex}"] text`);
    if (!text) throw new Error(`no <text> for line ${lineIndex}`);
    return label.x + parseFloat(text.getAttribute('x') ?? '0');
  }

  const editText = (label: TextLabel, text: string): TextLabel => {
    const doc = { ...DEFAULT_DOC, textLabels: { [label.id]: label } };
    return updateTextLabel(doc, label.id, { text }).textLabels[label.id];
  };

  it.each(ALIGNS)('a leading space on line 1 leaves line 2 put (align=%s)', (align) => {
    const base = makeTextLabel({ id: 'g1', x: 100, y: 100, text: 'AAAA\nBBBB', align });
    const before = lineWorldX(base, 1);
    const after = lineWorldX(editText(base, ' AAAA\nBBBB'), 1);
    expect(after).toBeCloseTo(before, 5);
  });

  it.each(ALIGNS)('a leading space on line 2 leaves line 1 put (align=%s)', (align) => {
    const base = makeTextLabel({ id: 'g1', x: 100, y: 100, text: 'AAAA\nBBBB', align });
    const before = lineWorldX(base, 0);
    const after = lineWorldX(editText(base, 'AAAA\n BBBB'), 0);
    expect(after).toBeCloseTo(before, 5);
  });
});

describe('<LabelView /> hit proxy (selected-on-top drag target)', () => {
  const renderHit = (label: TextLabel, onPointerDown: (id: string) => void = () => {}) =>
    render(
      <svg>
        <LabelView label={label} selected layer="hit" onPointerDown={onPointerDown} />
      </svg>,
    ).container;

  const hit = (c: HTMLElement) => c.querySelector('[data-text-label-hit="g1"]');

  it('a selected, unlocked label renders a transparent bbox proxy with the label transform', () => {
    const c = renderHit(makeTextLabel({ id: 'g1', x: 40, y: 70, text: 'Midtown' }));
    const g = hit(c)!;
    expect(g).not.toBeNull();
    expect(g.getAttribute('transform')).toBe('translate(40 70) rotate(0)');
    // Distinct from the body's data-text-label-id (avoids strict-mode locator clashes).
    expect(g.getAttribute('data-text-label-id')).toBeNull();
    const rect = g.querySelector('rect')!;
    expect(rect.getAttribute('fill')).toBe('transparent');
  });

  it('routes a pointer-down to the label move handler with the id', () => {
    const onPointerDown = vi.fn();
    const c = renderHit(makeTextLabel({ id: 'g1' }), onPointerDown);
    fireEvent.pointerDown(hit(c)!.querySelector('rect')!);
    expect(onPointerDown).toHaveBeenCalledWith('g1', expect.anything());
  });

  it('renders no proxy when not selected', () => {
    const c = render(
      <svg>
        <LabelView
          label={makeTextLabel({ id: 'g1' })}
          selected={false}
          layer="hit"
          onPointerDown={() => {}}
        />
      </svg>,
    ).container;
    expect(hit(c)).toBeNull();
  });

  it('renders no proxy when locked (a locked label is not draggable)', () => {
    expect(hit(renderHit(makeTextLabel({ id: 'g1', locked: true })))).toBeNull();
  });
});

describe('<LabelView /> — locked label hit group', () => {
  const renderInteractive = (label: TextLabel, inHandMode = false, selected = false) =>
    render(
      <svg>
        <LabelView
          label={label}
          selected={selected}
          onPointerDown={() => {}}
          inHandMode={inHandMode}
        />
      </svg>,
    );

  it('marks the group [data-locked] and uses the pointing-hand cursor when locked', () => {
    const { container } = renderInteractive(makeTextLabel({ id: 'g1', locked: true }));
    const g = container.querySelector('[data-text-label-id="g1"]') as HTMLElement;
    expect(g.getAttribute('data-locked')).toBe('true');
    expect(g.style.cursor).toBe('pointer');
  });

  it('a locked, unselected label ignores pointer events (clicks land on what is beneath)', () => {
    const { container } = renderInteractive(makeTextLabel({ id: 'g1', locked: true }));
    const g = container.querySelector('[data-text-label-id="g1"]') as HTMLElement;
    expect(g.getAttribute('pointer-events')).toBe('none');
  });

  it('a locked label stays clickable while selected (popover unlock stays reachable)', () => {
    const { container } = renderInteractive(makeTextLabel({ id: 'g1', locked: true }), false, true);
    const g = container.querySelector('[data-text-label-id="g1"]') as HTMLElement;
    expect(g.getAttribute('pointer-events')).toBeNull();
  });

  it('an unlocked, unselected label keeps its hit rect live', () => {
    const { container } = renderInteractive(makeTextLabel({ id: 'g1' }));
    const g = container.querySelector('[data-text-label-id="g1"]') as HTMLElement;
    expect(g.getAttribute('pointer-events')).toBeNull();
  });

  it('uses the four-arrow move cursor and omits data-locked when unlocked', () => {
    const { container } = renderInteractive(makeTextLabel({ id: 'g1' }));
    const g = container.querySelector('[data-text-label-id="g1"]') as HTMLElement;
    expect(g.getAttribute('data-locked')).toBeNull();
    expect(g.style.cursor).toBe('move');
  });

  it('uses the open hand in hand mode even when locked (pan wins)', () => {
    const { container } = renderInteractive(makeTextLabel({ id: 'g1', locked: true }), true);
    const g = container.querySelector('[data-text-label-id="g1"]') as HTMLElement;
    expect(g.style.cursor).toBe('grab');
  });
});
