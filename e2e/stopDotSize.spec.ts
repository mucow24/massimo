import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, fourInLine, openLineStyleDetail } from './fixtures';

// ACCEPTANCE SPEC for stop dot sizes — written red-first (double-loop TDD)
// with `test.fail()` annotations that were removed once the feature landed.
//
// The dot size is the dot's DIAMETER in px; rendering halves it into the SVG
// `r`. The global default is diameter 8 (STOP_DOT_RADIUS pinned to 4 — was
// 3.92). Sizes follow the dot-TYPE override semantics: a per-stop value is
// stored only while it differs from the line's effective default; changing
// the line default absorbs any override equal to the NEW default, so those
// stops track it from then on.
//
// Locator notes: codeless dots carry the data attrs on the shape element
// itself; service-code dots carry them on a wrapping <g> whose child
// <circle> has the radius. While a line is selected, HighlightedLineLayer
// re-renders its dots on top with the SAME data attrs, so a stop can match
// twice — `expectDotR` asserts on every match, which doubles as the check
// that the highlight copy is size-threaded like the base render.
// Assertions use the `r` attribute (not toBeVisible) so size 0 stays
// assertable. The line default is split into "Singleton dot size" /
// "Interchange dot size"; the per-stop control is "Stop dot size". These
// share the "dot size" substring, so role lookups use exact: true. The
// fourInLine fixture's stations are single-line (singletons), so the tests
// drive the SINGLETON line default — except the last describe, which declares
// a station an interchange to reach the other half of the split.

const DOT = (page: Page, stationId: string, lineId: string) =>
  page.locator(`[data-stop-station="${stationId}"][data-stop-line="${lineId}"]`);

// Every rendered copy of the stop's dot (base layer + any highlight copy)
// has radius `r`. For service-code dots the radius lives on the wrapped
// <circle> rather than the tagged element itself.
async function expectDotR(page: Page, stationId: string, lineId: string, r: string) {
  await expect
    .poll(async () => {
      const rs = await DOT(page, stationId, lineId).evaluateAll((els) =>
        els.map((el) => el.getAttribute('r') ?? el.querySelector('circle')?.getAttribute('r')),
      );
      return rs.length > 0 && rs.every((v) => v === r) ? `all r=${r}` : `r=[${rs.join(', ')}]`;
    })
    .toBe(`all r=${r}`);
}

const STRIPE = (page: Page, lineId: string) =>
  page.locator(`[data-band-stripe][data-line-id="${lineId}"]`).first();

async function selectLine(page: Page, lineId: string): Promise<void> {
  await STRIPE(page, lineId).click({ force: true });
  await page.locator('.inspector').waitFor();
  // The dot controls live inside the collapsed style detail.
  await openLineStyleDetail(page);
}

// Select station `stationId`, enter its on-canvas layout editor, and click
// its `lineId` stop handle so the per-stop controls target it. Leaves the
// line editor first if one is open — while Edit Stops is up, station clicks
// are editing gestures, not selections.
async function selectStop(page: Page, stationId: string, lineId: string): Promise<void> {
  await page.keyboard.press('Escape');
  const c = await stationCenter(page, stationId);
  await page.mouse.click(c.x, c.y);
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.locator(`[data-cell-kind="stop"][data-line-id="${lineId}"]`).click();
}

// Replace a controlled number input's value, then blur to commit.
//
// These spinbuttons are React *controlled* inputs (value={text}). Playwright's
// fill() clears-then-inserts in a single shot; on a controlled input the
// clear's re-render can lag the insert, so when the field already shows a
// value (e.g. the line default that a tracking stop displays) the new digits
// get APPENDED rather than replacing it ("7" + "8" -> "78"). Filling '' first
// is its own awaited step that settles the input to empty, so the real fill
// then starts from a blank field and can't append. (This was a latent flake in
// this spec, surfaced under sustained e2e load.)
async function replaceNumber(page: Page, name: string, value: string): Promise<void> {
  const spin = page.getByRole('spinbutton', { name, exact: true });
  await expect(spin).toBeVisible({ timeout: 2000 });
  await spin.fill('');
  await spin.fill(value);
  await spin.blur();
}

