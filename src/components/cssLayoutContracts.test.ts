import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SIDEBAR_WIDTH } from './sidebarLayout';
import { PALETTE_EDITOR_ROW_HEIGHT } from './PaletteEditor';
import { PALETTE_ROW_HEIGHT } from './PalettesDialog';

// A handful of layout numbers are stated TWICE: once in styles.css, which is
// what actually sizes the box, and once in TypeScript, which does arithmetic
// against that size. Each of the three below says so in its own docstring —
// "matches `.sidebar` in styles.css", "pinned in CSS", "CSS pins it" — and
// nothing enforced the claim, because the tests that exercise the arithmetic
// feed it the TS constant and so agree with themselves whatever the stylesheet
// says. Drift is silent and visual: the popover dock and the snap-label clamp
// subtract a strip the sidebar no longer occupies, and a row-reorder drag
// divides by a height the rows no longer have, so the preview lands a row out.
//
// Pinned the way styles.css is already pinned elsewhere (the @font-face ladder
// in textMeasure.cache.test.ts, FONT_TABLE in export/fonts.test.ts): read the
// stylesheet, parse the one declaration, compare. Grouped in one file rather
// than three copies of the same six lines — this is one contract with three
// members, and the next number to join it has an obvious home.
const css = readFileSync('src/styles.css', 'utf8');

/** The px value of `prop` in the FIRST `selector { … }` block, or null. */
function cssPx(selector: string, prop: 'width' | 'height'): number | null {
  const rule = new RegExp(`^\\${selector}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!rule) return null;
  const decl = new RegExp(`(?:^|;)\\s*${prop}:\\s*(\\d+(?:\\.\\d+)?)px\\s*(?:;|$)`, 'm').exec(
    rule[1],
  );
  return decl ? Number(decl[1]) : null;
}

describe('layout numbers TypeScript restates from styles.css', () => {
  const contracts: readonly [string, string, 'width' | 'height', number][] = [
    ['SIDEBAR_WIDTH', '.sidebar', 'width', SIDEBAR_WIDTH],
    ['PALETTE_EDITOR_ROW_HEIGHT', '.palette-editor-row', 'height', PALETTE_EDITOR_ROW_HEIGHT],
    ['PALETTE_ROW_HEIGHT', '.palette-row', 'height', PALETTE_ROW_HEIGHT],
  ];

  it.each(contracts)('%s equals %s { %s }', (_name, selector, prop, value) => {
    expect(cssPx(selector, prop)).toBe(value);
  });

  // The parse is the load-bearing half: a selector that stopped matching (a
  // rename, a rule split in two) would read `null` and, compared loosely,
  // could pass as "no disagreement". It reads a number or the contract above
  // is not being checked at all.
  it('actually found a number for every contract', () => {
    expect(contracts.map(([, sel, prop]) => cssPx(sel, prop))).toEqual(
      contracts.map(([, , , value]) => value),
    );
  });
});
