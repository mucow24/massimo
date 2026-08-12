import { describe, it, expect, afterEach } from 'vitest';
import { DEFAULT_GUIDE_RENDER, dashPeriod, parseDashPattern, useDevSettings } from './devSettings';

afterEach(() => {
  useDevSettings.getState().resetGuide();
});

describe('parseDashPattern', () => {
  it('reads a space- or comma-separated list of lengths', () => {
    expect(parseDashPattern('5 2')).toEqual([5, 2]);
    expect(parseDashPattern(' 9,3 , 1,3 ')).toEqual([9, 3, 1, 3]);
    expect(parseDashPattern('4')).toEqual([4]);
  });

  it('falls back to the default while the text is unusable', () => {
    // The field holds whatever is typed, and half of "5 2" is not a pattern —
    // mid-edit junk must not blank the guides off the canvas.
    const fallback = parseDashPattern(DEFAULT_GUIDE_RENDER.dash);
    expect(parseDashPattern('')).toEqual(fallback);
    expect(parseDashPattern('5 x')).toEqual(fallback);
    expect(parseDashPattern('5 -2')).toEqual(fallback);
    // All-zero draws nothing at all, which reads as a bug rather than a dial.
    expect(parseDashPattern('0 0')).toEqual(fallback);
  });
});

describe('dashPeriod', () => {
  it('sums an even-length pattern', () => {
    expect(dashPeriod([5, 2])).toBe(7);
    expect(dashPeriod([9, 3, 1, 3])).toBe(16);
  });

  it('doubles an odd-length one — SVG runs the list twice before it repeats', () => {
    expect(dashPeriod([4])).toBe(8);
    expect(dashPeriod([5, 2, 1])).toBe(16);
  });
});

describe('useDevSettings', () => {
  it('patches one dial at a time and resets the whole recipe', () => {
    const { setGuide } = useDevSettings.getState();
    setGuide({ thickness: 4 });
    setGuide({ color: '#ff00ff' });
    expect(useDevSettings.getState().guide.thickness).toBe(4);
    expect(useDevSettings.getState().guide.color).toBe('#ff00ff');
    // Untouched dials keep their values through a patch.
    expect(useDevSettings.getState().guide.dash).toBe(DEFAULT_GUIDE_RENDER.dash);

    useDevSettings.getState().resetGuide();
    expect(useDevSettings.getState().guide).toEqual(DEFAULT_GUIDE_RENDER);
  });
});
