import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, type Seed } from './fixtures';

/**
 * The ⊕ at a line circle's centre — see the LineCircleView doc comment for what
 * it is and why. Driven in a real browser because the thing under test is which
 * element the pointer actually reaches, and jsdom has neither hit-testing nor
 * layout.
 */

const R = 140;
const CIRCLE = { id: 'c1', x: 0, y: 0, radius: R };

/** A station seated on the ring at `deg`, its stop routed along the rim. */
const seat = (id: string, deg: number) => {
  const t = (deg * Math.PI) / 180;
  return {
    id,
    name: id,
    x: CIRCLE.x + R * Math.cos(t),
    y: CIRCLE.y + R * Math.sin(t),
    circleId: CIRCLE.id,
    stops: [{ lineId: 'L1', row: 0, col: 0, viaCircle: true }],
  };
};

/**
 * A ring with a line riding it. Five seats 80° apart, connected in order, so
 * four of the five arcs are painted and the one gap (100°→140°) contains
 * neither of the two points these tests probe: due WEST (180°, inside the
 * 140→220 arc) and due EAST (0°, inside the 300→20 arc). West is where a click
 * proves the rim is buried; east is where the resize knob sits.
 *
 * A path, not a loop — the seed derives edges from consecutive stations — so
 * one gap is unavoidable. It is parked out of the way rather than wished away.
 */
const SEATS = [140, 220, 300, 20, 100];
const RING_WITH_LINE: Seed = {
  lineCircles: [CIRCLE],
  stations: SEATS.map((deg, i) => seat(`s${i}`, deg)),
  // A fat stripe, so the band comfortably covers the rim's 12px grab stroke.
  lines: [
    {
      id: 'L1',
      service: 'L',
      color: '#c60c30',
      stations: SEATS.map((_, i) => `s${i}`),
      width: 20,
    },
  ],
};

/** The ring's centre and radius in SCREEN px, read off the painted guide. */
const ringOnScreen = async (page: Page) => {
  const b = (await page.locator('[data-line-circle] > circle').first().boundingBox())!;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: b.width / 2 };
};

