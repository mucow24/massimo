// Cursor for a directly-manipulable canvas item (station, route bullet, text
// label, polygon body). Hand mode (pan tool or space held) wins everywhere —
// the whole canvas reads as pannable, so the open hand shows over items too.
// Off the pan tool: an unlocked, movable item shows the four-arrow "move"
// cursor; a locked item shows the pointing hand. The pointer only ever shows
// while the locked item is SELECTED (an unselected locked item is
// click-through and never hovers) — it reads as "clickable to keep the
// popover/unlock reachable, not draggable". Bare canvas keeps the svg's
// default cursor.
export function itemCursor(inHandMode: boolean, locked?: boolean): 'grab' | 'move' | 'pointer' {
  if (inHandMode) return 'grab';
  return locked ? 'pointer' : 'move';
}
