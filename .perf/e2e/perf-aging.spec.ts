/* THROWAWAY browser perf harness — not part of the suite.
 *
 *   npm run build
 *   PORT=5235 npx playwright test -c .perf/playwright.perf-prod.config.ts \
 *     -g 'ages a session'
 *
 * Answers ONE question: does the app get slower the longer a session is
 * edited, and if so, WHICH quantity is growing?
 *
 * The reported symptom is that after an hour or two of editing, station drags
 * fall to a few fps and a reload cures it. Panning degrades differently and
 * that difference is the clue: a pan is compositor-only ONCE STARTED and stays
 * smooth, but the click-to-pan-start gap grows. Pan start does almost nothing
 * in JS (useViewport.startPan sets a ref and willChange) — the cost hiding in
 * that press is Blink rasterizing the whole 2x-window map into a fresh
 * compositor layer. So drag-frame cost and pan-start cost share ONE quantity:
 * the paint/raster cost of the map layer. This harness measures both, next to
 * the counters that could explain either.
 *
 * Structure: [measure] -> [age by N real gestures] -> [measure] -> ... so the
 * output is a series, not a number. Read DOWN each column for the trend; a
 * column that is flat is a theory eliminated.
 *
 * PERF_PLANT_LEAK=1 plants a known DOM leak. USE IT FIRST. A harness that has
 * never been seen to go red is not evidence of anything.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { readPerfMap } from '../perfMap';

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 6);
/** Committed drag gestures per aging round. */
const AGE_GESTURES = Number(process.env.PERF_AGE ?? 40);
const TARGET = process.env.PERF_TARGET ?? 'Times Sq';

interface Station {
  id: string;
  name: string;
  x: number;
  y: number;
  stops: unknown[];
}
interface DocShape {
  stations: Record<string, Station>;
  [k: string]: unknown;
}

/** Seed the real map + a camera centred on `centre`, then reload into it. */
async function seedAt(page: Page, doc: DocShape, centre: { x: number; y: number }): Promise<void> {
  await page.goto('/e2e-blank.html');
  await page.evaluate(
    ([key, value, vkey, vp]) => {
      localStorage.setItem(key as string, value as string);
      localStorage.setItem(vkey as string, vp as string);
    },
    [
      'massimo-doc:perf-map',
      JSON.stringify({ version: 22, state: doc }),
      'massimo-camera:perf-map',
      JSON.stringify({ state: { x: centre.x, y: centre.y, zoom: 1 }, version: 0 }),
    ],
  );
  await page.goto('/#map=perf-map');
  await page.waitForSelector('.canvas-host svg');
  await page.waitForFunction(() => '__massimo' in window, undefined, { timeout: 10_000 });
  await page.waitForTimeout(1500); // let the first full build settle
  // Status toasts float OVER the canvas, and a run this long raises plenty of
  // them. A toast under the cursor becomes the topmost element at the very
  // point we must press, so every later gesture grabs the toast instead of the
  // station — silently, while the harness keeps reporting numbers. (That is
  // exactly how this run failed the first time: `topClass: "toast"`.) They are
  // made click-through rather than hidden, so what the map PAINTS is unchanged.
  await page.addStyleTag({
    content:
      '.toast, .toasts, .warning-toasts, [class*="toast" i], [class*="toast" i] * ' +
      '{ pointer-events: none !important; }',
  });
}

interface Counters {
  heapMB: number;
  wasmMB: number;
  past: number;
  future: number;
  regionCache: number;
  svgNodes: number;
  defsNodes: number;
  clipPaths: number;
  stations: number;
  lines: number;
  regionAssignments: number;
}

const counters = (page: Page): Promise<Counters> =>
  page.evaluate(() => (window as unknown as { __massimo: { counters: () => Counters } }).__massimo.counters());

