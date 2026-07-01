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

  // The line-highlight dim: softened in light mode so the rest of the map
  // stays readable as context; the black canvas keeps the stronger wash (it
  // needs it to mute colored lines). dimmedLabel is the "addable station"
  // name color painted above the dim in append mode — tuned per dim strength.
  it('defines the line-highlight dim per mode, softer in light', () => {
    expect(themeColors(false).dim).toBe('#000000');
    expect(themeColors(false).dimOpacity).toBe(0.55);
    expect(themeColors(true).dim).toBe('#000000');
    expect(themeColors(true).dimOpacity).toBe(0.75);
    expect(themeColors(false).dimmedLabel).toBe('#eeeeee');
    expect(themeColors(true).dimmedLabel).toBe('#bbbbbb');
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
  });
});
