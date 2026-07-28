import { useDoc, useSelection } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import type { SegmentBandSpec } from '../../geometry/interlining';
import { SIDEBAR_WIDTH, sidebarVisible } from '../Sidebar';

/**
 * Shows a clickable toast for each band the router flagged as "tight." Click
 * jumps the viewport to the band's center so the user can fix the layout.
 * `bands` is MapCanvas's memoized band spec — the router is the most
 * expensive pure computation in the app, so this must never rebuild it.
 */
export function WarningToasts({ bands }: { bands: readonly SegmentBandSpec[] }) {
  const stations = useDoc((s) => s.stations);
  const setViewport = useViewportStore((s) => s.setViewport);
  const zoom = useViewportStore((s) => s.zoom);
  // The toasts rest in the host's bottom-right corner (`right: 12px` in
  // styles.css) — right where the open sidebar paints over them. While the
  // panel shows, shift them a panel-width left so they clear it and stay on
  // screen, keeping the same 12px gap on the panel's near edge. Same
  // SIDEBAR_WIDTH inset ItemPopovers subtracts from the popover dock; re-renders
  // only when the panel toggles (boolean selector), never rebuilding the router.
  const underSidebar = useSelection(sidebarVisible);
  const warnings = bands.filter((b) => b.warning);
  if (warnings.length === 0) return null;
  return (
    <div
      className="warning-toasts"
      style={underSidebar ? { right: 12 + SIDEBAR_WIDTH } : undefined}
    >
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
