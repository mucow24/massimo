import { describe, it, expect } from 'vitest';
import { justifyLine } from './labelJustify';
import { emptyStyleState, inlineBulletDiameter } from './labelTokens';

// Deterministic advance: every glyph is 10 wide. Space runs measure by length
// too, matching how the real measurer treats whitespace advance.
const CHAR = 10;
const adv = (s: string) => s.length * CHAR;

describe('justifyLine', () => {
  it('distributes slack evenly across interior gaps and flushes both edges', () => {
    // 'aa bb cc' ink = 8 glyphs = 80. Target 100 → slack 20 over 2 gaps = 10 each.
    const atoms = justifyLine('aa bb cc', 10, 80, 100, adv);
    expect(atoms).not.toBeNull();
    expect(atoms!.map((a) => ({ kind: a.kind, value: a.value, x: a.x }))).toEqual([
      { kind: 'text', value: 'aa', x: 0 },
      { kind: 'text', value: 'bb', x: 40 }, // 20 (aa) + 10 (space) + 10 (extra)
      { kind: 'text', value: 'cc', x: 80 }, // + 20 (bb) + 10 (space) + 10 (extra)
    ]);
    // Last word right pen edge = 80 + adv('cc') = 100 = targetWidth → flush right.
    const last = atoms![atoms!.length - 1];
    expect(last.x + adv(last.value!)).toBe(100);
  });

  it('places an inline bullet as its own atom and keeps the line flush', () => {
    const d = inlineBulletDiameter(10); // 9
    const ink = adv('aa') + adv(' ') + d + adv(' ') + adv('bb'); // 20+10+9+10+20 = 69
    const atoms = justifyLine('aa |A1| bb', 10, ink, ink + 20, adv); // slack 20, 2 gaps
    expect(atoms).not.toBeNull();
    expect(atoms!.map((a) => a.kind)).toEqual(['text', 'bullet', 'text']);
    const bullet = atoms!.find((a) => a.kind === 'bullet')!;
    expect(bullet.code).toBe('A1');
    expect(bullet.shape).toBe('circle');
    expect(bullet.filled).toBe(true);
    expect(bullet.diameter).toBe(d);
    // aa(0) + 20 + space10 + extra10 = 40
    expect(bullet.x).toBe(40);
  });

  it('returns null when the line has no interior gap (single word)', () => {
    expect(justifyLine('aaaa', 10, 40, 100, adv)).toBeNull();
  });

  it('returns null when the ink already meets or exceeds the target (no slack)', () => {
    expect(justifyLine('aa bb', 10, 50, 40, adv)).toBeNull();
    expect(justifyLine('aa bb', 10, 50, 50, adv)).toBeNull();
  });

  it('parses formatting tags and attaches styles when given an entry state', () => {
    // '<b>aa</b> bb cc': ink = 8 glyphs + 2 spaces = 80. Target 100 → 10/gap.
    const atoms = justifyLine('<b>aa</b> bb cc', 10, 80, 100, adv, emptyStyleState());
    expect(atoms).not.toBeNull();
    expect(atoms!.map((a) => ({ value: a.value, x: a.x }))).toEqual([
      { value: 'aa', x: 0 },
      { value: 'bb', x: 40 },
      { value: 'cc', x: 80 },
    ]);
    expect(atoms![0].style).toMatchObject({ bold: true });
    expect(atoms![1].style).toBeUndefined();
  });

  it('carries an open tag from the entry state across the whole line', () => {
    const entry = { ...emptyStyleState(), italic: 1 };
    const atoms = justifyLine('aa bb', 10, 50, 90, adv, entry);
    expect(atoms).not.toBeNull();
    expect(atoms![0].style).toMatchObject({ italic: true });
    expect(atoms![1].style).toMatchObject({ italic: true });
  });

  it('leaves tags literal without an entry state (station grammar)', () => {
    const atoms = justifyLine('<b>aa</b> bb cc', 10, 80, 100, adv);
    expect(atoms).not.toBeNull();
    expect(atoms![0]).toMatchObject({ value: '<b>aa</b>', x: 0 });
    expect(atoms![0].style).toBeUndefined();
  });

  it('does not stretch leading/trailing whitespace (only interior gaps)', () => {
    // '  aa bb  ' — one interior gap. Leading/trailing spaces advance the cursor
    // but receive no extra slack.
    const atoms = justifyLine('  aa bb  ', 10, 50, 90, adv); // slack 40 over 1 gap
    expect(atoms).not.toBeNull();
    const [a0, a1] = atoms!;
    expect(a0).toMatchObject({ value: 'aa', x: 20 }); // 2 leading spaces * 10
    // aa(20) + adv('aa')=20 → 40, + space10 + extra40 = 90 → bb at 90
    expect(a1).toMatchObject({ value: 'bb', x: 90 });
  });
});
