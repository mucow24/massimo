import { acquireGateMutex } from './gateMutex';
import { assertUncontended } from './contention';
import { readPowerMode } from './powerMode';
import { readBrowserGpu, readGpuOverrides } from './gpuInfo';

/**
 * Runs once before any perf spec — wired into both perf playwright configs.
 *
 * First it takes the machine-wide gate mutex (gateMutex.ts), so a perf run
 * and a pre-pr can never overlap, then proves the machine is actually quiet
 * (contention.ts — the mutex only covers work that opted in), and only then
 * stamps the run with the machine states that swing these numbers and are
 * otherwise invisible in the output: the CPU perf mode, which GPU the browser
 * actually binds, and any per-app GPU override that could pin it. Stamps are
 * non-fatal wherever a value can't be read (see powerMode.ts / gpuInfo.ts);
 * the contention check is fatal on purpose. The mutex is released and the
 * machine re-checked in perfGlobalTeardown.ts.
 */
export default async function globalSetup(): Promise<void> {
  await acquireGateMutex('perf');
  assertUncontended('start');
  console.log(`[perf] Lenovo power mode: ${readPowerMode()}`);
  console.log(`[perf] browser GPU: ${await readBrowserGpu()}`);
  const overrides = readGpuOverrides();
  if (overrides.length === 0) {
    console.log('[perf] per-app GPU overrides (DirectX\\UserGpuPreferences): none\n');
  } else {
    console.log('[perf] per-app GPU overrides (DirectX\\UserGpuPreferences):');
    for (const o of overrides) {
      const mark = o.appliesToThisRun ? "  !! THIS RUN'S BROWSER: " : '     ';
      console.log(`${mark}${o.exe} -> ${o.label}`);
    }
    console.log('');
  }
}
