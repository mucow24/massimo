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
  setLineEndStyle,
  setLineDashLength,
  setLineDashWidth,
  setLineInterlineGap,
  setLineLabelGap,
  setLineSingletonDotStyle,
  setLineMultiDotStyle,
  setLineSingletonDotSize,
  setLineMultiDotSize,
  setDotSize,
  setLineStrokeColor,
  setLineStrokeWidth,
  setLineWidth,
  snapToStep,
  updatePolygon,
  updateRouteBullet,
  updateStationLabelStyle,
  updateTextLabel,
  updateTransferStyle,
} from './transforms';
import {
  DEFAULT_STOP_DOT_STYLE_ID,
  NONE_STOP_DOT_STYLE_ID,
  canonicalDotStyle,
  defaultDotDiameter,
  dotStylesEqual,
} from './dotStyle';
import { DOT_SIZE_MIN, DOT_SIZE_STEP, lineSingletonDotSizeOf, lineMultiDotSizeOf } from './dotSize';
import { lineDashLengthOf, lineDashWidthOf } from './dashSize';
import {
  LINE_LABEL_GAP_DEFAULT,
  LINE_WIDTH_MIN,
  LINE_WIDTH_STEP,
  canonicalLineLabelGap,
  lineWidthOf,
} from './lineWidth';
import { LINE_END_STYLE_DEFAULT, isLineEndStyle, lineEndStyleOf } from './lineEnd';
import {
  LINE_CURVE_RADIUS_DEFAULT,
  LINE_CURVE_RADIUS_MIN,
  LINE_CURVE_RADIUS_STEP,
  lineCurveRadiusOf,
} from './lineCurve';
import {
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_MIN,
  canonicalStrokeWidth,
  lineStrokeColorStored,
  lineStrokeColorsEqual,
  lineStrokeWidthOf,
  normalizedStrokeColor,
} from './lineStroke';
import {
  TRANSFER_DRAW_DEFAULT,
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_STROKE_WIDTH_STEP,
  TRANSFER_THICKNESS_MIN,
  TRANSFER_THICKNESS_STEP,
  resolveTransferStyle,
} from './transferStyle';
import { dayNightColorsEqual } from './dayNightColor';
import type {
  DotStyle,
  Line,
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

// Which MapDoc collection each style kind's items live in. `stopDot` is
// excluded — it has no item collection (its wearers are dot slots, handled by a
// dedicated slot-walk), so it never flows through the generic tag/stamp path.
export const STYLE_COLLECTION_OF = {
  line: 'lines',
  textLabel: 'textLabels',
  polygon: 'polygons',
  routeBullet: 'routeBullets',
  transfer: 'transfers',
  station: 'stations',
} as const satisfies Record<Exclude<StyleKind, 'stopDot'>, keyof MapDoc>;

// The one shape all six item collections share that styles care about.
type Tagged = { styleId?: string };

// stopDot resolves to {} — the generic loops (updateStyleProps / deleteStyle /
// adoptDefaultStyles) then find nothing, and stopDot's real work is done by the
// dedicated slot functions in its callers.
const itemsOf = (doc: MapDoc, kind: StyleKind): Record<string, Tagged> =>
  kind === 'stopDot' ? {} : (doc[STYLE_COLLECTION_OF[kind]] as Record<string, Tagged>);

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
      // STORED, not resolved: a casing set to the line's own color must
      // capture as the 'line' sentinel, so the style hands every wearer ITS
      // color instead of baking the example line's hue (and so a tagged line
      // still compares equal to its style).
      const dashLength = lineDashLengthOf(l);
      const dashWidth = lineDashWidthOf(l);
      const interlineGap = l.interlineGap;
      const labelGap = l.labelGap;
      return {
        // Dot TYPE ids (always stored on a real line; the ?? heals a bare
        // fixture / legacy line so the captured style is still self-contained).
        singletonDotStyleId: l.singletonDotStyleId ?? DEFAULT_STOP_DOT_STYLE_ID,
        multiDotStyleId: l.multiDotStyleId ?? DEFAULT_STOP_DOT_STYLE_ID,
        singletonDotSize: lineSingletonDotSizeOf(l),
        multiDotSize: lineMultiDotSizeOf(l),
        width: lineWidthOf(l),
        curveRadius: lineCurveRadiusOf(l),
        endStyle: lineEndStyleOf(l),
        strokeWidth: lineStrokeWidthOf(l),
        strokeColor: lineStrokeColorStored(l),
        // Optional: omitted when unset, so a captured style compares equal to
        // one that never had the key.
        ...(dashLength !== undefined ? { dashLength } : {}),
        ...(dashWidth !== undefined ? { dashWidth } : {}),
        ...(interlineGap !== undefined ? { interlineGap } : {}),
        ...(labelGap !== undefined ? { labelGap } : {}),
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
    case 'stopDot':
      // A stopDot style is not captured FROM an item — it is edited directly in
      // the panel (define-in-place). No item to read.
      return null;
  }
  return null;
}

