import type {
  Polygon,
  Rotation,
  RouteBullet,
  RouteBulletShape,
  SvgImage,
  SwatchRef,
  TextLabel,
  TextLabelAlign,
  TextLabelWeight,
} from './types';
import { isAllowedImageHref } from './svgImport';
import { isSwatchRef } from './swatchRef';
// Paste is a THIRD gate on these unions, behind the two load paths' sanitizers.
// It judges by the model's own ladders rather than re-spelling them, so a value
// the app can produce can never be one paste silently drops.
import { isLabelWeight, isRouteBulletShape, isTextLabelAlign } from './transforms';
import type { Vec2 } from '../geometry/vec';
import { parseJsonObject } from '../util/json';

/**
 * Serializable clipboard payloads. The system clipboard holds JSON of the
 * form `{ format, version, items }`, where `items` is an ordered list of the
 * typed slices below — one per copied canvas item. The paste handler
 * dispatches on each item's `kind`. Future versions can add more `kind`s here.
 */
export type ClipPayload =
  | { kind: 'route-bullet'; data: Omit<RouteBullet, 'id'> }
  | { kind: 'text-label'; data: Omit<TextLabel, 'id'> }
  | { kind: 'polygon'; data: Omit<Polygon, 'id'> }
  | { kind: 'svg-image'; data: Omit<SvgImage, 'id'> };

const FORMAT = 'massimo-clipboard';
// v1 wrapped a single `payload`; v2 carries an ordered `items` array. A v1
// string has no `items` and reads back as `null` (paste no-ops) — no fallback.
const VERSION = 2;

// Accepts `#rrggbb` and (since colors carry alpha) `#rrggbbaa`.
const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

// The two field tests the four validators below are almost entirely made of.
// Named rather than inlined because the inline spelling
// (`typeof d.f !== 'number' || !Number.isFinite(d.f)`) states the field TWICE, at
// every field of every validator, in a file whose whole job is to refuse a
// hostile string — and naming the wrong field in the second half is invisible:
// the check still accepts valid input and still rejects the obviously bad, so no
// test would notice. Type predicates, so a passing check still narrows the
// property to `number`/`string` and the value can be read without a cast.
const finiteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hexColor = (v: unknown): v is string => typeof v === 'string' && HEX_COLOR.test(v);

export function writeClipboard(items: ClipPayload[]): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, items });
}

// Build the clipboard payload for a route bullet (drops its id).
export function routeBulletPayload(b: RouteBullet): ClipPayload {
  const { id: _id, ...data } = b;
  return { kind: 'route-bullet', data };
}

// Build the clipboard payload for a text label (drops its id).
export function textLabelPayload(l: TextLabel): ClipPayload {
  const { id: _id, ...data } = l;
  return { kind: 'text-label', data };
}

// Build the clipboard payload for a polygon (drops its id).
export function polygonPayload(p: Polygon): ClipPayload {
  const { id: _id, ...data } = p;
  return { kind: 'polygon', data };
}

// Build the clipboard payload for an svg image (drops its id).
export function svgImagePayload(im: SvgImage): ClipPayload {
  const { id: _id, ...data } = im;
  return { kind: 'svg-image', data };
}

/**
 * Parse a string that may or may not be one of our clipboard payloads.
 * Returns the list of items that match our format/version and validate;
 * items with an unknown `kind` or malformed data are silently dropped. Returns
 * `null` for non-JSON, foreign format, a future version, a missing `items`
 * array, or when no item survives validation — so paste-anything is safe.
 */
export function readClipboard(text: string): ClipPayload[] | null {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return null;
  const obj = parsed.obj as { format?: unknown; version?: unknown; items?: unknown };
  if (obj.format !== FORMAT) return null;
  if (typeof obj.version !== 'number' || obj.version > VERSION) return null;
  if (!Array.isArray(obj.items)) return null;
  const out: ClipPayload[] = [];
  for (const entry of obj.items) {
    const item = parseItem(entry);
    if (item) out.push(item);
  }
  return out.length > 0 ? out : null;
}

