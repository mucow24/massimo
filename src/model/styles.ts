// Named, reusable style presets ("Styles"): pure transforms over
// MapDoc.styles and the per-item styleId tags. See the StyleDef/styleId
// contracts in types.ts. All transforms are pure (doc, …) → doc and return
// the SAME reference on no-op (the invariant undo/history relies on).
//
// Stamping goes through the existing canonical setters (setLineWidth,
// updateTransferStyle, …) rather than raw field spreads, so every clamp,
// collapse-at-default and cascade rule (per-stop override pruning, transfer
// override canonicalization, label re-anchoring) stays in one place and a
// stamped doc round-trips serialize/parse unchanged. The tag is written LAST
// so the setters' own detach-on-edit can't erase it.

import {
  DEFAULT_STYLES,
  FONT_SIZE_STEP,
  POLYGON_CURVE_RADIUS_MIN,
  POLYGON_STROKE_STEP,
  POLYGON_STROKE_WIDTH_MIN,
  TEXT_LABEL_FONT_SIZE_MIN,
  canonicalStationLabelStyle,
  clampRouteBulletSize,
  effectiveStationStyleProps,
  setLineCurveRadius,
  setLineDashLength,
  setLineDashWidth,
  setLineDefaultDotSize,
  setLineDefaultDotStyle,
  setLineStrokeColor,
  setLineSeamColor,
  setLineSeamWidth,
  setLineStrokeWidth,
  setLineWidth,
  updatePolygon,
  updateRouteBullet,
  updateStationLabelStyle,
  updateTextLabel,
  updateTransferStyle,
} from './transforms';
import { DEFAULT_DOT_STYLE, dotStylesEqual } from './dotStyle';
import { DOT_SIZE_MIN, lineDefaultDotSizeOf } from './dotSize';
import { lineDashLengthOf, lineDashWidthOf } from './dashSize';
import { LINE_WIDTH_MIN, LINE_WIDTH_STEP, lineWidthOf } from './lineWidth';
import {
  LINE_CURVE_RADIUS_DEFAULT,
  LINE_CURVE_RADIUS_MIN,
  LINE_CURVE_RADIUS_STEP,
  lineCurveRadiusOf,
} from './lineCurve';
import {
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_MIN,
  canonicalSeamColor,
  canonicalStrokeWidth,
  lineSeamColorOf,
  lineSeamWidthOf,
  lineStrokeColorOf,
  lineStrokeWidthOf,
} from './lineStroke';
import {
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_STROKE_WIDTH_STEP,
  TRANSFER_THICKNESS_MIN,
  dayNightColorsEqual,
  resolveTransferStyle,
} from './transferStyle';
import type {
  LineStyleProps,
  MapDoc,
  PolygonStyleProps,
  RouteBulletStyleProps,
  StationStyleProps,
  StyleDef,
  StyleKind,
  StylePropsByKind,
  TextLabelStyleProps,
  TransferStyleProps,
} from './types';

// Which MapDoc collection each style kind's items live in.
export const STYLE_COLLECTION_OF = {
  line: 'lines',
  textLabel: 'textLabels',
  polygon: 'polygons',
  routeBullet: 'routeBullets',
  transfer: 'transfers',
  station: 'stations',
} as const satisfies Record<StyleKind, keyof MapDoc>;

// The one shape all five collections share that styles care about.
type Tagged = { styleId?: string };

const itemsOf = (doc: MapDoc, kind: StyleKind): Record<string, Tagged> =>
  doc[STYLE_COLLECTION_OF[kind]] as Record<string, Tagged>;

/**
 * Read the EFFECTIVE covered-field values of one item as style props —
 * define-by-example capture. Effective, not stored: absent optionals resolve
 * through the same helpers the renderer uses (lineWidthOf, resolveTransferStyle,
 * label `?? 0/1/0`, …), so a captured style is self-contained. Returns null
 * when the item doesn't exist.
 */
