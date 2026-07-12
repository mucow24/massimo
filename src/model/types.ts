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
  | 'filled-black-service-code'
  | 'filled-black-diamond'
  | 'filled-white-diamond'
  | 'filled-black-x'
  | 'filled-white-x'
  | 'none';

// A color that resolves per theme: `day` paints in light mode, `night` in
// dark mode. Both 7-char lowercase hex.
export interface DayNightColor {
  day: string;
  night: string;
}

export type DotBaseShape = 'circle' | 'square' | 'diamond' | 'x';

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
  // Per-station bold flag. When true, the rendered weight is bumped two
  // steps along LABEL_WEIGHT_VALUES (Regular → Bold, Light → Roman, etc.),
  // clamped at Black (900). Omitted/false means "use the doc's labelWeight
  // as-is".
  labelBold?: boolean;
  // Per-station italic flag. When true, this station's name renders italic
  // even if the doc's global `labelItalic` is off. Combined with the global
  // flag (OR): the label is italic when either is set. Omitted/false means
  // "use the doc's labelItalic as-is".
  labelItalic?: boolean;
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
  stations: StationId[];
  waypoints?: Record<string, Vec2[]>;
  // Per-segment style overrides keyed by canonical pair-key (pairKeyOf(a, b)).
  // Missing key ⇒ 'solid'. Setters delete the key when called with 'solid'
  // so the default is never stored.
  segmentStyles?: Record<string, LineStyle>;
  // Per-segment z-layer override keyed by canonical pair-key. Missing key ⇒ 0.
  // Higher = closer to the viewer. Uncapped — the layering UI just ±1's the
  // value, so it can drift as far positive or negative as the user clicks.
  // Setters delete the key when value lands on 0 so the default isn't stored.
  segmentLayers?: Record<string, number>;
  // Style for stops on this line whose own `dotStyle` is unset. Missing ⇒
  // DEFAULT_DOT_STYLE (the filled-black preset, the historical default).
  // Setters drop the field when the chosen style equals the default so it is
  // never stored. Legacy saves carried a `defaultDotShape` preset id —
  // converted on load (see convertLegacyDotShapes in serialize.ts).
  defaultDotStyle?: DotStyle;
  // Dot DIAMETER in px for stops on this line whose own `dotSize` is unset.
  // Missing ⇒ DOT_SIZE_DEFAULT (= 2 × STOP_DOT_RADIUS) — no migration needed
  // for older saves, same idiom as `width`. The setter
  // (`setLineDefaultDotSize`) clamps to ≥ DOT_SIZE_MIN, rounds to an
  // integer, and drops the field at the default so it is never stored. An
  // EXPLICIT size (here or per-stop) applies to every dot style including
  // service-code discs; only the fully-default chain keeps the larger
  // SERVICE_CODE_DOT_RADIUS (see resolveDotRender's sizeOverride param).
  defaultDotSize?: number;
  // Stripe width in world units. Missing ⇒ LINE_WIDTH_DEFAULT (= STOP_SIZE,
  // the historical constant) — no migration needed for older saves. The
  // setter (`setLineWidth`) clamps to ≥ LINE_WIDTH_MIN, rounds to an integer,
  // and drops the field when the result lands on the default so it is never
  // stored. Width is GEOMETRY, not presentation: stop-cell tangency, band
  // merging, and stripe offsets all derive from it (see lineWidth.ts).
  width?: number;
  // Casing rails CENTERED on the line's body edges — half in, half out —
  // in world units per side (MTA-style separators; see lineStroke.ts for
  // why centered). Missing ⇒ 0 (no casing). Unlike `width`, stroke is
  // PRESENTATION: it never moves paths or changes band merging, so
  // renderers resolve it live. The setter clamps to ≥ 0, rounds to the
  // 0.5 grid, and drops the field at 0 so the default is never stored.
  strokeWidth?: number;
  // Casing color, 7-char lowercase hex. Missing ⇒ '#ffffff'. The setter
  // normalizes to lowercase and drops the field at the default.
  strokeColor?: string;
  // Live link to a StyleDef of kind 'line' (see MapDoc.styles). INVARIANT:
  // when present, this line's covered style fields (defaultDotStyle,
  // defaultDotSize, width, strokeWidth, strokeColor — NOT color) equal the
  // style's props. Transforms maintain it: editing any covered field clears
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

