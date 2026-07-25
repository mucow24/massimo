import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadWasmClipper } from './geometry/clip';
import './styles.css';

const mount = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

// Resolve the WebAssembly clipper before the first paint. Region geometry is
// ~5x faster on it, and the two engines round differently — mounting first
// would render the map on the JS engine and then subtly reshape it the moment
// wasm arrived. `loadWasmClipper` never rejects; a failure just leaves the JS
// engine in place, so this cannot block startup on a broken load.
void loadWasmClipper().then(mount);
