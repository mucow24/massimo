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

// Preset ids for the built-in stop-dot styles. Documents no longer store
// these — stops/lines carry full `DotStyle` objects — but the ids remain the
// currency of the shape pickers and of legacy-save conversion (each id maps
// to a pinned `DotStyle` in `DOT_SHAPE_PRESETS`, see dotStyle.ts).
export type DotShape =
  | 'filled-black'
  | 'open-black'
  | 'filled-black-white-stroke'
  | 'filled-white'
  | 'open-white'
  | 'filled-white-black-stroke'
  | 'filled-line-color'
  | 'filled-line-color-white-stroke'
  | 'filled-line-color-black-stroke'
  | 'filled-black-service-code'
  | 'filled-black-diamond'
  | 'filled-white-diamond'
  | 'filled-black-x'
  | 'filled-white-x'
  | 'dash'
  | 'none';

// A color that resolves per theme: `day` paints in light mode, `night` in
// dark mode. Both 7-char lowercase hex.
export interface DayNightColor {
  day: string;
  night: string;
}

// 'dash' is the TfL-style tick: a short bar protruding from the stop's own
// stripe edge toward the station label, perpendicular to the line. Unlike the
// symmetric shapes it is NOT drawn by StopGlyph's isotropic path — StationDots
// branches to DashGlyph, which reads the travel axis and label side (see
// geometry/stationDash.ts). Its dimensions derive from the line width
// (overridable per line via Line.dashLength / Line.dashWidth), so dotSize is
// ignored for dash stops; of the style fields only `fill` applies.
export type DotBaseShape = 'circle' | 'square' | 'diamond' | 'x' | 'dash';

// Base color of a dot. 'line' = the owning line's color, resolved at render
// time; 'none' = transparent (the line band shows through — the "open" dots).
export type DotFill = DayNightColor | 'line' | 'none';

// Stroke color of a dot. No 'none' here — strokeWidth 0 is how a style says
// "no stroke".
export type DotStrokeColor = DayNightColor | 'line';

// A procedurally-defined stop dot. All fields are required — a deliberate
// divergence from the optional-field-plus-named-default convention on `Line`:
// style objects are canonical by construction so plain deep equality
// (`dotStylesEqual`) works everywhere. The clean-persisted-state convention
// lives one level up instead, in the presence/absence of `StopCell.dotStyle`
// and `Line.defaultDotStyle`. Size is intentionally NOT part of the style —
// it's the orthogonal `StopCell.dotSize` / `Line.defaultDotSize` pair, so
// picking a shape preset never clobbers a size (and vice versa).
export interface DotStyle {
  shape: DotBaseShape;
  fill: DotFill;
  // World units; 0 = no stroke (stroke attrs omitted at render).
  strokeWidth: number;
  strokeColor: DotStrokeColor;
  // Render the line's service code centered on the dot, in whichever of
  // black/white is legible on the resolved fill. Implies the larger
  // SERVICE_CODE_DOT_RADIUS disc so the code stays readable.
  showServiceCode: boolean;
  // Explicit service-code text color, per theme. Only meaningful when
  // `showServiceCode` is true. Absent ⇒ the historical behavior: pick
  // whichever of black/white is legible on the resolved fill
  // (`legibleTextOn`). Present ⇒ that auto-contrast is overridden by the
  // chosen day/night pair. Optional so untouched styles (and every preset)
  // stay byte-identical.
  serviceCodeColor?: DayNightColor;
}

