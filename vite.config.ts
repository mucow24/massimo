import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use relative asset URLs ('./') for production builds so the same dist/ works
// regardless of the path it's served under:
//   - GitHub Pages publishes this repo at https://mucow24.github.io/massimo/
//     (served from the /massimo/ subpath), and
//   - the local srv/ static server serves dist/ at the root of
//     massimo.localhost:4000.
// A relative base resolves correctly in both; an absolute '/massimo/' base
// 404s the assets when the site is served from root. The app has no client-side
// router, so no nested route can shift the document base and break the relative
// paths. The dev server keeps an absolute '/' base — `mode` is 'development'
// there ('production' for both `vite build` and `vite preview`). Playwright
// drives both: plain `npm run e2e` uses the dev server at '/', and the
// `e2e:prod` gate uses `vite preview`, which serves dist/ at its own root,
// where the relative base resolves fine (both `/` and `/e2e-blank.html` load).
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? './' : '/',
  plugins: [react()],
  // The region worker dynamically imports the clipper package inside the
  // worker chunk, and dynamic imports mean code-splitting — which Vite's
  // default 'iife' worker format refuses at build time. ES-module workers
  // split fine, and every supported browser (Chromium-family) runs them.
  worker: { format: 'es' },
  // Honor a harness-assigned port (Claude Code preview servers run several
  // worktrees side by side, each with its own PORT). Without PORT set —
  // plain `npm run dev`, Playwright's webServer — Vite keeps its default.
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
}));
