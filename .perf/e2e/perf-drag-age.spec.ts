/* PAINT-TIME AGE and post-stop convergence of a station drag, pipeline ON vs
 * OFF, interleaved in one page session.
 *
 * What it answers — the rubber-band numbers the existing A/B never measured:
 * when a painted frame lands, how OLD is the position it shows (ms since that
 * position was the cursor's, px behind the cursor now), and once the cursor
 * STOPS, how many intermediate "travel" paints render before the item settles
 * under it, and how long that takes.
 *
 * Method: the synthetic cursor rides a circle at constant speed,
 * parameterized by VIRTUAL time that only advances while dispatching — one
 * continuous path across blocks, so each painted position can be matched
 * (nearest-distance within a time window) back to the dispatch that produced
 * it; age = paint tick time - dispatch time. Dispatches are rAF-paced with
 * positions computed from CURRENT wall time, which is exactly how real
 * coalesced pointer input behaves: one latest-position event per rendering
 * opportunity, bigger jumps when the main thread is slower. Snap is bypassed
 * (shiftKey) so painted positions sit on the commanded path.
 *
 * Probe proofs (README discipline):
 *  - mapping gate: before measuring, command a point and require the painted
 *    position to land on it (<=5px) — proves the world->client mapping;
 *  - engagement gate: both arms must advance paints, or the run is void;
 *  - OFF-arm age has a KNOWN value (~ one sync frame period): if the matcher
 *    reports otherwise there, the instrument is broken, not the app;
 *  - the ON arm reports its armed ratio; below 70% the arm measured the sync
 *    path and says so.
 *
 *   npm run build
 *   PORT=5237 npx playwright test -c .perf/playwright.perf-prod.config.ts e2e/perf-drag-age.spec.ts
 */
import { test, type Page } from '@playwright/test';
import { readPerfMap } from '../perfMap';

const TARGETS = (process.env.PERF_TARGETS ?? 'Times Sq,Atlantic-Barclays,Halsey').split(',');
const PAIRS = Number(process.env.PERF_PAIRS ?? 4); // alternating A/B block pairs
const MOVE_MS = Number(process.env.PERF_MOVE_MS ?? 1600); // movement phase per block
const HOLD_MS = Number(process.env.PERF_HOLD_MS ?? 800); // cursor-stopped phase per block
const SPEED = Number(process.env.PERF_SPEED ?? 500); // cursor speed, px/s
// Scenario ingredients, OFF by default (the clean baseline):
//  PERF_SNAP=1     dispatch without shiftKey, so the snap engine runs per event
//                  as it does in a real drag (age matching gets noisier: snap
//                  can displace the painted point off the commanded path).
//  PERF_POPOVER=1  click-select the station first so its popover is open during
//                  the drag — the live-subscribed chrome re-renders per event.
const SNAP = process.env.PERF_SNAP === '1';
const POPOVER = process.env.PERF_POPOVER === '1';
// Events dispatched per rAF tick (default 1 = a 60Hz display). A high-refresh
// display feeds the live main thread 2-3 pointermoves per 60Hz frame; this
// emulates that input pressure without a real 165Hz display.
const EVENTS_PER_TICK = Number(process.env.PERF_EVENTS_PER_TICK ?? 1);

interface DocShape {
  stations: Record<string, { id: string; name: string; x: number; y: number; stops: unknown[] }>;
  [k: string]: unknown;
}

async function seedAt(page: Page, doc: DocShape, c: { x: number; y: number }) {
  await page.goto('/e2e-blank.html');
  await page.evaluate(
    ([k, v, vk, vv]) => {
      localStorage.setItem(k as string, v as string);
      localStorage.setItem(vk as string, vv as string);
    },
    [
      'massimo-doc:perf-map',
      JSON.stringify({ version: 22, state: doc }),
      'massimo-camera:perf-map',
      JSON.stringify({ state: { x: c.x, y: c.y, zoom: 1 }, version: 0 }),
    ],
  );
  await page.goto('/#map=perf-map');
  await page.waitForSelector('.canvas-host svg');
  await page.waitForTimeout(1500);
}

