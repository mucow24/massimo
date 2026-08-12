import { test, expect, type Page } from '@playwright/test';
import {
  seedAndOpen,
  fourInLine,
  fourInLineWithBullets,
  bulletCenter,
  stationCenter,
  type Seed,
} from './fixtures';

/**
 * Chrome the layout means to read on ONE line must actually fit on one line.
 *
 * Every case here broke when the UI took Söhne: the boxes were sized around
 * the strings as the old face set them, and a slightly wider face pushed each
 * one past its container — the sidebar tabs onto two rows, the style dropdowns
 * onto two or three. Nothing about that is visible to jsdom, which has no font
 * metrics at all, so these have to run in a real browser against the real
 * files in /public/fonts.
 *
 * Two different measurements, because the two failure modes are different and
 * a check for one is blind to the other:
 *
 * `lines()` counts distinct line boxes over the element's TEXT nodes — the
 * mode for anything that may wrap. Not the element's height: a wrapped control
 * grows its whole row, so a height check tells you the row got tall without
 * telling you which string broke.
 *
 * `shown()` returns what a one-line box actually renders. A control pinned to
 * `white-space: nowrap` can never fail a line count, so on the dropdowns —
 * which are pinned, deliberately — a line count is VACUOUS and only the
 * truncation test can go red. Sanity-check any edit here by putting
 * `.tab-bar .tab` back on `flex: 1` (equal thirds) or a `.style-row` label
 * back on its panel's fixed column width: the matching case must go red.
 */
const lines = (page: Page, selector: string, nth = 0) =>
  page.evaluate(
    ([sel, i]) => {
      const el = document.querySelectorAll(sel as string)[i as number];
      if (!el) throw new Error(`no element for ${sel}[${i}]`);
      const tops = new Set<number>();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walk.nextNode())) {
        if (!node.nodeValue?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0.5) tops.add(Math.round(r.top));
      }
      return tops.size;
    },
    [selector, nth] as const,
  );

/**
 * `{ text, whole }` for a select trigger's value: what it holds, and whether
 * the box is wide enough to render all of it. `whole: false` is the ellipsis.
 */
const shown = (page: Page, triggerSelector: string) =>
  page.evaluate((sel) => {
    const trigger = document.querySelector(sel);
    if (!trigger) throw new Error(`no trigger for ${sel}`);
    const span = Array.from(trigger.children).find((c) => c.tagName !== 'svg');
    if (!span) throw new Error(`no value span in ${sel}`);
    return {
      text: (span.textContent ?? '').trim(),
      whole: span.scrollWidth <= span.clientWidth,
      width: Math.round(trigger.getBoundingClientRect().width),
    };
  }, triggerSelector);

/**
 * The distinct left edges of a panel's controls, in panel coordinates. One
 * entry means every row starts its control at the same x — the aligned band
 * the label columns exist to produce. Numeric rows are excluded: their slider
 * fills the band while the spinbox sits at the far end, so a second edge there
 * says nothing about the column.
 */
const controlEdges = (page: Page, panelSelector: string) =>
  page.evaluate((sel) => {
    const panel = document.querySelector(sel);
    if (!panel) throw new Error(`no panel for ${sel}`);
    const base = panel.getBoundingClientRect().left;
    const edges = new Set<number>();
    for (const row of panel.querySelectorAll('.row')) {
      if (!row.querySelector('label')) continue;
      const control = row.querySelector(
        'button.field-select, .shape-group, .segmented-toggle, .layer-buttons, .daynight-pair',
      );
      if (!control) continue;
      edges.add(Math.round(control.getBoundingClientRect().left - base));
    }
    return [...edges].sort((a, b) => a - b);
  }, panelSelector);

/** A map with a three-digit station count, spread thin so it paints fast. */
function manyStations(n: number): Seed {
  const stations = [];
  for (let i = 0; i < n; i++) {
    stations.push({
      id: 'S' + i,
      name: 'Station ' + i,
      x: -600 + (i % 20) * 60,
      y: -300 + Math.floor(i / 20) * 60,
      stops: [{ lineId: 'L1', row: 0, col: 0 }],
    });
  }
  return {
    stations,
    lines: [
      {
        id: 'L1',
        service: 'L',
        color: '#0039A6',
        stations: stations.map((s) => s.id),
      },
    ],
  };
}

