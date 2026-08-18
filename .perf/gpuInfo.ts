import { execFileSync } from 'node:child_process';
import { chromium, type Page } from '@playwright/test';
import { PERF_CHROMIUM_ARGS } from './chromiumArgs';

/**
 * The GPU story for a perf run, stamped alongside the CPU power mode because it
 * is the other axis this laptop moves numbers on: it has an iGPU and a dGPU,
 * Windows decides per PROCESS which one a browser binds, and a per-app override
 * set in Settings > Display > Graphics silently pins a binary to one of them.
 * The retracted "sessions get slower over time" symptom was exactly this
 * machinery — see README, "The session-aging question".
 *
 * Two layers, because they answer different questions:
 *  - the registry holds the INTENT: any per-exe override the user has set;
 *  - the browser reports the OUTCOME: which adapter ANGLE actually created its
 *    device on, read from the unmasked WebGL renderer string.
 * Either alone can mislead: an override recorded for a stale Playwright path
 * applies to nothing (the bundled binary's path changes with every Playwright
 * version), and "no override" does not say which GPU Windows chose.
 *
 * Everything here returns rather than throws — a perf run must never fail on
 * its own stamp (same contract as powerMode.ts).
 */

const GPU_PREF_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';

/** What `GpuPreference=<n>` means in that registry key. */
const PREF_LABELS: Record<string, string> = {
  '0': 'let Windows decide',
  '1': 'power saving (iGPU)',
  '2': 'high performance (dGPU)',
};

export interface GpuOverride {
  exe: string;
  label: string;
  /** True when the override names the chromium binary this run launches. */
  appliesToThisRun: boolean;
}

export function readGpuOverrides(): GpuOverride[] {
  let out = '';
  try {
    out = execFileSync('reg', ['query', GPU_PREF_KEY], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return []; // key absent, or not Windows — nothing to report
  }
  const exePath = safeExecutablePath()?.toLowerCase();
  const rows: GpuOverride[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s+(.+?)\s+REG_SZ\s+(.*)$/);
    if (!m) continue;
    const [, exe, raw] = m;
    // The key also holds AutoHDR/AppStatus flags and a DirectXUserGlobalSettings
    // row; only GpuPreference= is a GPU mapping.
    const pref = raw.match(/GpuPreference=(\d+)/)?.[1];
    if (!pref) continue;
    rows.push({
      exe,
      label: PREF_LABELS[pref] ?? `GpuPreference=${pref}`,
      appliesToThisRun: !!exePath && exe.toLowerCase() === exePath,
    });
  }
  return rows;
}

function safeExecutablePath(): string | null {
  try {
    return chromium.executablePath();
  } catch {
    return null;
  }
}

/** The unmasked WebGL renderer of the page's own browser — the ground truth
 *  for the browser actually being measured. Specs print this next to the CPU
 *  mode so a run testifies about its own medium. */
export function readPageGpu(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'unknown (no webgl context)';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  });
}

/**
 * Launch chromium the way the perf configs do (same binary, same args, same
 * headless mode) and ask which adapter it rendered on.
 */
export async function readBrowserGpu(): Promise<string> {
  try {
    const browser = await chromium.launch({ args: PERF_CHROMIUM_ARGS });
    try {
      return await readPageGpu(await browser.newPage());
    } finally {
      await browser.close();
    }
  } catch (e) {
    return `unknown (${(e as Error).message.split('\n')[0]})`;
  }
}
