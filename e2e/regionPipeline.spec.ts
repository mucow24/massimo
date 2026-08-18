import { test, expect, type Page } from '@playwright/test';
import { seedAndOpen, stationCenter, type Seed } from './fixtures';

// The pipelined region worker, end to end in a real browser: WYSIWYG parity
// at the drop, mid-drag same-rAF coherence between the painted stations and
// the painted clip holes, and the fallback when the worker dies mid-drag.
//
// The seed is the regions suite's perpendicular crossing. L2 is painted on
// top of the (only) overlap face, so L1 renders through an exclusion clip —
// the worker's whole output made visible. The e2e map is tiny, so arming is
// forced with a zero threshold; status().gen/armed prove the pipeline really
// engaged (a vacuously-synchronous pass would make every assertion here
// meaningless).

const crossing: Seed = {
  stations: [
    { id: 'A', name: 'A', x: 0, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 400, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    {
      id: 'C',
      name: 'C',
      x: 200,
      y: -150,
      stops: [{ lineId: 'L2', row: 0, col: 0, orientation: 'auto-vertical' }],
    },
    {
      id: 'D',
      name: 'D',
      x: 200,
      y: 150,
      stops: [{ lineId: 'L2', row: 0, col: 0, orientation: 'auto-vertical' }],
    },
  ],
  lines: [
    { id: 'L1', service: '1', color: '#0039A6', stations: ['A', 'B'] },
    { id: 'L2', service: '2', color: '#ee352e', stations: ['C', 'D'] },
  ],
};

/** Paint L2 on top of the crossing so exclusion clips exist to observe. */
const paintOverride = async (page: Page) => {
  await page.keyboard.press('l');
  await page.locator('[data-region-target]').click({ force: true });
  await expect(page.locator('clipPath[data-region-exclude="L1"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
};

const enablePipeline = (page: Page) =>
  page.evaluate(() => {
    (
      window as unknown as {
        __massimo: { regionPipeline: { enable: (on: boolean, o?: object) => void } };
      }
    ).__massimo.regionPipeline.enable(true, { armThresholdMs: 0 });
  });

const pipelineStatus = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __massimo: {
          regionPipeline: {
            status: () => {
              enabled: boolean;
              armed: boolean;
              workerWarm: boolean;
              gen: number;
              seq: number;
            };
          };
        };
      }
    ).__massimo.regionPipeline.status(),
  );

/** Shift-drag a station by (dx, dy) screen px in `steps` moves, WITHOUT
 *  releasing. Shift bypasses snapping so positions stay exact. */
const dragStationTo = async (
  page: Page,
  id: string,
  dx: number,
  dy: number,
  steps: number,
): Promise<void> => {
  const c = await stationCenter(page, id);
  await page.keyboard.down('Shift');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(c.x + (dx * i) / steps, c.y + (dy * i) / steps);
  }
};

const releaseDrag = async (page: Page) => {
  await page.mouse.up();
  await page.keyboard.up('Shift');
};

/** The at-rest picture that must be identical either way: every painted
 *  station transform + every exclusion-clip path. */
const restSnapshot = (page: Page) =>
  page.evaluate(() => {
    const stations = [...document.querySelectorAll('g[data-station-id]')]
      .map((g) => `${g.getAttribute('data-station-id')}:${g.getAttribute('transform')}`)
      .sort();
    const clips = [...document.querySelectorAll('clipPath[data-region-exclude]')]
      .map(
        (c) =>
          `${c.getAttribute('data-region-exclude')}:${[...c.querySelectorAll('path')]
            .map((p) => p.getAttribute('d'))
            .join(';')}`,
      )
      .sort();
    return { stations, clips };
  });

test('WYSIWYG at the drop: the pipelined drag lands byte-identical to the synchronous one', async ({
  page,
}) => {
  // Control run: pipeline off, drag D right by 120px, snapshot the result.
  await seedAndOpen(page, crossing);
  await paintOverride(page);
  await dragStationTo(page, 'D', 120, 0, 10);
  await releaseDrag(page);
  const syncResult = await restSnapshot(page);

  // Same drag with the pipeline on. status() proves it really armed.
  // (seedAndOpen overwrites the doc key and boots fresh — no cleanup needed.)
  await seedAndOpen(page, crossing);
  await paintOverride(page);
  await enablePipeline(page);
  await dragStationTo(page, 'D', 120, 0, 10);
  const midStatus = await pipelineStatus(page);
  await releaseDrag(page);
  expect(midStatus.armed, 'pipeline must actually arm mid-drag').toBe(true);

  // Converged: the DOM the user keeps is the synchronous path's, byte for byte.
  await expect.poll(async () => (await pipelineStatus(page)).armed, { timeout: 3000 }).toBe(false);
  expect(await restSnapshot(page)).toEqual(syncResult);
});