test.describe('sidebar tabs', () => {
  test('a three-digit station count stays on the tab’s own line', async ({ page }) => {
    await seedAndOpen(page, manyStations(489));
    await expect(page.getByRole('button', { name: 'Stations (489)' })).toBeVisible();
    // Equal thirds of the 320px panel leave "Stations (489)" ~3px short, so it
    // wrapped — and took the whole tab strip to two rows with it.
    expect(await lines(page, '.tab-bar .tab', 0)).toBe(1);
    expect(await lines(page, '.tab-bar .tab', 1)).toBe(1);
    expect(await lines(page, '.tab-bar .tab', 2)).toBe(1);
  });

  test('the tab strip stays inside the sidebar', async ({ page }) => {
    await seedAndOpen(page, manyStations(489));
    const fits = await page.evaluate(() => {
      const bar = document.querySelector('.tab-bar')!;
      const side = document.querySelector('.sidebar')!;
      return bar.getBoundingClientRect().right <= side.getBoundingClientRect().right + 0.5;
    });
    expect(fits).toBe(true);
  });
});

/**
 * The style dropdown's job is to name the item's style and say whether the
 * item has drifted from it. "<name> (edited)" is the longest thing it routinely
 * shows, and "Save style…" the longest thing it offers — both have to fit the
 * trigger the popover gives it, out of what the panel's label column leaves.
 * The narrow shells are where this bit: the polygon popover runs an 84px
 * column, which left the dropdown 42 of the shell's 248 pixels.
 *
 * The room comes from the SHELL, never from the column. A style row that
 * shrinks its own label buys the dropdown 25px and hands back a ragged left
 * edge — the dropdown starting somewhere no other control in the panel starts.
 * `alignment` below is the assertion that closes that door.
 */
