import { useDoc, useSelection } from '../../state/store';
import { legibleTextOn } from '../../util/color';

/**
 * Renders the colored top banner + 4-side frame around the map area when in
 * placing-station or appending-to-line mode. Color matches the active mode
 * (blue for placing, the line's color for appending).
 */
export function EditingBanner() {
  const lines = useDoc((s) => s.lines);
  const placingStation = useSelection((s) => s.placingStation);
  const appendingToLineId = useSelection((s) => s.appendingToLineId);

  if (placingStation) {
    return (
      <>
        <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
        <div className="append-banner placing">
          Click on the canvas to place a new station. Press Esc to cancel.
        </div>
      </>
    );
  }
  if (appendingToLineId) {
    const line = lines[appendingToLineId];
    if (!line) return null;
    const text = legibleTextOn(line.color);
    return (
      <>
        <div className="append-frame" style={{ borderColor: line.color }} />
        <div className="append-banner" style={{ background: line.color, color: text }}>
          Appending to line {line.service} — click stations to add or remove. Esc to stop.
        </div>
      </>
    );
  }
  return null;
}
