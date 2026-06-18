import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this project repo under https://mucow24.github.io/massimo/,
// so production asset URLs must be prefixed with the repo name. `mode` is
// 'production' for both `vite build` and `vite preview`, and 'development' for
// the dev server — which is what Playwright e2e drives, so localhost stays at
// root and the e2e baseURL ('/') keeps working unchanged.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/massimo/' : '/',
  plugins: [react()],
}));
