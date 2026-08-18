/**
 * Scheduler-jitter probe — the backstop behind the gate mutex. The mutex
 * serializes everything that OPTS IN (pre-pr, these harnesses); this catches
 * what didn't: an ad-hoc build, a stray vitest run, anything heavy that
 * bypassed the queue. A busy-spinning thread only stops observing the clock
 * when the OS runs something else on its core, so gaps between consecutive
 * `performance.now()` samples are time stolen by other work — a measure of
 * the actual confounder, unlike process-name sniffing, which cannot tell a
 * foreign pre-pr from this harness's own webserver.
 *
 * Calibrated on the dev machine (Aug 2026): idle reads 0.0ms stolen across
 * repeated windows; a concurrent full vitest suite reads ~30-150ms per 4s
 * with worst gaps of 5-23ms. The 15ms limit sits between those with ~2x
 * margin to the quietest contended window observed. Honest limits: a probe at
 * the run's endpoints can miss a burst that lives entirely between them (a
 * full pre-pr cannot — at 5-7min it outlives any 1-2min harness run — but a
 * fast-failing one could), and light single-core activity steals little from
 * one spinner on a many-core box. It is a backstop, not the design.
 */
export interface ContentionReading {
  stolenMs: number;
  worstGapMs: number;
  windowMs: number;
}

const GAP_MS = 4;
const WINDOW_MS = 4000;
const STOLEN_LIMIT_MS = 15;

export function jitterProbe(windowMs = WINDOW_MS): ContentionReading {
  let prev = performance.now();
  const end = prev + windowMs;
  let stolenMs = 0;
  let worstGapMs = 0;
  for (;;) {
    const now = performance.now();
    if (now >= end) break;
    const gap = now - prev;
    if (gap > GAP_MS) {
      stolenMs += gap;
      if (gap > worstGapMs) worstGapMs = gap;
    }
    prev = now;
  }
  return { stolenMs, worstGapMs, windowMs };
}

/**
 * Probe and stamp; throw CONTENDED when over the limit, so the run fails
 * loudly instead of printing a table that will be read as clean.
 * PERF_ALLOW_CONTENDED=1 downgrades to a warning for deliberate
 * measure-under-load sessions.
 */
export function assertUncontended(when: 'start' | 'end'): void {
  const r = jitterProbe();
  console.log(
    `[perf] contention at ${when}: ${r.stolenMs.toFixed(1)}ms stolen ` +
      `(worst gap ${r.worstGapMs.toFixed(1)}ms) over ${r.windowMs / 1000}s`,
  );
  if (r.stolenMs <= STOLEN_LIMIT_MS) return;
  const msg =
    `CONTENDED at ${when} of run: ${r.stolenMs.toFixed(1)}ms of a ${r.windowMs / 1000}s probe ` +
    `window stolen by other work (limit ${STOLEN_LIMIT_MS}ms). Something heavy is running ` +
    `outside the gate mutex, so this run's numbers are not comparable to anything. Re-run on a ` +
    `calm machine, or set PERF_ALLOW_CONTENDED=1 to keep going anyway.`;
  if (process.env.PERF_ALLOW_CONTENDED) console.warn(`[perf] ${msg}`);
  else throw new Error(msg);
}
