import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { LabelView } from './LabelView';
import { useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC, updateTextLabel } from '../model/transforms';
import { makeTextLabel } from '../test/fixtures';
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

describe('<LabelView /> — selection ring', () => {
  afterEach(() => useViewportStore.setState({ zoom: 1 }));

  const ringRect = () =>
    render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: 'Hi' })} selected layer="stroke" />
      </svg>,
    ).container.querySelector('[data-text-label-stroke] rect')!;

  it('renders the documented weight at zoom 1', () => {
    const r = ringRect();
    expect(Number(r.getAttribute('stroke-width'))).toBe(2);
    expect(r.getAttribute('stroke-dasharray')).toBe('4 3');
  });

  // Constant SCREEN weight across zoom (1/zoom idiom) — matches the polygon
  // and svg-image selection chrome so mixed selections read as one language.
  it('divides stroke and dash by zoom', () => {
    useViewportStore.setState({ zoom: 2 });
    const r = ringRect();
    expect(Number(r.getAttribute('stroke-width'))).toBe(1);
    expect(r.getAttribute('stroke-dasharray')).toBe('2 1.5');
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
  it('renders an inline bullet with the line color when text contains <CODE>', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: seedLine({ id: 'L1', service: 'A1', color: '#00ff00' }) },
      lineOrder: ['L1'],
    });
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: '<A1>' })} selected={false} />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    expect(bullets[0].getAttribute('data-inline-bullet')).toBe('A1');
    const circle = bullets[0].querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#00ff00');
  });

  it('renders a gray "?" bullet when the code does not match any line', () => {
    const { container } = render(
      <svg>
        <LabelView label={makeTextLabel({ id: 'g1', text: '<NOPE>' })} selected={false} />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    const circle = bullets[0].querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#888');
    expect(bullets[0].querySelector('text')?.textContent).toBe('?');
  });

  it('renders no bullet when text has no <...> tokens', () => {
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
        <LabelView label={makeTextLabel({ id: 'g1', text: 'Take <A1> uptown' })} selected={false} />
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
  const renderInteractive = (label: TextLabel, inHandMode = false) =>
    render(
      <svg>
        <LabelView
          label={label}
          selected={false}
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
