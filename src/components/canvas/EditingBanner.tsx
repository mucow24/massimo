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
  const creatingLineTag = useSelection((s) => s.creatingLineTag);
  const creatingRouteBullet = useSelection((s) => s.creatingRouteBullet);
  const creatingTransfer = useSelection((s) => s.creatingTransfer);
  const transferAnchor = useSelection((s) => s.transferAnchor);
  const layeringMode = useSelection((s) => s.layeringMode);

  if (layeringMode) {
    return (
      <>
        <div className="append-frame" style={{ borderColor: '#c46b00' }} />
        <div className="append-banner placing" style={{ background: '#c46b00' }}>
          Layering mode — click a line segment to cycle its layer, shift-click to decrement. Press
          Esc to exit.
        </div>
      </>
    );
  }
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
  if (creatingLineTag) {
    return (
      <>
        <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
        <div className="append-banner placing">
          Click a colored line to place a tag. Press Esc to cancel.
        </div>
      </>
    );
  }
  if (creatingRouteBullet) {
    return (
      <>
        <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
        <div className="append-banner placing">
          Click on the canvas to place a route bullet. Press Esc to cancel.
        </div>
      </>
    );
  }
  if (creatingTransfer) {
    return (
      <>
        <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
        <div className="append-banner placing">
          {transferAnchor
            ? 'Click the second station to complete the transfer. Press Esc to cancel.'
            : 'Click the first station to start a transfer. Press Esc to cancel.'}
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
