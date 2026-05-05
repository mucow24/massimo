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

export interface StopCell {
  lineId: LineId;
  row: number;
  col: number;
  orientation: StopOrientation;
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
}