export function captureStyleProps<K extends StyleKind>(
  doc: MapDoc,
  kind: K,
  itemId: string,
): StylePropsByKind[K] | null {
  switch (kind as StyleKind) {
    case 'line': {
      const l = doc.lines[itemId];
      if (!l) return null;
      const seamColor = lineSeamColorOf(l);
      const seamWidth = lineSeamWidthOf(l);
      const dashLength = lineDashLengthOf(l);
      const dashWidth = lineDashWidthOf(l);
      return {
        defaultDotStyle: l.defaultDotStyle ?? DEFAULT_DOT_STYLE,
        defaultDotSize: lineDefaultDotSizeOf(l),
        width: lineWidthOf(l),
        curveRadius: lineCurveRadiusOf(l),
        strokeWidth: lineStrokeWidthOf(l),
        strokeColor: lineStrokeColorOf(l),
        // Optional: omitted when unset, so a captured style compares equal to
        // one that never had the key.
        ...(seamColor !== undefined ? { seamColor } : {}),
        ...(seamWidth !== undefined ? { seamWidth } : {}),
        ...(dashLength !== undefined ? { dashLength } : {}),
        ...(dashWidth !== undefined ? { dashWidth } : {}),
      } as StylePropsByKind[K];
    }
    case 'textLabel': {
      const t = doc.textLabels[itemId];
      if (!t) return null;
      return {
        color: t.color,
        darkColor: t.darkColor,
        fontSize: t.fontSize,
        weight: t.weight,
        italic: t.italic,
        align: t.align,
      } as StylePropsByKind[K];
    }
    case 'polygon': {
      const p = doc.polygons[itemId];
      if (!p) return null;
      return {
        fill: p.fill,
        stroke: p.stroke,
        darkFill: p.darkFill,
        darkStroke: p.darkStroke,
        strokeWidth: p.strokeWidth,
        curveRadius: p.curveRadius ?? 0,
        closed: p.closed !== false,
      } as StylePropsByKind[K];
    }
    case 'routeBullet': {
      const b = doc.routeBullets[itemId];
      if (!b) return null;
      return { shape: b.shape, size: b.size } as StylePropsByKind[K];
    }
    case 'transfer': {
      const t = doc.transfers[itemId];
      if (!t) return null;
      return resolveTransferStyle(t) as StylePropsByKind[K];
    }
    case 'station': {
      const s = doc.stations[itemId];
      if (!s) return null;
      // Effective typography (stored ?? LABEL_* default), so a default-looking
      // station captures the factory props — self-contained like the others.
      return effectiveStationStyleProps(s) as StylePropsByKind[K];
    }
  }
  return null;
}

// "Custom" is the style dropdown's detached-sentinel label — a style wearing
// it would be indistinguishable there, so every naming path (save, rename,
// file-load sanitizing) refuses it, case-insensitively.
export function isReservedStyleName(trimmed: string): boolean {
  return trimmed.toLowerCase() === 'custom';
}

// Deep equality over style props. Most props are flat scalars, but two kinds
// carry objects that must compare STRUCTURALLY, not by reference: a line
// style's DotStyle (dotStylesEqual), and a transfer style's day/night
// color/strokeColor (dayNightColorsEqual). Exported for serialize's
// mismatched-tag pruning.
export function stylePropsEqual(
  kind: StyleKind,
  a: StyleDef['props'],
  b: StyleDef['props'],
): boolean {
  if (kind === 'line') {
    const la = a as LineStyleProps;
    const lb = b as LineStyleProps;
    return (
      dotStylesEqual(la.defaultDotStyle, lb.defaultDotStyle) &&
      la.defaultDotSize === lb.defaultDotSize &&
      la.width === lb.width &&
      la.curveRadius === lb.curveRadius &&
      la.strokeWidth === lb.strokeWidth &&
      la.strokeColor === lb.strokeColor &&
      la.seamColor === lb.seamColor &&
      la.seamWidth === lb.seamWidth &&
      la.dashLength === lb.dashLength &&
      la.dashWidth === lb.dashWidth
    );
  }
  if (kind === 'transfer') {
    const ta = a as TransferStyleProps;
    const tb = b as TransferStyleProps;
    return (
      ta.thickness === tb.thickness &&
      ta.strokeWidth === tb.strokeWidth &&
      dayNightColorsEqual(ta.color, tb.color) &&
      dayNightColorsEqual(ta.strokeColor, tb.strokeColor)
    );
  }
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of Object.keys(rb)) if (ra[k] !== rb[k]) return false;
  return true;
}

