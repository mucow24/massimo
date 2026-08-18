import { readPowerMode } from './powerMode';
import { readBrowserGpu, readGpuOverrides } from './gpuInfo';

/**
 * Runs once before any perf spec — wired into both perf playwright configs.
 * Stamps the run with the machine states that swing these numbers and are
 * otherwise invisible in the output: the CPU perf mode, which GPU the browser
 * actually binds, and any per-app GPU override that could pin it. Non-fatal
 * everywhere a stamp can't be read (see powerMode.ts / gpuInfo.ts).
 */
export default async function globalSetup(): Promise<void> {
  console.log(`\n[perf] Lenovo power mode: ${readPowerMode()}`);
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
