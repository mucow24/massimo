// Config for the throwaway drag-perf harnesses. The main vitest config's
// `include` is scoped to src/, so nothing under .perf/ is collectable by it —
// which is the point: these never run in the suite, only when asked for by
// name. Run from the repo root:
//   PERF=1 npx vitest run -c .perf/vitest.bench.config.ts --disableConsoleIntercept
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['.perf/bench/**/*.perf.test.ts'],
    // Serialize behind the machine-wide gate mutex and verify the machine is
    // quiet at both ends (see benchGlobalSetup.ts).
    globalSetup: ['./.perf/benchGlobalSetup.ts'],
  },
});
