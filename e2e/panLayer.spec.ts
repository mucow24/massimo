import { test, expect } from '@playwright/test';
import { fourInLine, seedAndOpen } from './fixtures';

/**
 * The pan-start compositing contract, which only a real browser can check.
 *
 * The canvas is one composited layer, and Blink re-runs the compositing update
 * over the WHOLE layer for any change inside it — about 4µs per painted node,
 * so ~55ms on a 464-station drawing. Arming a pan used to trigger that twice
 * over: once by granting `will-change` at pointer-down (and revoking it at
 * pointer-up, so the next press paid again), and once by applying the
 * "grabbing" cursor, which is an INHERITED property and therefore restyles
 * every descendant of whatever element carries it.
 *
 * Both fixes live in CSS, so no jsdom test can see them — `styles.css` is never
 * loaded there. Middle-press latency on a 464-station map, 0.5ms floor:
 * 49ms → 29ms (promotion held) → 8ms (cursor moved to the overlay).
 */
test('the pan layer is promoted for the whole session, not per gesture', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await page.waitForSelector('.canvas-host svg');

  const willChange = () =>
    page.evaluate(
      () => getComputedStyle(document.querySelector('.canvas-pan-layer')!).willChange,
    );

  // At rest, before any gesture: already promoted.
  expect(await willChange()).toBe('transform');

  const host = (await page.locator('.canvas-host').boundingBox())!;
  const x = Math.round(host.x + host.width / 2);
  const y = Math.round(host.y + host.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  expect(await willChange()).toBe('transform');
  await page.mouse.up({ button: 'middle' });

  // ...and STILL promoted afterwards. Revoking it here is what made the next
  // press rebuild the layer from scratch.
  expect(await willChange()).toBe('transform');
});

test('the grabbing cursor comes from the overlay, never from the map svg', async ({ page }) => {
  await seedAndOpen(page, fourInLine);
  await page.waitForSelector('.canvas-host svg');

  const host = (await page.locator('.canvas-host').boundingBox())!;
  const x = Math.round(host.x + host.width / 2);
  const y = Math.round(host.y + host.height / 2);
  await page.mouse.move(x, y);

  const probe = () =>
    page.evaluate(
      ([px, py]) => {
        const overlay = document.querySelector('.pan-cursor-overlay')!;
        const el = document.elementFromPoint(px as number, py as number);
        return {
          overlayPointerEvents: getComputedStyle(overlay).pointerEvents,
          overlayCursor: getComputedStyle(overlay).cursor,
          hitIsOverlay: el?.classList.contains('pan-cursor-overlay') ?? false,
          svgCursor: getComputedStyle(document.querySelector('.canvas-pan-layer > svg')!).cursor,
        };
      },
      [x, y],
    );

  // At rest the overlay is inert and the map answers the pointer.
  const idle = await probe();
  expect(idle.overlayPointerEvents).toBe('none');
  expect(idle.hitIsOverlay).toBe(false);

  await page.mouse.down({ button: 'middle' });
  const panning = await probe();
  // Mid-pan the overlay is what the pointer lands on, and it carries the
  // cursor. If this ever reports `hitIsOverlay: false`, the gesture has
  // silently lost its cursor and the latency win was bought with a feature.
  expect(panning.overlayPointerEvents).toBe('auto');
  expect(panning.overlayCursor).toBe('grabbing');
  expect(panning.hitIsOverlay).toBe(true);
  // The svg itself must NOT have been restyled to grabbing — that is the
  // inherited-property path that costs a full-tree recalc.
  expect(panning.svgCursor).not.toBe('grabbing');

  await page.mouse.up({ button: 'middle' });
  expect((await probe()).overlayPointerEvents).toBe('none');
});
