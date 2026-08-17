/* Shared rig for the gesture-start harnesses: map loading, page seeding, and
 * the in-page latency probe.
 *
 * This lives in a module rather than in whichever spec wrote it first because
 * the probe is the part that took three revisions to get honest (see
 * `installProbes`), and a second harness re-deriving it would re-derive the
 * bugs with it.
 */
import { type Page } from '@playwright/test';
import { readPerfMap } from './perfMap';

export interface Vertex {
  x: number;
  y: number;
}
export interface DocShape {
  stations: Record<string, { id: string; name: string; x: number; y: number }>;
  polygons: Record<string, { locked?: boolean; vertices: Vertex[] }>;
  regionAssignments: Record<string, unknown>;
  [k: string]: unknown;
}

/** One input event, timed by the page itself from arrival to the task after
 *  the next paint. */
export interface LatencySample {
  name: string;
  /** OS event stamp -> our capture listener: queueing on a busy main thread. */
  delayMs: number;
  /** Capture listener -> first task after the next paint: the app's work. */
  toPaintMs: number;
}

export function loadDoc(): DocShape {
  const doc = (JSON.parse(readPerfMap()) as { doc: DocShape }).doc;
  if (process.env.PERF_NO_REGIONS) doc.regionAssignments = {};
  // PERF_KEEP=<n>: keep only the n stations nearest the map's centre of mass.
  // The question this answers is whether gesture-start latency is a property of
  // WHAT the gesture does or of HOW BIG the painted tree is — if the compositor
  // is re-committing the whole layer, the cost tracks node count and nothing
  // else. Lines keep only edges whose endpoints both survive.
  const keep = Number(process.env.PERF_KEEP ?? 0);
  if (keep > 0) {
    const all = Object.values(doc.stations);
    const mid = {
      x: all.reduce((a, s) => a + s.x, 0) / all.length,
      y: all.reduce((a, s) => a + s.y, 0) / all.length,
    };
    const near = [...all]
      .sort(
        (a, b) =>
          (a.x - mid.x) ** 2 + (a.y - mid.y) ** 2 - ((b.x - mid.x) ** 2 + (b.y - mid.y) ** 2),
      )
      .slice(0, keep);
    const ids = new Set(near.map((s) => s.id));
    doc.stations = Object.fromEntries(near.map((s) => [s.id, s]));
    const lines = doc.lines as Record<string, { stations: string[]; edges: string[] }>;
    for (const l of Object.values(lines)) {
      l.stations = l.stations.filter((id) => ids.has(id));
      l.edges = l.edges.filter((e) => e.split('|').every((id) => ids.has(id)));
    }
    doc.transfers = Object.fromEntries(
      Object.entries(
        doc.transfers as Record<string, { a: { stationId?: string }; b: { stationId?: string } }>,
      ).filter(
        ([, t]) => (!t.a.stationId || ids.has(t.a.stationId)) && (!t.b.stationId || ids.has(t.b.stationId)),
      ),
    );
  }
  return doc;
}

export const centroid = (vs: Vertex[]): Vertex => ({
  x: vs.reduce((a, v) => a + v.x, 0) / vs.length,
  y: vs.reduce((a, v) => a + v.y, 0) / vs.length,
});

export async function seedAt(page: Page, doc: DocShape, centre: Vertex): Promise<void> {
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

/**
 * Install the probes once; each round reads and clears their buffers.
 *
 * Latency is timed by the PAGE, not by the Event Timing API. Event Timing
 * looked like the obvious instrument and is the reason this harness reported
 * fiction for three revisions: it only emits entries for what it considers an
 * interaction, so a middle-button press and a drag-style press produce NOTHING,
 * and the natural `Math.max(0, ...entries)` renders that absence as a
 * beautiful 0ms. Four of six gestures were "0ms" because they were unmeasured.
 *
 * A CAPTURE-phase window listener has none of that discretion — it sees every
 * event, before React's root handler, so t0 is genuinely "the app has done
 * nothing yet". requestAnimationFrame -> setTimeout(0) closes the interval on
 * the first task after the next paint. `probeFloor` below measures the same
 * interval doing nothing, so every number has a stated noise floor, and callers
 * assert a sample count so an unmeasured gesture fails instead of reporting
 * zero.
 */
export const PROBED_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'click'] as const;

export async function installProbes(page: Page): Promise<void> {
  await page.evaluate((types: readonly string[]) => {
    interface Probe {
      lat: { name: string; delayMs: number; toPaintMs: number }[];
      longTasks: number[];
    }
    const w = window as unknown as { __probe?: Probe };
    if (w.__probe) return;
    const probe: Probe = { lat: [], longTasks: [] };
    w.__probe = probe;
    for (const type of types) {
      window.addEventListener(
        type,
        (e) => {
          const t0 = performance.now();
          const delayMs = t0 - e.timeStamp;
          requestAnimationFrame(() =>
            setTimeout(() => {
              probe.lat.push({ name: type, delayMs, toPaintMs: performance.now() - t0 });
            }, 0),
          );
        },
        true,
      );
    }
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) probe.longTasks.push(e.duration);
    }).observe({ type: 'longtask' } as PerformanceObserverInit);
  }, PROBED_EVENTS as unknown as string[]);
}

/** The instrument's own cost: the identical rAF -> setTimeout(0) interval with
 *  nothing between it, on the same idle page. Every latency is only meaningful
 *  against this. */
export const probeFloor = (page: Page, reps = 15) =>
  page.evaluate(async (n: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await new Promise<void>((res) =>
        requestAnimationFrame(() =>
          setTimeout(() => {
            out.push(performance.now() - t0);
            res();
          }, 0),
        ),
      );
      await new Promise((res) => setTimeout(res, 40));
    }
    return out;
  }, reps);

export const resetProbe = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __probe: { lat: unknown[]; longTasks: number[] } };
    w.__probe.lat.length = 0;
    w.__probe.longTasks.length = 0;
  });

/** Drain the probes. A rAF+timeout lets the last entries flush first. */
export const readProbe = (page: Page) =>
  page.evaluate(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(() => r(), 60)));
    const w = window as unknown as {
      __probe: {
        lat: { name: string; delayMs: number; toPaintMs: number }[];
        longTasks: number[];
      };
    };
    return { lat: [...w.__probe.lat], longTasks: [...w.__probe.longTasks] };
  });

export const med = (xs: number[]): number =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