// "Custom" is the style dropdown's detached-sentinel label — a style wearing
// it would be indistinguishable there, so every naming path (save, rename,
// file-load sanitizing) refuses it, case-insensitively.
export function isReservedStyleName(trimmed: string): boolean {
  return trimmed.toLowerCase() === 'custom';
}

// A kind that has an item collection (and therefore a per-field override
// story) — everything but stopDot, whose wearers are dot slots compared as
// whole DotStyles.
export type ItemStyleKind = Exclude<StyleKind, 'stopDot'>;

// The covered fields of each item-collection kind. THE single source of what
// a style covers: per-field equality (styleFieldsDiff), selective stamping
// (stampStyleFields / revertStyleField), and the popovers' override dots all
// walk this list, so a new covered field is added here once.
export const STYLE_FIELDS = {
  line: [
    'singletonDotStyleId',
    'multiDotStyleId',
    'singletonDotSize',
    'multiDotSize',
    'width',
    'curveRadius',
    'endStyle',
    'strokeWidth',
    'strokeColor',
    'dashLength',
    'dashWidth',
    'interlineGap',
    'labelGap',
  ],
  textLabel: ['color', 'darkColor', 'fontSize', 'weight', 'italic', 'align'],
  polygon: ['fill', 'stroke', 'darkFill', 'darkStroke', 'strokeWidth', 'curveRadius', 'closed'],
  routeBullet: ['shape', 'size'],
  transfer: ['thickness', 'color', 'strokeWidth', 'strokeColor', 'draw'],
  station: ['fontSize', 'weight', 'italic', 'leading', 'tracking'],
} as const satisfies Record<ItemStyleKind, readonly string[]>;

// Equality for ONE covered field. Most fields are flat scalars; the special
// cases: a line casing color (structural pair-or-sentinel), a transfer's two
// day/night pairs, and the absent-≡-default fields (labelGap 3, draw 'under')
// — a def from a save predating those fields must compare equal to one
// carrying the explicit default, or every legacy wearer reads as overridden
// on load (the DotStyle strokeAlign trap).
function styleFieldEqual(
  kind: ItemStyleKind,
  field: string,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (kind === 'line') {
    if (field === 'strokeColor') {
      return lineStrokeColorsEqual(
        a.strokeColor as LineStyleProps['strokeColor'],
        b.strokeColor as LineStyleProps['strokeColor'],
      );
    }
    if (field === 'labelGap') {
      return (
        ((a.labelGap as number | undefined) ?? LINE_LABEL_GAP_DEFAULT) ===
        ((b.labelGap as number | undefined) ?? LINE_LABEL_GAP_DEFAULT)
      );
    }
  }
  if (kind === 'transfer') {
    if (field === 'color' || field === 'strokeColor') {
      return dayNightColorsEqual(
        a[field] as TransferStyleProps['color'],
        b[field] as TransferStyleProps['color'],
      );
    }
    if (field === 'draw') {
      return (a.draw ?? TRANSFER_DRAW_DEFAULT) === (b.draw ?? TRANSFER_DRAW_DEFAULT);
    }
  }
  return a[field] === b[field];
}

/**
 * The covered fields on which two props objects disagree — [] means equal.
 * Read with `a` = an item's captured EFFECTIVE props and `b` = its style's
 * props, the result is the item's OVERRIDE set: the fields it pins against
 * the style, which style edits leave alone and the red dots mark. There is
 * no stored override state — this diff IS the override, so a style edit that
 * lands exactly on an item's pinned value dissolves the override.
 */