test('mid-drag, every sampled frame paints the hole its painted stations produce', async ({
  page,
}) => {
  // The constraint made testable: each pipelined frame must be the EXACT
  // arrangement of its snapshot. Per rAF we sample the painted position of
  // the dragged station D together with the painted exclusion hole's center;
  // afterwards we replay each sampled position AT REST (exact X via the
  // inspector, pipeline off) and require the mid-drag paint to equal the
  // at-rest paint for the same geometry. A canvas painting doc N with holes
  // N-1 is off by a frame of travel (~10 units); the tolerance is a float
  // hair. The hole's center comes from the clip path's smallest subpath —
  // the path is world-rect-minus-holes at the 64x raster scale.
  await seedAndOpen(page, crossing);
  await paintOverride(page);
  await enablePipeline(page);

  await page.evaluate(() => {
    const w = window as unknown as {
      __holeCx: () => number | null;
      __coherenceSamples: { dx: number; holeCx: number; armed: boolean }[];
      __stopSampling: boolean;
      __massimo: { regionPipeline: { status: () => { armed: boolean } } };
    };
    w.__holeCx = () => {
      const hole = document.querySelector('clipPath[data-region-exclude="L1"] path');
      const d = hole?.getAttribute('d');
      if (!d) return null;
      const subpaths = d
        .split('M')
        .filter((s) => s.trim().length)
        .map((s) => {
          const nums = (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
          let x0 = Infinity,
            x1 = -Infinity,
            y0 = Infinity,
            y1 = -Infinity;
          for (let i = 0; i + 1 < nums.length; i += 2) {
            x0 = Math.min(x0, nums[i]);
            x1 = Math.max(x1, nums[i]);
            y0 = Math.min(y0, nums[i + 1]);
            y1 = Math.max(y1, nums[i + 1]);
          }
          return { cx: (x0 + x1) / 2, area: (x1 - x0) * (y1 - y0) };
        });
      if (subpaths.length < 2) return null;
      // Drop the world rect (largest), average the hole subpaths' centers.
      subpaths.sort((a, b) => b.area - a.area);
      const holes = subpaths.slice(1);
      return holes.reduce((s, h) => s + h.cx, 0) / holes.length / 64; // unscale
    };
    w.__coherenceSamples = [];
    w.__stopSampling = false;
    const loop = () => {
      const dEl = document.querySelector('g[data-station-id="D"]');
      const m = /translate\(([-\d.]+)/.exec(dEl?.getAttribute('transform') ?? '');
      const holeCx = w.__holeCx();
      if (m && holeCx !== null) {
        w.__coherenceSamples.push({
          dx: Number(m[1]),
          holeCx,
          armed: w.__massimo.regionPipeline.status().armed,
        });
      }
      if (!w.__stopSampling) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  await dragStationTo(page, 'D', 160, 0, 16);
  expect((await pipelineStatus(page)).armed).toBe(true);
  await releaseDrag(page);

  const samples = await page.evaluate(() => {
    const w = window as unknown as {
      __coherenceSamples: { dx: number; holeCx: number; armed: boolean }[];
      __stopSampling: boolean;
    };
    w.__stopSampling = true;
    return w.__coherenceSamples;
  });
  const armedSamples = samples.filter((s) => s.armed);
  expect(
    armedSamples.length,
    'need armed mid-drag samples for this to mean anything',
  ).toBeGreaterThan(3);

  // Replay a spread of sampled positions at rest, pipeline off, and compare.
  await page.evaluate(() => {
    (
      window as unknown as { __massimo: { regionPipeline: { enable: (on: boolean) => void } } }
    ).__massimo.regionPipeline.enable(false);
  });
  const picks = [0, Math.floor(armedSamples.length / 2), armedSamples.length - 1].map(
    (i) => armedSamples[i],
  );
  // Select D from the sidebar list (already expanded) — a canvas click at the
  // station g's bbox center can land in the dead gap between the dot and its
  // label rect.
  await page.locator('[data-station-row="D"]').click();
  await expect(page.locator('.station-popover')).toBeVisible();
  const xField = page.getByLabel('X');
  await expect(xField).toBeVisible();
  for (const s of picks) {
    await xField.fill(String(s.dx));
    await xField.blur();
    const restHoleCx = await page.evaluate(() =>
      (window as unknown as { __holeCx: () => number | null }).__holeCx(),
    );
    expect(restHoleCx, `no hole at rest for dx=${s.dx}`).not.toBeNull();
    expect(Math.abs((restHoleCx as number) - s.holeCx), JSON.stringify(s)).toBeLessThan(1.5);
  }
});

test('worker killed mid-drag: times out, falls back, the drag finishes synchronously', async ({
  page,
}) => {
  await seedAndOpen(page, crossing);
  await paintOverride(page);
  await enablePipeline(page);

  await dragStationTo(page, 'D', 60, 0, 6);
  expect((await pipelineStatus(page)).armed).toBe(true);
  // Kill a worker that is WORKING, which is the scenario named above. Killing
  // one still booting is a different test: it has never answered, so the
  // watchdog holds the boot-sized 5s budget rather than 2.5x its own average,
  // and the drag sits frozen behind a stale frame for all of it. That is why
  // this went red only in a full-suite run — alone the first result lands in
  // milliseconds; under load it was still in flight.
  await expect
    .poll(async () => (await pipelineStatus(page)).workerWarm, { timeout: 10_000 })
    .toBe(true);
  await page.evaluate(() => {
    (
      window as unknown as { __massimo: { regionPipeline: { kill: () => void } } }
    ).__massimo.regionPipeline.kill();
  });
  // Keep dragging; the frame timeout fires and the pipeline falls back.
  const c = await stationCenter(page, 'D');
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(c.x + 60 + i * 10, c.y);
    await page.waitForTimeout(120);
  }
  // Warm, so the budget is `2.5 * emaMs` clamped to 500..5000 — 5s is the
  // ceiling the watchdog can hold, and the poll has to clear it.
  await expect.poll(async () => (await pipelineStatus(page)).armed, { timeout: 6000 }).toBe(false);
  await releaseDrag(page);

  // The gesture itself was never in the worker's hands: the doc is live, the
  // drop lands, and the clips are back on the synchronous path.
  // 200 start + 60px first leg + 60px after the kill (stationCenter was
  // re-read mid-drag, so the second leg's +60 adds to the moved position).
  const d = await page.locator('g[data-station-id="D"]').getAttribute('transform');
  expect(d).toContain('translate(380');
  await expect(page.locator('clipPath[data-region-exclude="L1"]')).toHaveCount(1);
});
