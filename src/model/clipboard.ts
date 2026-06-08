import type {
  Polygon,
  Rotation,
  RouteBullet,
  RouteBulletShape,
  TextLabel,
  TextLabelAlign,
  TextLabelWeight,
} from './types';
import type { Vec2 } from '../geometry/vec';

/**
 * Serializable clipboard payloads. The system clipboard holds JSON of the
 * form `{ format, version, items }`, where `items` is an ordered list of the
 * typed slices below — one per copied canvas item. The paste handler
 * dispatches on each item's `kind`. Future versions can add more `kind`s here.
 */
export type ClipPayload =
  | { kind: 'route-bullet'; data: Omit<RouteBullet, 'id'> }
  | { kind: 'text-label'; data: Omit<TextLabel, 'id'> }
  | { kind: 'polygon'; data: Omit<Polygon, 'id'> };

const FORMAT = 'massimo-clipboard';
// v1 wrapped a single `payload`; v2 carries an ordered `items` array. A v1
// string has no `items` and reads back as `null` (paste no-ops) — no fallback.
const VERSION = 2;

const VALID_SHAPES: ReadonlyArray<RouteBulletShape> = ['circle', 'square', 'diamond'];
// Helvetica Neue weights we ship — note there is NO 600.
const VALID_WEIGHTS: ReadonlyArray<TextLabelWeight> = [100, 200, 300, 400, 500, 700, 800, 900];
const VALID_ALIGNS: ReadonlyArray<TextLabelAlign> = ['left', 'center', 'right'];
const HEX7 = /^#[0-9a-fA-F]{6}$/;

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

/**
 * Parse a string that may or may not be one of our clipboard payloads.
 * Returns the list of items that match our format/version and validate;
 * items with an unknown `kind` or malformed data are silently dropped. Returns
 * `null` for non-JSON, foreign format, a future version, a missing `items`
 * array, or when no item survives validation — so paste-anything is safe.
 */
export function readClipboard(text: string): ClipPayload[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { format?: unknown; version?: unknown; items?: unknown };
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
  return null;
}

function parseRouteBulletData(raw: unknown): Omit<RouteBullet, 'id'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.x !== 'number' || !Number.isFinite(d.x)) return null;
  if (typeof d.y !== 'number' || !Number.isFinite(d.y)) return null;
  if (typeof d.size !== 'number' || !Number.isFinite(d.size)) return null;
  if (typeof d.rotation !== 'number') return null;
  if (d.rotation < 0 || d.rotation > 7 || !Number.isInteger(d.rotation)) return null;
  if (d.lineId !== null && typeof d.lineId !== 'string') return null;
  if (typeof d.shape !== 'string') return null;
  if (!VALID_SHAPES.includes(d.shape as RouteBulletShape)) return null;
  return {
    x: d.x,
    y: d.y,
    rotation: d.rotation as Rotation,
    lineId: d.lineId,
    shape: d.shape as RouteBulletShape,
    size: d.size,
  };
}

function parseTextLabelData(raw: unknown): Omit<TextLabel, 'id'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.x !== 'number' || !Number.isFinite(d.x)) return null;
  if (typeof d.y !== 'number' || !Number.isFinite(d.y)) return null;
  if (typeof d.rotation !== 'number') return null;
  if (d.rotation < 0 || d.rotation > 7 || !Number.isInteger(d.rotation)) return null;
  if (typeof d.text !== 'string') return null;
  if (typeof d.fontSize !== 'number' || !Number.isFinite(d.fontSize)) return null;
  if (typeof d.weight !== 'number' || !VALID_WEIGHTS.includes(d.weight as TextLabelWeight))
    return null;
  if (typeof d.italic !== 'boolean') return null;
  if (typeof d.align !== 'string' || !VALID_ALIGNS.includes(d.align as TextLabelAlign)) return null;
  if (typeof d.color !== 'string' || !HEX7.test(d.color)) return null;
  if (typeof d.darkColor !== 'string' || !HEX7.test(d.darkColor)) return null;
  return {
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
}

function parsePolygonData(raw: unknown): Omit<Polygon, 'id'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.vertices) || d.vertices.length < 3) return null;
  const vertices: Vec2[] = [];
  for (const v of d.vertices) {
    if (!v || typeof v !== 'object') return null;
    const pt = v as Record<string, unknown>;
    if (typeof pt.x !== 'number' || !Number.isFinite(pt.x)) return null;
    if (typeof pt.y !== 'number' || !Number.isFinite(pt.y)) return null;
    vertices.push({ x: pt.x, y: pt.y });
  }
  if (typeof d.fill !== 'string' || !HEX7.test(d.fill)) return null;
  if (typeof d.stroke !== 'string' || !HEX7.test(d.stroke)) return null;
  if (typeof d.darkFill !== 'string' || !HEX7.test(d.darkFill)) return null;
  if (typeof d.darkStroke !== 'string' || !HEX7.test(d.darkStroke)) return null;
  if (typeof d.strokeWidth !== 'number' || !Number.isFinite(d.strokeWidth)) return null;
  // Optional fields: reject a present-but-wrong type; leave absent ones absent.
  if (
    d.fillOpacity !== undefined &&
    (typeof d.fillOpacity !== 'number' || !Number.isFinite(d.fillOpacity))
  )
    return null;
  if (d.locked !== undefined && typeof d.locked !== 'boolean') return null;
  const out: Omit<Polygon, 'id'> = {
    vertices,
    fill: d.fill,
    stroke: d.stroke,
    darkFill: d.darkFill,
    darkStroke: d.darkStroke,
    strokeWidth: d.strokeWidth,
  };
  if (d.fillOpacity !== undefined) out.fillOpacity = d.fillOpacity as number;
  if (d.locked !== undefined) out.locked = d.locked as boolean;
  return out;
}
