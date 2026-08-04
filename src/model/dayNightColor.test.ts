import { describe, expect, it } from 'vitest';
import { dayNightColorsEqual, resolveDayNight } from './dayNightColor';

describe('resolveDayNight', () => {
  it('picks the day half in light mode and the night half in dark mode', () => {
    const c = { day: '#111111', night: '#eeeeee' };
    expect(resolveDayNight(c, false)).toBe('#111111');
    expect(resolveDayNight(c, true)).toBe('#eeeeee');
  });

  it('returns the exact stored string, unnormalized', () => {
    const c = { day: 'RED', night: 'rgba(0,0,0,0.5)' };
    expect(resolveDayNight(c, false)).toBe('RED');
    expect(resolveDayNight(c, true)).toBe('rgba(0,0,0,0.5)');
  });
});

describe('dayNightColorsEqual', () => {
  it('is true only when BOTH halves match', () => {
    expect(
      dayNightColorsEqual({ day: '#000', night: '#fff' }, { day: '#000', night: '#fff' }),
    ).toBe(true);
    // day differs
    expect(
      dayNightColorsEqual({ day: '#000', night: '#fff' }, { day: '#001', night: '#fff' }),
    ).toBe(false);
    // night differs — the trap a plain `a.day === b.day` would miss
    expect(
      dayNightColorsEqual({ day: '#000', night: '#fff' }, { day: '#000', night: '#eee' }),
    ).toBe(false);
  });

  it('compares exactly, without normalizing casing', () => {
    expect(
      dayNightColorsEqual({ day: '#ABC', night: '#DEF' }, { day: '#abc', night: '#def' }),
    ).toBe(false);
  });
});
