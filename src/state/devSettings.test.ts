import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_GUIDE_RENDER,
  dashPeriod,
  isGaplessDash,
  parseDashPattern,
  useDevSettings,
} from './devSettings';

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

  it('takes a caller-supplied fallback — what lets the casing borrow the core', () => {
    // The casing hands in the core's parsed pattern, so clearing its field to
    // retype leaves the two registered instead of snapping to the default 10 2
    // the core may not be wearing.
    expect(parseDashPattern('', [9, 3])).toEqual([9, 3]);
    expect(parseDashPattern('0 0', [9, 3])).toEqual([9, 3]);
    // Usable text still wins over the fallback.
    expect(parseDashPattern('6 1', [9, 3])).toEqual([6, 1]);
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

describe('isGaplessDash', () => {
  it('is true when every gap is zero — the pattern draws unbroken', () => {
    expect(isGaplessDash([1, 0])).toBe(true);
    expect(isGaplessDash([4, 0])).toBe(true);
    expect(isGaplessDash([9, 0, 3, 0])).toBe(true);
  });

  it('is false for any real gap', () => {
    expect(isGaplessDash([10, 2])).toBe(false);
    expect(isGaplessDash([9, 0, 3, 1])).toBe(false);
  });

  it('is false for an ODD-length list — SVG doubles it, so the dashes become gaps', () => {
    // "4" runs 4 on, 4 off: it reads gapless as written but draws dashed.
    expect(isGaplessDash([4])).toBe(false);
    expect(isGaplessDash([5, 2, 1])).toBe(false);
  });
});

describe('useDevSettings — rehydrating a stored recipe', () => {
  afterEach(() => localStorage.clear());

  // The dials come and go, so a stored recipe is routinely a dial or two behind
  // the code reading it. zustand's default merge is shallow over TOP-LEVEL keys,
  // which would hand `guide` over wholesale — and a recipe stored before the
  // casing dials existed then reaches the ink math as `undefined`, where
  // `parseDashPattern` throws on `.trim()` and takes the canvas down with it.
  // The store's own `merge` hook is the only thing standing between the two.
  const store = (guide: Record<string, unknown>) =>
    localStorage.setItem('massimo-dev-settings', JSON.stringify({ state: { guide }, version: 0 }));

  it('keeps the dials a stored recipe carries', async () => {
    store({ dash: '4 4', thickness: 3 });
    await useDevSettings.persist.rehydrate();
    expect(useDevSettings.getState().guide.dash).toBe('4 4');
    expect(useDevSettings.getState().guide.thickness).toBe(3);
  });

  it('fills the dials it predates from the defaults, never with undefined', async () => {
    store({ dash: '4 4', thickness: 3 });
    await useDevSettings.persist.rehydrate();
    // Every dial the stored blob is missing comes back as the recipe's own
    // default — the whole shape, so a dial added tomorrow is covered too.
    expect(useDevSettings.getState().guide).toEqual({
      ...DEFAULT_GUIDE_RENDER,
      dash: '4 4',
      thickness: 3,
    });
  });

  it('leaves the dash parser something to read after a pre-casing recipe loads', async () => {
    store({ dash: '4 4' });
    await useDevSettings.persist.rehydrate();
    const { casingDash } = useDevSettings.getState().guide;
    // The call GuideView makes on every mount. Without the merge hook this is
    // parseDashPattern(undefined) — a TypeError, not a fallback.
    expect(() => parseDashPattern(casingDash)).not.toThrow();
    expect(parseDashPattern(casingDash)).toEqual([1, 0]);
  });

  it('survives a stored blob with no recipe in it at all', async () => {
    localStorage.setItem('massimo-dev-settings', JSON.stringify({ state: {}, version: 0 }));
    await useDevSettings.persist.rehydrate();
    expect(useDevSettings.getState().guide).toEqual(DEFAULT_GUIDE_RENDER);
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
