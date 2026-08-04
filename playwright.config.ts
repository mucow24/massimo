import { defineConfig, devices } from '@playwright/test';

// Honor PORT env var so parallel worktrees can run e2e tests without
// colliding on the default Vite port. Falls back to Vite's default (5173)
// when unset, preserving the prior behavior.
const PORT = Number(process.env.PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  // No retries locally — flake should be fixed, not papered over.
  retries: process.env.CI ? 2 : 0,
  // Single worker. Playwright already isolates localStorage per test via a
  // fresh BrowserContext, so this is NOT about fixture races: the specs measure
  // drag/pan timing and rendered geometry, which destabilise under CPU
  // contention. The suite is small enough that serialising is cheap.
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
