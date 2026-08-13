import { defineConfig, devices } from '@playwright/test';

// Honor PORT env var so parallel worktrees can run e2e tests without
// colliding on the default Vite port. Falls back to Vite's default (5173)
// when unset, preserving the prior behavior.
const PORT = Number(process.env.PORT ?? 5173);

// E2E_PREVIEW=1 serves the PRODUCTION bundle (`vite preview` over dist/)
// instead of the dev server: bundled modules and prod React make each app
// boot far cheaper, and every test pays one. pre-pr uses this — it builds
// right before the e2e stage anyway. Plain `npm run e2e` keeps the dev
// server so a single spec can be iterated on without a build step.
const PREVIEW = !!process.env.E2E_PREVIEW;

export default defineConfig({
  testDir: './e2e',
  // No retries locally — flake should be fixed, not papered over.
  retries: process.env.CI ? 2 : 0,
  // Single worker. Playwright already isolates localStorage per test via a
  // fresh BrowserContext, so this is NOT about fixture races: the specs measure
  // drag/pan timing and rendered geometry, which destabilise under CPU
  // contention. The suite is small enough that serialising is cheap.
  workers: 1,
  // Per-test ceiling. Playwright's 30s default phantom-fails slow cloud
  // containers, where a test's dev-server page loads alone run ~26-39s (vs a
  // couple of seconds locally). A timeout is a ceiling, not a wait — green
  // runs pay nothing; the cost is only that a genuinely hung test takes 2min
  // to be called dead instead of 30s.
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: PREVIEW
      ? `npm run preview -- --port ${PORT} --strictPort`
      : `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Never reuse in preview mode: whatever already answers on the port is at
    // best a dev server (often another worktree's) — reusing it would silently
    // gate the prod run on the wrong bundle and un-fix the exact bug class
    // e2e:prod exists to catch (e.g. import('/src/…') 404s only in dist).
    reuseExistingServer: !process.env.CI && !PREVIEW,
    timeout: 60_000,
  },
});
