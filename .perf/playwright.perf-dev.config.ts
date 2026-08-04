import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: ROOT,
  },
});