/**
 * Clamp/normalize a full per-kind props object onto the SAME canonical grids
 * the item transforms use, so a def edited in the panel compares exactly
 * equal to what stamping it stores back. Total over typed input — validation
 * of untyped file data lives in serialize's sanitizeStyleProps, which applies
 * these rules after type-checking. Rebuilds explicitly, so foreign keys (a
 * patch meant for another kind, since-dropped fields) never survive.
 */
export function canonicalStyleProps<K extends StyleKind>(
  kind: K,
  props: StylePropsByKind[K],
): StylePropsByKind[K] {
  switch (kind as StyleKind) {
    case 'line': {
      const p = props as LineStyleProps;
      // Canonical seam: off (transparent color / 0 width) collapses to omitted,
      // mirroring the line fields. Dash dims collapse the same way (0 = derive).
      const seamColor = p.seamColor == null ? undefined : canonicalSeamColor(p.seamColor);
      const seamWidth = p.seamWidth == null ? undefined : canonicalStrokeWidth(p.seamWidth);
      const dashLength = p.dashLength == null ? undefined : canonicalStrokeWidth(p.dashLength);
      const dashWidth = p.dashWidth == null ? undefined : canonicalStrokeWidth(p.dashWidth);
      return {
        defaultDotStyle: p.defaultDotStyle,
        defaultDotSize: Math.max(DOT_SIZE_MIN, Math.round(p.defaultDotSize)),
        width: Math.max(LINE_WIDTH_MIN, Math.round(p.width / LINE_WIDTH_STEP) * LINE_WIDTH_STEP),
        // `?? DEFAULT` heals defs from saves that predate the field (the load
        // paths bake it in first — see bakeDocCurveRadius — this is the
        // keep-canonical-props-concrete backstop).
        curveRadius: Math.max(
          LINE_CURVE_RADIUS_MIN,
          Math.round((p.curveRadius ?? LINE_CURVE_RADIUS_DEFAULT) / LINE_CURVE_RADIUS_STEP) *
            LINE_CURVE_RADIUS_STEP,
        ),
        strokeWidth: Math.max(
          LINE_STROKE_WIDTH_MIN,
          Math.round(p.strokeWidth / LINE_STROKE_STEP) * LINE_STROKE_STEP,
        ),
        strokeColor: p.strokeColor.toLowerCase(),
        ...(seamColor !== undefined ? { seamColor } : {}),
        ...(seamWidth !== undefined ? { seamWidth } : {}),
        ...(dashLength !== undefined ? { dashLength } : {}),
        ...(dashWidth !== undefined ? { dashWidth } : {}),
      } as StylePropsByKind[K];
    }
    case 'textLabel': {
      const p = props as TextLabelStyleProps;
      return {
        color: p.color,
        darkColor: p.darkColor,
        fontSize: Math.max(
          TEXT_LABEL_FONT_SIZE_MIN,
          Math.round(p.fontSize / FONT_SIZE_STEP) * FONT_SIZE_STEP,
        ),
        weight: p.weight,
        italic: p.italic,
        align: p.align,
      } as StylePropsByKind[K];
    }
    case 'polygon': {
      const p = props as PolygonStyleProps;
      return {
        fill: p.fill,
        stroke: p.stroke,
        darkFill: p.darkFill,
        darkStroke: p.darkStroke,
        strokeWidth: Math.max(
          POLYGON_STROKE_WIDTH_MIN,
          Math.round(p.strokeWidth / POLYGON_STROKE_STEP) * POLYGON_STROKE_STEP,
        ),
        curveRadius: Math.max(POLYGON_CURVE_RADIUS_MIN, p.curveRadius),
        closed: p.closed,
      } as StylePropsByKind[K];
    }
    case 'routeBullet': {
      const p = props as RouteBulletStyleProps;
      return { shape: p.shape, size: clampRouteBulletSize(p.size) } as StylePropsByKind[K];
    }
    case 'transfer': {
      const p = props as TransferStyleProps;
      return {
        thickness: Math.max(TRANSFER_THICKNESS_MIN, Math.round(p.thickness)),
        color: p.color,
        strokeWidth: Math.max(
          TRANSFER_STROKE_WIDTH_MIN,
          Math.round(p.strokeWidth / TRANSFER_STROKE_WIDTH_STEP) * TRANSFER_STROKE_WIDTH_STEP,
        ),
        strokeColor: p.strokeColor,
      } as StylePropsByKind[K];
    }
    case 'station': {
      // Same canonicalizer the per-station writer uses, so a panel-edited def
      // compares exactly equal to what stamping it stores back on a station.
      return canonicalStationLabelStyle(props as StationStyleProps) as StylePropsByKind[K];
    }
  }
  return props;
}

