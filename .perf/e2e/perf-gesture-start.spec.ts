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
import {
  centroid,
  installProbes,
  type LatencySample,
  loadDoc,
  med,
  probeFloor,
  readProbe,
  resetProbe,
  seedAt,
  sum,
} from '../gestureProbe';

const REPS = Number(process.env.PERF_REPS ?? 5);

interface Round {
  lat: LatencySample[];
  longTasks: number[];
  engaged: boolean;
  wallMs: number;
}

const sel = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __massimo: { stores: { selection: { getState: () => Record<string, unknown> } } };
        }
      ).__massimo.stores.selection.getState() as Record<string, unknown>,
  );

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

  // Where the painted nodes actually are. Gesture-start latency is linear in
  // this count (~4µs per node), and it is the only lever that does not depend
  // on zoom — culling buys nothing with the whole map on screen, which is a
  // normal working view for a transit diagram.
  if (process.env.PERF_CENSUS) {
    const census = await page.evaluate(() => {
      const svg = document.querySelector('.canvas-pan-layer > svg')!;
      const all = [...svg.querySelectorAll('*')];
      const byTag = new Map<string, number>();
      const byOwner = new Map<string, number>();
      const OWNERS = [
        'data-station-id',
        'data-transfer-id',
        'data-line-id',
        'data-polygon-id',
        'data-text-label-id',
        'data-bullet-id',
        'data-guide-id',
        'data-line-tag-id',
        'data-svg-image-id',
      ];
      for (const el of all) {
        byTag.set(el.tagName, (byTag.get(el.tagName) ?? 0) + 1);
        let owner = 'other/chrome';
        if (el.closest('defs')) owner = 'defs';
        else {
          for (const a of OWNERS) {
            if (el.closest(`[${a}]`)) {
              owner = a.replace('data-', '').replace('-id', '');
              break;
            }
          }
        }
        byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1);
      }
      // One station's whole subtree, so "nodes per station" has a shape.
      const st = svg.querySelector('[data-station-id]');
      const stTags = new Map<string, number>();
      if (st) {
        for (const el of [st, ...st.querySelectorAll('*')]) {
          stTags.set(el.tagName, (stTags.get(el.tagName) ?? 0) + 1);
        }
      }
      // How much of the <g> mass is pure wrapping — a group carrying no
      // attributes, or one child, or both (which is free to delete).
      const gs = all.filter((el) => el.tagName === 'g');
      const gNoAttrs = gs.filter((el) => el.attributes.length === 0).length;
      const gOneChild = gs.filter((el) => el.children.length === 1).length;
      const gCollapsible = gs.filter(
        (el) => el.attributes.length === 0 && el.children.length <= 1,
      ).length;
      // What the unattributed majority actually is: the nearest ancestor
      // carrying ANY data- attribute names the layer it belongs to.
      const layer = new Map<string, number>();
      for (const el of all) {
        let n: Element | null = el;
        let name = '(svg root)';
        while (n && n !== svg) {
          const attr = [...n.attributes].find((a) => a.name.startsWith('data-'));
          if (attr) {
            name = attr.name;
            break;
          }
          n = n.parentElement;
        }
        layer.set(name, (layer.get(name) ?? 0) + 1);
      }
      return {
        total: all.length,
        gTotal: gs.length,
        gNoAttrs,
        gOneChild,
        gCollapsible,
        layer: [...layer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
        stations: svg.querySelectorAll('[data-station-id]').length,
        byTag: [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
        byOwner: [...byOwner.entries()].sort((a, b) => b[1] - a[1]),
        stTags: [...stTags.entries()].sort((a, b) => b[1] - a[1]),
        stTotal: st ? 1 + st.querySelectorAll('*').length : 0,
      };
    });
    console.log(`\n=== painted node census (${census.total} nodes in the map svg) ===`);
    console.log('  --- by owner ---');
    for (const [k, n] of census.byOwner) {
      console.log(`  ${String(n).padStart(6)}  ${((n / census.total) * 100).toFixed(1).padStart(5)}%  ${k}`);
    }
    console.log('  --- by tag ---');
    for (const [k, n] of census.byTag) {
      console.log(`  ${String(n).padStart(6)}  ${((n / census.total) * 100).toFixed(1).padStart(5)}%  ${k}`);
    }
    console.log('  --- <g> wrapping ---');
    console.log(
      `  ${String(census.gTotal).padStart(6)}  total <g>;  ${census.gNoAttrs} carry NO attributes;  ${census.gOneChild} have ONE child;  ${census.gCollapsible} are both (free to delete)`,
    );
    console.log('  --- by nearest data- ancestor (which layer the nodes belong to) ---');
    for (const [k, n] of census.layer) {
      console.log(`  ${String(n).padStart(6)}  ${((n / census.total) * 100).toFixed(1).padStart(5)}%  ${k}`);
    }
    console.log(
      `  --- one station: ${census.stTotal} nodes (${census.stations} stations on the map) ---`,
    );
    console.log(`  ${census.stTags.map(([t, n]) => `${t}×${n}`).join('  ')}`);
  }

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
  // PERF_PAN_ONLY runs just the middle-click block, which needs only a
  // background point — that is what lets the scale sweep trim the map down to
  // sizes where no station lands near the camera.
  const panOnly = !!process.env.PERF_PAN_ONLY;
  if (!points.bg) throw new Error(`no background hit point: ${JSON.stringify(points)}`);
  if (!panOnly && !points.station) throw new Error(`no station hit point`);
  const st = points.station ?? { x: 0, y: 0, id: '' };
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
    const { lat, longTasks } = await readProbe(page);
    return { lat, longTasks, engaged: await gate(), wallMs };
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
        const on = await page.locator('.canvas-host.panning').count();
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
        const on = await page.locator('.canvas-host.panning').count();
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

  const floor0 = (await probeFloor(page)).sort((a, b) => a - b);
  console.log(
    `\n  PROBE FLOOR (rAF -> setTimeout with no work): med ${med(floor0).toFixed(1)}ms  max ${floor0[floor0.length - 1].toFixed(1)}ms`,
  );
  console.log(`\n=== gesture-start latency, real input, median of ${REPS} ===`);
  console.log(
    '  gesture               engaged  samples   delay ms   worst→paint   longtask ms   wall ms',
  );
  const failures: string[] = [];
  for (const g of panOnly ? [] : gestures) {
    await round(g.act, g.gate, g.reset); // warm-up, discarded
    const delay: number[] = [];
    const worstPaint: number[] = [];
    const lt: number[] = [];
    const wall: number[] = [];
    const samples: number[] = [];
    let engagedAll = true;
    for (let i = 0; i < REPS; i++) {
      const r = await round(g.act, g.gate, g.reset);
      engagedAll &&= r.engaged;
      const mine = r.lat.filter((e) => g.of.includes(e.name));
      samples.push(mine.length);
      // The costliest single event of the gesture — a gesture is felt as its
      // worst frame, not its average one.
      if (mine.length) {
        worstPaint.push(Math.max(...mine.map((e) => e.toPaintMs)));
        delay.push(med(mine.map((e) => e.delayMs)));
      }
      lt.push(sum(r.longTasks));
      wall.push(r.wallMs);
    }
    if (!engagedAll) failures.push(`${g.label} (never engaged)`);
    // A gesture that produced no timing samples measured NOTHING. That is a
    // broken instrument, not a fast gesture, and it is exactly how this table
    // reported fiction for three revisions — so it fails the run.
    if (sum(samples) === 0) failures.push(`${g.label} (no latency samples)`);
    const cell = (xs: number[], dp: number, w: number) =>
      (xs.length ? med(xs).toFixed(dp) : '—').padStart(w);
    console.log(
      `  ${g.label.padEnd(20)} ${(engagedAll ? 'yes' : 'NO').padStart(6)} ` +
        `${med(samples).toFixed(0).padStart(8)} ${cell(delay, 1, 10)} ` +
        `${cell(worstPaint, 1, 13)} ${med(lt).toFixed(0).padStart(13)} ${med(wall).toFixed(0).padStart(9)}`,
    );
  }

  // Middle-click -> pan armed, at finer resolution than the table above can
  // give: Event Timing quantizes `duration` to 8ms, so a fast gesture reports a
  // flat 0 and the wall column is mostly this harness's own settle waits. The
  // page times itself instead — a CAPTURE-phase listener on window runs before
  // React's root handler, so t0 is genuinely "the app has done nothing yet",
  // and the first task after the next paint closes the interval. `inputDelay`
  // is the gap between the OS event stamp and that listener: queueing, i.e.
  // what a busy main thread would add.
  {
    const PAN_REPS = Number(process.env.PERF_PAN_REPS ?? 15);
    const floor = await probeFloor(page);
    /** Drain the shared probe, keeping only presses. */
    const readPresses = async () => {
      await resetProbeAfterRead();
      return pressBuf.splice(0, pressBuf.length);
    };
    const pressBuf: LatencySample[] = [];
    async function resetProbeAfterRead() {
      const { lat } = await readProbe(page);
      pressBuf.push(...lat.filter((e) => e.name === 'pointerdown'));
      await resetProbe(page);
    }

    // CONTROL: the identical middle-press, at a point OUTSIDE .canvas-host, so
    // MapCanvas's handler never runs and no pan is armed. Same probe, same
    // page, same button — the only difference is whether the app does its
    // pan-arm work. This is what separates "the app costs 90ms" from "a middle
    // press costs 90ms".
    // Scan the window for a point that is neither canvas nor an interactive
    // control — pressing a button or field would measure that instead.
    const offCanvas = await page.evaluate(() => {
      for (let y = 4; y < window.innerHeight; y += 12) {
        for (let x = 4; x < window.innerWidth; x += 12) {
          const el = document.elementFromPoint(x, y);
          if (!el || el.closest('.canvas-host')) continue;
          if (el.closest('button,input,select,textarea,a,[role="button"],[role="menuitem"]')) {
            continue;
          }
          return { x, y };
        }
      }
      return null;
    });
    const offCanvasIsClear = offCanvas != null;
    await resetProbe(page);
    let controlSamples: LatencySample[] = [];
    if (offCanvas) {
      for (let i = 0; i < PAN_REPS; i++) {
        await page.mouse.move(offCanvas.x + (i % 3), offCanvas.y + (i % 3));
        await page.waitForTimeout(60);
        await page.mouse.down({ button: 'middle' });
        await page.waitForTimeout(90);
        await page.mouse.up({ button: 'middle' });
        await page.waitForTimeout(60);
      }
      controlSamples = await readPresses();
    }

    let armed = 0;
    for (let i = 0; i < PAN_REPS; i++) {
      await page.mouse.move(bg.x + (i % 5), bg.y + (i % 3));
      await page.waitForTimeout(60);
      await page.mouse.down({ button: 'middle' });
      await page.waitForTimeout(90);
      // Armed = the pan is live AND the cursor overlay is the element under the
      // pointer. The second half is not decoration: the overlay is how the
      // "grabbing" cursor is served now, and if it were not hit-tested the
      // gesture would simply have lost its cursor — a fast number bought by
      // deleting the feature.
      const state = await page.evaluate(
        ([px, py]) => ({
          panning: !!document.querySelector('.canvas-host.panning'),
          overlayUnderPointer: !!document
            .elementFromPoint(px as number, py as number)
            ?.classList.contains('pan-cursor-overlay'),
        }),
        [bg.x + (i % 5), bg.y + (i % 3)],
      );
      if (state.panning && state.overlayUnderPointer) armed++;
      await page.mouse.up({ button: 'middle' });
      await page.waitForTimeout(60);
    }
    const panSamples = await readPresses();
    const toPaint = panSamples.map((s) => s.toPaintMs).sort((a, b) => a - b);
    const delays = panSamples.map((s) => s.delayMs).sort((a, b) => a - b);
    const p = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))];
    const floorSorted = [...floor].sort((a, b) => a - b);
    console.log(`\n=== middle-click -> pan armed, ${panSamples.length} presses ===`);
    console.log(`  armed ${armed}/${PAN_REPS}   (samples ${panSamples.length}/${PAN_REPS})`);
    console.log(
      `  PROBE FLOOR (same interval, no press):  med ${med(floorSorted).toFixed(1)}ms   max ${floorSorted[floorSorted.length - 1].toFixed(1)}ms`,
    );
    if (!offCanvasIsClear) {
      console.log(`  CONTROL: no off-canvas point found — control skipped`);
    } else {
      const ctl = controlSamples.map((s) => s.toPaintMs).sort((a, b) => a - b);
      console.log(
        `  CONTROL middle-press at ${offCanvas!.x},${offCanvas!.y} (off canvas, no pan armed), ${ctl.length} presses:  med ${ctl.length ? med(ctl).toFixed(1) : '—'}ms`,
      );
    }
    if (toPaint.length) {
      console.log(
        `  press -> painted:  med ${med(toPaint).toFixed(1)}ms   p90 ${p(toPaint, 0.9).toFixed(1)}ms   max ${toPaint[toPaint.length - 1].toFixed(1)}ms   min ${toPaint[0].toFixed(1)}ms`,
      );
      console.log(
        `  input delay:       med ${med(delays).toFixed(1)}ms   p90 ${p(delays, 0.9).toFixed(1)}ms   max ${delays[delays.length - 1].toFixed(1)}ms`,
      );
    }
    // An un-armed press measured nothing, same rule as the gestures above.
    expect(armed, 'middle-press never armed a pan').toBe(PAN_REPS);
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