export interface StopCell {
  lineId: LineId;
  row: number;
  col: number;
  orientation: StopOrientation;
  // Per-stop style override. `undefined` defers to the line's
  // `defaultDotStyle`; setters drop the field when the chosen style equals
  // the line's effective default so persisted state stays clean. Legacy
  // saves carried a `dotShape` preset id here — converted on load (see
  // convertLegacyDotShapes in serialize.ts).
  dotStyle?: DotStyle;
  // Live link to a StyleDef of kind 'stopDot' (the dot-style library). When
  // present, `dotStyle` equals that style's props (the stamped shadow the
  // renderer reads). Editing the style restamps `dotStyle`; picking a library
  // entry sets both. Absent ⇒ this stop has no explicit override and defers to
  // the line default. Same raw-value-plus-tag contract lines/stations use.
  dotStyleId?: string;
  // Per-stop dot size override — the dot's DIAMETER in px. `undefined`
  // defers to the line's `defaultDotSize`; the setter (`setDotSize`) drops
  // the field when the chosen size equals the line's effective default, so
  // the stop tracks the default going forward (same contract as `dotStyle`).
  dotSize?: number;
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
// `auto-down` centers the FIRST line on the label cell, with any subsequent
// lines stacking below — the block top stays put as the label grows.
// `auto-up` is the mirror: it centers the LAST line on the label cell, with
// earlier lines stacking above — the block bottom stays put. Both are
// indistinguishable from `middle` for a single-line label; they only differ
// once a second line shows up.
export type LabelValign = 'auto-down' | 'top' | 'middle' | 'bottom' | 'auto-up';

// Multi-line tuning for autoAlign labels (see LabelCell.autoHAlign /
// autoVAlign). Same value space as LabelAlign's explicit members; kept as
// separate types so the two mechanisms can't be cross-assigned by accident.
export type AutoHAlign = 'start' | 'middle' | 'end';
export type AutoVAlign = 'up' | 'down';

// The station's name lives in a single grid cell with its own 8-way rotation
// (in the unrotated station-local frame). `align` controls how the rendered
// text positions relative to that cell along the reading direction; `valign`
// does the same on the cross-reading axis. `offset` then shifts the rendered
// label along its reading direction (so for upright text it's left/right,
// for vertical text it's up/down, etc.) in pixels of unrotated-station-local
// space. Positive `offset` = forward in reading dir. `offsetPerp` is the
// matching cross-axis shift (positive = the direction a new line of text
// would stack, i.e. the `(-readSin, readCos)` unit vector — visually "down"
// for a horizontal-reading label). Optional and defaults to 0 so saves made
// before the field existed continue to load as-is.
export interface LabelCell {
  row: number;
  col: number;
  rotation: Rotation;
  offset: number;
  offsetPerp?: number;
  align: LabelAlign;
  valign: LabelValign;
  // Smart placement: when true, `align`/`valign` are overridden and the
  // alignment is derived from the label cell's octant relative to the
  // nearest stop (transitmap.net typography — baseline sits above the
  // marker, cap line hangs below it, Core Type Area centers beside it,
  // corner octants pin the facing CTA corner). `offset`/`offsetPerp` still
  // apply on top. Optional and omitted when off, so older saves load
  // unchanged.
  autoAlign?: boolean;
  // Multi-line tuning while `autoAlign` is on (ignored otherwise; absent =
  // derived from the octant, and omitted when set back to auto).
  // `autoHAlign` re-aligns the lines WITHIN the block — the anchor line
  // keeps its octant-pinned position, so single-line labels render
  // identically. `autoVAlign` picks WHICH line anchors: 'down' = the top
  // line with extra lines stacking down, 'up' = the bottom line stacking
  // up; the octant still supplies the pinned typographic edge (baseline /
  // cap line / CTA-center).
  autoHAlign?: AutoHAlign;
  autoVAlign?: AutoVAlign;
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
  // Per-stop `dotStyle` values are NOT mutated when this flips — rendering
  // simply treats all bullets as hidden while the flag is on. Omitted/false
  // means "regular station".
  isWaypoint?: boolean;
  // Per-station name typography. All optional with collapse-at-default: an
  // absent field means "the LABEL_* default" (fontSize→LABEL_FONT_SIZE_DEFAULT,
  // weight→LABEL_WEIGHT_DEFAULT, italic→false, leading→LABEL_LEADING_DEFAULT,
  // tracking→LABEL_TRACKING_DEFAULT), so a station wearing the factory Default
  // style stores none of them. `updateStationLabelStyle` drops a field when it
  // lands on its default, mirroring the transfer-override and
  // TextLabel.leading/tracking patterns. All five are covered by the station
  // StyleDef; editing any of them detaches the styleId tag. `weight` is one of
  // the Helvetica Neue ladder values (see TextLabelWeight); the hover bump and
  // append-starter styling are applied at paint time, not stored here.
  fontSize?: number;
  weight?: TextLabelWeight;
  italic?: boolean;
  leading?: number;
  tracking?: number;
  // When locked, the station can't be dragged, marquee-selected, group-towed,
  // arrow-nudged, rotated, or deleted from the canvas — it can still be click-selected
  // (so its inspector, including the lock toggle, stays reachable) and remains
  // fully editable there. Optional; missing ⇒ unlocked. Mirrors Polygon.locked
  // but is canvas-protection only (the station inspector is never disabled).
  locked?: boolean;
  // Remembered height (in CSS px) of the Name text box in this station's
  // inspector, so a manually stretched box stays stretched instead of resetting
  // to its rows-derived default each time the inspector reopens. Purely an
  // editing-UI dimension — it never affects the rendered name. Optional;
  // missing ⇒ the box auto-sizes to its content. Clamped to a positive integer
  // by `setStationEditorHeight`. Mirrors `TextLabel.editorHeight`.
  editorHeight?: number;
  // Live link to a StyleDef of kind 'station' — covered fields are the name
  // typography (fontSize/weight/italic/leading/tracking), NOT identity
  // (name/position/rotation/stops/label/waypoint/lock/editorHeight). Same
  // contract as `Line.styleId`.
  styleId?: string;
}

// Visual style for a single segment of a line. `solid` is the historical
// default and is never explicitly stored — a missing entry in `segmentStyles`
// means solid. `hatched` and `hatched-mirror` are the two diagonal hatch
// patterns (45° and -45°) — visually mirrored across the line's tangent.
// `dotted` and `dashed-open` are the two "open" styles: repeated circles and
// width-scaled dashes, both with transparent gaps (no backing fill) — unlike
// `dashed`, whose gaps are painted in the canvas background color.
export type LineStyle =
  | 'solid'
  | 'dashed'
  | 'hatched'
  | 'hatched-mirror'
  | 'dotted'
  | 'dashed-open';

export interface Line {
  id: LineId;
  service: string;
  name: string;
  color: string;
  // The stations this line SERVES — its members, one StopCell each. Order is
  // DISPLAY ONLY (the inspector list, "reverse", stable iteration); it does NOT
  // define the route. The actual track topology is `edges`. A member may be
  // degree-0 transiently while the line is being drawn (or a lone-stop line);
  // otherwise INVARIANT: every station appears at most once, and every `edges`
  // endpoint is a member.
  stations: StationId[];
  // The line's connectivity as an EDGE SET: canonical `pairKeyOf(a, b)` strings,
  // each unique. This — not the order of `stations` — is what the renderer,
  // interlining, tags, and per-segment overrides key off. A path is a chain of
  // edges, a loop is a cycle, a branch is a station of degree ≥ 3. Saves that
  // predate the field backfill it from consecutive `stations` pairs on load
  // (edgesFromStations; serialize.ts / migrateDoc). Helpers: model/lineTopology.ts.
  edges: string[];
  // Per-segment style overrides keyed by canonical pair-key (pairKeyOf(a, b)).
  // Missing key ⇒ 'solid'. Setters delete the key when called with 'solid'
  // so the default is never stored.
  segmentStyles?: Record<string, LineStyle>;
  // NOTE: there is no per-segment z-layer field anymore — `segmentLayers`
  // was retired with the layering rework: overlap regions are painted via
  // MapDoc.regionAssignments instead (persist v15 strips the old field).
  // Default dot style for this line's stops, SPLIT by how many lines share the
  // stop's station (dynamic, recomputed at render time — see resolveDotStyle):
  //   - `singletonDotStyle` applies at a station where THIS is the only line
  //     stopping (no other line's stop — `station.stops.length === 1`);
  //   - `multiDotStyle` applies where the stop is shared with another line
  //     (an interchange — `station.stops.length >= 2`).
  // Each is used only for stops whose OWN `dotStyle` is unset; an explicit
  // per-stop `dotStyle` always wins and survives topology changes. The two are
  // INDEPENDENT — editing one never moves the other. Each missing ⇒
  // DEFAULT_DOT_STYLE (the filled-black preset, the historical default);
  // setters drop the field when the chosen style equals it so it is never
  // stored. Legacy saves carried one combined `defaultDotStyle` (and, older
  // still, a `defaultDotShape` preset id) — both baked into the split fields on
  // load (bakeLineDotDefaults / convertLegacyDotShapes in serialize.ts).
  singletonDotStyle?: DotStyle;
  multiDotStyle?: DotStyle;
  // Live links to StyleDefs of kind 'stopDot' — the dot-style library entry
  // each split default references. When present, the matching `*DotStyle` raw
  // field equals the style's props (the stamped shadow the renderer reads);
  // editing the style restamps it, picking a library entry sets both. Absent ⇒
  // no explicit line default — resolve to the doc's designated default stopDot
  // style (see resolveDotStyle). Same raw-value-plus-tag contract as `styleId`.
  singletonDotStyleId?: string;
  multiDotStyleId?: string;
  // Dot DIAMETER in px for this line's stops, split the same way as
  // `singletonDotStyle` / `multiDotStyle` (singleton vs. shared station) and
  // used only for stops whose own `dotSize` is unset. Each missing ⇒
  // DOT_SIZE_DEFAULT (= 2 × STOP_DOT_RADIUS). The setters clamp to
  // ≥ DOT_SIZE_MIN, round to an integer, and drop the field at the default so
  // it is never stored. An EXPLICIT size (here or per-stop) applies to every
  // dot style including service-code discs; only the fully-default chain keeps
  // the larger SERVICE_CODE_DOT_RADIUS (see resolveDotRender's sizeOverride
  // param). Legacy saves carried one combined `defaultDotSize`, baked into both
  // on load (bakeLineDotDefaults).
  singletonDotSize?: number;
  multiDotSize?: number;
  // Stripe width in world units. Missing ⇒ LINE_WIDTH_DEFAULT (= STOP_SIZE,
  // the historical constant) — no migration needed for older saves. The
  // setter (`setLineWidth`) clamps to ≥ LINE_WIDTH_MIN, rounds to the 0.25
  // (quarter-unit) grid, and drops the field when the result lands on the default so it is never
  // stored. Width is GEOMETRY, not presentation: stop-cell tangency, band
  // merging, and stripe offsets all derive from it (see lineWidth.ts) — so
  // the setter also re-packs tangent stop chains at the line's stations
  // (stationPacking.ts), keeping packed layouts packed at the new width.
  width?: number;
  // Casing rails CENTERED on the line's body edges — half in, half out —
  // in world units per side (MTA-style separators; see lineStroke.ts for
  // why centered). Missing ⇒ 0 (no casing). Unlike `width`, stroke is
  // PRESENTATION: it never moves paths or changes band merging, so
  // renderers resolve it live. The setter clamps to ≥ 0, rounds to the
  // 0.25 (quarter-unit) grid, and drops the field at 0 so the default is never stored.
  strokeWidth?: number;
  // Casing color, 7-char lowercase hex. Missing ⇒ '#ffffff'. The setter
  // normalizes to lowercase and drops the field at the default.
  strokeColor?: string;
  // Interior "seam" color for a branch/loop. Where a line's OWN bands overlap
  // (a self-junction) the casing is normally merged away; set this to paint a
  // subtle stroke there so the overlap still reads as two tracks. Lowercase
  // hex, may carry alpha (#rrggbbaa) for a translucent seam. Missing ⇒ no seam;
  // the setter drops the field when unset or fully transparent (the "off"
  // state).
  seamColor?: string;
  // Seam width per side, world units. Stored like `strokeWidth` (drop at 0), but
  // an UNSET value inherits the casing width at render time (see seamRenderWidth)
  // so a seam-color-only line still shows a seam. Only takes effect alongside a
  // non-transparent seamColor.
  seamWidth?: number;
  // TfL-tick dimensions for this line's 'dash' stops, world units. Both are
  // stored like `seamWidth` (quarter-unit grid, drop at 0 = "auto"); an UNSET
  // value derives from the line width at render time (length = width,
  // thickness = width / 2 — see dashSize.ts). PRESENTATION: never moves band
  // geometry. `dashLength` is how far the tick protrudes from the stripe edge
  // toward the label; `dashWidth` is its thickness along the travel axis.
  dashLength?: number;
  dashWidth?: number;
  // Corner-rounding radius in world units. Missing ⇒ LINE_CURVE_RADIUS_DEFAULT
  // (= 24, the historical doc-global default) — legacy saves carried a
  // doc-level `curveRadius` instead, baked onto lines on load (see
  // bakeDocCurveRadius in serialize.ts). Like `width` this is GEOMETRY: it
  // moves band paths. Where interlined lines disagree, the shared band curves
  // at the largest member radius. The setter (`setLineCurveRadius`) rounds,
  // clamps to ≥ LINE_CURVE_RADIUS_MIN, and drops the field at the default so
  // it is never stored.
  curveRadius?: number;
  // Live link to a StyleDef of kind 'line' (see MapDoc.styles). INVARIANT:
  // when present, this line's covered style fields (singletonDotStyle,
  // multiDotStyle, singletonDotSize, multiDotSize, width, strokeWidth,
  // strokeColor, seamColor, seamWidth, dashLength, dashWidth, curveRadius —
  // NOT color) equal the style's props. Transforms maintain it: editing any covered field clears
  // the tag ("detach to Custom"), editing the style re-stamps its users,
  // deleting the style untags. Absent ⇒ no style ("Custom" in the UI).
  // Dangling ids are pruned on file load.
  styleId?: string;
}

// A movable label printed inside a line's color band (Vignelli-style).
//
// Anchored to a *station-pair corridor*, not a segment index, so the tag
// survives line reordering: as long as the line still has an edge between
// `fromStationId` and `toStationId`, the tag stays on it.
//
// `fromStationId < toStationId` always (canonical / alphabetic order, matching
// `pairKeyOf` in pairKey.ts).
//
// Position is anchored to one of the two canonical endpoints, by world
// arc-length along the line's stripe path. As the corridor lengthens or
// shortens, the tag stays at the same `distance` from its `anchorEnd`,
// keeping it visually pinned to the nearer station.
//
// `orientation` is in *line-traversal* frame so the user's notion of "forward"
// matches how they drew the line; the renderer flips when the line traverses
// the corridor in reverse-canonical order.
//
// A tag renders either as its service text (`kind: 'text'`, the default) or as
// a directional chevron (`kind: 'chevron'`). The right-click cycle walks all
// six states in order: text up → right → down → left → chevron-forward →
// chevron-reverse → back to text. For chevrons only `orientation` 0 (points
// along line-forward) and 2 (line-reverse) are meaningful.
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
  // Undefined (legacy saves) is treated as 'text'.
  kind?: 'text' | 'chevron';
}

