import { useMemo } from 'react';
import { useDoc } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import { buildBands } from '../../geometry/interlining';

/**
 * Shows a clickable toast for each band the router flagged as "tight." Click
 * jumps the viewport to the band's center so the user can fix the layout.
 */
export function WarningToasts() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const curveRadius = useDoc((s) => s.curveRadius);
  const setViewport = useViewportStore((s) => s.setViewport);
  const zoom = useViewportStore((s) => s.zoom);
  const lineOrder = useDoc((s) => s.lineOrder);
  const bands = useMemo(
    () => buildBands(stations, lines, curveRadius, lineOrder),
    [stations, lines, curveRadius, lineOrder],
  );
  const warnings = bands.filter((b) => b.warning);
  if (warnings.length === 0) return null;
  return (
    <div className="warning-toasts">
      {warnings.map((w, i) => {
        const a = stations[w.fromId]?.name ?? '?';
        const b = stations[w.toId]?.name ?? '?';
        return (
          <div
            key={i}
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