// A free-floating imported SVG graphic, placed on the canvas as an OPAQUE
// `<image href="data:image/svg+xml;base64,…">`. Rendered in the same band as
// polygons (under all other map content). `x`/`y` are the WORLD coords of the
// image CENTER; `width`/`height` are the unrotated bounding-box size in world
// units (post-scale). `rotation` is a CONTINUOUS angle in degrees clockwise —
// deliberately NOT the 8-step `Rotation` octant used elsewhere, because svg
// images snap to 22.5° (half an octant) under Shift. `href` is the embedded
// data URI, fixed at import and never edited.
export interface SvgImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  href: string;
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
  Pick<SvgImage, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'locked'>
>;

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
  // Inter-station transfer indicators (a theme-aware line between two stations,
  // black-on-white by default in both themes).
  transfers: Record<string, Transfer>;
  // Free-floating text annotations ("Labels" in the UI). Keyed by label id.
  textLabels: Record<string, TextLabel>;
  // Free-floating background shapes (rivers, lakes, …). Rendered under all
  // other map content. Keyed by polygon id.
  polygons: Record<string, Polygon>;
  // Relative paint order of polygons among themselves (all still sit beneath
  // every other map element). Later in the array = painted later = on top.
  // Ids missing from this list (legacy saves, races) fall back to insertion
  // order and render on top — see `effectivePolygonOrder`.
  polygonOrder: string[];
  // Free-floating imported SVG graphics, placed in the polygon band (under all
  // other map content). Keyed by image id.
  svgImages: Record<string, SvgImage>;
  // Relative paint order of svg images among themselves (all still sit in the
  // polygon band). Later in the array = painted later = on top. Ids missing
  // from this list fall back to insertion order — see `effectiveSvgImageOrder`.
  svgImageOrder: string[];
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
  // Global station-label styling. Applies to every station name; line tags
  // and route bullets keep their always-bold pill styling. `labelWeight` is
  // one of the Helvetica Neue weights we ship in /public/fonts/ (no 600).
  // Per-station `labelBold` bumps the rendered weight two steps heavier on
  // top of this default.
  labelFontSize: number;
  labelWeight: TextLabelWeight;
  labelItalic: boolean;
  // Global station-label line-spacing multiplier (1 = the default 1.2em
  // spacing) and letter-spacing in em (0 = font-normal). Apply to every
  // station name, mirroring the per-label `leading`/`tracking` on TextLabel.
  // Absent in saves predating the fields — backfilled to the neutral 1 / 0 via
  // DEFAULT_DOC.
  labelLeading: number;
  labelTracking: number;
  // Which color palettes are available in the line editor. Invariant:
  // never empty (enforced by transforms / parse sanitiser).
  activePalettes: PaletteId[];
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

// Which item collection a style preset applies to.
export type StyleKind = 'line' | 'textLabel' | 'polygon' | 'routeBullet' | 'transfer';

// Style props hold FULLY-RESOLVED effective values (captured by example from
// an item — see model/styles.ts), so a style is self-contained: applying one
// never consults the item or the doc defaults it was captured from. Identity
// fields are deliberately NOT style: a line's `color`/`service`/`name`, a
// bullet's `lineId`.
export interface LineStyleProps {
  defaultDotStyle: DotStyle;
  // Dot DIAMETER in px (the line-default size).
  defaultDotSize: number;
  // Stripe width, world units.
  width: number;
  // Casing width per side, world units (0 = no casing).
  strokeWidth: number;
  // Casing color, lowercase hex.
  strokeColor: string;
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

// Per-kind props lookup, for code generic over StyleKind.
export interface StylePropsByKind {
  line: LineStyleProps;
  textLabel: TextLabelStyleProps;
  polygon: PolygonStyleProps;
  routeBullet: RouteBulletStyleProps;
  transfer: TransferStyleProps;
}

// A named, reusable formatting preset stored in the doc (MapDoc.styles).
// Items reference a style via their `styleId` tag; see that field's contract.
export type StyleDef = {
  [K in StyleKind]: { id: string; name: string; kind: K; props: StylePropsByKind[K] };
}[StyleKind];