// One coordinate of a region assignment, expressed in a LINE's own frame so
// it rides the line through geometry edits: "along line `lineId`'s stripe in
// corridor `pairKey`, `distance` world units of arc length from the
// `anchorEnd` endpoint" (same anchoring convention as LineTag). A region
// assignment carries one anchor per covering line; reconciliation re-mints
// them after every geometry edit and translates them across edge
// splits/heals when a pairKey is replaced.
export interface RegionAnchor {
  lineId: LineId;
  // Canonical station-pair key of the edge whose band the anchor measures
  // along. May transiently reference a removed edge mid-reconcile (step 0
  // translates it); never persisted dangling by app writers.
  pairKey: string;
  anchorEnd: 'from' | 'to';
  // Arc length in world units from the anchor endpoint along this line's
  // stripe in the corridor.
  distance: number;
  // Signed perpendicular offset (leftNormal of the stripe tangent) from the
  // stripe's center path, world units. Lets an anchor point INTO a face that
  // sits within the stripe body but off its center path (small corner faces
  // at multi-line junctions). Missing ⇒ 0 (on the path); never stored at 0.
  side?: number;
}

// A user's choice of which line paints one overlap region ("paint by
// numbers"). Regions themselves are derived geometry (faces of the
// arrangement of line bodies); the assignment tracks its region through
// edits via the anchors, and `lines` records the region's covering line set
// (sorted) for compatibility checks. `lineId` — the line that shows — is
// always a member of `lines`.
export interface RegionAssignment {
  id: string;
  lineId: LineId;
  lines: LineId[];
  anchors: RegionAnchor[];
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
  // When locked, the bullet can't be dragged, nudged, rotated, deleted, or
  // marquee-selected, and its popover controls (other than the lock toggle)
  // are disabled. It can still be click-selected so the user can unlock it.
  // Optional; missing ⇒ unlocked. Mirrors Polygon.locked.
  locked?: boolean;
  // Live link to a StyleDef of kind 'routeBullet' — covered fields are
  // `shape` and `size` (NOT `lineId`). Same contract as `Line.styleId`.
  styleId?: string;
}

