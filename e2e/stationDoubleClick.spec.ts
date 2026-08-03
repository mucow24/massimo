import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, fourInLine, stationCenter } from './fixtures';

// Double-click on a station splits two ways: plain opens the station LAYOUT
// editor, shift opens the inline name editor.
//
// This lives in e2e and not in jsdom because the thing that breaks is event
// DELIVERY, not the handlers. A selected station mounts a transparent drag
// proxy in the top-z layer, so a click that changes the selection swaps out the
// element the NEXT click lands on — and the browser dispatches `dblclick` at a
// node that may no longer be in the document. `fireEvent.doubleClick(el)` hands
// the event straight to the element you name, so a unit test asserts the
// handler while assuming the arrival: exactly the half that was broken.

/** Double-click at a page coordinate with modifier keys held down. */
async function dblClickAt(
  page: Page,
  pt: { x: number; y: number },
  modifiers: ('Shift' | 'Control' | 'Meta' | 'Alt')[] = [],
): Promise<void> {
  for (const m of modifiers) await page.keyboard.down(m);
  try {
    await page.mouse.dblclick(pt.x, pt.y);
  } finally {
    for (const m of [...modifiers].reverse()) await page.keyboard.up(m);
  }
}

// The inline rename editor is the only <textarea> inside a <foreignObject> —
// the pinned popover's Name box is a portaled div, not SVG content.
const renameEditor = (page: Page) => page.locator('foreignObject textarea');
const layoutBanner = (page: Page) => page.getByText('Editing station layout');

test.describe('station double-click', () => {
  test('opens the layout editor for the station', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await dblClickAt(page, await stationCenter(page, 'B'));

    await expect(layoutBanner(page)).toBeVisible();
    // The mode is on the station that was hit, not merely on: the pinned
    // inspector rides along and names it.
    await expect(page.locator('.inspector textarea').first()).toHaveValue('B');
    // ...and NOT the rename editor.
    await expect(renameEditor(page)).toHaveCount(0);
  });

  test('shift+double-click opens the inline name editor instead', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    await dblClickAt(page, await stationCenter(page, 'B'), ['Shift']);

    const editor = renameEditor(page);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue('B');
    await expect(editor).toBeFocused();
    // The layout editor must stay out of it — the two gestures are a split, not
    // a race.
    await expect(layoutBanner(page)).toHaveCount(0);
  });

  test('the rename gesture leaves the station sole-selected, not toggled out', async ({ page }) => {
    // Each shift-click underneath is a multi-select TOGGLE, so the gesture has
    // to put the selection back: an editor open on a station that is no longer
    // selected would close on the next stray click.
    await seedAndOpen(page, fourInLine);
    await dblClickAt(page, await stationCenter(page, 'B'), ['Shift']);

    await expect(renameEditor(page)).toBeVisible();
    // The top-z drag proxy is emitted for exactly the selected stations, so it
    // reads the selection straight off the DOM — and it is the same element
    // whose mount/unmount broke the gesture in the first place.
    await expect(page.locator('[data-station-hit]')).toHaveCount(1);
    await expect(page.locator('[data-station-hit="B"]')).toHaveCount(1);
  });
});
