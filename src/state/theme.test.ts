import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { themeColors } from './theme';

describe('themeColors', () => {
  it('light mode: near-white canvas, dark labels, white underlay', () => {
    const c = themeColors(false);
    expect(c.canvasBg).toBe('#fafafa');
    expect(c.label).toBe('#111111');
    expect(c.underlay).toBe('#ffffff');
    expect(c.editorBg).toBe('#ffffff');
  });

  it('dark mode: black canvas, white labels, black underlay (gaps read as empty canvas)', () => {
    const c = themeColors(true);
    expect(c.canvasBg).toBe('#000000');
    expect(c.label).toBe('#ffffff');
    expect(c.underlay).toBe('#000000');
    expect(c.editorBg).toBe('#000000');
  });

  it('returns a stable reference per mode (cheap to use as a memo input)', () => {
    expect(themeColors(true)).toBe(themeColors(true));
    expect(themeColors(false)).toBe(themeColors(false));
  });

  // "Day canvas color" is a local viewing preference (see useViewportStore):
  // in day mode the big bright paper can be dimmed (gray or black) to cut glare,
  // WITHOUT flipping to night mode — day-mode ink, grid, underlay and editor all
  // stay put.
  describe('day canvas color', () => {
    it("day mode 'white' is the untinted day palette (the default)", () => {
      expect(themeColors(false, 'white')).toBe(themeColors(false));
      expect(themeColors(false, 'white').canvasBg).toBe('#fafafa');
    });

    it("day mode 'black' dims only the paper, keeping the rest of the day palette", () => {
      const c = themeColors(false, 'black');
      expect(c.canvasBg).toBe('#000000');
      // Day-black and night paint the SAME canvas. That shared premise is what
      // lets this entry borrow DARK's grid below, so pin it here: retune one
      // side alone and the borrowed grid is tuned for a paper it no longer has.
      expect(c.canvasBg).toBe(themeColors(true).canvasBg);
      // The ink stays day mode — this is glare relief, not night mode.
      expect(c.label).toBe('#111111');
      expect(c.underlay).toBe('#ffffff');
      expect(c.editorBg).toBe('#ffffff');
      expect(c.accent).toBe('#1a4ea8');
    });

    it("day mode 'gray' sits between white and black, dimming only the paper", () => {
      const c = themeColors(false, 'gray');
      expect(c.canvasBg).toBe('#616161');
      // The rest of the day palette holds.
      expect(c.label).toBe('#111111');
      expect(c.underlay).toBe('#ffffff');
      expect(c.editorBg).toBe('#ffffff');
    });

    it('the dimmed papers darken the grid so it stays wallpaper, not a white cage', () => {
      // The day grid (#eeeeee) is tuned against near-white paper; on a dimmed
      // paper it jumps out as bright white lines. Gray drops to Grey 800, one
      // rung below its Grey 700 paper; black takes the night grid outright —
      // same paper, so the value already tuned for it is the right one.
      expect(themeColors(false, 'gray').grid).toBe('#424242');
      expect(themeColors(false, 'black').grid).toBe(themeColors(true).grid);
      expect(themeColors(false, 'black').grid).toBe('#222222');
    });

    it('night mode ignores the day canvas color', () => {
      expect(themeColors(true, 'black')).toBe(themeColors(true));
      expect(themeColors(true, 'white')).toBe(themeColors(true));
      expect(themeColors(true, 'black').canvasBg).toBe('#000000');
    });

    it('returns a stable reference per (mode, day color) pair', () => {
      expect(themeColors(false, 'black')).toBe(themeColors(false, 'black'));
      expect(themeColors(false, 'gray')).toBe(themeColors(false, 'gray'));
    });
  });

  // The alignment guides' COLORS live in the palette (their geometry — dashes,
  // widths, the zoom curve — is in useDevSettings). Day gets a saturated blue
  // over a translucent near-white casing that reads as a rail across band art;
  // night keeps the lifted periwinkle and a black casing that melts into the
  // black paper, unchanged.
  describe('alignment guide colors', () => {
    it('day: a blue guide over a translucent near-white casing', () => {
      const c = themeColors(false);
      expect(c.alignGuide).toBe('#0067ff');
      expect(c.alignGuideCasing).toBe('#fafafab5');
    });

    it('night is left on its own values', () => {
      const c = themeColors(true);
      expect(c.alignGuide).toBe('#8c9cf2');
      expect(c.alignGuideCasing).toBe('#000000');
    });

    it('the day casing holds across the dimmed papers, like the guide color', () => {
      // alignGuide is one day value across white/gray/black; the casing follows
      // suit — a fixed translucent rail rather than melting into each paper.
      for (const paper of ['white', 'gray', 'black'] as const) {
        expect(themeColors(false, paper).alignGuide).toBe('#0067ff');
        expect(themeColors(false, paper).alignGuideCasing).toBe('#fafafab5');
      }
    });
  });

  // The editor's interaction accent (marquee, drop targets, mode frames) lives
  // in the palette so both modes define it in one place. Light keeps the
  // original editing blue; dark must be a brighter variant — the light blue is
  // near-invisible on the pure-black canvas.
  it('defines an interaction accent per mode, brighter in dark', () => {
    const light = themeColors(false);
    const dark = themeColors(true);
    expect(light.accent).toBe('#1a4ea8');
    expect(light.accentWash).toBe('rgba(26, 78, 168, 0.08)');
    expect(dark.accent).toBe('#6b9aff');
    expect(dark.accentWash).toBe('rgba(107, 154, 255, 0.12)');
  });

  // The focus dim (line-highlight + station-layout edit): one standardized
  // strength across both themes — a softer light-mode wash was tried and
  // disliked. dimmedLabel is the "addable station" name color painted above
  // the dim in append mode, still tuned per theme against that dim.
  it('defines a single standardized dim strength for both modes', () => {
    expect(themeColors(false).dim).toBe('#000000');
    expect(themeColors(false).dimOpacity).toBe(0.7);
    expect(themeColors(true).dim).toBe('#000000');
    expect(themeColors(true).dimOpacity).toBe(0.7);
    expect(themeColors(false).dimmedLabel).toBe('#eeeeee');
    expect(themeColors(true).dimmedLabel).toBe('#bbbbbb');
  });

  // The guide wells are HTML chrome sitting ON the paper, so they are themed in
  // CSS and have to read against the paper rather than against the toolbar. The
  // palette answers that one question for them, because BOTH mismatches are
  // real: "Dark UI in day" darkens the chrome over a light map, and the
  // gray/black day papers darken the map under a light chrome.
  it('says whether the PAPER is dark — per paper, not per mode', () => {
    expect(themeColors(false).darkPaper).toBe(false);
    expect(themeColors(false, 'white').darkPaper).toBe(false);
    // Grey 700 is dark enough that day-mode ink at well opacity vanishes on it.
    expect(themeColors(false, 'gray').darkPaper).toBe(true);
    expect(themeColors(false, 'black').darkPaper).toBe(true);
    expect(themeColors(true).darkPaper).toBe(true);
  });

  // The chrome side duplicates the accent as the --accent CSS variable
  // (styles.css declares it on .app and reassigns it for dark). The two copies
  // can't share code — CSS variables don't reach SVG attribute paint — so this
  // test is what actually enforces the "keep in sync" comments.
  it('styles.css --accent declarations match the palette in both modes', () => {
    // Read as text from disk (vitest stubs CSS imports, even with ?raw);
    // vitest's cwd is the project root.
    const css = readFileSync('src/styles.css', 'utf8');
    const values = [...css.matchAll(/--accent:\s*([^;]+);/g)].map((m) => m[1].trim());
    // Order in the file: light block on .app, then the dark reassignment.
    expect(values).toEqual([themeColors(false).accent, themeColors(true).accent]);
    // The guide wells hold a THIRD copy: they key off the paper rather than the
    // chrome (see darkPaper), so they can't read --accent — but their hover
    // wash is the same interaction blue and must stay the same blue. Note this
    // pins the PAIR, not which one is live: on a dimmed day paper the wells use
    // the night blue while the marquee beside them is still on the day one,
    // because the dimmed papers keep day ink by design.
    const wells = [...css.matchAll(/--well-accent:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(wells).toEqual([themeColors(false).accent, themeColors(true).accent]);
  });
});