// A free-floating background shape (river, lake, park, …). Rendered UNDER all
// other map content. Vertices are stored in WORLD coordinates (length >= 3, in
// order); there is no separate center/rotation — rotation rewrites the vertices
// around the centroid via the shared `rotateAround` primitive. `fill`/`stroke`
// are 7-char hex (`#rrggbb`); `strokeWidth` is in world units, floored at 0
// (unbounded above — the popover slider caps at 10, but the stored value does
// not).
export interface Polygon {
  id: string;
  vertices: Vec2[];
  fill: string;
  stroke: string;
  strokeWidth: number;
  // Dark-mode colors, used in place of `fill`/`stroke` when the canvas is in
  // dark mode. Initialized equal to the light colors at creation and fully
  // independent thereafter — editing one never changes the other. Old saves
  // predating these fields are backfilled to the light colors once on load
  // (see serialize.ts), so they are always present at runtime. Same 7-char hex.
  darkFill: string;
  darkStroke: string;
  // When locked, the polygon can't be dragged, vertex-edited, rotated, deleted,
  // or marquee-selected, and its popover controls (other than the lock toggle)
  // are disabled. It can still be click-selected so the user can unlock it.
  // Optional; missing ⇒ unlocked.
  locked?: boolean;
  // Corner-rounding radius in world units, 0..50. Optional; missing ⇒ 0 (sharp
  // corners), so polygons saved before this field render unchanged.
  curveRadius?: number;
  // When false, the polygon is OPEN: the stroke runs along the vertex chain
  // with no closing edge and no fill, and hit-testing follows the stroke
  // instead of the filled body. Optional; missing ⇒ true (closed), so polygons
  // saved before this field render unchanged.
  closed?: boolean;
  // Live link to a StyleDef of kind 'polygon' — covered fields are the
  // colors, strokeWidth, curveRadius and closed (NOT vertices/locked). Same
  // contract as `Line.styleId`.
  styleId?: string;
}

