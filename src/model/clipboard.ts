import type { Rotation, RouteBullet, RouteBulletShape } from './types';

/**
 * Serializable clipboard payloads. The system clipboard holds JSON of the
 * form `{ format, version, payload }`; `payload` is the typed slice the
 * paste handler dispatches on. Future versions can add more `kind`s here.
 */
export type ClipPayload = {
  kind: 'route-bullet';
  data: Omit<RouteBullet, 'id'>;
};

const FORMAT = 'massimo-clipboard';
const VERSION = 1;

const VALID_SHAPES: ReadonlyArray<RouteBulletShape> = ['circle', 'square', 'diamond'];

export function writeClipboard(payload: ClipPayload): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, payload });
}

// Build the clipboard payload for a route bullet (drops its id).
export function routeBulletPayload(b: RouteBullet): ClipPayload {
  const { id: _id, ...data } = b;
  return { kind: 'route-bullet', data };
}

/**
 * Parse a string that may or may not be one of our clipboard payloads.
 * Returns the typed payload if it matches our format/version and validates;
 * `null` otherwise (non-JSON, foreign format, future version, malformed
 * data — all silently ignored so paste-anything is safe).
 */
export function readClipboard(text: string): ClipPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { format?: unknown; version?: unknown; payload?: unknown };
  if (obj.format !== FORMAT) return null;
  if (typeof obj.version !== 'number' || obj.version > VERSION) return null;
  if (!obj.payload || typeof obj.payload !== 'object') return null;
  const p = obj.payload as { kind?: unknown; data?: unknown };
  if (p.kind === 'route-bullet') {
    const data = parseRouteBulletData(p.data);
    if (!data) return null;
    return { kind: 'route-bullet', data };
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