function parseItem(raw: unknown): ClipPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as { kind?: unknown; data?: unknown };
  if (p.kind === 'route-bullet') {
    const data = parseRouteBulletData(p.data);
    return data ? { kind: 'route-bullet', data } : null;
  }
  if (p.kind === 'text-label') {
    const data = parseTextLabelData(p.data);
    return data ? { kind: 'text-label', data } : null;
  }
  if (p.kind === 'polygon') {
    const data = parsePolygonData(p.data);
    return data ? { kind: 'polygon', data } : null;
  }
  if (p.kind === 'svg-image') {
    const data = parseSvgImageData(p.data);
    return data ? { kind: 'svg-image', data } : null;
  }
  return null;
}

function parseSvgImageData(raw: unknown): Omit<SvgImage, 'id'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!finiteNumber(d.x)) return null;
  if (!finiteNumber(d.y)) return null;
  if (!finiteNumber(d.width) || d.width <= 0) return null;
  if (!finiteNumber(d.height) || d.height <= 0) return null;
  // Continuous rotation — finite is the only constraint (NOT the 0..7 octant).
  if (!finiteNumber(d.rotation)) return null;
  // Security: only an inline image data URI (svg/png/jpeg) is allowed. A
  // remote/script href from a crafted clipboard string would break the
  // opaque-sandbox guarantee.
  if (typeof d.href !== 'string' || !isAllowedImageHref(d.href)) return null;
  // Optional: reject a present-but-wrong type; leave an absent field absent.
  if (d.opacity !== undefined && (!finiteNumber(d.opacity) || d.opacity < 0 || d.opacity > 1)) {
    return null;
  }
  if (d.locked !== undefined && typeof d.locked !== 'boolean') return null;
  const out: Omit<SvgImage, 'id'> = {
    x: d.x,
    y: d.y,
    width: d.width,
    height: d.height,
    rotation: d.rotation,
    href: d.href,
  };
  if (d.opacity !== undefined) out.opacity = d.opacity as number;
  if (d.locked !== undefined) out.locked = d.locked as boolean;
  return out;
}

function parseRouteBulletData(raw: unknown): Omit<RouteBullet, 'id'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!finiteNumber(d.x)) return null;
  if (!finiteNumber(d.y)) return null;
  if (!finiteNumber(d.size)) return null;
  if (typeof d.rotation !== 'number') return null;
  if (d.rotation < 0 || d.rotation > 7 || !Number.isInteger(d.rotation)) return null;
  if (d.lineId !== null && typeof d.lineId !== 'string') return null;
  if (!isRouteBulletShape(d.shape)) return null;
  // Optional: reject a present-but-wrong type; leave an absent flag absent.
  if (d.locked !== undefined && typeof d.locked !== 'boolean') return null;
  // Optional style tag. Only the type is checked here — whether the id
  // resolves in the RECEIVING doc is the paste transform's job (addRouteBulletWith).
  if (d.styleId !== undefined && typeof d.styleId !== 'string') return null;
  const out: Omit<RouteBullet, 'id'> = {
    x: d.x,
    y: d.y,
    rotation: d.rotation as Rotation,
    lineId: d.lineId,
    shape: d.shape as RouteBulletShape,
    size: d.size,
  };
  if (d.locked !== undefined) out.locked = d.locked as boolean;
  if (d.styleId !== undefined) out.styleId = d.styleId as string;
  return out;
}