// The mutable style/geometry fields of a Polygon accepted by `updatePolygon`
// (everything except `id`). Shared by the transform and the store action so
// the two never drift.
export type PolygonStylePatch = Partial<
  Pick<
    Polygon,
    | 'fill'
    | 'stroke'
    | 'darkFill'
    | 'darkStroke'
    | 'strokeWidth'
    | 'locked'
    | 'curveRadius'
    | 'closed'
    | 'vertices'
  >
>;

// A free-floating imported graphic — an .svg, or a png/jpeg raster — placed on
// the canvas as an OPAQUE `<image href="data:image/…;base64,…">`. (The name
// predates raster support; the entity is format-agnostic.) Rendered in the
// same band as polygons (under all other map content). `x`/`y` are the WORLD
// coords of the image CENTER; `width`/`height` are the unrotated bounding-box
// size in world units (post-scale). `rotation` is a CONTINUOUS angle in
// degrees clockwise — deliberately NOT the 8-step `Rotation` octant used
// elsewhere, because these images snap to 22.5° (half an octant) under Shift.
// `href` is the embedded data URI, fixed at import and never edited.
export interface SvgImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  href: string;
  // Alpha in the SVG-native 0..1 range, painted straight onto the <image>'s
  // `opacity` attribute (the popover slider shows it as a percent). Optional;
  // MISSING ⇒ 1 = fully opaque, and the attribute is omitted entirely, so an
  // untouched image's exported markup is unchanged. Unlike Polygon's fill,
  // opacity can't live in the color's alpha here — an image has no paint of
  // its own, only its baked-in pixels.
  opacity?: number;
  // When locked, the image can't be dragged, resized, rotated, deleted, or
  // marquee-selected, and its popover controls (other than the lock toggle)
  // are disabled. It can still be click-selected so the user can unlock it.
  // Optional; missing ⇒ unlocked. Mirrors Polygon.locked.
  locked?: boolean;
}

// The mutable fields of an SvgImage accepted by `updateSvgImage` (everything
// except `id` and the immutable `href`). Shared by the transform and the store
// action so the two never drift.
export type SvgImageStylePatch = Partial<
  Pick<SvgImage, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'locked'>
>;

// How the branch seam's "inner edges" are drawn (see MapDoc.seamEdges). A seam
// edge path is a mix of straight (`line`) and curved (fillet `arc`) pieces; this
// picks which to keep — 'both' is the full notch, 'straight'/'curved' hint the
// branch with just one edge.
export type SeamEdges = 'both' | 'straight' | 'curved';