test.describe('style row', () => {
  test('a route bullet’s style shows "Default (edited)" whole', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBullets);
    const b1 = await bulletCenter(page, 'b1');
    await page.mouse.click(b1.x, b1.y);
    await expect(page.locator('.bullet-popover')).toBeVisible();

    // The seeded bullet is 16px, which no factory style matches, so it loads
    // detached — tag it first, then diverge from the tag.
    const style = page.locator('.bullet-popover').getByRole('combobox', { name: 'Style' });
    await style.click();
    await page.getByRole('option', { name: 'Default', exact: true }).click();
    await expect(style).toHaveText('Default');
    // Size is a style-covered field: nudging it makes the item diverge, which
    // is what puts the "(edited)" marker on the trigger.
    const size = page.locator('.bullet-popover').getByRole('spinbutton', { name: 'Size' });
    await size.fill('19');
    await size.press('Enter');
    await expect(style).toHaveText('Default (edited)');
    expect(await lines(page, '.bullet-popover .style-row [role="combobox"]')).toBe(1);
    expect(await shown(page, '.bullet-popover .style-row [role="combobox"]')).toMatchObject({
      text: 'Default (edited)',
      whole: true,
    });
  });

  test('a polygon’s style shows "Default (edited)" whole', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
    await page.mouse.click(900, 300);
    await expect(page.locator('.polygon-popover')).toBeVisible();

    const style = page.locator('.polygon-popover').getByRole('combobox', { name: 'Style' });
    await expect(style).toHaveText(/^Default/);
    const strokeWidth = page
      .locator('.polygon-popover')
      .getByRole('spinbutton', { name: /Stroke width/i });
    await strokeWidth.fill('3');
    await strokeWidth.press('Enter');
    await expect(style).toHaveText('Default (edited)');
    expect(await lines(page, '.polygon-popover .style-row [role="combobox"]')).toBe(1);
    expect(await shown(page, '.polygon-popover .style-row [role="combobox"]')).toMatchObject({
      text: 'Default (edited)',
      whole: true,
    });
  });

  test('a transfer’s style shows "Default (edited)" whole', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    // A self-transfer on A's stop dot is the smallest thing that mounts this
    // popover; the factory style paints it at r = 1, far too small to aim a
    // click at, so the selection goes through the store the way popoverDock's
    // off-screen cases do.
    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);
    await page.getByRole('combobox', { name: /^Transfer \(line/ }).click();
    await page.getByRole('option', { name: 'Default' }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const s = await import('/src/state/store.ts');
      const id = Object.keys(s.useDoc.getState().transfers)[0];
      s.useSelection.getState().selectTransfer(id);
    });
    const pop = page.locator('.transfer-popover');
    await expect(pop).toBeVisible();

    const style = pop.getByRole('combobox', { name: 'Style' });
    await expect(style).toHaveText(/^Default/);
    const width = pop.getByRole('spinbutton', { name: /width/i }).first();
    await width.fill('6');
    await width.press('Enter');
    await expect(style).toHaveText('Default (edited)');
    expect(await lines(page, '.transfer-popover .style-row [role="combobox"]')).toBe(1);
    expect(await shown(page, '.transfer-popover .style-row [role="combobox"]')).toMatchObject({
      text: 'Default (edited)',
      whole: true,
    });
  });

  /**
   * "Save style…" is the widest entry the dropdown itself offers, so a trigger
   * that cannot show its own longest option is under-sized by definition. The
   * ellipsis fallback below keeps a user's own long style name from ever
   * wrapping the control, but the app's own strings must not need it.
   */
  test('every style trigger can show its own longest option', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
    await page.mouse.click(900, 300);
    await expect(page.locator('.polygon-popover')).toBeVisible();

    const truncated = await page.evaluate(() => {
      const trigger = document.querySelector('.polygon-popover .style-row [role="combobox"]')!;
      const span = Array.from(trigger.children).find((c) => c.tagName !== 'svg')!;
      const original = span.textContent;
      const bad: string[] = [];
      for (const s of ['Custom', 'Default', 'Default (edited)', 'Save style…']) {
        span.textContent = s;
        if (span.scrollWidth > span.clientWidth) bad.push(s);
      }
      span.textContent = original;
      return bad;
    });
    expect(truncated).toEqual([]);
  });

  /**
   * The style row is a row like the others: its dropdown starts where every
   * other control in the panel starts. Widening the shell is the only way to
   * pay for that — narrowing the row's own label pulls its dropdown left of
   * the band and leaves the panel with a ragged edge.
   */
  test('the style dropdown starts on the panel’s control band', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBullets);
    const b1 = await bulletCenter(page, 'b1');
    await page.mouse.click(b1.x, b1.y);
    await expect(page.locator('.bullet-popover')).toBeVisible();
    // Line, Style, and Shape all start at one x — a second edge is the defect.
    expect(await controlEdges(page, '.bullet-popover')).toHaveLength(1);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
    await page.mouse.click(560, 400);
    await expect(page.locator('.polygon-popover')).toBeVisible();
    expect(await controlEdges(page, '.polygon-popover')).toHaveLength(1);
  });

  /**
   * A style name is user-authored and unbounded, so no width settles it: the
   * control must degrade to an ellipsis rather than grow a second line and
   * shove the rest of the panel down.
   */
  test('an over-long style name ellipsises instead of wrapping', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
    await page.mouse.click(900, 300);
    await expect(page.locator('.polygon-popover')).toBeVisible();

    const result = await page.evaluate(() => {
      const trigger = document.querySelector('.polygon-popover .style-row [role="combobox"]')!;
      const span = Array.from(trigger.children).find((c) => c.tagName !== 'svg')! as HTMLElement;
      const before = trigger.getBoundingClientRect().height;
      span.textContent = 'Waterfront esplanade boundary, dashed variant';
      const after = trigger.getBoundingClientRect().height;
      const ellipsised = span.scrollWidth > span.clientWidth + 1;
      return { before, after, ellipsised, overflow: getComputedStyle(span).textOverflow };
    });
    expect(result.after).toBe(result.before);
    expect(result.ellipsised).toBe(true);
    expect(result.overflow).toBe('ellipsis');
  });
});