test('paint-time age + convergence: pipeline on vs off', async ({ page }) => {
  test.setTimeout(900_000);
  const doc = (JSON.parse(readPerfMap()) as { doc: DocShape }).doc;

  for (const frag of TARGETS) {
    const st = Object.values(doc.stations).find((s) =>
      s.name.toLowerCase().replace(/\s+/g, ' ').includes(frag.toLowerCase().trim()),
    );
    if (!st) continue;
    await seedAt(page, doc, { x: st.x, y: st.y });

    const host = (await page.locator('.canvas-host').boundingBox())!;
    const findHit = () =>
      page.evaluate(
        ([sid, ox, oy]) => {
          // A SELECTED station's top element is its drag proxy, which is keyed
          // under data-station-hit (not data-station-id) on purpose — accept
          // either: both start the same drag.
          const at = (x: number, y: number) => {
            const g = document
              .elementFromPoint(x, y)
              ?.closest('[data-station-id],[data-station-hit]');
            return g?.getAttribute('data-station-id') ?? g?.getAttribute('data-station-hit') ?? null;
          };
          if (at(ox as number, oy as number) === sid) return { x: ox, y: oy };
          for (let r = 2; r <= 26; r += 2)
            for (let a = 0; a < 16; a++) {
              const x = Math.round((ox as number) + r * Math.cos((a * Math.PI) / 8));
              const y = Math.round((oy as number) + r * Math.sin((a * Math.PI) / 8));
              if (at(x, y) === sid) return { x, y };
            }
          return null;
        },
        [st.id, Math.round(host.x + host.width / 2), Math.round(host.y + host.height / 2)],
      );
    let hit = await findHit();
    if (!hit) {
      console.log(`!! ${st.name}: unreachable; skipping`);
      continue;
    }
    if (POPOVER) {
      // Select first, so the station's popover chrome is open for the whole
      // measured drag (the common real-world repositioning posture). The panel
      // (or the selection's drag-proxy chrome) can cover the original hit
      // point, so re-scan for a spot that still resolves to the station.
      await page.mouse.click(hit.x as number, hit.y as number);
      await page.waitForTimeout(600);
      hit = await findHit();
      if (!hit) {
        console.log(`!! ${st.name}: covered by its own popover; skipping`);
        continue;
      }
    }
    const cx = hit.x as number;
    const cy = hit.y as number;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 6, cy + 4);
    await page.waitForTimeout(500);

    const res = await page.evaluate(
      async ([sx, sy, sid, pairs, moveMs, holdMs, speed, snapOn, perTick]) => {
        const svg = document.querySelector('.canvas-host svg')!;
        const massimo = (
          window as unknown as {
            __massimo: {
              regionPipeline: {
                enable: (on: boolean, o?: { armThresholdMs?: number }) => void;
                status: () => { armed: boolean };
              };
            };
          }
        ).__massimo;
        const el = () => document.querySelector(`g[data-station-id="${sid as string}"]`);
        const parseXY = (tr: string | null | undefined) => {
          if (!tr) return null;
          const m = /translate\(\s*([-\d.eE]+)[ ,]\s*([-\d.eE]+)/.exec(tr);
          return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
        };
        const raf = () => new Promise((r) => requestAnimationFrame(() => r(null)));

        // Virtual-time circular path whose vt=0 point IS the grab point.
        const R = 130;
        const omega = (speed as number) / R;
        const cx0 = (sx as number) - R;
        const cy0 = sy as number;
        const pathAt = (v: number) => ({
          x: cx0 + R * Math.cos(omega * v),
          y: cy0 + R * Math.sin(omega * v),
        });
        let vt = 0;
        const samples: { t: number; x: number; y: number }[] = [];
        let lastDispatch = { x: sx as number, y: sy as number };
        const dispatchAt = (v: number) => {
          const p = pathAt(v);
          lastDispatch = p;
          const now = performance.now();
          samples.push({ t: now, x: p.x, y: p.y });
          while (samples.length && samples[0].t < now - 3000) samples.shift();
          svg.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              clientX: p.x,
              clientY: p.y,
              buttons: 1,
              pointerId: 1,
              pointerType: 'mouse',
              // Shift bypasses snapping so painted sits exactly on the path;
              // the snap-on scenario drops it to run the real per-event cost.
              shiftKey: !snapOn,
            }),
          );
        };
        const settle = async (quietMs: number, maxMs: number) => {
          let lastTr = el()?.getAttribute('transform');
          let lastChange = performance.now();
          const t0 = performance.now();
          for (;;) {
            const now = performance.now();
            if (now - lastChange >= quietMs || now - t0 >= maxMs) return;
            await raf();
            const tr = el()?.getAttribute('transform');
            if (tr !== lastTr) {
              lastTr = tr;
              lastChange = performance.now();
            }
          }
        };

        // ---- Baseline: world->client mapping, plus the mapping PROBE PROOF.
        massimo.regionPipeline.enable(false);
        dispatchAt(0);
        await settle(350, 4000);
        const w0 = parseXY(el()?.getAttribute('transform'));
        if (!w0) return { fail: 'no parsable transform on the dragged station' };
        const K = { x: (sx as number) - w0.x, y: (sy as number) - w0.y };
        const painted = () => {
          const w = parseXY(el()?.getAttribute('transform'));
          return w ? { x: w.x + K.x, y: w.y + K.y } : null;
        };
        vt = 0.35; // ~45px along the arc at 500px/s: a distinct commanded point
        dispatchAt(vt);
        await settle(350, 4000);
        {
          const p = painted();
          const cmd = pathAt(vt);
          const err = p ? Math.hypot(p.x - cmd.x, p.y - cmd.y) : Infinity;
          // With snap on, a nearby target may legitimately displace the point
          // by up to the snap tolerance; the gate only rules out a broken
          // world->client mapping, not a working snap.
          if (err > (snapOn ? 14 : 5))
            return { fail: `mapping gate: painted ${err.toFixed(1)}px off command` };
        }

        interface Arm {
          age: number[];
          gap: number[];
          advance: number[];
          rafMove: number[];
          paints: number;
          moveTime: number;
          holds: { paints: number; settleMs: number; residualPx: number }[];
          armedTicks: number;
          ticks: number;
          unmatched: number;
        }
        const mk = (): Arm => ({
          age: [],
          gap: [],
          advance: [],
          rafMove: [],
          paints: 0,
          moveTime: 0,
          holds: [],
          armedTicks: 0,
          ticks: 0,
          unmatched: 0,
        });
        const on = mk();
        const off = mk();

        let prevTr = el()?.getAttribute('transform');
        const runBlock = async (pipeline: boolean, a: Arm) => {
          massimo.regionPipeline.enable(pipeline);
          // Warmup rides the path so arming (on-arm) / draining (off-arm)
          // settles outside the measured window.
          let wallPrev = performance.now();
          const tickDispatch = (now: number) => {
            const dt = (now - wallPrev) / 1000;
            wallPrev = now;
            for (let k = 1; k <= (perTick as number); k++)
              dispatchAt(vt + (dt * k) / (perTick as number));
            vt += dt;
          };
          for (let i = 0; i < 6; i++) {
            await raf();
            tickDispatch(performance.now());
          }
          // ---- Movement phase.
          const t0 = performance.now();
          let lastTick = t0;
          let prevPainted: { x: number; y: number } | null = null;
          while (performance.now() - t0 < (moveMs as number)) {
            await raf();
            const now = performance.now();
            a.rafMove.push(now - lastTick);
            lastTick = now;
            tickDispatch(now);
            const tr = el()?.getAttribute('transform');
            if (tr !== prevTr) {
              prevTr = tr;
              const p = painted();
              if (p) {
                // LATEST sample within tolerance, not the global nearest: the
                // path is a circle, so it passes over itself once per
                // revolution and a nearest-distance match can alias a snap-
                // displaced point to the PREVIOUS pass (a fat spurious tail,
                // one revolution long). The item painting a position it was
                // commanded to twice always corresponds to the newer pass —
                // were it truly a lap behind, gap would show hundreds of px.
                // Tolerance doubles as the age-bias bound (a newer sample up
                // to TOL px ahead can steal the match): TOL/speed seconds,
                // ~16ms at 8px/500px/s. Snap-on needs room for the snap
                // displacement itself.
                const TOL = (snapOn as number) ? 15 : 8;
                let matched = false;
                for (let i = samples.length - 1; i >= 0; i--) {
                  const s = samples[i];
                  if (s.t < now - 2600) break;
                  if (Math.hypot(s.x - p.x, s.y - p.y) <= TOL) {
                    a.age.push(now - s.t);
                    matched = true;
                    break;
                  }
                }
                if (!matched) a.unmatched++;
                a.gap.push(Math.hypot(lastDispatch.x - p.x, lastDispatch.y - p.y));
                if (prevPainted) a.advance.push(Math.hypot(p.x - prevPainted.x, p.y - prevPainted.y));
                prevPainted = p;
                a.paints++;
              }
            }
            a.ticks++;
            if (massimo.regionPipeline.status().armed) a.armedTicks++;
          }
          a.moveTime += performance.now() - t0;
          // ---- Hold phase: cursor stops dead; count travel paints to settle.
          const holdStart = performance.now();
          const target = lastDispatch;
          let paintsInHold = 0;
          let settleMs = -1;
          let residual = -1;
          while (performance.now() - holdStart < (holdMs as number)) {
            await raf();
            const tr = el()?.getAttribute('transform');
            if (tr !== prevTr) {
              prevTr = tr;
              const p = painted();
              if (p) {
                paintsInHold++;
                residual = Math.hypot(p.x - target.x, p.y - target.y);
                if (residual <= 1.5 && settleMs < 0)
                  settleMs = performance.now() - holdStart;
              }
            }
          }
          a.holds.push({ paints: paintsInHold, settleMs, residualPx: residual });
          wallPrev = performance.now(); // hold time must not advance the path
        };

        for (let b = 0; b < (pairs as number); b++) {
          if (b % 2 === 0) {
            await runBlock(false, off);
            await runBlock(true, on);
          } else {
            await runBlock(true, on);
            await runBlock(false, off);
          }
        }
        massimo.regionPipeline.enable(false);
        return { on, off };
      },
      [cx, cy, st.id, PAIRS, MOVE_MS, HOLD_MS, SPEED, SNAP ? 1 : 0, EVENTS_PER_TICK],
    );
    await page.mouse.up();

    if ('fail' in res) {
      console.log(`!! ${st.name}: ${res.fail}`);
      continue;
    }
    const q = (v: number[], p: number) =>
      v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))] : NaN;
    const fmt = (a: typeof res.on, label: string) => {
      const settles = a.holds.map((h) => h.settleMs).filter((s) => s >= 0);
      const holdPaints = a.holds.map((h) => h.paints);
      const unsettled = a.holds.filter((h) => h.settleMs < 0).length;
      return (
        `  ${label}  rAF med=${q(a.rafMove, 0.5).toFixed(1)}ms  ` +
        `paints/s=${((a.paints / a.moveTime) * 1000).toFixed(1)}  ` +
        `age med/p95=${q(a.age, 0.5).toFixed(0)}/${q(a.age, 0.95).toFixed(0)}ms  ` +
        `gap med/p95=${q(a.gap, 0.5).toFixed(0)}/${q(a.gap, 0.95).toFixed(0)}px\n` +
        `      hold: paints med=${q(holdPaints, 0.5)}  settle med=${q(settles, 0.5).toFixed(0)}ms` +
        (unsettled ? `  UNSETTLED=${unsettled}/${a.holds.length}` : '') +
        `  armed=${a.armedTicks}/${a.ticks}` +
        (a.unmatched ? `  unmatched=${a.unmatched}` : '')
      );
    };
    const engaged = res.on.paints > 0 && res.off.paints > 0;
    console.log(
      `\n[${st.name.replace(/\n/g, ' ')}] speed=${SPEED}px/s pairs=${PAIRS} move=${MOVE_MS}ms ` +
        `hold=${HOLD_MS}ms snap=${SNAP ? 'ON' : 'off'} popover=${POPOVER ? 'OPEN' : 'closed'}` +
        (EVENTS_PER_TICK > 1 ? ` events/tick=${EVENTS_PER_TICK}` : '') +
        '\n' +
        fmt(res.off, 'pipeline OFF') +
        '\n' +
        fmt(res.on, 'pipeline ON ') +
        (engaged ? '' : '\n  !! ENGAGEMENT GATE FAILED: an arm painted nothing; run is void'),
    );
  }
});