/**
 * Browser-side counts the page cannot see about itself: live DOM nodes and
 * registered listeners across the whole document, and Blink's own layout /
 * style-recalc tallies. `Nodes` counts what is ALIVE, so a climb here with a
 * flat svgNodes means detached nodes are being retained somewhere.
 */
async function cdpMetrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  const want = ['Nodes', 'JSEventListeners', 'LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration'];
  const out: Record<string, number> = {};
  for (const m of metrics) if (want.includes(m.name)) out[m.name] = m.value;
  return out;
}

/**
 * A screen point that really hits `stationId`, RIGHT NOW.
 *
 * Two things this had to learn the hard way, both caught by probing the live
 * DOM rather than reasoning about it:
 *
 * 1. The station's OWN screen anchor comes from its screen CTM, not from
 *    getBoundingClientRect(). The bounding box includes the label — 152x51 px
 *    on a hub whose dot is ~12 — so its centre sits on blank canvas or on a
 *    neighbour.
 * 2. The thing painted at that anchor is the STOP DOT, and a stop dot is not
 *    inside the `[data-station-id]` group. It carries `data-stop-station`
 *    instead. A hit test that knows only `data-station-id` matches nothing at
 *    the very point you must press, and every gesture then silently grabs
 *    empty canvas while the harness reports confident numbers.
 *
 * Re-acquired before every gesture, because dragging moves the station.
 */
const POINT_ON_STATION = (sid: string): { x: number; y: number } | null => {
  const el = document.querySelector(`[data-station-id="${sid}"]`) as SVGGraphicsElement | null;
  if (!el) return null;
  const owner = (x: number, y: number): string | null => {
    const t = document.elementFromPoint(x, y);
    if (!t) return null;
    return (
      t.closest('[data-station-id]')?.getAttribute('data-station-id') ??
      t.closest('[data-stop-station]')?.getAttribute('data-stop-station') ??
      null
    );
  };
  const m = el.getScreenCTM();
  if (m) {
    const p = new DOMPoint(0, 0).matrixTransform(m);
    const ax = Math.round(p.x);
    const ay = Math.round(p.y);
    if (owner(ax, ay) === sid) return { x: ax, y: ay };
    // The anchor can be covered by an interlined neighbour's band; step out.
    for (let r = 2; r <= 24; r += 2) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(ax + r * Math.cos((a * Math.PI) / 8));
        const y = Math.round(ay + r * Math.sin((a * Math.PI) / 8));
        if (owner(x, y) === sid) return { x, y };
      }
    }
  }
  return null;
};

const POINT_ON_STATION_SRC = POINT_ON_STATION.toString();

async function pointOn(page: Page, stationId: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ([fnSrc, sid]) =>
      (new Function(`return (${fnSrc})`)() as (s: string) => { x: number; y: number } | null)(
        sid as string,
      ),
    [POINT_ON_STATION_SRC, stationId],
  );
}

/** Why POINT_ON_STATION came up empty — printed instead of a bare NaN. */
async function whyNoPoint(page: Page, stationId: string): Promise<unknown> {
  return page.evaluate((sid) => {
    const el = document.querySelector(`[data-station-id="${sid}"]`) as SVGGraphicsElement | null;
    if (!el) return { reason: 'no [data-station-id] element' };
    const m = el.getScreenCTM();
    if (!m) return { reason: 'no screen CTM' };
    const p = new DOMPoint(0, 0).matrixTransform(m);
    const ax = Math.round(p.x);
    const ay = Math.round(p.y);
    const t = document.elementFromPoint(ax, ay);
    return {
      reason: 'nothing at the anchor belongs to this station',
      anchor: [ax, ay],
      inViewport: ax >= 0 && ay >= 0 && ax < innerWidth && ay < innerHeight,
      topTag: t?.tagName ?? null,
      topClass: t?.getAttribute('class') ?? null,
      topPointerEvents: t ? getComputedStyle(t).pointerEvents : null,
      uimode: document.querySelector('.canvas-host')?.getAttribute('data-uimode') ?? null,
    };
  }, stationId);
}

