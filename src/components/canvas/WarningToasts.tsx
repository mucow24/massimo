import { useRef } from 'react';
import { useSelection } from '../../state/store';
import { useRenderDoc } from '../../state/renderDoc';
import { useViewportStore } from '../../state/viewportStore';
import type { SegmentBandSpec } from '../../geometry/interlining';
import { SIDEBAR_WIDTH, sidebarVisible } from '../Sidebar';
import { useDock } from './useDock';

// Resting inset from the window's bottom-right corner; `bottom` lives in
// styles.css, `right` is written here because it has the sidebar to clear.
const EDGE_PAD = 12;

/**
 * Shows a clickable toast for each band the router flagged as "tight." Click
 * jumps the viewport to the band's center so the user can fix the layout.
 * `bands` is MapCanvas's memoized band spec — the router is the most
 * expensive pure computation in the app, so this must never rebuild it.
 *
 * The stack rests in the bottom-right corner of what's VISIBLE of the canvas
 * host, pinned to the window (`position: fixed` in styles.css) exactly like the
 * item popovers at the top-right — see `useDock`. Two things can eat into that
 * corner: the open sidebar, which paints above the toasts, and the window's own
 * edge when the app is wider than the window and the page is scrolled left.
 */
export function WarningToasts({
  bands,
  hostSize,
}: {
  bands: readonly SegmentBandSpec[];
  hostSize: { w: number; h: number };
}) {
  // Render source: names only, so a lagged frame is visually identical — but
  // reading live would re-render the toasts on every mid-drag doc write.
  const stations = useRenderDoc((s) => s.stations);
  const setViewport = useViewportStore((s) => s.setViewport);
  const zoom = useViewportStore((s) => s.zoom);
  // Re-renders only when the panel toggles (boolean selector), never rebuilding
  // the router.
  const underSidebar = useSelection(sidebarVisible);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Same box the popover dock uses: the host minus the sidebar's strip.
  const strip = underSidebar ? SIDEBAR_WIDTH : 0;
  const dock = useDock(rootRef, { strip, fallbackW: hostSize.w - strip });
  // How much of that strip is actually inside the window — the whole 320 when
  // the host's corner is on screen, tapering to nothing as the sidebar scrolls
  // out of view with it. Capped at the strip's own width, which is all there
  // ever is to clear: an unmeasured host (zero-size, before the ResizeObserver
  // reports) would otherwise read as "the entire window is past the dock".
  const clearSidebar = Math.min(dock.insetRight, strip);
  const warnings = bands.filter((b) => b.warning);
  if (warnings.length === 0) return null;
  return (
    <div ref={rootRef} className="warning-toasts" style={{ right: EDGE_PAD + clearSidebar }}>
      {warnings.map((w) => {
        const a = stations[w.fromId]?.name ?? '?';
        const b = stations[w.toId]?.name ?? '?';
        return (
          <div
            key={w.bandKey}
            className="toast"
            onClick={() => {
              const c = w.centerline[Math.floor(w.centerline.length / 2)];
              if (c) setViewport({ x: c.x, y: c.y, zoom });
            }}
          >
            ⚠ Routing warning: {a} ↔ {b}
          </div>
        );
      })}
    </div>
  );
}
