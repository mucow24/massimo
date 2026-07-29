import { useDoc, useSelection } from '../../state/store';
import { legibleTextOn } from '../../util/color';
import { stationNameListText } from '../../geometry/labelTokens';
import { validCursor } from '../../model/appendGestures';
import type { Station, StationId } from '../../model/types';

// Copy for the simple one-click placement modes. Right-click cancels every
// mode outside RIGHT_CLICK_PASSTHROUGH_MODES (App.tsx), so the shared hint is
// accurate for all of these.
const PLACING_TEXT: Record<
  | 'placing-station'
  | 'creating-line-tag'
  | 'creating-route-bullet'
  | 'placing-label'
  | 'placing-anchor'
  | 'creating-polygon'
  | 'placing-line-circle'
  | 'placing-svg',
  string
> = {
  'placing-station': 'Click on the canvas to place a new station.',
  'creating-line-tag': 'Click a colored line to place a tag.',
  'creating-route-bullet': 'Click on the canvas to place a route bullet.',
  'placing-label': 'Click on the canvas to place a text label.',
  'placing-anchor':
    'Click on the canvas to place a transfer anchor — a corner for a transfer to turn.',
  'creating-polygon': 'Click on the canvas to place a polygon.',
  'placing-line-circle':
    'Click on the canvas to place a line circle — stations dropped on its rim snap onto it.',
  'placing-svg': 'Click on the canvas to place the imported image.',
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
  const stations = useDoc((s) => s.stations);
  const uiMode = useSelection((s) => s.uiMode);

  switch (uiMode.kind) {
    case 'placing-station':
    case 'creating-line-tag':
    case 'creating-route-bullet':
    case 'placing-label':
    case 'placing-anchor':
    case 'creating-polygon':
    case 'placing-line-circle':
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
            {uiMode.firstEnd
              ? `Click the second station to complete the transfer. ${CANCEL_HINT}`
              : `Click the first station to start a transfer. ${CANCEL_HINT}`}
          </div>
        </>
      );
    case 'appending-to-line': {
      const line = lines[uiMode.lineId];
      if (!line) return null;
      const text = legibleTextOn(line.color);
      // The tail tracks the cursor machine (nothing armed / pen on a station /
      // inserting into an edge) so "armed" is never inferable only from canvas
      // chrome. A stale cursor (undo can strip it) reads as nothing armed —
      // matching what the next click will actually do.
      const cursor = validCursor(line, uiMode.cursor);
      const nameOf = (sid: StationId) => {
        const st: Station | undefined = stations[sid];
        return (st && stationNameListText(st.name)) || 'station';
      };
      const tail = !cursor
        ? 'click a station or segment to start, Alt-click for a new station. Esc or right-click exits.'
        : cursor.kind === 'station'
          ? `pen at ${nameOf(cursor.stationId)} — click a station to connect it (Alt-click: new station), Del or × removes this stop. Esc backs out.`
          : `inserting into ${nameOf(cursor.from)}–${nameOf(cursor.to)} — click a station to splice it in (Alt-click: new station), Del or × cuts the segment, the chip cycles its style. Esc backs out.`;
      return (
        <>
          <div className="append-frame" style={{ borderColor: line.color }} />
          <div className="append-banner" style={{ background: line.color, color: text }}>
            Editing line {line.service} — {tail}
          </div>
        </>
      );
    }
    case 'layering':
      // Right-click is repurposed here (cycle backward — see
      // RIGHT_CLICK_PASSTHROUGH_MODES), so Esc is the only exit.
      return (
        <>
          <div className="append-frame layering" />
          <div className="append-banner layering">
            Layering mode — click where lines overlap to cycle which line shows on top (right-click
            cycles backward); shift-click spreads the line an overlap already shows across the whole
            crossing. Press Esc to exit.
          </div>
        </>
      );
    case 'editing-station-layout':
      // Right-click is repurposed here too (rotate the stop/label under the
      // cursor — see RIGHT_CLICK_PASSTHROUGH_MODES), so Esc is the exit.
      return (
        <>
          <div className="append-frame" />
          <div className="append-banner placing">
            Editing station layout — drag dots to move (Shift: diagonal grid), right-click or R to
            rotate, arrows to nudge. Press Esc to exit.
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