export interface MapDoc {
  // User-facing document name. Shown in the toolbar, the window title, and the
  // export/save filename. Never empty at runtime: absent in a loaded file (or
  // older save) fills from DEFAULT_DOC ('Untitled map') via the same merge that
  // backfills every other scalar field, so no migration is needed.
  name: string;
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
  // Z-order, top-of-list (index 0) renders LAST = on top, à la Photoshop layers.
  lineOrder: LineId[];
  // NOTE: there is no doc-level `curveRadius` anymore — corner rounding is a
  // per-line style field (Line.curveRadius). Legacy saves that carry the old
  // doc field get it baked onto their lines on load (bakeDocCurveRadius).
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
  // Inter-station transfer indicators (a theme-aware line between two stations,
  // black-on-white by default in both themes).
  transfers: Record<string, Transfer>;
  // Free-floating text annotations ("Labels" in the UI). Keyed by label id.
  textLabels: Record<string, TextLabel>;
  // Free-floating background shapes (rivers, lakes, …). Rendered under all
  // other map content. Keyed by polygon id.
  polygons: Record<string, Polygon>;
  // Relative paint order of the BACKGROUND BAND — polygons and svg images
  // TOGETHER, in one stack, so either kind can sit over the other (all of it
  // still sits beneath every other map element). Holds ids from both
  // `polygons` and `svgImages`; the kind is resolved by lookup. Later in the
  // array = painted later = on top. Ids missing from this list (legacy saves,
  // races) fall back to insertion order — polygons then images, the pre-merge
  // stacking — and render on top; see `effectiveBackgroundOrder`.
  backgroundOrder: string[];
  // Region paint choices ("paint by numbers" layering): which line shows in
  // an overlap region where line bodies cross. Keyed by assignment id. The
  // regions themselves are derived geometry; assignments track them via
  // line-frame anchors and are reconciled (rebound, split, merged, re-minted)
  // by the store on every geometry-committing edit. Absent entries mean every
  // overlap shows its lineOrder default.
  regionAssignments: Record<string, RegionAssignment>;
  // Free-floating imported graphics (svg or png/jpeg raster), placed in the
  // background band (under all other map content). Keyed by image id. Their
  // z-order lives in `backgroundOrder`, shared with polygons.
  svgImages: Record<string, SvgImage>;
  // Named, reusable formatting presets, keyed by style id (see StyleDef at the
  // bottom of this file and model/styles.ts). Doc-scoped on purpose: styles
  // travel inside the saved file and every edit to them is undoable. Absent in
  // saves predating the feature — backfilled to the per-kind factory styles
  // (DEFAULT_STYLES) via the DEFAULT_DOC merge. INVARIANT: every kind has at
  // least one style (deleteStyle refuses the last; the load paths inject the
  // factory one for an empty kind).
  styles: Record<string, StyleDef>;
  // Which style is THE default of each kind — new items are stamped with it
  // on creation, and legacy loads adopt matching items into it. Explicit and
  // id-keyed (not name-keyed), so any style can be made the default
  // (`setDefaultStyle`) and names stay free. Structurally exactly one per
  // kind; INVARIANT: each entry resolves to a style of that kind (repaired on
  // load, re-pointed when the default style is deleted).
  styleDefaults: Record<StyleKind, string>;
  // NOTE: there are no doc-level station-label font settings anymore — the
  // five labelFontSize/labelWeight/labelItalic/labelLeading/labelTracking
  // fields were retired. Station name typography is per-station (Station's
  // fontSize/weight/italic/leading/tracking), and the map-wide default is the
  // DESIGNATED default 'station' style. Saves predating the retirement carry
  // the five label* fields — baked into per-station values on load
  // (bakeLegacyLabelSettings / persist v13), mirroring the transfer-settings
  // retirement below.
  // Which color palettes are available in the line editor. Invariant:
  // never empty (enforced by transforms / parse sanitiser).
  activePalettes: PaletteId[];
  // How to render every line's branch/loop "inner edges" — the seam painted
  // where a line's own bands overlap at a junction. 'both' draws the full notch
  // (every seam edge), 'straight' keeps only the straight pieces, 'curved' only
  // the fillet arcs, so a branch can be hinted with a single edge instead of the
  // whole overlap. Global for now (all lines share it). Absent in older saves
  // ⇒ 'both' via the DEFAULT_DOC merge — no migration needed.
  seamEdges: SeamEdges;
  // Whether the map is a NIGHT map: false = day (light), true = night (dark).
  // A property of the document, not of the session viewing it — so it travels
  // in the saved file, an exported .massimo.json reopens in the mode it was
  // drawn in, and the library thumbnail / PNG / PDF exports all bake the right
  // background. Every day/night resolution (DayNightColor, themeColors) takes
  // this as a plain boolean parameter, so the model stays theme-agnostic: this
  // field is only ever the SOURCE, read once per component from the store.
  // Absent in older saves ⇒ false via the DEFAULT_DOC merge — no migration
  // needed, same route seamEdges took.
  darkMode: boolean;
  // NOTE: there are no doc-level transfer settings anymore. Transfers fall
  // back to the constant TRANSFER_STYLE_DEFAULTS (transferStyle.ts); map-wide
  // restyling goes through the "Default" transfer style preset. Saves that
  // predate the retirement carry transferThickness/transferColor/
  // transferStrokeWidth/transferStrokeColor — baked into per-transfer
  // overrides on load (bakeLegacyTransferSettings / persist v10).
}

// Multi-line horizontal text alignment inside a TextLabel. `justify` flushes
// both edges: to the widest line when the label auto-sizes (width 0), or to the
// column when a `width` is set. The other three anchor the text within the box.
export type TextLabelAlign = 'left' | 'center' | 'right' | 'justify';

// Helvetica Neue weights we ship in /public/fonts/.
export type TextLabelWeight = 100 | 200 | 300 | 400 | 500 | 700 | 800 | 900;

