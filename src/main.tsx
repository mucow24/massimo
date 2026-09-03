import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDevHandle } from './debug/devHandle';
import { loadClipper } from './geometry/clip';
import { initRegionPipeline } from './worker/regionPipeline';
import { bootFailureMessage } from './util/staleBuild';
import { bootedWithoutMap, tabMapId } from './state/libraryPointer';
import { acquireMapLock, whenMapLockFree } from './state/mapLock';
import { requestLibraryAtBoot } from './state/mapTab';
import './styles.css';

const root = () => document.getElementById('root')!;

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
  // A tab that named no map opens on the library, like a documents app on
  // its list (libraryPointer.ts).
  if (bootedWithoutMap) requestLibraryAtBoot();
  return ReactDOM.createRoot(root()).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

const plainPage = (el: HTMLElement) =>
  el.setAttribute('style', 'padding:2rem;font:14px system-ui;max-width:32rem');

/**
 * Another window is editing this tab's map (mapLock.ts). Nothing mounts —
 * the stores have hydrated, but nothing here will write — and the tab takes
 * over the moment the other window lets go. The link drops the fragment,
 * which the pointer answers with a reload into a bare boot: a fresh map with
 * the library open.
 */
const showMapBusy = () => {
  const el = root();
  el.replaceChildren();
  plainPage(el);
  const p = document.createElement('p');
  const link = document.createElement('a');
  link.href = window.location.pathname;
  link.textContent = 'open the library instead';
  p.append(
    'This map is already open in another window. Close it there and this window will take over — or ',
    link,
    '.',
  );
  el.append(p);
};

/**
 * One editing window per map: take this tab's map's lock before anything can
 * write to its slots. Held for the life of the tab (or until the tab becomes
 * another map — mapTab.ts moves it along).
 */
const gate = async () => {
  const mapId = tabMapId();
  if (await acquireMapLock(mapId)) {
    mount();
    return;
  }
  showMapBusy();
  void whenMapLockFree(mapId).then(() => window.location.reload());
};

// Resolve the clipper engine before the first paint: every geometry consumer
// is synchronous, and there is no second implementation to draw with while it
// loads (see clip.ts). If it cannot load there is no map to render, so say so
// plainly rather than mounting an app whose every polygon operation throws.
// Two unrelated failures arrive here as one rejection, and they want opposite
// things said — see bootFailureMessage, which picks between them.
void loadClipper().then(gate, (err: unknown) => {
  console.error(err);
  const el = document.getElementById('root');
  if (el) {
    el.textContent = bootFailureMessage(err);
    plainPage(el);
  }
});