export function styleFieldsDiff(
  kind: ItemStyleKind,
  a: StyleDef['props'],
  b: StyleDef['props'],
): string[] {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  return STYLE_FIELDS[kind].filter((f) => !styleFieldEqual(kind, f, ra, rb));
}

// Deep equality over style props — no covered field disagrees. stopDot props
// are whole DotStyles (structural dotStylesEqual); every other kind runs the
// per-field diff. Exported for serialize's tag pruning and the load-time
// adoption pass.
export function stylePropsEqual(
  kind: StyleKind,
  a: StyleDef['props'],
  b: StyleDef['props'],
): boolean {
  if (kind === 'stopDot') {
    return dotStylesEqual(a as DotStyle, b as DotStyle);
  }
  return styleFieldsDiff(kind, a, b).length === 0;
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
      // Dash dims collapse to omitted at 0 (= derive), mirroring the line
      // fields.
      const dashLength = p.dashLength == null ? undefined : canonicalStrokeWidth(p.dashLength);
      const dashWidth = p.dashWidth == null ? undefined : canonicalStrokeWidth(p.dashWidth);
      const interlineGap =
        p.interlineGap == null ? undefined : canonicalStrokeWidth(p.interlineGap);
      // Label gap collapses at its DEFAULT (3), not at 0 — 0 is a real value
      // (text butted to the marker) and absent means 3.
      const labelGap = p.labelGap == null ? undefined : canonicalLineLabelGap(p.labelGap);
      return {
        // `?? DEFAULT` heals a def from a save that predates dot-type coverage
        // (and is the concrete backstop for a since-deleted id — see
        // deleteStopDotStyle, which re-points wearers, but a hand-edited file
        // could still dangle here).
        singletonDotStyleId: p.singletonDotStyleId ?? DEFAULT_STOP_DOT_STYLE_ID,
        multiDotStyleId: p.multiDotStyleId ?? DEFAULT_STOP_DOT_STYLE_ID,
        singletonDotSize: snapToStep(p.singletonDotSize, DOT_SIZE_STEP, DOT_SIZE_MIN),
        multiDotSize: snapToStep(p.multiDotSize, DOT_SIZE_STEP, DOT_SIZE_MIN),
        width: snapToStep(p.width, LINE_WIDTH_STEP, LINE_WIDTH_MIN),
        // `?? DEFAULT` heals defs from saves that predate the field (the load
        // paths bake it in first — see bakeDocCurveRadius — this is the
        // keep-canonical-props-concrete backstop).
        curveRadius: snapToStep(
          p.curveRadius ?? LINE_CURVE_RADIUS_DEFAULT,
          LINE_CURVE_RADIUS_STEP,
          LINE_CURVE_RADIUS_MIN,
        ),
        // Same `?? DEFAULT` healing as curveRadius, for defs written before
        // line ends were a covered field.
        endStyle: isLineEndStyle(p.endStyle) ? p.endStyle : LINE_END_STYLE_DEFAULT,
        strokeWidth: snapToStep(p.strokeWidth, LINE_STROKE_STEP, LINE_STROKE_WIDTH_MIN),
        // Lowercased but NOT collapsed: style props are concrete, so a def
        // spells out the white default rather than dropping it.
        strokeColor: normalizedStrokeColor(p.strokeColor),
        ...(dashLength !== undefined ? { dashLength } : {}),
        ...(dashWidth !== undefined ? { dashWidth } : {}),
        ...(interlineGap !== undefined ? { interlineGap } : {}),
        ...(labelGap !== undefined ? { labelGap } : {}),
      } as StylePropsByKind[K];
    }
    case 'textLabel': {
      const p = props as TextLabelStyleProps;
      return {
        color: p.color,
        darkColor: p.darkColor,
        fontSize: snapToStep(p.fontSize, FONT_SIZE_STEP, TEXT_LABEL_FONT_SIZE_MIN),
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
        strokeWidth: snapToStep(p.strokeWidth, POLYGON_STROKE_STEP, POLYGON_STROKE_WIDTH_MIN),
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
        thickness: snapToStep(p.thickness, TRANSFER_THICKNESS_STEP, TRANSFER_THICKNESS_MIN),
        color: p.color,
        strokeWidth: snapToStep(
          p.strokeWidth,
          TRANSFER_STROKE_WIDTH_STEP,
          TRANSFER_STROKE_WIDTH_MIN,
        ),
        strokeColor: p.strokeColor,
        // `?? DEFAULT` heals defs written before the draw axis existed — the
        // keep-canonical-props-concrete backstop, same as line's curveRadius.
        draw: p.draw ?? TRANSFER_DRAW_DEFAULT,
      } as StylePropsByKind[K];
    }
    case 'station': {
      // Same canonicalizer the per-station writer uses, so a panel-edited def
      // compares exactly equal to what stamping it stores back on a station.
      return canonicalStationLabelStyle(props as StationStyleProps) as StylePropsByKind[K];
    }
    case 'stopDot':
      return canonicalDotStyle(props as DotStyle) as StylePropsByKind[K];
  }
  return props;
}