// Set the tag on one item; same reference when already tagged with this id.
function withStyleTag(doc: MapDoc, kind: StyleKind, itemId: string, styleId: string): MapDoc {
  const key = STYLE_COLLECTION_OF[kind];
  const coll = itemsOf(doc, kind);
  const cur = coll[itemId];
  if (!cur || cur.styleId === styleId) return doc;
  return { ...doc, [key]: { ...coll, [itemId]: { ...cur, styleId } } } as MapDoc;
}

// Stamp a def's props onto one item via the canonical setters, then tag it.
// Always applies (no already-tagged early-out) — the re-stamp path relies on
// that when a tagged item's values predate a redefined style.
function stampStyle(doc: MapDoc, def: StyleDef, itemId: string): MapDoc {
  let next = doc;
  switch (def.kind) {
    case 'line': {
      const p = def.props;
      next = setLineDefaultDotStyle(next, itemId, p.defaultDotStyle);
      next = setLineDefaultDotSize(next, itemId, p.defaultDotSize);
      next = setLineWidth(next, itemId, p.width);
      next = setLineCurveRadius(next, itemId, p.curveRadius);
      next = setLineStrokeWidth(next, itemId, p.strokeWidth);
      next = setLineStrokeColor(next, itemId, p.strokeColor);
      // undefined ⇒ fully transparent ⇒ removes any prior seam (stamp "off").
      next = setLineSeamColor(next, itemId, p.seamColor ?? '#00000000');
      // undefined ⇒ 0 ⇒ dropped, so the stamped line inherits the casing width.
      next = setLineSeamWidth(next, itemId, p.seamWidth ?? 0);
      // undefined ⇒ 0 ⇒ dropped, so the stamped line derives from its width.
      next = setLineDashLength(next, itemId, p.dashLength ?? 0);
      next = setLineDashWidth(next, itemId, p.dashWidth ?? 0);
      break;
    }
    case 'textLabel': {
      // Explicit pick, not a props spread — a def from an older save could
      // carry since-dropped keys (width/leading/tracking) that must not be
      // stamped onto the label.
      const p = def.props;
      next = updateTextLabel(next, itemId, {
        color: p.color,
        darkColor: p.darkColor,
        fontSize: p.fontSize,
        weight: p.weight,
        italic: p.italic,
        align: p.align,
      });
      break;
    }
    case 'polygon':
      next = updatePolygon(next, itemId, { ...def.props });
      break;
    case 'routeBullet':
      next = updateRouteBullet(next, itemId, { ...def.props });
      break;
    case 'transfer':
      next = updateTransferStyle(next, itemId, { ...def.props });
      break;
    case 'station': {
      // Explicit pick (not a props spread) so a def from an older save can't
      // carry a since-changed key onto the station; the setter collapses each
      // field to omission at its default and strips any prior tag (re-added
      // below). All five typography fields are covered.
      const p = def.props;
      next = updateStationLabelStyle(next, itemId, {
        fontSize: p.fontSize,
        weight: p.weight,
        italic: p.italic,
        leading: p.leading,
        tracking: p.tracking,
      });
      break;
    }
  }
  return withStyleTag(next, def.kind, itemId, def.id);
}

