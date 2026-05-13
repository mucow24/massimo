import { defineConfig, devices } from '@playwright/test';

// Honor PORT env var so parallel worktrees can run e2e tests without
// colliding on the default Vite port. Falls back to Vite's default (5173)
// when unset, preserving the prior behavior.
const PORT = Number(process.env.PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  // No retries locally — flake should be fixed, not papered over.
  retries: process.env.CI ? 2 : 0,
  // Single worker keeps the persisted localStorage fixtures from racing
  // across tests; the suite is small.
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