/**
 * Direction of the next measurement sweep. Flipped every call so consecutive
 * measurements cancel out: a drag that always swept the same way walked the
 * station ~50px across the screen per round and eventually off it. Median
 * frame cost does not care which way the pointer goes.
 */
let sweepDir = 1;

/** Median per-frame cost of a real station drag, driven frame-by-frame. */
async function measureDragFrameMs(page: Page, stationId: string): Promise<number> {
  const dir = (sweepDir = -sweepDir);
  const at = await pointOn(page, stationId);
  if (!at) {
    // Never fail silently: a harness that returns NaN without saying why sends
    // you looking for a leak in the app when the fault is in the instrument.
    console.log('!! could not acquire the station: ' + JSON.stringify(await whyNoPoint(page, stationId)));
    return NaN;
  }
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dir * 6, at.y + dir * 4); // clear the drag threshold
  await page.waitForTimeout(400); // let the first drag frame's cost pass
  const per = await page.evaluate(
    async ([sx, sy, d]) => {
      const host = document.querySelector('.canvas-host svg');
      if (!host) return [] as number[];
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        // A steady monotonic sweep: small oscillations get snapped back at a
        // hub, which makes the gesture unverifiable.
        const t0 = performance.now();
        host.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            clientX: (sx as number) + (d as number) * (6 + i * 2),
            clientY: (sy as number) + (d as number) * (4 + i * 1.5),
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
          }),
        );
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        out.push(performance.now() - t0);
      }
      return out;
    },
    [at.x, at.y, dir],
  );
  await page.mouse.up();
  const warm = per.slice(4).sort((a, b) => a - b);
  return warm.length ? warm[Math.floor(warm.length / 2)] : NaN;
}

/**
 * The user-facing pan-start symptom: hold space (hand mode), press, and watch
 * for the stall before the map starts following the cursor.
 *
 * Reported as the WORST frame interval in the window straight after the press.
 * The layerization raster happens off the main thread, so a main-thread timer
 * would miss it entirely — but it still delays presentation, which shows up as
 * a long gap between rAF callbacks. That gap IS the felt lag.
 */
