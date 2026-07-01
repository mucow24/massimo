import { useDoc, useSelection } from '../../state/store';
import { legibleTextOn } from '../../util/color';

// Copy for the simple one-click placement modes. Right-click cancels every
// mode outside RIGHT_CLICK_PASSTHROUGH_MODES (App.tsx), so the shared hint is
// accurate for all of these.
const PLACING_TEXT: Record<
  | 'placing-station'
  | 'creating-line-tag'
  | 'creating-route-bullet'
  | 'placing-label'
  | 'creating-polygon'
  | 'placing-svg',
  string
> = {
  'placing-station': 'Click on the canvas to place a new station.',
  'creating-line-tag': 'Click a colored line to place a tag.',
  'creating-route-bullet': 'Click on the canvas to place a route bullet.',
  'placing-label': 'Click on the canvas to place a text label.',
  'creating-polygon': 'Click on the canvas to place a polygon.',
  'placing-svg': 'Click on the canvas to place the imported SVG.',
};
const CANCEL_HINT = 'Esc or right-click to cancel.';

/**
 * Renders the colored top banner + 4-side frame around the map area for every
 * non-idle uiMode. Blue (the accent) for placement modes, the line's color
 * for appending, orange for layering. The switch is exhaustive over UiMode —
 * a new mode kind fails to compile until it either joins PLACING_TEXT or adds
 * its own case, so no mode can ship silent again (creating-polygon and
 * placing-svg used to fall out the bottom with no feedback at all).
 */
export function EditingBanner() {
  const lines = useDoc((s) => s.lines);
  const uiMode = useSelection((s) => s.uiMode);

  switch (uiMode.kind) {
    case 'placing-station':
    case 'creating-line-tag':
    case 'creating-route-bullet':
    case 'placing-label':
    case 'creating-polygon':
    case 'placing-svg':
      return (
        <>
          <div className="append-frame" />
          <div className="append-banner placing">
            {PLACING_TEXT[uiMode.kind]} {CANCEL_HINT}
          </div>
        </>
      );
    case 'creating-transfer':
      return (
        <>
          <div className="append-frame" />
          <div className="append-banner placing">
            {uiMode.anchor
              ? `Click the second station to complete the transfer. ${CANCEL_HINT}`
              : `Click the first station to start a transfer. ${CANCEL_HINT}`}
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
            Appending to line {line.service} — click stations to add or remove. Esc or right-click
            to stop.
          </div>
        </>
      );
    }
    case 'layering':
      // Right-click is repurposed here (layer decrement — see
      // RIGHT_CLICK_PASSTHROUGH_MODES), so Esc is the only exit.
      return (
        <>
          <div className="append-frame layering" />
          <div className="append-banner layering">
            Layering mode — click a line segment to cycle its layer, shift-click or right-click to
            decrement. Press Esc to exit.
          </div>
        </>
      );
    case 'idle':
      return null;
    default: {
      const unhandled: never = uiMode;
      return unhandled;
    }
  }
}