// A free-floating, rotatable text annotation rendered on top of the map. Used
// for neighborhood names, river labels, legend headings, etc. Position is the
// label's center in world coords; rotation is the existing 8-step 45° axis.
// The popover controls text content, font size (0.5-stepped, min
// TEXT_LABEL_FONT_SIZE_MIN), weight, italic, and multi-line horizontal
// alignment. Not tied to any station or line.
export interface TextLabel {
  id: string;
  x: number;
  y: number;
  rotation: Rotation;
  // Multiline; '\n'-separated.
  text: string;
  // Floored at TEXT_LABEL_FONT_SIZE_MIN and snapped to a 0.5 step by
  // `updateTextLabel`; the slider caps at 96 but the spinbutton is unbounded
  // above, so this can be any half-integer >= the minimum.
  fontSize: number;
  weight: TextLabelWeight;
  italic: boolean;
  align: TextLabelAlign;
  // Column width in world units for wrapping + justification. 0 or absent =
  // "Auto": the label sizes to its content and honors manual '\n' line breaks
  // (the historical behavior). >0 = a fixed-width column: text word-wraps to
  // this width and each '\n' becomes a hard paragraph break. Orthogonal to
  // `align` — left/center/right/justify all position within whichever box this
  // implies. Optional so saves predating the field load as Auto; clamped to a
  // non-negative integer by `updateTextLabel`.
  width?: number;
  // Day/night text colors. `color` paints in light mode, `darkColor` in dark
  // mode. Unlike a polygon (whose dark color is initialized equal to its light
  // color), a label's two defaults differ (#111111 / #ffffff) so the text stays
  // legible in both modes — matching the theme-driven color labels used before
  // these fields existed. Independent once edited. Old saves predating these
  // fields are backfilled to the defaults once on load (see serialize.ts), so
  // they are always present at runtime. 7-char hex (`#rrggbb`).
  color: string;
  darkColor: string;
  // Line-spacing multiplier applied between lines: 1 = the default 1.2em
  // spacing, 0 stacks lines on top of each other, 2 doubles the spacing.
  // Single-line labels are unaffected (one line has no between-line space).
  // Optional so saves predating the field load as 1; clamped to [0, ∞) and
  // snapped to the slider's 0.05 step by `updateTextLabel`.
  leading?: number;
  // Extra letter-spacing in em added inside text runs (0 = font-normal
  // spacing, negative = tighter). Optional so saves predating the field load
  // as 0; clamped at the slider floor and snapped to its 0.01 step by
  // `updateTextLabel`.
  tracking?: number;
  // When locked, the label can't be dragged, nudged, rotated, deleted, or
  // marquee-selected, and its popover controls (other than the lock toggle)
  // are disabled. It can still be click-selected so the user can unlock it.
  // Optional; missing ⇒ unlocked. Mirrors Polygon.locked.
  locked?: boolean;
  // Remembered height (in CSS px) of the text-entry box in this label's editor
  // popover, so a manually stretched box stays stretched instead of resetting
  // to its rows-derived default each time the popover reopens. Purely an
  // editing-UI dimension — it never affects the rendered label. Optional;
  // missing ⇒ the box auto-sizes to its content. Clamped to a positive integer
  // by `updateTextLabel`. Mirrors `Station.editorHeight`.
  editorHeight?: number;
  // Live link to a StyleDef of kind 'textLabel' — covered fields are the
  // colors, fontSize, weight, italic and align (NOT width/leading/tracking/
  // text/position/rotation/locked/editorHeight). Same contract as
  // `Line.styleId`.
  styleId?: string;
}

// One endpoint of a transfer: a specific dot on a station. `lineId` picks
// which dot when the station has multiple (interlining); null means "no
// specific line / station has no stops" — render falls back to the
// station's anchor.
export interface TransferEnd {
  stationId: StationId;
  lineId: LineId | null;
}

// A transfer is a line connecting one station dot to another (thickness and
// theme-aware color come from the per-transfer overrides below, falling back
// to the constant TRANSFER_STYLE_DEFAULTS — the classic 2px black body, white
// outline, black/white in both themes). The endpoints are anchored to specific
// stops so they follow the dot when stations move, lines are reordered, or
// stops shift on a station. Cascade-deleted when either endpoint's stop is
// removed — by deleting the station, deleting the line, or removing that line's
// stop from the station.
export interface Transfer {
  id: string;
  a: TransferEnd;
  b: TransferEnd;
  // Per-transfer style overrides. Each absent field defers to the constant
  // default (TRANSFER_STYLE_DEFAULTS); `updateTransferStyle` drops a field
  // when the chosen value equals that default, so persisted state stays
  // clean (same contract as StopCell.dotStyle / dotSize and Line.width).
  // `color`/`strokeColor` are theme-aware DayNightColors — day in light mode,
  // night in dark; a whole color drops only when BOTH halves match the
  // default. Units and clamps — see model/transferStyle.ts.
  thickness?: number;
  color?: DayNightColor;
  strokeWidth?: number;
  strokeColor?: DayNightColor;
  // Live link to a StyleDef of kind 'transfer' — covered fields are all four
  // style overrides above. Same contract as `Line.styleId`.
  styleId?: string;
}

