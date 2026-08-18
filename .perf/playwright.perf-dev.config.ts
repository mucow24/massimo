import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PERF_CHROMIUM_ARGS } from './chromiumArgs';

// The DEV-SERVER twin of playwright.perf-prod.config.ts: same specs, but
// served by `vite` (unminified, React dev mode, StrictMode double-render)
// instead of `vite preview` over dist/. Exists because the drag is FELT in
// dev during daily editing — a symptom that reproduces here but not in the
// prod config is a dev-mode tax, not an app regression. Numbers from this
// config must never be compared against prod-config numbers from a different
// session (25%+ run-to-run variance; see README).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 5234);
export default defineConfig({
  testDir: resolve(ROOT, '.perf/e2e'),
  // Serialize behind the machine-wide gate mutex, verify the machine is quiet
  // at both ends, and stamp the run with the CPU/GPU state that swings these
  // numbers (see perfGlobalSetup.ts).
  globalSetup: resolve(ROOT, '.perf/perfGlobalSetup.ts'),
  globalTeardown: resolve(ROOT, '.perf/perfGlobalTeardown.ts'),

  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Hardware rendering on the iGPU instead of Playwright's all-software
        // headless default — see chromiumArgs.ts, shared with the GPU stamp.
        launchOptions: { args: PERF_CHROMIUM_ARGS },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: ROOT,
  },
});