function parseTextLabelData(raw: unknown): Omit<TextLabel, 'id'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!finiteNumber(d.x)) return null;
  if (!finiteNumber(d.y)) return null;
  if (typeof d.rotation !== 'number') return null;
  if (d.rotation < 0 || d.rotation > 7 || !Number.isInteger(d.rotation)) return null;
  if (typeof d.text !== 'string') return null;
  if (!finiteNumber(d.fontSize)) return null;
  if (!isLabelWeight(d.weight)) return null;
  if (typeof d.italic !== 'boolean') return null;
  if (!isTextLabelAlign(d.align)) return null;
  if (!hexColor(d.color)) return null;
  if (!hexColor(d.darkColor)) return null;
  // Optional: reject a present-but-wrong type; leave an absent flag absent.
  if (d.locked !== undefined && typeof d.locked !== 'boolean') return null;
  // Optional column width (0/absent = Auto). Reject a present-but-invalid value.
  if (d.width !== undefined && (!finiteNumber(d.width) || d.width < 0)) return null;
  // Optional leading/tracking (absent = the 1 / 0 defaults). Range clamping is
  // updateTextLabel's job; here we only reject wrong types.
  if (d.leading !== undefined && !finiteNumber(d.leading)) return null;
  if (d.tracking !== undefined && !finiteNumber(d.tracking)) return null;
  // Optional style tag. Only the type is checked here — whether the id
  // resolves in the RECEIVING doc is the paste transform's job (addTextLabelWith).
  if (d.styleId !== undefined && typeof d.styleId !== 'string') return null;
  // Optional swatch ref, same contract: shape here, resolution in the
  // receiving doc (the paste transform reconciles — a same-named palette
  // re-links, anything else degrades to the plain colors).
  if (d.colorRef !== undefined && !isSwatchRef(d.colorRef)) return null;
  const out: Omit<TextLabel, 'id'> = {
    x: d.x,
    y: d.y,
    rotation: d.rotation as Rotation,
    text: d.text,
    fontSize: d.fontSize,
    weight: d.weight as TextLabelWeight,
    italic: d.italic,
    align: d.align as TextLabelAlign,
    color: d.color,
    darkColor: d.darkColor,
  };
  if (d.locked !== undefined) out.locked = d.locked as boolean;
  if (d.width !== undefined) out.width = d.width as number;
  if (d.leading !== undefined) out.leading = d.leading as number;
  if (d.tracking !== undefined) out.tracking = d.tracking as number;
  if (d.styleId !== undefined) out.styleId = d.styleId as string;
  if (d.colorRef !== undefined) out.colorRef = d.colorRef as SwatchRef;
  return out;
}

function parsePolygonData(raw: unknown): Omit<Polygon, 'id'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.vertices) || d.vertices.length < 3) return null;
  const vertices: Vec2[] = [];
  for (const v of d.vertices) {
    if (!v || typeof v !== 'object') return null;
    const pt = v as Record<string, unknown>;
    if (!finiteNumber(pt.x)) return null;
    if (!finiteNumber(pt.y)) return null;
    vertices.push({ x: pt.x, y: pt.y });
  }
  if (!hexColor(d.fill)) return null;
  if (!hexColor(d.stroke)) return null;
  if (!hexColor(d.darkFill)) return null;
  if (!hexColor(d.darkStroke)) return null;
  if (!finiteNumber(d.strokeWidth)) return null;
  // Optional fields: reject a present-but-wrong type; leave absent ones absent.
  if (d.locked !== undefined && typeof d.locked !== 'boolean') return null;
  if (d.curveRadius !== undefined && !finiteNumber(d.curveRadius)) return null;
  if (d.closed !== undefined && typeof d.closed !== 'boolean') return null;
  // Optional style tag. Only the type is checked here — whether the id
  // resolves in the RECEIVING doc is the paste transform's job (addPolygonWith).
  if (d.styleId !== undefined && typeof d.styleId !== 'string') return null;
  // Optional swatch refs — shape here, resolution at paste (see textLabel).
  if (d.fillRef !== undefined && !isSwatchRef(d.fillRef)) return null;
  if (d.strokeRef !== undefined && !isSwatchRef(d.strokeRef)) return null;
  const out: Omit<Polygon, 'id'> = {
    vertices,
    fill: d.fill,
    stroke: d.stroke,
    darkFill: d.darkFill,
    darkStroke: d.darkStroke,
    strokeWidth: d.strokeWidth,
  };
  if (d.styleId !== undefined) out.styleId = d.styleId as string;
  if (d.locked !== undefined) out.locked = d.locked as boolean;
  if (d.fillRef !== undefined) out.fillRef = d.fillRef as SwatchRef;
  if (d.strokeRef !== undefined) out.strokeRef = d.strokeRef as SwatchRef;
  // curveRadius and closed ride along like the other optional fields. Both are
  // already validated finite/boolean above; `updatePolygon` re-clamps a later
  // curveRadius edit at its lower bound, so no clamp is needed at paste time.
  if (d.curveRadius !== undefined) out.curveRadius = d.curveRadius as number;
  if (d.closed !== undefined) out.closed = d.closed as boolean;
  return out;
}
