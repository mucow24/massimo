import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadClipper } from './geometry/clip';
import './styles.css';

const mount = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

// Resolve the clipper engine before the first paint: every geometry consumer
// is synchronous, and there is no second implementation to draw with while it
// loads (see clip.ts). If it cannot load there is no map to render, so say so
// plainly rather than mounting an app whose every polygon operation throws.
void loadClipper().then(mount, (err: unknown) => {
  console.error(err);
  const root = document.getElementById('root');
  if (root) {
    root.textContent =
      'Could not load the polygon clipping engine, so the map cannot be drawn. Check the console, and that WebAssembly is enabled.';
    root.setAttribute('style', 'padding:2rem;font:14px system-ui;max-width:32rem');
  }
});
