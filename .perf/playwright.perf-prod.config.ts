import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PERF_CHROMIUM_ARGS } from './chromiumArgs';

// The config lives in .perf/, so Playwright would run the preview server from
// there and vite would not find dist/. Anchor it at the repo root.
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
        // headless default — see chromiumArgs.ts, which the GPU stamp shares
        // so it probes the same launch it vouches for.
        launchOptions: { args: PERF_CHROMIUM_ARGS },
      },
    },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: ROOT,
  },
});