async function measurePanStallMs(page: Page, stationId: string): Promise<number> {
  const at = (await pointOn(page, stationId)) ?? { x: 700, y: 400 };
  await page.keyboard.down('Space');
  await page.mouse.move(at.x, at.y);
  await page.evaluate(() => {
    const w = window as unknown as { __panProbe?: { frames: number[]; stop?: () => void } };
    w.__panProbe = { frames: [] };
    let last = performance.now();
    let live = true;
    const tick = () => {
      if (!live) return;
      const now = performance.now();
      w.__panProbe!.frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__panProbe!.stop = () => {
      live = false;
    };
  });
  await page.mouse.down();
  // Small continuous moves: the pan must actually engage, or we are timing an
  // idle page.
  for (let i = 0; i < 12; i++) await page.mouse.move(at.x + i * 3, at.y + i * 2);
  const worst = await page.evaluate(() => {
    const w = window as unknown as { __panProbe: { frames: number[]; stop: () => void } };
    w.__panProbe.stop();
    // Drop the first sample: it spans from arming to the next frame boundary
    // and carries whatever the page was already doing.
    return Math.max(0, ...w.__panProbe.frames.slice(1));
  });
  await page.mouse.up();
  await page.keyboard.up('Space');
  return worst;
}

/**
 * N committed drag gestures — down, moves, up — the way a session ages.
 *
 * The pointerdown must be dispatched on the element the pointer is actually
 * OVER, not on the svg root: the drag hooks bind per-entity and events bubble
 * up, so a down on the root reaches nothing and the gesture silently no-ops.
 * (That is what the undo-depth gate caught the first time this ran.) The
 * station also MOVES as it is dragged, so its hit point is re-acquired every
 * gesture rather than assumed fixed.
 *
 * Returns the number of gestures that actually engaged.
 */
async function age(page: Page, stationIds: string[], n: number): Promise<number> {
  const { engaged, skipped } = await page.evaluate(
    async ([fnSrc, sids, count]) => {
      const host = document.querySelector('.canvas-host svg');
      if (!host) return { engaged: 0, skipped: 0 };
      const findPoint = new Function(`return (${fnSrc as string})`)() as (
        s: string,
      ) => { x: number; y: number } | null;
      const fire = (el: Element, type: string, x: number, y: number, buttons: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            buttons,
            button: 0,
            pointerId: 1,
            pointerType: 'mouse',
          }),
        );

      const ids = sids as string[];
      let engaged = 0;
      let skipped = 0;
      for (let g = 0; g < (count as number); g++) {
        // Cycle stations: a session's work is spread over the map, and aging
        // that only ever touches ONE station exercises exactly the caches that
        // one station keeps warm.
        const p = findPoint(ids[g % ids.length]);
        // Skip a station that is momentarily unreachable rather than abandoning
        // the whole batch: one station behind an overlay must not silently cut
        // an 8-round run down to 38 seconds.
        if (!p) {
          skipped++;
          continue;
        }
        const target = document.elementFromPoint(p.x, p.y) ?? host;
        // Out and back, PER STATION. Keying the direction on the raw gesture
        // index gives each station a constant direction whenever the set size
        // is even (station i only ever sees g = i, i+n, i+2n...), so every
        // station marched the same way until it walked off its own hit point.
        // The pass number is what has to alternate.
        const dir = Math.floor(g / ids.length) % 2 === 0 ? 1 : -1;
        fire(target, 'pointerdown', p.x, p.y, 1);
        for (let i = 1; i <= 4; i++) fire(host, 'pointermove', p.x + dir * i * 4, p.y + dir * i * 3, 1);
        fire(host, 'pointerup', p.x + dir * 16, p.y + dir * 12, 0);
        engaged++;
        // One frame between gestures so commits actually land.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return { engaged, skipped };
    },
    [POINT_ON_STATION_SRC, stationIds, n],
  );
  if (skipped) console.log(`   (aging skipped ${skipped} unreachable gestures)`);
  return engaged;
}

/**
 * The target station plus its nearest neighbours — the set the aging walk
 * cycles through, so the churn is spread over a neighbourhood the way real
 * editing is.
 */
function agingSet(doc: DocShape, centre: Station, n: number): string[] {
  return Object.values(doc.stations)
    .filter((s) => s.stops.length > 0)
    .sort(
      (a, b) =>
        (a.x - centre.x) ** 2 + (a.y - centre.y) ** 2 - ((b.x - centre.x) ** 2 + (b.y - centre.y) ** 2),
    )
    .slice(0, n)
    .map((s) => s.id);
}

interface Row {
  round: number;
  gestures: number;
  dragMs: number;
  panStallMs: number;
  c: Counters;
  m: Record<string, number>;
}

