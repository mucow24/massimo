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
  TEXT_LABEL_LEADING_DEFAULT,
  TEXT_LABEL_TRACKING_DEFAULT,
  setLineDefaultDotSize,
  setLineDefaultDotStyle,
  setLineStrokeColor,
  setLineStrokeWidth,
  setLineWidth,
  updatePolygon,
  updateRouteBullet,
  updateTextLabel,
  updateTransferStyle,
} from './transforms';
import { DEFAULT_DOT_STYLE, dotStylesEqual } from './dotStyle';
import { lineDefaultDotSizeOf } from './dotSize';
import { lineWidthOf } from './lineWidth';
import { lineStrokeColorOf, lineStrokeWidthOf } from './lineStroke';
import { resolveTransferStyle } from './transferStyle';
import type { LineStyleProps, MapDoc, StyleDef, StyleKind, StylePropsByKind } from './types';

// Which MapDoc collection each style kind's items live in.
export const STYLE_COLLECTION_OF = {
  line: 'lines',
  textLabel: 'textLabels',
  polygon: 'polygons',
  routeBullet: 'routeBullets',
  transfer: 'transfers',
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
      return {
        defaultDotStyle: l.defaultDotStyle ?? DEFAULT_DOT_STYLE,
        defaultDotSize: lineDefaultDotSizeOf(l),
        width: lineWidthOf(l),
        strokeWidth: lineStrokeWidthOf(l),
        strokeColor: lineStrokeColorOf(l),
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
        width: t.width ?? 0,
        leading: t.leading ?? TEXT_LABEL_LEADING_DEFAULT,
        tracking: t.tracking ?? TEXT_LABEL_TRACKING_DEFAULT,
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
      return resolveTransferStyle(t, {
        thickness: doc.transferThickness,
        color: doc.transferColor,
        strokeWidth: doc.transferStrokeWidth,
        strokeColor: doc.transferStrokeColor,
      }) as StylePropsByKind[K];
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

// Deep equality over style props. Everything is flat scalars except a line
// style's DotStyle, which compares structurally (dotStylesEqual). Exported
// for serialize's mismatched-tag pruning.
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
      la.strokeWidth === lb.strokeWidth &&
      la.strokeColor === lb.strokeColor
    );
  }
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of Object.keys(rb)) if (ra[k] !== rb[k]) return false;
  return true;
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
      next = setLineStrokeWidth(next, itemId, p.strokeWidth);
      next = setLineStrokeColor(next, itemId, p.strokeColor);
      break;
    }
    case 'textLabel':
      next = updateTextLabel(next, itemId, { ...def.props });
      break;
    case 'polygon':
      next = updatePolygon(next, itemId, { ...def.props });
      break;
    case 'routeBullet':
      next = updateRouteBullet(next, itemId, { ...def.props });
      break;
    case 'transfer':
      next = updateTransferStyle(next, itemId, { ...def.props });
      break;
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

/** Delete a style def and untag its users (their values are kept). */
export function deleteStyle(doc: MapDoc, styleId: string): MapDoc {
  const def = doc.styles[styleId];
  if (!def) return doc;
  const { [styleId]: _gone, ...styles } = doc.styles;
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
  return untagged ? ({ ...doc, styles, [key]: out } as MapDoc) : { ...doc, styles };
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