/**
 * Stamp a style's props onto an item and tag it. No-ops (same reference)
 * when the style or item is missing, or the item is tagged AND its values
 * already match — the skip is by VALUE, not by tag, so re-applying a style
 * repairs a tagged item whose values drifted (a stale clipboard paste)
 * instead of early-outing on the tag.
 */
export function applyStyleToItem(doc: MapDoc, styleId: string, itemId: string): MapDoc {
  const def = doc.styles[styleId];
  if (!def) return doc;
  const cur = itemsOf(doc, def.kind)[itemId];
  if (!cur) return doc;
  const props = captureStyleProps(doc, def.kind, itemId);
  if (props && stylePropsEqual(def.kind, props, def.props)) {
    // Values already match — just make sure the tag is on (no-op when it is).
    return withStyleTag(doc, def.kind, itemId, styleId);
  }
  return stampStyle(doc, def, itemId);
}

/**
 * Re-assert the tagged ⇒ matches invariant on one item after an insert that
 * carried a frozen snapshot (clipboard paste): if the item arrived tagged but
 * the style was redefined since the copy, re-stamp it with the style's
 * CURRENT props. Same reference when untagged or already matching. The
 * add*With constructors have already stripped dangling/wrong-kind tags, so a
 * surviving tag always resolves.
 */
export function restampStyleTag(doc: MapDoc, kind: StyleKind, itemId: string): MapDoc {
  const cur = itemsOf(doc, kind)[itemId];
  if (!cur || cur.styleId === undefined) return doc;
  return applyStyleToItem(doc, cur.styleId, itemId);
}

/**
 * Upsert a style def captured from an item (define-by-example), then re-stamp
 * every item tagged with it — their values may predate the new props — plus
 * the source item, all in one returned doc (one undo entry). Users whose
 * effective values already match are skipped (keeps their references, and
 * keeps updateTextLabel's re-anchor from churning unchanged labels).
 */
export function saveStyleFromItem(
  doc: MapDoc,
  styleId: string,
  kind: StyleKind,
  name: string,
  itemId: string,
): MapDoc {
  const trimmed = name.trim();
  if (!trimmed || isReservedStyleName(trimmed)) return doc;
  const props = captureStyleProps(doc, kind, itemId);
  if (!props) return doc;
  const existing = doc.styles[styleId];
  if (
    existing &&
    existing.kind === kind &&
    existing.name === trimmed &&
    stylePropsEqual(kind, existing.props, props) &&
    itemsOf(doc, kind)[itemId].styleId === styleId
  ) {
    return doc;
  }
  const def = { id: styleId, name: trimmed, kind, props } as StyleDef;
  let next: MapDoc = { ...doc, styles: { ...doc.styles, [styleId]: def } };
  const coll = itemsOf(next, kind);
  for (const id of Object.keys(coll)) {
    if (id !== itemId && coll[id].styleId !== styleId) continue;
    const cur = captureStyleProps(next, kind, id);
    if (cur && stylePropsEqual(kind, cur, props)) {
      next = withStyleTag(next, kind, id, styleId);
    } else {
      next = stampStyle(next, def, id);
    }
  }
  return next;
}

/**
 * Add a brand-new style of `kind` with the kind's FACTORY props (the same
 * values the built-in Default ships with) — the Styles panel's "+ New style".
 * Refuses empty/reserved names, same-kind collisions, and taken ids.
 */
export function createStyle(doc: MapDoc, id: string, kind: StyleKind, name: string): MapDoc {
  const trimmed = name.trim();
  if (!trimmed || isReservedStyleName(trimmed) || doc.styles[id]) return doc;
  for (const other of Object.values(doc.styles)) {
    if (other.kind === kind && other.name === trimmed) return doc;
  }
  const factory = Object.values(DEFAULT_STYLES).find((d) => d.kind === kind);
  if (!factory) return doc;
  const def = { id, name: trimmed, kind, props: factory.props } as StyleDef;
  return { ...doc, styles: { ...doc.styles, [id]: def } };
}

