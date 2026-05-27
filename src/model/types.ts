import type { Vec2 } from '../geometry/vec';
import type { PaletteId } from './palettes';

export type StationId = string;
export type LineId = string;

export type Rotation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Per-stop travel direction in the unrotated station-local frame. Each
// variant pins only the AXIS — N/S, E/W, NE/SW, or NW/SE; the sign (which
// way along that axis the line actually flows at this station) falls out
// of the world tangent derived from neighbor positions. With no neighbors
// to consult, each variant falls back to a fixed +axis default
// (`auto-vertical` → +y, `auto-horizontal` → +x, `auto-ne-sw` → NE,
// `auto-nw-se` → SE).
export type StopOrientation =
  | 'auto-vertical' // N/S
  | 'auto-ne-sw' // NE/SW
  | 'auto-horizontal' // E/W
  | 'auto-nw-se'; // NW/SE

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

// Alignment of the rendered label text relative to the label cell, expressed
// in the label's reading-direction frame.
//
// `auto`  — snap against an adjacent stop (text-anchor end/start with a small
//           gap), or fall back to centering on the cell when no stop is
//           adjacent along the reading axis. The historical default.
// `start` — text begins at the cell center and extends forward.
// `middle`— text centered on the cell center.
// `end`   — text ends at the cell center and extends backward.
export type LabelAlign = 'auto' | 'start' | 'middle' | 'end';

// Vertical alignment in the label's own (unrotated) frame — i.e. relative to
// the reading-direction's perpendicular axis. Maps to SVG dominant-baseline
// at render time.
//
// `auto` centers the FIRST line on the label cell, with any subsequent lines
// stacking below. For a single-line label it's indistinguishable from
// `middle`; for multi-line labels the first line stays put as the label
// grows, instead of the whole block re-centering.
export type LabelValign = 'auto' | 'top' | 'middle' | 'bottom';

// The station's name lives in a single grid cell with its own 8-way rotation
// (in the unrotated station-local frame). `align` controls how the rendered
// text positions relative to that cell along the reading direction; `valign`
// does the same on the cross-reading axis. `offset` then shifts the rendered
// label along its reading direction (so for upright text it's left/right,
// for vertical text it's up/down, etc.) in pixels of unrotated-station-local
// space. Positive = forward in reading dir.
export interface LabelCell {
  row: number;
  col: number;
  rotation: Rotation;
  offset: number;
  align: LabelAlign;
  valign: LabelValign;
}

export interface Station {
  id: StationId;
  name: string;
  x: number;
  y: number;
  rotation: Rotation;
  stops: StopCell[];
  label: LabelCell;
  // Marks a "routing point" station: the name and all bullet glyphs are
  // hidden on the canvas, and the label hit rect is dropped. The station
  // remains selectable/draggable via the hit rect around its stop cells.
  // Per-stop `dotShape` values are NOT mutated when this flips — rendering
  // simply treats all bullets as hidden while the flag is on. Omitted/false
  // means "regular station".
  isWaypoint?: boolean;
  // Per-station bold flag. When true, the rendered weight is bumped two
  // steps along LABEL_WEIGHT_VALUES (Regular → Bold, Light → Roman, etc.),
  // clamped at Black (900). Omitted/false means "use the doc's labelWeight
  // as-is".
  labelBold?: boolean;
}

// Visual style for a single segment of a line. `solid` is the historical
// default and is never explicitly stored — a missing entry in `segmentStyles`
// means solid. `hatched` and `hatched-mirror` are the two diagonal hatch
// patterns (45° and -45°) — visually mirrored across the line's tangent.
export type LineStyle = 'solid' | 'dashed' | 'hatched' | 'hatched-mirror';

export interface Line {
  id: LineId;
  service: string;
  name: string;
  color: string;
  stations: StationId[];
  waypoints?: Record<string, Vec2[]>;
  // Per-segment style overrides keyed by canonical pair-key (pairKeyOf(a, b)).
  // Missing key ⇒ 'solid'. Setters delete the key when called with 'solid'
  // so the default is never stored.
  segmentStyles?: Record<string, LineStyle>;
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
  // Free-floating text annotations ("Labels" in the UI). Keyed by label id.
  textLabels: Record<string, TextLabel>;
  // Global station-label styling. Applies to every station name; line tags
  // and route bullets keep their always-bold pill styling. `labelWeight` is
  // one of the Helvetica Neue weights we ship in /public/fonts/ (no 600).
  // Per-station `labelBold` bumps the rendered weight two steps heavier on
  // top of this default.
  labelFontSize: number;
  labelWeight: TextLabelWeight;
  labelItalic: boolean;
  // Which color palettes are available in the line editor. Invariant:
  // never empty (enforced by transforms / parse sanitiser).
  activePalettes: PaletteId[];
  // Global styling for inter-station transfers. Thickness is the visible
  // colored body's stroke width in world units, clamped at MIN in
  // transforms.ts (the slider tops out at MAX but the textbox accepts
  // arbitrary larger values). Color is a 7-char hex string (`#rrggbb`),
  // the format emitted by `<input type="color">`.
  transferThickness: number;
  transferColor: string;
  // Optional always-on outline around the body (a "halo"). Width is the
  // per-side padding added past the body in world units, clamped to
  // [TRANSFER_STROKE_WIDTH_MIN, TRANSFER_STROKE_WIDTH_MAX]. 0 = no outline.
  transferStrokeWidth: number;
  transferStrokeColor: string;
}

// Multi-line horizontal text alignment inside a TextLabel.
export type TextLabelAlign = 'left' | 'center' | 'right';

// Helvetica Neue weights we ship in /public/fonts/.
export type TextLabelWeight = 100 | 200 | 300 | 400 | 500 | 700 | 800 | 900;

// A free-floating, rotatable text annotation rendered on top of the map. Used
// for neighborhood names, river labels, legend headings, etc. Position is the
// label's center in world coords; rotation is the existing 8-step 45° axis.
// The popover controls text content, font size (1..96), weight, italic, and
// multi-line horizontal alignment. Not tied to any station or line.
export interface TextLabel {
  id: string;
  x: number;
  y: number;
  rotation: Rotation;
  // Multiline; '\n'-separated.
  text: string;
  // Integer in [1, 96].
  fontSize: number;
  weight: TextLabelWeight;
  italic: boolean;
  align: TextLabelAlign;
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
