/* THROWAWAY browser perf harness — not part of the suite.
 *
 *   PORT=5236 npx playwright test -c .perf/playwright.perf-prod.config.ts perf-gesture-start
 *
 * Resolves its map through perfMap.ts like every other harness here, so with
 * nothing dropped in .perf/ it runs on the committed mta-v23 drawing. Needs a
 * map with a LOCKED POLYGON (mta-v23 has three) for the deep-pick case.
 *
 * The complaint this exists for is NOT the drag frame (that has its own
 * harnesses) — it is the GAP BEFORE a gesture starts:
 *
 *   - click-to-pan: ~1s before the map begins moving
 *   - mouseover a station: visible delay before the hover highlight appears
 *   - mousedown on a station: ~1s before the drag engages (the drag itself is fine)
 *   - alt+click a locked polygon: 2-3s
 *
 * REAL mouse input only. The first cut of this harness dispatched synthetic
 * PointerEvents and measured a flat ~15ms for everything — a null result that
 * was entirely an artefact: a synthesized pointermove fires no
 * pointerover/pointerenter, so the hover never engaged, and a synthetic
 * pointerId cannot be captured, so startPan threw instead of panning. Every
 * gesture below therefore drives page.mouse / page.keyboard and asserts an
 * ENGAGEMENT GATE (the store field or DOM class the gesture is supposed to
 * change). A gesture that does not engage fails the run rather than reporting
 * a fast number.
 *
 * Timing comes from the Event Timing API, which is what the browser itself
 * calls input latency: `processingEnd - processingStart` is the handler (plus
 * React's discrete flush), `duration` is event-to-next-paint, quantized to 8ms.
 * A longtask observer catches whatever lands outside a handler.
 */
import { test, expect, type Page } from '@playwright/test';
import { readPerfMap } from '../perfMap';

const REPS = Number(process.env.PERF_REPS ?? 5);

interface Vertex {
  x: number;
  y: number;
}
interface DocShape {
  stations: Record<string, { id: string; name: string; x: number; y: number }>;
  polygons: Record<string, { locked?: boolean; vertices: Vertex[] }>;
  regionAssignments: Record<string, unknown>;
  [k: string]: unknown;
}

interface EventEntry {
  name: string;
  handlerMs: number;
  durationMs: number;
  delayMs: number;
}
interface Round {
  events: EventEntry[];
  longTasks: number[];
  engaged: boolean;
  wallMs: number;
}

function loadDoc(): DocShape {
  const doc = (JSON.parse(readPerfMap()) as { doc: DocShape }).doc;
  if (process.env.PERF_NO_REGIONS) doc.regionAssignments = {};
  return doc;
}

const centroid = (vs: Vertex[]): Vertex => ({
  x: vs.reduce((a, v) => a + v.x, 0) / vs.length,
  y: vs.reduce((a, v) => a + v.y, 0) / vs.length,
});

async function seedAt(page: Page, doc: DocShape, centre: Vertex): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([key, value, vkey, vp]) => {
      localStorage.setItem(key as string, value as string);
      localStorage.setItem(vkey as string, vp as string);
    },
    [
      'vignelli-map-doc-v1',
      JSON.stringify({ version: 22, state: doc }),
      'massimo-viewport',
      JSON.stringify({ state: { x: centre.x, y: centre.y, zoom: 1 }, version: 0 }),
    ],
  );
  await page.reload();
  await page.waitForSelector('.canvas-host svg');
  await page.waitForTimeout(2500);
}

/** Install the observers once; each round reads and clears their buffers. */
async function installProbes(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface Probe {
      events: { name: string; handlerMs: number; durationMs: number; delayMs: number }[];
      longTasks: number[];
    }
    const w = window as unknown as { __probe?: Probe };
    if (w.__probe) return;
    const probe: Probe = { events: [], longTasks: [] };
    w.__probe = probe;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        probe.events.push({
          name: e.name,
          handlerMs: e.processingEnd - e.processingStart,
          durationMs: e.duration,
          delayMs: e.processingStart - e.startTime,
        });
      }
    }).observe({ type: 'event', durationThreshold: 0 } as PerformanceObserverInit);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) probe.longTasks.push(e.duration);
    }).observe({ type: 'longtask' } as PerformanceObserverInit);
  });
}

const resetProbe = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __probe: { events: unknown[]; longTasks: number[] } };
    w.__probe.events.length = 0;
    w.__probe.longTasks.length = 0;
  });