// Set the line's SINGLETON default dot size through the LineInspector
// spinbutton (fourInLine's stations are single-line, so this is the default
// their stops track).
async function setLineDotSizeTo(page: Page, value: string): Promise<void> {
  await replaceNumber(page, 'Singleton dot size', value);
}

// Set the selected stop's dot size through the StationInspector textbox.
async function setStopDotSizeTo(page: Page, value: string): Promise<void> {
  await replaceNumber(page, 'Stop dot size', value);
}

test.describe('Stop dot size', () => {
  test('default-tracking dots render at r 4 (diameter 8)', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    for (const sid of ['A', 'B', 'C', 'D']) {
      await expectDotR(page, sid, 'L1', '4');
    }
  });

  test('the line default dot size slider resizes every tracking stop', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    await selectLine(page, 'L1');
    await setLineDotSizeTo(page, '12');
    for (const sid of ['A', 'B', 'C', 'D']) {
      await expectDotR(page, sid, 'L1', '6');
    }
  });

  test('a per-stop override set via the station inspector textbox resizes only that stop', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    await selectStop(page, 'A', 'L1');
    await setStopDotSizeTo(page, '16');

    await expectDotR(page, 'A', 'L1', '8');
    await expectDotR(page, 'B', 'L1', '4');
    await expectDotR(page, 'C', 'L1', '4');
  });

  test('override semantics: 7→8→9 (overrides equal to a NEW default start tracking it)', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    // Line default 7: every dot at r 3.5.
    await selectLine(page, 'L1');
    await setLineDotSizeTo(page, '7');
    await expectDotR(page, 'A', 'L1', '3.5');

    // Stop A overridden to 8.
    await selectStop(page, 'A', 'L1');
    await setStopDotSizeTo(page, '8');
    await expectDotR(page, 'A', 'L1', '4');

    // Default 7 → 9: A's explicit 8 is untouched; tracking B follows.
    await selectLine(page, 'L1');
    await setLineDotSizeTo(page, '9');
    await expectDotR(page, 'A', 'L1', '4');
    await expectDotR(page, 'B', 'L1', '4.5');

    // Default 9 → 8: A's override equals the new default — absorbed.
    await setLineDotSizeTo(page, '8');
    await expectDotR(page, 'A', 'L1', '4');
    await expectDotR(page, 'B', 'L1', '4');

    // Default 8 → 9: A now tracks the default along with B.
    await setLineDotSizeTo(page, '9');
    await expectDotR(page, 'A', 'L1', '4.5');
    await expectDotR(page, 'B', 'L1', '4.5');
  });

  test('an explicit size overrides the service-code disc; tracking code dots keep r 6', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine, { stopDotLibrary: true });

    // Make the service-code disc the line's SINGLETON default stop dot.
    await selectLine(page, 'L1');
    await page.getByRole('button', { name: 'Singleton stop shape' }).click();
    await page.getByRole('menuitem', { name: 'Filled black with service code' }).click();

    // No explicit size anywhere: the code disc keeps its legibility radius.
    await expectDotR(page, 'A', 'L1', '6');

    // An explicit line default applies to code discs too.
    await setLineDotSizeTo(page, '10');
    await expectDotR(page, 'A', 'L1', '5');
  });

  test('dot sizes persist across reload', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    await selectLine(page, 'L1');
    await setLineDotSizeTo(page, '12');
    await selectStop(page, 'A', 'L1');
    await setStopDotSizeTo(page, '16');

    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await expectDotR(page, 'A', 'L1', '8');
    await expectDotR(page, 'B', 'L1', '6');
  });

  test('Ctrl+Z undoes a size change', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    await selectLine(page, 'L1');
    await setLineDotSizeTo(page, '12');
    await expectDotR(page, 'A', 'L1', '6');

    await page.keyboard.press('Control+z');
    await expectDotR(page, 'A', 'L1', '4');
  });
});

