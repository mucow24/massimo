import { useDoc, useSelection } from '../../state/store';
import { legibleTextOn } from '../../util/color';

/**
 * Renders the colored top banner + 4-side frame around the map area when in
 * placing-station or appending-to-line mode. Color matches the active mode
 * (blue for placing, the line's color for appending, orange for layering).
 */
export function EditingBanner() {
  const lines = useDoc((s) => s.lines);
  const uiMode = useSelection((s) => s.uiMode);

  switch (uiMode.kind) {
    case 'placing-station':
      return (
        <>
          <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
          <div className="append-banner placing">
            Click on the canvas to place a new station. Press Esc to cancel.
          </div>
        </>
      );
    case 'creating-line-tag':
      return (
        <>
          <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
          <div className="append-banner placing">
            Click a colored line to place a tag. Press Esc to cancel.
          </div>
        </>
      );
    case 'creating-route-bullet':
      return (
        <>
          <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
          <div className="append-banner placing">
            Click on the canvas to place a route bullet. Press Esc to cancel.
          </div>
        </>
      );
    case 'creating-transfer':
      return (
        <>
          <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
          <div className="append-banner placing">
            {uiMode.anchor
              ? 'Click the second station to complete the transfer. Press Esc to cancel.'
              : 'Click the first station to start a transfer. Press Esc to cancel.'}
          </div>
        </>
      );
    case 'appending-to-line': {
      const line = lines[uiMode.lineId];
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
    case 'layering':
      return (
        <>
          <div className="append-frame" style={{ borderColor: '#c46b00' }} />
          <div className="append-banner placing" style={{ background: '#c46b00' }}>
            Layering mode — click a line segment to cycle its layer, shift-click to decrement. Press
            Esc to exit.
          </div>
        </>
      );
    case 'editing-station-layout':
      return (
        <>
          <div className="append-frame" style={{ borderColor: '#1a4ea8' }} />
          <div className="append-banner placing">
            Editing station layout — drag dots to move (Shift: diagonal grid), right-click or R to
            rotate, arrows to nudge. Esc to exit.
          </div>
        </>
      );
    case 'placing-label':
    case 'idle':
      return null;
  }
}