// A partial patch of ONE kind's props — the store/panel write shape for
// updateStyleProps (each editor patches a single kind). A UNION, not a
// Partial of the intersection: the same-named `color`/`strokeColor` keys no
// longer share a type across kinds (transfer's are day/night objects,
// textLabel's/line's are hex strings), so an intersection would collapse them
// to `never`. canonicalStyleProps' explicit rebuild still discards keys
// foreign to the def's kind after the spread.
export type StylePropsPatch =
  | Partial<LineStyleProps>
  | Partial<TextLabelStyleProps>
  | Partial<PolygonStyleProps>
  | Partial<RouteBulletStyleProps>
  | Partial<TransferStyleProps>
  | Partial<StationStyleProps>;

/**
 * Patch a style def's props (the panel editor's write path) and re-stamp
 * every item tagged with it in the same returned doc — the live preview.
 * Values land on the canonical grids; users already matching are skipped
 * (reference-stable). Name and id are untouched (renameStyle owns the name).
 */
export function updateStyleProps(doc: MapDoc, styleId: string, patch: StylePropsPatch): MapDoc {
  const def = doc.styles[styleId];
  if (!def) return doc;
  const merged = canonicalStyleProps(def.kind, {
    ...def.props,
    ...patch,
  } as StylePropsByKind[typeof def.kind]);
  if (stylePropsEqual(def.kind, merged, def.props)) return doc;
  const nextDef = { id: def.id, name: def.name, kind: def.kind, props: merged } as StyleDef;
  let next: MapDoc = { ...doc, styles: { ...doc.styles, [styleId]: nextDef } };
  const coll = itemsOf(next, def.kind);
  for (const id of Object.keys(coll)) {
    if (coll[id].styleId !== styleId) continue;
    const cur = captureStyleProps(next, def.kind, id);
    if (cur && stylePropsEqual(def.kind, cur, merged)) continue;
    next = stampStyle(next, nextDef, id);
  }
  return next;
}

/** Rename a style (id kept, no re-stamp). Refuses same-kind name collisions
 *  and the reserved sentinel name "Custom". */
export function renameStyle(doc: MapDoc, styleId: string, name: string): MapDoc {
  const def = doc.styles[styleId];
  if (!def) return doc;
  const trimmed = name.trim();
  if (!trimmed || trimmed === def.name || isReservedStyleName(trimmed)) return doc;
  for (const other of Object.values(doc.styles)) {
    if (other.id !== styleId && other.kind === def.kind && other.name === trimmed) return doc;
  }
  return { ...doc, styles: { ...doc.styles, [styleId]: { ...def, name: trimmed } } };
}

/**
 * Delete a style def and untag its users (their values are kept). REFUSED
 * for the last style of its kind — every kind keeps at least one, so the
 * default designation always has somewhere to point. Deleting the current
 * default re-points the designation at the kind's first remaining style
 * (name order).
 */
export function deleteStyle(doc: MapDoc, styleId: string): MapDoc {
  const def = doc.styles[styleId];
  if (!def) return doc;
  const { [styleId]: _gone, ...styles } = doc.styles;
  const remaining = stylesOfKind(styles, def.kind);
  if (remaining.length === 0) return doc;
  const key = STYLE_COLLECTION_OF[def.kind];
  const coll = itemsOf(doc, def.kind);
  const out: Record<string, Tagged> = {};
  let untagged = false;
  for (const id of Object.keys(coll)) {
    const item = coll[id];
    if (item.styleId === styleId) {
      const { styleId: _sid, ...rest } = item;
      out[id] = rest;
      untagged = true;
    } else {
      out[id] = item;
    }
  }
  const styleDefaults =
    doc.styleDefaults[def.kind] === styleId
      ? { ...doc.styleDefaults, [def.kind]: remaining[0].id }
      : doc.styleDefaults;
  return untagged
    ? ({ ...doc, styles, styleDefaults, [key]: out } as MapDoc)
    : { ...doc, styles, styleDefaults };
}