// The station popover's "Stop type" dropdown: which SIDE of the split a
// station's stops read from, when counting the stops that paint there is a
// poor proxy (a dense network where almost everything is shared). Driven
// through dot SIZE rather than dot type because the size is assertable as a
// number — the resolution path is the same `stationIsSingleton` either way.
test.describe('Station stop type', () => {
  // Select a station WITHOUT entering its layout editor: the Stop type row is
  // in the popover itself, one level up from the per-stop controls.
  async function selectStation(page: Page, stationId: string): Promise<void> {
    await page.keyboard.press('Escape');
    const c = await stationCenter(page, stationId);
    await page.mouse.click(c.x, c.y);
    await page.getByRole('combobox', { name: 'Stop type' }).waitFor();
  }

  async function setStopType(page: Page, value: string): Promise<void> {
    await page.getByRole('combobox', { name: 'Stop type' }).click();
    await page.getByRole('option', { name: value, exact: true }).click();
  }

  test('the row label reads on ONE line', async ({ page }) => {
    // "Stop type" is two words, and the popover's shared label column is sized
    // for the one-word typography rows — left in it, the label wraps. Counting
    // the text's line boxes is exact where a height heuristic would guess.
    await seedAndOpen(page, fourInLine);
    await selectStation(page, 'A');

    const lineBoxes = await page
      .locator('label[for^="station-stop-type-"]')
      .evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getClientRects().length;
      });
    expect(lineBoxes).toBe(1);
  });

  test('declaring a lone stop an interchange moves it onto the interchange default', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    // Give the two sides of the split different sizes. Every station here is
    // single-line, so the interchange side starts out inert — assert that,
    // or the flip below could pass on a default nothing ever changed.
    await selectLine(page, 'L1');
    await replaceNumber(page, 'Interchange dot size', '16');
    for (const sid of ['A', 'B', 'C', 'D']) await expectDotR(page, sid, 'L1', '4');

    await selectStation(page, 'A');
    await setStopType(page, 'Interchange');

    await expectDotR(page, 'A', 'L1', '8');
    await expectDotR(page, 'B', 'L1', '4');
    await expectDotR(page, 'C', 'L1', '4');
    await expectDotR(page, 'D', 'L1', '4');
  });

  test('Auto returns the station to the count, and the choice survives reload', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    await selectLine(page, 'L1');
    await replaceNumber(page, 'Interchange dot size', '16');
    await selectStation(page, 'A');
    await setStopType(page, 'Interchange');
    await expectDotR(page, 'A', 'L1', '8');

    await page.reload();
    await page.waitForSelector('.canvas-host svg');
    await expectDotR(page, 'A', 'L1', '8');

    // Auto names the answer the COUNT gives, which is unchanged by the
    // declaration standing in its way — A still has exactly one stop.
    await selectStation(page, 'A');
    await setStopType(page, 'Auto (Singleton)');
    await expectDotR(page, 'A', 'L1', '4');
  });

  test('Ctrl+Z undoes a stop type change', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    await selectLine(page, 'L1');
    await replaceNumber(page, 'Interchange dot size', '16');
    await selectStation(page, 'A');
    await setStopType(page, 'Interchange');
    await expectDotR(page, 'A', 'L1', '8');

    // Radix hands focus back to the trigger, whose `combobox` role puts the
    // app's keyboard guard in form mode — the same blur-then-undo contract the
    // spinbutton tests above honour. Blur first, then undo.
    await page.getByRole('combobox', { name: 'Stop type' }).blur();
    await page.keyboard.press('Control+z');
    await expectDotR(page, 'A', 'L1', '4');
  });
});
