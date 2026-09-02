import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { themeColors } from './theme';
import { CANVAS_COLORS, DEFAULT_CANVAS_COLOR } from './viewportStore';

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

  // "Canvas color" is a local viewing preference (see useViewportStore): the
  // paper can be pinned light, gray or dark whatever mode the map is in, WITHOUT
  // flipping the mode — the mode's ink, underlay and editor all stay put. 'auto'
  // is the mode's own paper.
  describe('canvas color', () => {
    it("'auto' is each mode's own paper (the default)", () => {
      expect(themeColors(false, 'auto')).toBe(themeColors(false));
      expect(themeColors(true, 'auto')).toBe(themeColors(true));
      expect(themeColors(false).canvasBg).toBe('#fafafa');
      expect(themeColors(true).canvasBg).toBe('#000000');
    });

    it("'light' in day mode and 'dark' in night mode are the untinted palettes", () => {
      expect(themeColors(false, 'light')).toBe(themeColors(false));
      expect(themeColors(true, 'dark')).toBe(themeColors(true));
    });

    it("day mode 'dark' dims only the paper, keeping the rest of the day palette", () => {
      const c = themeColors(false, 'dark');
      expect(c.canvasBg).toBe('#000000');
      // Day-dark and night paint the SAME canvas. That shared premise is what
      // lets this entry borrow DARK's grid below, so pin it here: retune one
      // side alone and the borrowed grid is tuned for a paper it no longer has.
      expect(c.canvasBg).toBe(themeColors(true).canvasBg);
      // The ink stays day mode — this is glare relief, not night mode.
      expect(c.label).toBe('#111111');
      expect(c.underlay).toBe('#ffffff');
      expect(c.editorBg).toBe('#ffffff');
      expect(c.accent).toBe('#1a4ea8');
    });

    it("night mode 'light' lifts only the paper, keeping the rest of the night palette", () => {
      const c = themeColors(true, 'light');
      expect(c.canvasBg).toBe(themeColors(false).canvasBg);
      expect(c.label).toBe('#ffffff');
      expect(c.underlay).toBe('#000000');
      expect(c.editorBg).toBe('#000000');
      expect(c.accent).toBe('#6b9aff');
    });

    it("'gray' sits between light and dark in both modes, moving only the paper", () => {
      const day = themeColors(false, 'gray');
      expect(day.canvasBg).toBe('#616161');
      expect(day.label).toBe('#111111');
      expect(day.underlay).toBe('#ffffff');
      expect(day.editorBg).toBe('#ffffff');
      const night = themeColors(true, 'gray');
      expect(night.canvasBg).toBe('#616161');
      expect(night.label).toBe('#ffffff');
      expect(night.underlay).toBe('#000000');
      expect(night.editorBg).toBe('#000000');
    });

    it('a pinned paper takes the grid tuned for THAT paper, not for the mode', () => {
      // The day grid (#eeeeee) is tuned against near-white paper; on a dimmed
      // paper it jumps out as bright white lines. Gray drops to Grey 800, one
      // rung below its Grey 700 paper; a dark paper takes the night grid and a
      // light one the day grid — same paper, so the value already tuned for it
      // is the right one.
      expect(themeColors(false, 'gray').grid).toBe('#424242');
      expect(themeColors(true, 'gray').grid).toBe('#424242');
      expect(themeColors(false, 'dark').grid).toBe(themeColors(true).grid);
      expect(themeColors(false, 'dark').grid).toBe('#222222');
      expect(themeColors(true, 'light').grid).toBe(themeColors(false).grid);
      expect(themeColors(true, 'light').grid).toBe('#eeeeee');
    });

    it('returns a stable reference per (mode, canvas color) pair', () => {
      expect(themeColors(false, 'dark')).toBe(themeColors(false, 'dark'));
      expect(themeColors(false, 'gray')).toBe(themeColors(false, 'gray'));
      expect(themeColors(true, 'light')).toBe(themeColors(true, 'light'));
      expect(themeColors(true, 'gray')).toBe(themeColors(true, 'gray'));
    });

    // The store heals a stored non-member on the way in (see viewportStore's
    // merge), so nothing in the app should ever hand one over. This is the
    // second net: a table MISS must degrade to the mode's plain palette rather
    // than return undefined and take every canvas consumer down with it.
    it("degrades an unknown paper to the mode's plain palette", () => {
      const rogue = 'chartreuse' as unknown as Parameters<typeof themeColors>[1];
      expect(themeColors(false, rogue)).toBe(themeColors(false));
      expect(themeColors(true, rogue)).toBe(themeColors(true));
    });

    it('paints a paper for every rung of the ladder in both modes — no rung falls to that net', () => {
      for (const darkMode of [false, true]) {
        const plain = themeColors(darkMode);
        for (const color of CANVAS_COLORS) {
          const c = themeColors(darkMode, color);
          // 'auto' and the mode's own paper ARE the plain palette; every other
          // rung must paint something else. A rung the paper table forgot lands
          // on the same net the rogue value above does — a menu row that paints
          // nothing.
          const isOwn = color === (darkMode ? 'dark' : 'light');
          if (color === DEFAULT_CANVAS_COLOR || isOwn) expect(c).toBe(plain);
          else expect(c).not.toBe(plain);
        }
      }
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

    it('the day casing holds across the pinned papers, like the guide color', () => {
      // alignGuide is one day value across light/gray/dark; the casing follows
      // suit — a fixed translucent rail rather than melting into each paper.
      for (const paper of ['light', 'gray', 'dark'] as const) {
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
  // real: a "Dark" chrome darkens the toolbar over a light map, and a gray or
  // dark paper darkens the map under a light chrome.
  it('says whether the PAPER is dark — per paper, not per mode', () => {
    expect(themeColors(false).darkPaper).toBe(false);
    expect(themeColors(false, 'light').darkPaper).toBe(false);
    // Grey 700 is dark enough that day-mode ink at well opacity vanishes on it.
    expect(themeColors(false, 'gray').darkPaper).toBe(true);
    expect(themeColors(false, 'dark').darkPaper).toBe(true);
    expect(themeColors(true).darkPaper).toBe(true);
    expect(themeColors(true, 'gray').darkPaper).toBe(true);
    // A light paper under a night map is a light paper: the wells read day ink.
    expect(themeColors(true, 'light').darkPaper).toBe(false);
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