// Set the tag on one item; same reference when already tagged with this id.
// stopDot has no item collection — its slots carry tags via dedicated setters,
// so the generic tag path is a no-op for it.
function withStyleTag(doc: MapDoc, kind: StyleKind, itemId: string, styleId: string): MapDoc {
  if (kind === 'stopDot') return doc;
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
  // stopDot styles are never stamped onto a generic item — their wearers are dot
  // slots, restamped by updateStopDotStyleProps. Guard so this dead path (which
  // has no collection to tag) is a safe no-op.
  if (def.kind === 'stopDot') return doc;
  let next = doc;
  switch (def.kind) {
    case 'line': {
      const p = def.props;
      // Dot TYPE: re-point the line's split defaults at the style's library
      // entries (setter no-ops when the id doesn't resolve, e.g. a dangling def).
      next = setLineSingletonDotStyle(next, itemId, p.singletonDotStyleId);
      next = setLineMultiDotStyle(next, itemId, p.multiDotStyleId);
      next = setLineSingletonDotSize(next, itemId, p.singletonDotSize);
      next = setLineMultiDotSize(next, itemId, p.multiDotSize);
      next = setLineWidth(next, itemId, p.width);
      next = setLineCurveRadius(next, itemId, p.curveRadius);
      next = setLineEndStyle(next, itemId, p.endStyle);
      next = setLineStrokeWidth(next, itemId, p.strokeWidth);
      next = setLineStrokeColor(next, itemId, p.strokeColor);
      // undefined ⇒ 0 ⇒ dropped, so the stamped line derives from its width.
      next = setLineDashLength(next, itemId, p.dashLength ?? 0);
      next = setLineDashWidth(next, itemId, p.dashWidth ?? 0);
      // undefined ⇒ 0 ⇒ dropped, back to plain tangency. Goes through the
      // canonical setter, so stamping a different gap also re-packs the
      // line's stations (same as a manual edit).
      next = setLineInterlineGap(next, itemId, p.interlineGap ?? 0);
      // undefined ⇒ the default 3 ⇒ dropped, back to the stock clearance.
      next = setLineLabelGap(next, itemId, p.labelGap ?? LINE_LABEL_GAP_DEFAULT);
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
 * Stamp a SUBSET of a def's covered fields onto one item via the canonical
 * setters — the per-field propagation primitive. updateStyleProps and
 * saveStyleFromItem stamp every non-overridden field; revertStyleField (the
 * red override dot) stamps exactly one. No tag write — callers own that (and
 * the setters don't touch tags; divergence is a legal override).
 */
function stampStyleFields(
  doc: MapDoc,
  def: StyleDef,
  itemId: string,
  fields: readonly string[],
): MapDoc {
  if (def.kind === 'stopDot' || fields.length === 0) return doc;
  let next = doc;
  if (def.kind === 'line') {
    const p = def.props;
    for (const f of fields) {
      switch (f) {
        case 'singletonDotStyleId':
          next = setLineSingletonDotStyle(next, itemId, p.singletonDotStyleId);
          break;
        case 'multiDotStyleId':
          next = setLineMultiDotStyle(next, itemId, p.multiDotStyleId);
          break;
        case 'singletonDotSize':
          next = setLineSingletonDotSize(next, itemId, p.singletonDotSize);
          break;
        case 'multiDotSize':
          next = setLineMultiDotSize(next, itemId, p.multiDotSize);
          break;
        case 'width':
          next = setLineWidth(next, itemId, p.width);
          break;
        case 'curveRadius':
          next = setLineCurveRadius(next, itemId, p.curveRadius);
          break;
        case 'endStyle':
          next = setLineEndStyle(next, itemId, p.endStyle);
          break;
        case 'strokeWidth':
          next = setLineStrokeWidth(next, itemId, p.strokeWidth);
          break;
        case 'strokeColor':
          next = setLineStrokeColor(next, itemId, p.strokeColor);
          break;
        // undefined ⇒ 0 ⇒ dropped, so the stamped line derives from its width.
        case 'dashLength':
          next = setLineDashLength(next, itemId, p.dashLength ?? 0);
          break;
        case 'dashWidth':
          next = setLineDashWidth(next, itemId, p.dashWidth ?? 0);
          break;
        // undefined ⇒ 0 ⇒ dropped, back to plain tangency (re-packs stations).
        case 'interlineGap':
          next = setLineInterlineGap(next, itemId, p.interlineGap ?? 0);
          break;
        // undefined ⇒ the default 3 ⇒ dropped, back to the stock clearance.
        case 'labelGap':
          next = setLineLabelGap(next, itemId, p.labelGap ?? LINE_LABEL_GAP_DEFAULT);
          break;
      }
    }
    return next;
  }
  // Patch kinds: one partial update carrying just the chosen fields. Explicit
  // per-field pick from the def (never a spread), so a def from an older save
  // can't smuggle a since-dropped key onto the item.
  const props = def.props as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const f of fields) patch[f] = props[f];
  switch (def.kind) {
    case 'textLabel':
      return updateTextLabel(next, itemId, patch);
    case 'polygon':
      return updatePolygon(next, itemId, patch);
    case 'routeBullet':
      return updateRouteBullet(next, itemId, patch);
    case 'transfer':
      return updateTransferStyle(next, itemId, patch);
    case 'station':
      return updateStationLabelStyle(next, itemId, patch);
  }
  return next;
}

/**
 * Stamp a style's FULL props onto an item and tag it — the dropdown pick and
 * the "Revert to style" button, so it also clears every per-field override.
 * No-ops (same reference) when the style or item is missing, or the item is
 * tagged AND its values already match — the skip is by VALUE, not by tag, so
 * applying a style to a tagged-but-diverged item resets it.
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
 * Stamp the style's value for ONE covered field back onto a tagged item —
 * what clicking a red override dot does. Other overrides stay put. No-op
 * (same reference) when the item is untagged, its tag doesn't resolve to a
 * def of its kind, or the field isn't covered.
 */
export function revertStyleField(
  doc: MapDoc,
  kind: ItemStyleKind,
  itemId: string,
  field: string,
): MapDoc {
  const cur = itemsOf(doc, kind)[itemId];
  const def = cur?.styleId !== undefined ? doc.styles[cur.styleId] : undefined;
  if (!def || def.kind !== kind) return doc;
  if (!(STYLE_FIELDS[kind] as readonly string[]).includes(field)) return doc;
  return stampStyleFields(doc, def, itemId, [field]);
}

/**
 * Upsert a style def captured from an item (define-by-example) — both "Save
 * style…" over an existing name and the Sync-to-style button — then carry the
 * new props onto every other wearer per-field: each wearer's override set is
 * diffed against the OLD props first, and only its non-overridden fields are
 * stamped, so a wearer's own pins survive the sync. The source item matches
 * the new def by construction and is just tagged. One returned doc (one undo
 * entry); reference-stable when nothing changes.
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
  // Snapshot the other wearers' override sets against the OLD props before
  // anything is written — "which fields does this wearer pin?" is only
  // answerable against the def it was tracking.
  const overrides: Record<string, string[]> = {};
  if (kind !== 'stopDot' && existing !== undefined && existing.kind === kind) {
    const coll = itemsOf(doc, kind);
    for (const id of Object.keys(coll)) {
      if (id === itemId || coll[id].styleId !== styleId) continue;
      const cur = captureStyleProps(doc, kind, id);
      overrides[id] = cur ? styleFieldsDiff(kind, cur, existing.props) : [];
    }
  }
  const def = { id: styleId, name: trimmed, kind, props } as StyleDef;
  let next: MapDoc = { ...doc, styles: { ...doc.styles, [styleId]: def } };
  next = withStyleTag(next, kind, itemId, styleId);
  if (kind !== 'stopDot') {
    for (const id of Object.keys(overrides)) {
      const ov = overrides[id];
      next = stampStyleFields(
        next,
        def,
        id,
        STYLE_FIELDS[kind].filter((f) => !ov.includes(f)),
      );
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

/**
 * Duplicate an existing style: a fresh def under `newId`/`name` carrying the
 * SAME kind and props as `sourceId`. The copy is not made default and wears no
 * items (nothing is stamped or re-stamped) — like createStyle, only the props
 * come from the source instead of the factory. Refuses a missing source, the
 * reserved built-in stopDot "None" (nothing to copy), a taken id, and an
 * empty/reserved/same-kind-colliding name (the same guards createStyle uses).
 * Props are shared by reference — safe, since every edit path rebuilds them.
 */
export function duplicateStyle(doc: MapDoc, newId: string, sourceId: string, name: string): MapDoc {
  if (sourceId === NONE_STOP_DOT_STYLE_ID) return doc; // reserved built-in
  const src = doc.styles[sourceId];
  if (!src) return doc;
  const trimmed = name.trim();
  if (!trimmed || isReservedStyleName(trimmed) || doc.styles[newId]) return doc;
  for (const other of Object.values(doc.styles)) {
    if (other.kind === src.kind && other.name === trimmed) return doc;
  }
  const def = { id: newId, name: trimmed, kind: src.kind, props: src.props } as StyleDef;
  return { ...doc, styles: { ...doc.styles, [newId]: def } };
}

// A partial patch of ONE kind's props — the store/panel write shape for
// updateStyleProps (each editor patches a single kind). A UNION, not a
// Partial of the intersection: the same-named `color`/`strokeColor` keys no
// longer share a type across kinds (transfer's is a day/night pair, line's is
// that pair or the 'line' sentinel, textLabel's is a hex string), so an
// intersection would collapse them to `never`. canonicalStyleProps' explicit
// rebuild still discards keys foreign to the def's kind after the spread.
export type StylePropsPatch =
  | Partial<LineStyleProps>
  | Partial<TextLabelStyleProps>
  | Partial<PolygonStyleProps>
  | Partial<RouteBulletStyleProps>
  | Partial<TransferStyleProps>
  | Partial<StationStyleProps>
  | Partial<DotStyle>;

/**
 * Patch a style def's props (the panel editor's write path) and carry the
 * change onto every wearer PER-FIELD in the same returned doc — the live
 * preview. Each wearer's override set (its diff against the OLD props) is
 * snapshotted before anything is written, then only its non-overridden
 * fields are stamped — a wearer's own pins survive the style edit, and a
 * field the style moves to a wearer's exact pinned value dissolves that pin
 * (no stored override state to disagree). Values land on the canonical
 * grids; wearers already matching are reference-stable. Name and id are
 * untouched (renameStyle owns the name).
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
  // Snapshot every wearer's override set against the PRE-EDIT doc and old
  // props — after the def (or, for stopDot, the dot shadows) is written,
  // "which fields did this wearer pin?" is no longer answerable.
  const overrides: Record<string, string[]> = {};
  if (def.kind !== 'stopDot') {
    const coll = itemsOf(doc, def.kind);
    for (const id of Object.keys(coll)) {
      if (coll[id].styleId !== styleId) continue;
      const cur = captureStyleProps(doc, def.kind, id);
      overrides[id] = cur ? styleFieldsDiff(def.kind, cur, def.props) : [];
    }
  }
  let next: MapDoc = { ...doc, styles: { ...doc.styles, [styleId]: nextDef } };
  // stopDot has no item collection — restamp its wearers (dot slots) directly.
  if (def.kind === 'stopDot') {
    next = restampStopDotStyle(next, styleId, merged as DotStyle);
    // A stopDot style implies a natural DIAMETER (12 with a service code, 8
    // without). Sizes are stored concretely, so an edit that moves the natural
    // sweeps it forward explicitly: every CUSTOM line sitting exactly at the
    // old natural follows (that's what the retired absent-means-natural
    // indirection rendered), as does every stop pin that tracked it — the
    // setters re-collapse pins that now equal their line's size. Tagged lines
    // are NOT swept: their LINE style's size rules, unchanged (their def keeps
    // its size, so tagged ⇒ matches holds without touching them).
    const oldNatural = defaultDotDiameter(def.props as DotStyle);
    const newNatural = defaultDotDiameter(merged as DotStyle);
    if (oldNatural !== newNatural) {
      for (const id of Object.keys(next.lines)) {
        const ln = next.lines[id];
        if (ln.styleId !== undefined) continue;
        if (
          ln.singletonDotStyleId === styleId &&
          (ln.singletonDotSize ?? oldNatural) === oldNatural
        )
          next = setLineSingletonDotSize(next, id, newNatural);
        if (ln.multiDotStyleId === styleId && (ln.multiDotSize ?? oldNatural) === oldNatural)
          next = setLineMultiDotSize(next, id, newNatural);
      }
      for (const sid of Object.keys(next.stations)) {
        for (const s of next.stations[sid].stops) {
          if (s.dotStyleId === styleId && s.dotSize === oldNatural)
            next = setDotSize(next, sid, s.lineId, newNatural);
        }
      }
    }
    return next;
  }
  for (const id of Object.keys(overrides)) {
    const ov = overrides[id];
    next = stampStyleFields(
      next,
      nextDef,
      id,
      STYLE_FIELDS[def.kind].filter((f) => !ov.includes(f)),
    );
  }
  return next;
}

/** Rename a style (id kept, no re-stamp). Refuses same-kind name collisions
 *  and the reserved sentinel name "Custom". */
export function renameStyle(doc: MapDoc, styleId: string, name: string): MapDoc {
  if (styleId === NONE_STOP_DOT_STYLE_ID) return doc; // reserved built-in
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
 *
 * "Remaining" is the SELECTABLE list, so the reserved "None" stop dot is
 * neither a fallback nor the thing that keeps a kind non-empty — the same
 * opinion the Styles panel's list and its last-style delete guard hold.
 */
export function deleteStyle(doc: MapDoc, styleId: string): MapDoc {
  if (styleId === NONE_STOP_DOT_STYLE_ID) return doc; // reserved built-in
  const def = doc.styles[styleId];
  if (!def) return doc;
  const { [styleId]: _gone, ...styles } = doc.styles;
  const remaining = selectableStylesOfKind(styles, def.kind);
  if (remaining.length === 0) return doc;
  if (def.kind === 'stopDot') return deleteStopDotStyle(doc, styleId, styles, remaining[0].id);
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

// ---- stopDot: the dedicated slot-walk (stopDot has no item collection) ----
// A stopDot style's "items" are the dot slots: each station stop's `dotStyleId`
// override and each line's `singletonDotStyleId` / `multiDotStyleId` split
// default. These two helpers are the stopDot analogue of the generic
// updateStyleProps restamp loop and deleteStyle untag loop.

/** Re-stamp the raw shadow (`dotStyle` / `singleton|multiDotStyle`) of every dot
 *  slot tagged with `styleId` to the style's new `props`. The def has already
 *  been written by the caller; this only refreshes the wearers. Reference-stable
 *  per collection when nothing wears the style. */
function restampStopDotStyle(doc: MapDoc, styleId: string, props: DotStyle): MapDoc {
  let stations = doc.stations;
  let stationsChanged = false;
  for (const sid of Object.keys(stations)) {
    const st = stations[sid];
    let stopsChanged = false;
    const stops = st.stops.map((s) => {
      if (s.dotStyleId !== styleId) return s;
      stopsChanged = true;
      return { ...s, dotStyle: props };
    });
    if (stopsChanged) {
      stations = { ...stations, [sid]: { ...st, stops } };
      stationsChanged = true;
    }
  }
  let lines = doc.lines;
  let linesChanged = false;
  for (const lid of Object.keys(lines)) {
    const ln = lines[lid];
    let nextLine: Line | undefined;
    if (ln.singletonDotStyleId === styleId) nextLine = { ...ln, singletonDotStyle: props };
    if (ln.multiDotStyleId === styleId) nextLine = { ...(nextLine ?? ln), multiDotStyle: props };
    if (nextLine) {
      lines = { ...lines, [lid]: nextLine };
      linesChanged = true;
    }
  }
  if (!stationsChanged && !linesChanged) return doc;
  return {
    ...doc,
    ...(stationsChanged ? { stations } : {}),
    ...(linesChanged ? { lines } : {}),
  };
}

/** Delete a stopDot style: drop the TAG (keep the raw shadow, like every other
 *  kind's delete) on every dot slot wearing it, and re-point the ⭐ designation
 *  if the deleted style was the default. `styles` is the def map already minus
 *  the deleted id; `fallbackDefaultId` is its kind's first remaining style. */
function deleteStopDotStyle(
  doc: MapDoc,
  styleId: string,
  styles: Record<string, StyleDef>,
  fallbackDefaultId: string,
): MapDoc {
  const styleDefaults =
    doc.styleDefaults.stopDot === styleId
      ? { ...doc.styleDefaults, stopDot: fallbackDefaultId }
      : doc.styleDefaults;
  let next: MapDoc = { ...doc, styles, styleDefaults };
  // Dot TYPE is a covered LINE-style field, so a line style def can also
  // reference the deleted id. Re-point those defs at the fallback FIRST,
  // while wearer lines still carry the old ref — per-field propagation reads
  // each wearer's diff against the old props, so a wearer that faithfully
  // wore the deleted id follows to the fallback, and one that overrode its
  // dot type keeps its own choice. (Ordering matters: dropping the lines'
  // refs first would make every faithful wearer read as overridden.)
  for (const def of Object.values(next.styles)) {
    if (def.kind !== 'line') continue;
    const patch: Partial<LineStyleProps> = {};
    if (def.props.singletonDotStyleId === styleId) patch.singletonDotStyleId = fallbackDefaultId;
    if (def.props.multiDotStyleId === styleId) patch.multiDotStyleId = fallbackDefaultId;
    if (patch.singletonDotStyleId !== undefined || patch.multiDotStyleId !== undefined) {
      next = updateStyleProps(next, def.id, patch);
    }
  }
  // Whatever still references the deleted id — stops, custom lines, wearers
  // whose dot type was an override — drops the TAG and keeps the raw shadow,
  // like every other kind's delete keeps values.
  let stations = next.stations;
  for (const sid of Object.keys(stations)) {
    const st = stations[sid];
    let stopsChanged = false;
    const stops = st.stops.map((s) => {
      if (s.dotStyleId !== styleId) return s;
      stopsChanged = true;
      const { dotStyleId: _g, ...rest } = s;
      return rest;
    });
    if (stopsChanged) stations = { ...stations, [sid]: { ...st, stops } };
  }
  let lines = next.lines;
  for (const lid of Object.keys(lines)) {
    let ln = lines[lid];
    let changed = false;
    if (ln.singletonDotStyleId === styleId) {
      const { singletonDotStyleId: _g, ...rest } = ln;
      ln = rest as Line;
      changed = true;
    }
    if (ln.multiDotStyleId === styleId) {
      const { multiDotStyleId: _g, ...rest } = ln;
      ln = rest as Line;
      changed = true;
    }
    if (changed) lines = { ...lines, [lid]: ln };
  }
  if (stations !== next.stations || lines !== next.lines) {
    next = { ...next, stations, lines };
  }
  return next;
}

/** Drop an item's style tag only (the dropdown's "Custom" choice). No stopDot
 *  Custom state exists, so it is a no-op there. */
export function clearStyleTag(doc: MapDoc, kind: StyleKind, itemId: string): MapDoc {
  if (kind === 'stopDot') return doc;
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
 * {@link stylesOfKind} minus the reserved built-in "None" stop dot — the kind's
 * styles as a LIBRARY ENTRY: what the Styles panel lists, what the "last style
 * of a kind" guard counts, and what a delete may fall back on. "None" is a
 * primitive the picker always offers but nobody chose, so promoting it to a
 * kind's default (or to a line style def's dot type) blanks dots the user never
 * asked to blank. The dot picker itself reads `stylesOfKind` — it is the one
 * consumer that wants the reserved entry.
 *
 * The filter is unconditional because no other kind can hold that id.
 */
export function selectableStylesOfKind(
  styles: Record<string, StyleDef>,
  kind: StyleKind,
): StyleDef[] {
  return stylesOfKind(styles, kind).filter((d) => d.id !== NONE_STOP_DOT_STYLE_ID);
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
  // Only the item-collection kinds — stopDot has no collection to adopt into.
  for (const kind of Object.keys(STYLE_COLLECTION_OF) as Exclude<StyleKind, 'stopDot'>[]) {
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
