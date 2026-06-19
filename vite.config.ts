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
// there (and 'production' for both `vite build` and `vite preview`), so
// Playwright e2e, which drives the dev server at '/', is unaffected.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? './' : '/',
  plugins: [react()],
}));