/** Drain the observers. A rAF+timeout lets the last entries flush first. */
const readProbe = (page: Page) =>
  page.evaluate(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(() => r(), 60)));
    const w = window as unknown as {
      __probe: {
        events: { name: string; handlerMs: number; durationMs: number; delayMs: number }[];
        longTasks: number[];
      };
    };
    return { events: [...w.__probe.events], longTasks: [...w.__probe.longTasks] };
  });

const sel = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __massimo: { stores: { selection: { getState: () => Record<string, unknown> } } };
        }
      ).__massimo.stores.selection.getState() as Record<string, unknown>,
  );

const med = (xs: number[]): number =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

test('gesture-start latency', async ({ page }) => {
  test.setTimeout(900_000);
  const doc = loadDoc();
  const lockedPoly = Object.values(doc.polygons).find((p) => p.locked && p.vertices?.length);
  if (!lockedPoly) throw new Error('map has no locked polygon — the alt-click case needs one');

  await seedAt(page, doc, centroid(lockedPoly.vertices));
  await installProbes(page);

  const counters = await page.evaluate(() =>
    (
      window as unknown as { __massimo: { counters: () => Record<string, number> } }
    ).__massimo.counters(),
  );
  console.log(`\n=== map loaded ===`);
  console.log(
    `  stations ${counters.stations}  lines ${counters.lines}  assignments ${counters.regionAssignments}`,
  );
  console.log(
    `  svgNodes ${counters.svgNodes}  defsNodes ${counters.defsNodes}  clipPaths ${counters.clipPaths}`,
  );

  const host = (await page.locator('.canvas-host').boundingBox())!;
  const cx = Math.round(host.x + host.width / 2);
  const cy = Math.round(host.y + host.height / 2);

  // The station point must belong to an UNLOCKED station: `onStartDrag` bails
  // on a locked one without capturing the gesture, so the press gesture would
  // measure a press that engaged nothing.
  const points = await page.evaluate(
    ([ox, oy]) => {
      const stations = (
        window as unknown as {
          __massimo: {
            stores: {
              doc: { getState: () => { stations: Record<string, { locked?: boolean }> } };
            };
          };
        }
      ).__massimo.stores.doc.getState().stations;
      const stationIdAt = (x: number, y: number): string | null => {
        const el = document.elementFromPoint(x, y)?.closest('[data-station-id]');
        const id = el?.getAttribute('data-station-id') ?? null;
        return id && stations[id] && !stations[id].locked ? id : null;
      };
      const isBg = (x: number, y: number) => !!document.elementFromPoint(x, y)?.closest('[data-bg]');
      let station: { x: number; y: number; id: string } | null = null;
      let bg: { x: number; y: number } | null = null;
      for (let r = 0; r <= 500 && (!station || !bg); r += 5) {
        for (let a = 0; a < 24; a++) {
          const x = Math.round((ox as number) + r * Math.cos((a * Math.PI) / 12));
          const y = Math.round((oy as number) + r * Math.sin((a * Math.PI) / 12));
          const id = stationIdAt(x, y);
          if (id && !station) station = { x, y, id };
          if (isBg(x, y) && !bg) bg = { x, y };
        }
      }
      return { station, bg };
    },
    [cx, cy],
  );
  if (!points.station || !points.bg) throw new Error(`no hit points: ${JSON.stringify(points)}`);
  const st = points.station;
  const bg = points.bg;
  console.log(`  station ${st.id} @ ${st.x},${st.y}   bg ${bg.x},${bg.y}   polygon ${cx},${cy}`);

  /** The dragged station's world position — the press gestures' engagement gate. */
  const stationPos = (id: string) =>
    page.evaluate((sid) => {
      const s = (
        window as unknown as {
          __massimo: {
            stores: {
              doc: { getState: () => { stations: Record<string, { x: number; y: number }> } };
            };
          };
        }
      ).__massimo.stores.doc.getState().stations[sid as string];
      return { x: s.x, y: s.y };
    }, id);

  // Where the pressed station sat before the current round, so the gate can ask
  // whether the press actually moved it. Re-read every reset, so a drag the undo
  // below failed to restore cannot make a later round's gate lie.
  let pressedFrom = { x: 0, y: 0 };
  const armPress = async () => {
    pressedFrom = await stationPos(st.id);
  };
  /** Did the press engage a drag, and put the station back afterwards. */
  const pressEngagedThenUndo = async (): Promise<boolean> => {
    const now = await stationPos(st.id);
    const moved = now.x !== pressedFrom.x || now.y !== pressedFrom.y;
    await page.mouse.up();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    return moved;
  };
  // Far enough that the snap engine cannot land the station back on its own
  // position — a small oscillation commits nothing and is invisible to the gate.
  const DRAG_PX = { dx: 40, dy: 24 };

  /** Run one gesture round: reset, act, drain, gate. */
  async function round(
    act: () => Promise<void>,
    gate: () => Promise<boolean>,
    reset: () => Promise<void>,
  ): Promise<Round> {
    await reset();
    await page.waitForTimeout(120);
    await resetProbe(page);
    const t0 = Date.now();
    await act();
    const wallMs = Date.now() - t0;
    const { events, longTasks } = await readProbe(page);
    return { events, longTasks, engaged: await gate(), wallMs };
  }

  const clearHover = async () => {
    await page.mouse.move(host.x + 6, host.y + 6);
    await page.waitForTimeout(80);
  };
  const clearSelection = async () => {
    await page.evaluate(() => {
      const s = (
        window as unknown as {
          __massimo: {
            stores: { selection: { getState: () => { clearSelection?: () => void } } };
          };
        }
      ).__massimo.stores.selection.getState();
      s.clearSelection?.();
    });
  };

  const gestures: {
    label: string;
    act: () => Promise<void>;
    gate: () => Promise<boolean>;
    reset: () => Promise<void>;
    /** Which event names are the gesture's own (others are noise). */
    of: string[];
  }[] = [
    {
      label: 'hover station',
      of: ['pointerover', 'pointerenter', 'mouseover', 'mousemove', 'pointermove'],
      reset: clearHover,
      act: async () => {
        await page.mouse.move(st.x, st.y);
        await page.waitForTimeout(400);
      },
      gate: async () => (await sel(page)).hoveredCanvasItem != null,
    },
    {
      label: 'pan start (middle)',
      of: ['pointerdown', 'mousedown'],
      reset: async () => {
        await page.mouse.move(bg.x, bg.y);
        await page.waitForTimeout(80);
      },
      act: async () => {
        await page.mouse.down({ button: 'middle' });
        await page.waitForTimeout(400);
      },
      gate: async () => {
        const on = await page.locator('.canvas-host svg.panning').count();
        await page.mouse.up({ button: 'middle' });
        await page.waitForTimeout(120);
        return on > 0;
      },
    },
    {
      // The user's actual pan: hand tool, plain left click-drag. Same
      // startPan as the middle-button path, but reached with the whole
      // hand-mode render (locked/interactive flags, cursors) in the way.
      label: 'pan start (hand)',
      of: ['pointerdown', 'mousedown'],
      reset: async () => {
        await page.evaluate(() => {
          (
            window as unknown as {
              __massimo: {
                stores: {
                  selection: { getState: () => { setToolMode: (m: string) => void } };
                };
              };
            }
          ).__massimo.stores.selection.getState().setToolMode('hand');
        });
        await page.mouse.move(bg.x, bg.y);
        await page.waitForTimeout(120);
      },
      act: async () => {
        await page.mouse.down();
        await page.waitForTimeout(400);
      },
      gate: async () => {
        const on = await page.locator('.canvas-host svg.panning').count();
        await page.mouse.up();
        await page.evaluate(() => {
          (
            window as unknown as {
              __massimo: {
                stores: {
                  selection: { getState: () => { setToolMode: (m: string) => void } };
                };
              };
            }
          ).__massimo.stores.selection.getState().setToolMode('arrow');
        });
        await page.waitForTimeout(120);
        return on > 0;
      },
    },
    {
      // The felt "click to pan takes a second" is partly this: the cursor
      // crosses live stations on its way to the press, and each crossing used
      // to queue a whole-map re-measure that the press then waited behind.
      // Sweep across the map, THEN press, and time the pair.
      label: 'sweep then press',
      of: ['pointerdown', 'mousedown', 'pointermove', 'mousemove'],
      reset: async () => {
        await page.mouse.move(host.x + 6, host.y + 6);
        await armPress();
        await page.waitForTimeout(120);
      },
      act: async () => {
        // Cross live map content, LANDING on the station, then press — so this
        // differs from the bare press below by the sweep alone.
        for (let i = 0; i < 5; i++) {
          await page.mouse.move(st.x - 100 + i * 20, st.y - 50 + i * 10);
        }
        await page.mouse.move(st.x, st.y);
        await page.mouse.down();
        await page.mouse.move(st.x + DRAG_PX.dx, st.y + DRAG_PX.dy);
        await page.waitForTimeout(400);
      },
      gate: pressEngagedThenUndo,
    },
    {
      label: 'station press',
      of: ['pointerdown', 'mousedown'],
      reset: async () => {
        await clearSelection();
        await page.mouse.move(st.x, st.y);
        await armPress();
        await page.waitForTimeout(120);
      },
      act: async () => {
        await page.mouse.down();
        await page.mouse.move(st.x + DRAG_PX.dx, st.y + DRAG_PX.dy);
        await page.waitForTimeout(400);
      },
      gate: pressEngagedThenUndo,
    },
    {
      label: 'alt-click polygon',
      of: ['pointerdown', 'mousedown', 'click', 'mouseup', 'pointerup'],
      reset: async () => {
        await clearSelection();
        await page.mouse.move(cx, cy);
        await page.waitForTimeout(120);
      },
      act: async () => {
        await page.keyboard.down('Alt');
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(600);
        await page.keyboard.up('Alt');
      },
      gate: async () => {
        const s = await sel(page);
        const ids = (s.selectedPolygonIds ?? []) as string[];
        return (
          ids.length > 0 ||
          s.selectedLineId != null ||
          ((s.selectedStationIds ?? []) as string[]).length > 0
        );
      },
    },
  ];

  console.log(`\n=== gesture-start latency, real input, median of ${REPS} ===`);
  console.log('  gesture               engaged   handler ms   dur ms   longtask ms   wall ms');
  const failures: string[] = [];
  for (const g of gestures) {
    await round(g.act, g.gate, g.reset); // warm-up, discarded
    const handler: number[] = [];
    const dur: number[] = [];
    const lt: number[] = [];
    const wall: number[] = [];
    let engagedAll = true;
    const worst: EventEntry[] = [];
    for (let i = 0; i < REPS; i++) {
      const r = await round(g.act, g.gate, g.reset);
      engagedAll &&= r.engaged;
      const mine = r.events.filter((e) => g.of.includes(e.name));
      handler.push(sum(mine.map((e) => e.handlerMs)));
      dur.push(Math.max(0, ...mine.map((e) => e.durationMs)));
      lt.push(sum(r.longTasks));
      wall.push(r.wallMs);
      for (const e of mine) if (e.handlerMs > 30) worst.push(e);
    }
    if (!engagedAll) failures.push(g.label);
    console.log(
      `  ${g.label.padEnd(20)} ${(engagedAll ? 'yes' : 'NO').padStart(6)} ` +
        `${med(handler).toFixed(1).padStart(11)} ${med(dur).toFixed(0).padStart(8)} ` +
        `${med(lt).toFixed(0).padStart(13)} ${med(wall).toFixed(0).padStart(9)}`,
    );
    for (const e of worst.slice(0, 4)) {
      console.log(
        `      slow ${e.name}: handler ${e.handlerMs.toFixed(0)}ms, delay ${e.delayMs.toFixed(0)}ms, dur ${e.durationMs.toFixed(0)}ms`,
      );
    }
  }

  // A webfont arriving mid-session is the other whole-map re-measure: App.tsx
  // drops the measurement cache on `document.fonts` 'loadingdone', which fires
  // whenever a label first uses a weight that has not been fetched. Trigger a
  // REAL face load (fonts.load(), not a synthesized event — a dispatched event
  // would prove only that the listener runs) on a fully rendered map, and time
  // what follows. One shot: the face is loaded afterwards.
  {
    await resetProbe(page);
    const loaded = await page.evaluate(async () => {
      const unloaded = [...(document.fonts as unknown as Iterable<FontFace>)].find(
        (f) => f.family.includes('Soehne') && f.status !== 'loaded',
      );
      if (!unloaded) return null;
      const decl = `${unloaded.style} ${unloaded.weight} 16px ${unloaded.family}`;
      await document.fonts.load(`${unloaded.weight} 16px "${unloaded.family}"`);
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(() => r(), 400)));
      return decl;
    });
    const after = await readProbe(page);
    console.log(`\n=== mid-session webfont arrival ===`);
    if (!loaded) {
      console.log('  every Soehne face was already loaded — nothing to measure');
    } else {
      console.log(`  loaded ${loaded}`);
      console.log(
        `  long tasks: ${after.longTasks.length}, total ${sum(after.longTasks).toFixed(0)}ms, worst ${Math.max(0, ...after.longTasks).toFixed(0)}ms`,
      );
    }
  }

  // PERF_TRACE: the renderer's own timeline. The JS sampling profiler reports
  // ~0ms busy for these gestures while the long task runs ~750ms, which is the
  // profiler telling the truth — the cost is style recalc / layout / paint over
  // a 16k-node SVG, and none of it is JavaScript. Only a timeline trace splits
  // those apart.
  if (process.env.PERF_TRACE) {
    for (const g of gestures) {
      if (process.env.PERF_TRACE !== '1' && !g.label.includes(process.env.PERF_TRACE)) continue;
      const cdp = await page.context().newCDPSession(page);
      const evs: { name: string; dur?: number; ph: string; args?: Record<string, unknown> }[] = [];
      cdp.on('Tracing.dataCollected', (d) => {
        evs.push(...(d.value as unknown as typeof evs));
      });
      await cdp.send('Tracing.start', {
        traceConfig: { includedCategories: ['devtools.timeline', 'blink', 'blink.user_timing'] },
      });
      for (let i = 0; i < REPS; i++) await round(g.act, g.gate, g.reset);
      const done = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
      await cdp.send('Tracing.end');
      await done;
      await cdp.detach();

      const byName = new Map<string, { ms: number; n: number }>();
      for (const e of evs) {
        if (e.ph !== 'X' || !e.dur) continue;
        const cur = byName.get(e.name) ?? { ms: 0, n: 0 };
        cur.ms += e.dur / 1000;
        cur.n += 1;
        byName.set(e.name, cur);
      }
      console.log(`\n=== timeline [${g.label}] ${REPS} reps — totals ===`);
      for (const [k, v] of [...byName.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14)) {
        if (v.ms / REPS < 1) break;
        console.log(
          `  ${(v.ms / REPS).toFixed(1).padStart(8)}ms/rep  ${String(Math.round(v.n / REPS)).padStart(5)}x/rep  ${k}`,
        );
      }
      // The aggregate can hide the thing we are hunting: one 700ms block is
      // what the long-task observer sees, and it looks the same in a total as
      // 300 small ones. Longest SINGLE events, which cannot.
      const longest = evs
        .filter((e) => e.ph === 'X' && (e.dur ?? 0) > 20_000)
        .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
        .slice(0, 14);
      console.log(`  --- longest single events (>20ms) ---`);
      for (const e of longest) console.log(`  ${((e.dur ?? 0) / 1000).toFixed(1).padStart(8)}ms  ${e.name}`);
    }
  }

  if (process.env.PERF_PROFILE) {
    for (const g of gestures) {
      if (process.env.PERF_PROFILE !== '1' && !g.label.includes(process.env.PERF_PROFILE)) continue;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
      for (let i = 0; i < REPS; i++) await round(g.act, g.gate, g.reset);
      const { profile } = await cdp.send('Profiler.stop');
      await cdp.detach();

      const byNode = new Map<number, { key: string; self: number }>();
      for (const n of profile.nodes) {
        const f = n.callFrame;
        const url = (f.url || '').split('/').slice(-1)[0].split('?')[0] || '(native)';
        byNode.set(n.id, { key: `${url} :: ${f.functionName || '(anonymous)'}`, self: 0 });
      }
      const deltas = profile.timeDeltas ?? [];
      const samples = profile.samples ?? [];
      for (let i = 0; i < samples.length; i++) {
        const e = byNode.get(samples[i]);
        if (e) e.self += (deltas[i] ?? 0) / 1000;
      }
      const agg = new Map<string, number>();
      for (const { key, self } of byNode.values()) agg.set(key, (agg.get(key) ?? 0) + self);
      const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]);
      const busy = rows.filter(([k]) => !k.includes('(idle)') && !k.includes('(program)'));
      const busyMs = sum(busy.map(([, ms]) => ms));
      console.log(
        `\n=== CPU profile [${g.label}] ${REPS} reps, ${busyMs.toFixed(0)}ms busy (${(busyMs / REPS).toFixed(0)}ms/rep) ===`,
      );
      for (const [k, ms] of busy.slice(0, 24)) {
        if (ms < busyMs * 0.008) break;
        console.log(
          `  ${((ms / busyMs) * 100).toFixed(1).padStart(5)}%  ${(ms / REPS).toFixed(1).padStart(7)}ms/rep  ${k}`,
        );
      }
    }
  }

  // An un-engaged gesture measured nothing; say so loudly rather than let a
  // fast number read as good news (this harness's first cut did exactly that).
  expect(failures, `gestures that never engaged: ${failures.join(', ')}`).toEqual([]);
});
