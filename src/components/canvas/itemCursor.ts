// Cursor for a directly-manipulable canvas item (station, route bullet, text
// label, polygon body). Hand mode (pan tool or space held) wins everywhere —
// the whole canvas reads as pannable, so the open hand shows over items too.
// Off the pan tool: an unlocked, movable item shows the four-arrow "move"
// cursor; a locked item shows the pointing hand (it can be clicked to
// select/unlock, but not dragged). Bare canvas keeps the svg's default cursor.
export function itemCursor(inHandMode: boolean, locked?: boolean): 'grab' | 'move' | 'pointer' {
  if (inHandMode) return 'grab';
  return locked ? 'pointer' : 'move';
}
