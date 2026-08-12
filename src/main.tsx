import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDevHandle } from './debug/devHandle';
import { loadClipper } from './geometry/clip';
import { initRegionPipeline } from './worker/regionPipeline';
import { bootFailureMessage } from './util/staleBuild';
import './styles.css';

const mount = () => {
  // window.__massimo: the same counters the toolbar's Developer pane shows, plus
  // the in-place resets that let a slowed-down session be bisected without the
  // reload that cures it. Installed in EVERY build, not just dev — the browser
  // perf harnesses measure the production build (dev carries its own tax, see
  // .perf/README.md), and a slowdown that takes an hour to appear has to be
  // catchable in whichever build is actually open.
  installDevHandle();
  // Wire the region worker pipeline to the stores. On by default; it arms
  // per-gesture (regions in play AND a slow synchronous build), and the flag
  // on __massimo.regionPipeline is the kill switch.
  initRegionPipeline();
  return ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

// Resolve the clipper engine before the first paint: every geometry consumer
// is synchronous, and there is no second implementation to draw with while it
// loads (see clip.ts). If it cannot load there is no map to render, so say so
// plainly rather than mounting an app whose every polygon operation throws.
// Two unrelated failures arrive here as one rejection, and they want opposite
// things said — see bootFailureMessage, which picks between them.
void loadClipper().then(mount, (err: unknown) => {
  console.error(err);
  const root = document.getElementById('root');
  if (root) {
    root.textContent = bootFailureMessage(err);
    root.setAttribute('style', 'padding:2rem;font:14px system-ui;max-width:32rem');
  }
});
