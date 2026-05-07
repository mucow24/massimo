import type { Vec2 } from '../geometry/vec';

export type StationId = string;
export type LineId = string;

export type Rotation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Per-stop travel direction in the unrotated station-local frame.
//
// `up`/`down`/`left`/`right` pin the stop's tangent to a specific signed axis
// — the line is forced to enter from the opposite edge and exit through the
// named edge.
//
// `auto-vertical`/`auto-horizontal` pin only the AXIS; the sign falls out of
// the line's actual direction of travel at this station (computed from
// neighbor positions). With no neighbors to consult, auto falls back to
// `down` / `right`.
export type StopOrientation =
  | 'up'
  | 'down'
  | 'auto-vertical'
  | 'left'
  | 'right'
  | 'auto-horizontal';

// Glyph rendered at a stop. `undefined` is treated as `'filled-black'` (the
// historical default) — no migration is needed for older saves.
export type DotShape =
  | 'filled-black'
  | 'open-black'
  | 'filled-black-white-stroke'
  | 'filled-white'
  | 'open-white'
  | 'filled-white-black-stroke'
  | 'filled-black-diamond'
  | 'filled-white-diamond'
  | 'none';

export interface StopCell {
  lineId: LineId;
  row: number;
  col: number;
  orientation: StopOrientation;
  dotShape?: DotShape;
}

// The station's name lives in a single grid cell with its own 8-way rotation
// (in the unrotated station-local frame). The rendered text auto-anchors to
// the side of the cell that faces an adjacent stop, when one is present.
// `offset` shifts the rendered label along its own reading direction (so for
// upright text it's left/right, for vertical text it's up/down, etc.) in
// pixels of unrotated-station-local space. Positive = forward in reading dir.
export interface LabelCell {
  row: number;
  col: number;
  rotation: Rotation;
  offset: number;
}

export interface Station {
  id: StationId;
  name: string;
  x: number;
  y: number;
  rotation: Rotation;
  stops: StopCell[];
  label: LabelCell;
}

export interface Line {
  id: LineId;
  service: string;
  color: string;
  stations: StationId[];
  waypoints?: Record<string, Vec2[]>;
}

// A movable label printed inside a line's color band (Vignelli-style).
//
// Anchored to a *station-pair corridor*, not a segment index, so the tag
// survives line reordering: as long as the line still has an edge between
// `fromStationId` and `toStationId`, the tag stays on it.
//
// `fromStationId < toStationId` always (canonical / alphabetic order, matching
// `pairKeyOf` in interlining.ts).
//
// Position is anchored to one of the two canonical endpoints, by world
// arc-length along the line's stripe path. As the corridor lengthens or
// shortens, the tag stays at the same `distance` from its `anchorEnd`,
// keeping it visually pinned to the nearer station.
//
// `orientation` is in *line-traversal* frame so the user's notion of "forward"
// matches how they drew the line; the renderer flips when the line traverses
// the corridor in reverse-canonical order. Cycle: 0 → 1 → 2 → 3 → 0.
export interface LineTag {
  id: string;
  lineId: LineId;
  fromStationId: StationId;
  toStationId: StationId;
  // 'from' = anchor at fromStationId (canonically lesser); 'to' = at toStationId.
  anchorEnd: 'from' | 'to';
  // Arc length in world units from the anchor endpoint along the stripe.
  // Renderer clamps to the stripe length if the corridor shrinks below it.
  distance: number;
  orientation: 0 | 1 | 2 | 3;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type RouteBulletShape = 'circle' | 'square' | 'diamond';

// A free-floating, draggable route badge that displays a single line's
// service code in its color. Used as a label/legend element on the map.
export interface RouteBullet {
  id: string;
  x: number;
  y: number;
  rotation: Rotation;
  // Which line's color + service code to render. Null = unset (no line
  // chosen yet); renders as a neutral placeholder.
  lineId: LineId | null;
  shape: RouteBulletShape;
  // Half-extent in world units (radius for circle, half-side for
  // square/diamond).
  size: number;
}

export interface MapDoc {
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
  // Z-order, top-of-list (index 0) renders LAST = on top, à la Photoshop layers.
  lineOrder: LineId[];
  curveRadius: number;
  /**
   * Monotonically-increasing counter advanced each time a line is added.
   * Used to pick the next palette color so the cycle continues across
   * deletions and reloads. Persisted with the doc.
   */
  lineCounter: number;
  // Movable in-band labels. Keyed by tag id.
  lineTags: Record<string, LineTag>;
  // Free-floating route badges. Keyed by bullet id.
  routeBullets: Record<string, RouteBullet>;
  // Inter-station transfer indicators (a black line between two stations).
  transfers: Record<string, Transfer>;
}

// One endpoint of a transfer: a specific dot on a station. `lineId` picks
// which dot when the station has multiple (interlining); null means "no
// specific line / station has no stops" — render falls back to the
// station's anchor.
export interface TransferEnd {
  stationId: StationId;
  lineId: LineId | null;
}

// A transfer is a 2px black line connecting one station dot to another. The
// endpoints are anchored to specific stops so they follow the dot when
// stations move, lines are reordered, or stops shift on a station.
// Cascade-deleted when either endpoint station is removed; `lineId`
// nulled if the referenced line is removed.
export interface Transfer {
  id: string;
  a: TransferEnd;
  b: TransferEnd;
}