/** Drop an item's style tag only (the dropdown's "Custom" choice). */
export function clearStyleTag(doc: MapDoc, kind: StyleKind, itemId: string): MapDoc {
  const key = STYLE_COLLECTION_OF[kind];
  const coll = itemsOf(doc, kind);
  const cur = coll[itemId];
  if (!cur || cur.styleId === undefined) return doc;
  const { styleId: _gone, ...rest } = cur;
  return { ...doc, [key]: { ...coll, [itemId]: rest } } as MapDoc;
}

/** The styles of one kind, sorted by name — the dropdown/panel list order. */
export function stylesOfKind(styles: Record<string, StyleDef>, kind: StyleKind): StyleDef[] {
  return Object.values(styles)
    .filter((d) => d.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The kind's DESIGNATED default style — the doc's styleDefaults entry,
 * guarded against a dangling or wrong-kind id (repaired on load, but partial
 * migrate-time docs pass through here too). Defaultness is explicit and
 * id-keyed (`setDefaultStyle`), never derived from a name.
 */
export function defaultStyleOf(
  doc: Pick<MapDoc, 'styles' | 'styleDefaults'>,
  kind: StyleKind,
): StyleDef | undefined {
  if (!doc.styles || !doc.styleDefaults) return undefined;
  const def = doc.styles[doc.styleDefaults[kind]];
  return def?.kind === kind ? def : undefined;
}

/**
 * The designated default's props. New items are stamped with these on
 * creation, and placement previews read them so the ghost matches what will
 * actually drop.
 */
export function defaultStyleProps<K extends StyleKind>(
  doc: Pick<MapDoc, 'styles' | 'styleDefaults'>,
  kind: K,
): StylePropsByKind[K] | undefined {
  return defaultStyleOf(doc, kind)?.props as StylePropsByKind[K] | undefined;
}

/**
 * Stamp + tag a freshly created item with its kind's designated default
 * style (current props — redefining the default changes what new items look
 * like). Same reference when the designation doesn't resolve (partial docs;
 * a loaded doc always has one).
 */
export function applyDefaultStyle(doc: MapDoc, kind: StyleKind, itemId: string): MapDoc {
  const def = defaultStyleOf(doc, kind);
  return def === undefined ? doc : applyStyleToItem(doc, def.id, itemId);
}

/**
 * Designate `styleId` as its kind's default — the panel's "make default".
 * No-op on an unknown id or when it already is the default.
 */
export function setDefaultStyle(doc: MapDoc, styleId: string): MapDoc {
  const def = doc.styles[styleId];
  if (!def || doc.styleDefaults[def.kind] === styleId) return doc;
  return { ...doc, styleDefaults: { ...doc.styleDefaults, [def.kind]: styleId } };
}

/**
 * One-time adoption pass for legacy saves: tag every UNTAGGED item whose
 * covered effective values exactly match its kind's style named "Default",
 * so the Styles panel's Default editors act on the whole loaded map (old
 * maps are full of default-looking items that predate tags). Load-path only
 * — parse() gates it to files that never had a styles record, and the
 * persist migrate to v<11 docs — so a doc saved WITH styles keeps its
 * explicit tag/Custom choices and round-trips unchanged. Values are already
 * canonical on these paths, so adoption never rewrites them; it only adds
 * tags. Reference-preserving, and tolerant of partial (persisted) docs.
 */
export function adoptDefaultStyles(doc: MapDoc): MapDoc {
  if (!doc.styles) return doc;
  let next = doc;
  for (const kind of Object.keys(STYLE_COLLECTION_OF) as StyleKind[]) {
    const def = defaultStyleOf(next, kind);
    if (!def) continue;
    const key = STYLE_COLLECTION_OF[kind];
    const coll = next[key] as Record<string, Tagged> | undefined;
    if (!coll) continue;
    let changed = false;
    const out: Record<string, Tagged> = {};
    for (const id of Object.keys(coll)) {
      const item = coll[id];
      if (item.styleId === undefined) {
        const props = captureStyleProps(next, kind, id);
        if (props && stylePropsEqual(kind, props, def.props)) {
          out[id] = { ...item, styleId: def.id };
          changed = true;
          continue;
        }
      }
      out[id] = item;
    }
    if (changed) next = { ...next, [key]: out } as MapDoc;
  }
  return next;
}