const circleCentre = (page: Page) =>
  page
    .locator('[data-line-circle] > circle')
    .first()
    .evaluate((el) => ({ cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')) }));

test.describe('line circle centre handle', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndOpen(page, RING_WITH_LINE);
    await expect(page.locator('[data-line-circle-center]')).toHaveCount(1);
  });

  test('the rim really is covered: a plain click there takes the line', async ({ page }) => {
    // The premise of the whole feature. Due west sits on the 140→220 arc, so
    // the band is painted over the rim's grab stroke — and the band wins,
    // because this layer paints below all map content.
    const { cx, cy, r } = await ringOnScreen(page);
    const west = { x: Math.round(cx - r), y: Math.round(cy) };
    const topmost = await page.evaluate((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      return {
        band: el?.closest('[data-band-stripe],[data-band-hitbox]')?.getAttribute('data-line-id'),
        rim: el?.closest('[data-line-circle-rim]')?.getAttribute('data-line-circle-rim') ?? null,
      };
    }, west);
    expect(topmost.band, 'expected the line band on top at the rim').toBe('L1');
    expect(topmost.rim, 'the rim should be buried, not topmost').toBeNull();

    await page.mouse.click(west.x, west.y);
    // The LINE is what a plain click selects there — the ring is unreachable
    // by plain click on its own rim.
    await expect(page.locator('.line-popover')).toHaveCount(1);
    await expect(page.locator('.line-circle-popover')).toHaveCount(0);
  });

  test('a plain click at the centre selects the ring instead', async ({ page }) => {
    const { cx, cy } = await ringOnScreen(page);
    const topmost = await page.evaluate(
      (p) => document.elementFromPoint(p.x, p.y)?.getAttribute('data-line-circle-center') ?? null,
      { x: Math.round(cx), y: Math.round(cy) },
    );
    expect(topmost, 'the centre disc should be topmost at the middle').toBe(CIRCLE.id);

    await page.mouse.click(Math.round(cx), Math.round(cy));
    await expect(page.locator('.line-circle-popover')).toHaveCount(1);
    await expect(page.locator('[data-line-circle-knob]')).toHaveCount(1);
  });

  test('dragging the centre MOVES the buried ring, which no deep-pick can do', async ({ page }) => {
    // The deep-pick re-dispatches a click, never a gesture (MapCanvas), so a
    // ring under a band could be selected but not dragged. This is the part the
    // handle uniquely adds.
    const { cx, cy } = await ringOnScreen(page);
    const before = await circleCentre(page);
    const rBefore = await page
      .locator('[data-line-circle] > circle')
      .first()
      .evaluate((el) => Number(el.getAttribute('r')));

    await page.mouse.move(Math.round(cx), Math.round(cy));
    await page.mouse.down();
    await page.keyboard.down('Shift'); // bypass snapping: the delta is exactly ours
    await page.mouse.move(Math.round(cx) + 60, Math.round(cy) + 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const after = await circleCentre(page);
    expect(after.cx).toBeGreaterThan(before.cx + 40);
    expect(after.cy).toBeGreaterThan(before.cy + 20);
    const rAfter = await page
      .locator('[data-line-circle] > circle')
      .first()
      .evaluate((el) => Number(el.getAttribute('r')));
    expect(rAfter, 'a centre drag must not resize').toBeCloseTo(rBefore, 6);
  });

  test('concentric rings collide: coincident discs, one of them unreachable', async ({ page }) => {
    // A collision the handle introduces, pinned so it stays a known cost rather
    // than a surprise. Two rings sharing a centre put their discs — and their
    // ⊕ glyphs — at exactly the same point, so DOM order picks the winner and
    // the loser is both unclickable and invisible. Alt-click still recovers it:
    // the two keep distinct ids, so both sit in the deep-pick cycle.
    await seedAndOpen(page, {
      ...RING_WITH_LINE,
      lineCircles: [CIRCLE, { id: 'c2', x: CIRCLE.x, y: CIRCLE.y, radius: R / 2 }],
    });
    const discs = page.locator('[data-line-circle-center]');
    await expect(discs).toHaveCount(2);
    const boxes = await discs.evaluateAll((els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect();
        return {
          x: Math.round(b.x),
          y: Math.round(b.y),
          id: el.getAttribute('data-line-circle-center'),
        };
      }),
    );
    expect(boxes[0].x).toBe(boxes[1].x);
    expect(boxes[0].y).toBe(boxes[1].y);
    // Only one can be hit at that point.
    const { cx, cy } = await ringOnScreen(page);
    const winner = await page.evaluate(
      (p) => document.elementFromPoint(p.x, p.y)?.getAttribute('data-line-circle-center') ?? null,
      { x: Math.round(cx), y: Math.round(cy) },
    );
    expect([boxes[0].id, boxes[1].id]).toContain(winner);
  });

  test('the resize knob stays buried — under a band, resize is popover-only', async ({ page }) => {
    // Worth pinning because it is the obvious thing to assume the handle fixes,
    // and it does not: the knob lives on the rim's east point.
    await page.locator('[data-line-circle-center]').click();
    const knob = (await page.locator('[data-line-circle-knob]').boundingBox())!;
    const topmost = await page.evaluate(
      (p) => document.elementFromPoint(p.x, p.y)?.getAttribute('data-line-circle-knob') ?? null,
      { x: Math.round(knob.x + knob.width / 2), y: Math.round(knob.y + knob.height / 2) },
    );
    expect(topmost, 'the knob is on the rim, so the band covers it').toBeNull();
    // ...and the popover that the centre handle just opened is the way through.
    await expect(page.locator('.line-circle-popover')).toHaveCount(1);
  });
});