test.describe('session aging', () => {
  test('ages a session and reports what grows', async ({ page }) => {
    test.setTimeout(1_800_000);
    const doc = (JSON.parse(readPerfMap()) as { doc: DocShape }).doc;
    const st = Object.values(doc.stations).find((s) =>
      s.name.toLowerCase().replace(/\s+/g, ' ').includes(TARGET.toLowerCase().trim()),
    );
    expect(st, `no station matching "${TARGET}"`).toBeTruthy();

    await seedAt(page, doc, { x: st!.x, y: st!.y });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');

    if (process.env.PERF_PLANT_LEAK) {
      console.log('!! PERF_PLANT_LEAK=1 — planting a DOM leak to prove the instrument.');
    }

    const at = await pointOn(page, st!.id);
    expect(at, 'no pointer-reachable point on the target station').toBeTruthy();

    const agingIds = agingSet(doc, st!, 6);

    // WARM UP before round 0. The very first drag on a cold page pays for the
    // first full region build and every lazy path behind it — 131ms against
    // 17ms for the second. Left in, that one number swamps the trend the whole
    // harness exists to show.
    // Twice: one drag+pan still left round 0 at 215ms against ~85ms for every
    // later round, which would read as a leak that then healed itself.
    for (let i = 0; i < 2; i++) {
      await measureDragFrameMs(page, st!.id);
      await measurePanStallMs(page, st!.id);
    }

    const rows: Row[] = [];
    let gestures = 0;

    for (let round = 0; round < ROUNDS; round++) {
      const dragMs = await measureDragFrameMs(page, st!.id);
      const panStallMs = await measurePanStallMs(page, st!.id);
      rows.push({
        round,
        gestures,
        dragMs,
        panStallMs,
        c: await counters(page),
        m: await cdpMetrics(cdp),
      });

      gestures += await age(page, agingIds, AGE_GESTURES);

      if (process.env.PERF_PLANT_LEAK) {
        // A known, deliberate leak: painted nodes accreting in the composited
        // pan layer. It should move svgNodes, CDP Nodes, and — because it is
        // real painted content — the pan-start raster too.
        await page.evaluate(() => {
          const layer = document.querySelector('.canvas-pan-layer svg');
          if (!layer) return;
          const ns = 'http://www.w3.org/2000/svg';
          for (let i = 0; i < 400; i++) {
            const p = document.createElementNS(ns, 'path');
            p.setAttribute('d', `M${i} 0 L${i + 40} 40 L${i} 80 Z`);
            p.setAttribute('fill', 'rgba(255,0,0,0.01)');
            layer.appendChild(p);
          }
        });
      }
    }

    // PROBE VALIDATION, two ways.
    //
    // `age()` reports how many gestures actually ENGAGED, and the undo stack
    // has to have grown by at least that many. Checking undo depth alone is
    // not enough and was misleading on the first run: each measurement drag is
    // itself a committed gesture, so `past` climbs by one per round even when
    // the aging did precisely nothing.
    const past = rows.map((r) => r.c.past);
    const pastGrew = past[past.length - 1] - past[0];
    // Two independent things have to hold, and neither is "all of them".
    //
    // ENGAGEMENT: the walk is allowed to skip a station that is momentarily
    // behind an overlay, so demanding every gesture engage would fail a run
    // that was 99% fine — and that contradicts the skip logic itself. 90% is
    // the floor; the exact skip count is printed either way.
    //
    // COMMITS: undo cannot grow one per gesture, because the walk goes out and
    // back and a gesture that returns a station to where it started is a
    // genuine no-op that records nothing.
    const wanted = AGE_GESTURES * ROUNDS;
    const engagedEnough = gestures >= wanted * 0.9;
    const grew = gestures > 0 && pastGrew >= gestures / 2 && engagedEnough;
    console.log(`\n=== session aging: ${ROUNDS} rounds x ${AGE_GESTURES} gestures ===`);
    console.log(
      `aging gestures engaged: ${gestures} of ${AGE_GESTURES * ROUNDS} ` +
        `(${((gestures / (AGE_GESTURES * ROUNDS)) * 100).toFixed(0)}%); undo depth grew by ${pastGrew}`,
    );
    if (!grew) {
      console.log(
        `!! the aging did not do what it claims (engaged=${gestures}, undo +${pastGrew}). ` +
          `DISCARD this run and fix the harness.`,
      );
    }

    const head =
      'round  gest |  dragMs  panStall |   heapMB  wasmMB |  past  regCache | svgNodes  clipPaths | ' +
      'Nodes  Listeners | regAssign';
    console.log(head);
    for (const r of rows) {
      console.log(
        `${String(r.round).padStart(5)} ${String(r.gestures).padStart(5)} | ` +
          `${r.dragMs.toFixed(1).padStart(7)} ${r.panStallMs.toFixed(1).padStart(9)} | ` +
          `${r.c.heapMB.toFixed(1).padStart(8)} ${r.c.wasmMB.toFixed(1).padStart(7)} | ` +
          `${String(r.c.past).padStart(5)} ${String(r.c.regionCache).padStart(9)} | ` +
          `${String(r.c.svgNodes).padStart(8)} ${String(r.c.clipPaths).padStart(10)} | ` +
          `${String(r.m.Nodes ?? 0).padStart(5)} ${String(r.m.JSEventListeners ?? 0).padStart(9)} | ` +
          `${String(r.c.regionAssignments).padStart(9)}`,
      );
    }

    const first = rows[0];
    const last = rows[rows.length - 1];
    console.log(
      `\ndrag ${first.dragMs.toFixed(1)} -> ${last.dragMs.toFixed(1)} ms ` +
        `(${(last.dragMs / first.dragMs).toFixed(2)}x), ` +
        `pan stall ${first.panStallMs.toFixed(1)} -> ${last.panStallMs.toFixed(1)} ms ` +
        `(${(last.panStallMs / first.panStallMs).toFixed(2)}x)`,
    );
    console.log(
      'Read DOWN the columns. A column that stays flat is a theory eliminated;\n' +
        'the one that tracks dragMs and panStall is the lead. Then confirm it in\n' +
        'the page: run the matching window.__massimo.reset.* while slow and see\n' +
        'if the times come back.',
    );

    // If the aging never committed, the run proves nothing — fail rather than
    // print a flat table that reads as "no leak".
    expect(grew, 'aging gestures did not commit; run is not evidence').toBe(true);
  });

  test('RESET: which in-place reset gives the time back', async ({ page }) => {
    test.setTimeout(1_800_000);
    const doc = (JSON.parse(readPerfMap()) as { doc: DocShape }).doc;
    const st = Object.values(doc.stations).find((s) =>
      s.name.toLowerCase().replace(/\s+/g, ' ').includes(TARGET.toLowerCase().trim()),
    )!;
    await seedAt(page, doc, { x: st.x, y: st.y });
    const at = await pointOn(page, st.id);
    expect(at, 'no pointer-reachable point on the target station').toBeTruthy();

    await measureDragFrameMs(page, st!.id); // warm up, as above
    const fresh = await measureDragFrameMs(page, st!.id);
    let aged_gestures = 0;
    const agingIds = agingSet(doc, st, 6);
    for (let i = 0; i < ROUNDS; i++) aged_gestures += await age(page, agingIds, AGE_GESTURES);
    const aged = await measureDragFrameMs(page, st!.id);
    expect(aged_gestures, 'aging gestures did not engage; run is not evidence').toBeGreaterThan(0);

    // Each reset is a piece of what a reload does. Applied in sequence, so the
    // FIRST one that moves the number is the owner.
    const after: Record<string, number> = {};
    for (const name of ['history', 'regions', 'doc'] as const) {
      await page.evaluate((n) => {
        const h = (window as unknown as { __massimo: { reset: Record<string, () => unknown> } })
          .__massimo;
        h.reset[n]();
      }, name);
      await page.waitForTimeout(300);
      after[name] = await measureDragFrameMs(page, st!.id);
    }

    console.log(`\n=== in-place resets (${ROUNDS * AGE_GESTURES} gestures of aging) ===`);
    console.log(`  fresh            ${fresh.toFixed(1)} ms`);
    console.log(`  aged             ${aged.toFixed(1)} ms  (${(aged / fresh).toFixed(2)}x)`);
    for (const [k, v] of Object.entries(after)) {
      console.log(`  after reset.${k.padEnd(8)} ${v.toFixed(1)} ms  (${(v / fresh).toFixed(2)}x)`);
    }
    console.log(
      'If none of these come back to `fresh` but a RELOAD does, what is left is\n' +
        'browser-side: compositor layers, raster caches, or the wasm heap.',
    );
    expect(aged).toBeGreaterThan(0);
  });
});