// The style overrides of a Transfer accepted by `updateTransferStyle`. Shared
// by the transform and the store action so the two never drift (mirrors
// PolygonStylePatch). A provided field is canonicalized against the constant
// default — passing the default's own value CLEARS that override. A color
// patch carries the WHOLE DayNightColor (both halves), even when the popover
// edits only one theme.
export type TransferStylePatch = Partial<
  Pick<Transfer, 'thickness' | 'color' | 'strokeWidth' | 'strokeColor'>
>;

// ---------- Styles (named, reusable per-kind formatting presets) ----------

// Which item collection a style preset applies to. `stopDot` is the outlier:
// it has no item collection of its own — it's the doc-scoped LIBRARY of named
// dot styles that the dot pickers choose from and that the line/stop dot slots
// reference. So it is deliberately absent from STYLE_COLLECTION_OF and the
// generic capture/stamp/adopt machinery; its wearers are the dot slots
// (StopCell.dotStyleId, Line.singleton/multiDotStyleId), restamped by a
// dedicated slot-walk. See model/styles.ts.
export type StyleKind =
  | 'line'
  | 'textLabel'
  | 'polygon'
  | 'routeBullet'
  | 'transfer'
  | 'station'
  | 'stopDot';

// Style props hold FULLY-RESOLVED effective values (captured by example from
// an item — see model/styles.ts), so a style is self-contained: applying one
// never consults the item or the doc defaults it was captured from. Identity
// fields are deliberately NOT style: a line's `color`/`service`/`name`, a
// bullet's `lineId`.
export interface LineStyleProps {
  // Dot TYPE (appearance) IS a covered line-style field: the stopDot library id
  // each split default points at (see Line.singletonDotStyleId /
  // multiDotStyleId), captured/stamped alongside dot size. So a line style also
  // carries the singleton/interchange dot appearance, mirroring the Line
  // inspector's dot rows. Stored as the library id (not a resolved DotStyle):
  // stamping re-points the line at the same library entry, so editing that
  // stopDot style still cascades to the line. A def whose id no longer resolves
  // is repaired to the stopDot ⭐ default on load (see canonicalStyleProps).
  singletonDotStyleId: string;
  multiDotStyleId: string;
  // Dot DIAMETER in px, split by singleton vs. shared station (see
  // Line.singletonDotSize / Line.multiDotSize).
  singletonDotSize: number;
  multiDotSize: number;
  // Stripe width, world units.
  width: number;
  // Corner-rounding radius, world units.
  curveRadius: number;
  // Casing width per side, world units (0 = no casing).
  strokeWidth: number;
  // Casing color, lowercase hex.
  strokeColor: string;
  // Interior branch/loop seam color (lowercase hex, may carry alpha). Optional:
  // absent ⇒ the style leaves the seam off (see Line.seamColor).
  seamColor?: string;
  // Seam width per side (world units). Optional: absent ⇒ inherit the casing
  // width (see Line.seamWidth).
  seamWidth?: number;
  // TfL-tick dimensions (world units). Optional: absent ⇒ derive from the
  // line width at render time (see Line.dashLength / Line.dashWidth).
  dashLength?: number;
  dashWidth?: number;
}

export interface TextLabelStyleProps {
  color: string;
  darkColor: string;
  fontSize: number;
  weight: TextLabelWeight;
  italic: boolean;
  align: TextLabelAlign;
  // Deliberately NOT covered: width, leading, tracking — per-label layout
  // tuning, not reusable typography.
}

export interface PolygonStyleProps {
  fill: string;
  stroke: string;
  darkFill: string;
  darkStroke: string;
  strokeWidth: number;
  curveRadius: number;
  closed: boolean;
}

export interface RouteBulletStyleProps {
  shape: RouteBulletShape;
  size: number;
}

// Mirrors TransferStyle in model/transferStyle.ts — kept as its own interface
// so types.ts stays dependency-free. `color`/`strokeColor` are theme-aware
// (day/night), captured fully-resolved by example like every other style prop.
export interface TransferStyleProps {
  thickness: number;
  color: DayNightColor;
  strokeWidth: number;
  strokeColor: DayNightColor;
}

// Per-station name typography. Every value is FULLY-RESOLVED (captured by
// example — absent per-station optionals resolve through the LABEL_* defaults),
// so a station style is self-contained like the others. Unlike
// TextLabelStyleProps, leading and tracking ARE covered here: for stations
// these were doc-global typography being decentralized (the retired
// labelLeading/labelTracking), not per-item layout tuning.
export interface StationStyleProps {
  fontSize: number;
  weight: TextLabelWeight;
  italic: boolean;
  leading: number;
  tracking: number;
}

// Per-kind props lookup, for code generic over StyleKind.
export interface StylePropsByKind {
  line: LineStyleProps;
  textLabel: TextLabelStyleProps;
  polygon: PolygonStyleProps;
  routeBullet: RouteBulletStyleProps;
  transfer: TransferStyleProps;
  station: StationStyleProps;
  // A stopDot style's props ARE a DotStyle — the named library entry a dot slot
  // references. (Size is deliberately not covered; it stays the orthogonal
  // dotSize axis.)
  stopDot: DotStyle;
}

// A named, reusable formatting preset stored in the doc (MapDoc.styles).
// Items reference a style via their `styleId` tag; see that field's contract.
export type StyleDef = {
  [K in StyleKind]: { id: string; name: string; kind: K; props: StylePropsByKind[K] };
}[StyleKind];
