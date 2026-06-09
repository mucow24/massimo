import { type Page } from '@playwright/test';

// Mirrors the partialized shape persisted by the doc store
// (`vignelli-map-doc-v1` in localStorage).

export interface SeedStation {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation?: number;
  stops: { lineId: string; row: number; col: number; orientation?: string }[];
  label?: {
    row: number;
    col: number;
    rotation: number;
    offset: number;
    align?: 'auto' | 'start' | 'middle' | 'end';
    valign?: 'top' | 'middle' | 'bottom';
  };
}

export interface SeedLine {
  id: string;
  service: string;
  color: string;
  stations: string[];
}

export interface SeedRouteBullet {
  id: string;
  x: number;
  y: number;
  rotation?: number;
  lineId: string | null;
  shape?: 'circle' | 'square' | 'diamond';
  size?: number;
}

export interface SeedTextLabel {
  id: string;
  x: number;
  y: number;
  rotation?: number;
  text?: string;
  fontSize?: number;
  weight?: 100 | 200 | 300 | 400 | 500 | 700 | 800 | 900;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface SeedPolygon {
  id: string;
  vertices: { x: number; y: number }[];
  fill: string;
  stroke: string;
  strokeWidth?: number;
  // Omit to simulate a polygon saved before the dark-mode fields existed (the
  // store's migrate should backfill them on rehydrate).
  darkFill?: string;
  darkStroke?: string;
}

export interface Seed {
  stations: SeedStation[];
  lines: SeedLine[];
  routeBullets?: SeedRouteBullet[];
  textLabels?: SeedTextLabel[];
  polygons?: SeedPolygon[];
}

/**
 * Seeds the persisted doc fixture into localStorage and navigates to the
 * dev server. Selection state is intentionally NOT persisted, so every test
 * starts with no selection.
 */
export async function seedAndOpen(
  page: Page,
  seed: Seed,
  // Optional camera seed. Defaults to the origin at zoom 1 (existing behavior),
  // so callers that don't care about the camera are unaffected. Tests that need
  // a specific zoom (e.g. zoom-aware snapping / constant-size handles) pass it.
  opts: { zoom?: number; x?: number; y?: number } = {},
): Promise<void> {
  // Pre-navigation: localStorage isn't writable until a page exists in the
  // origin. Open `/` once so the origin is established, then write, then
  // reload.
  await page.goto('/');

  const stations: Record<string, unknown> = {};
  for (const s of seed.stations) {
    stations[s.id] = {
      id: s.id,
      name: s.name,
      x: s.x,
      y: s.y,
      rotation: s.rotation ?? 0,
      stops: s.stops.map((c) => ({
        lineId: c.lineId,
        row: c.row,
        col: c.col,
        orientation: c.orientation ?? 'auto-vertical',
      })),
      label: s.label
        ? { align: 'auto', valign: 'middle', ...s.label }
        : { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
    };
  }
  const lines: Record<string, unknown> = {};
  for (const l of seed.lines) {
    lines[l.id] = {
      id: l.id,
      service: l.service,
      color: l.color,
      stations: l.stations,
    };
  }

  const routeBullets: Record<string, unknown> = {};
  for (const b of seed.routeBullets ?? []) {
    routeBullets[b.id] = {
      id: b.id,
      x: b.x,
      y: b.y,
      rotation: b.rotation ?? 0,
      lineId: b.lineId,
      shape: b.shape ?? 'circle',
      size: b.size ?? 12,
    };
  }

  const textLabels: Record<string, unknown> = {};
  for (const g of seed.textLabels ?? []) {
    textLabels[g.id] = {
      id: g.id,
      x: g.x,
      y: g.y,
      rotation: g.rotation ?? 0,
      text: g.text ?? 'Label',
      fontSize: g.fontSize ?? 16,
      weight: g.weight ?? 400,
      italic: g.italic ?? false,
      align: g.align ?? 'left',
    };
  }

  const polygons: Record<string, unknown> = {};
  for (const p of seed.polygons ?? []) {
    polygons[p.id] = {
      id: p.id,
      vertices: p.vertices,
      fill: p.fill,
      stroke: p.stroke,
      strokeWidth: p.strokeWidth ?? 1,
      // Only include the dark fields when provided, so an omitted pair persists
      // as a pre-dark-mode (legacy) polygon for the migration to backfill.
      ...(p.darkFill !== undefined ? { darkFill: p.darkFill } : {}),
      ...(p.darkStroke !== undefined ? { darkStroke: p.darkStroke } : {}),
    };
  }

  // `version` must be a number below the store's current persist version, or
  // zustand skips `migrate` entirely (it only migrates a numeric, mismatched
  // version). 4 == the last version shipped before dark-mode colors, so every
  // seeded doc exercises the real 4 → current upgrade path on rehydrate.
  const persisted = {
    version: 4,
    state: {
      stations,
      lines,
      lineOrder: seed.lines.map((l) => l.id),
      curveRadius: 24,
      lineCounter: seed.lines.length,
      lineTags: {},
      routeBullets,
      transfers: {},
      textLabels,
      polygons,
      polygonOrder: (seed.polygons ?? []).map((p) => p.id),
    },
  };

  await page.evaluate(
    ([key, value, viewportKey, viewport]) => {
      localStorage.setItem(key as string, value as string);
      localStorage.setItem(viewportKey as string, viewport as string);
    },
    [
      'vignelli-map-doc-v1',
      JSON.stringify(persisted),
      'massimo-viewport',
      JSON.stringify({
        state: { x: opts.x ?? 0, y: opts.y ?? 0, zoom: opts.zoom ?? 1 },
        version: 0,
      }),
    ],
  );

  await page.reload();
  // Wait until the SVG is in place — proxy for "doc loaded".
  await page.waitForSelector('.canvas-host svg');
}

/**
 * Standard four-station-on-one-line fixture: A — B — C — D in a horizontal
 * row at y = 0. Convenient for shift-click and group-drag tests.
 */
export const fourInLine: Seed = {
  stations: [
    { id: 'A', name: 'A', x: -300, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: -100, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'C', name: 'C', x: 100, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'D', name: 'D', x: 300, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
  ],
  lines: [{ id: 'L1', service: 'L', color: '#0039A6', stations: ['A', 'B', 'C', 'D'] }],
};

/**
 * fourInLine + two route bullets above the station row at y = -200.
 * Bullets are clear of every station's selection silhouette, so rect-
 * select / hit-test geometry stays separable from the station row.
 */
export const fourInLineWithBullets: Seed = {
  ...fourInLine,
  routeBullets: [
    { id: 'b1', x: -200, y: -200, lineId: 'L1', shape: 'circle', size: 16 },
    { id: 'b2', x: 200, y: -200, lineId: 'L1', shape: 'circle', size: 16 },
  ],
};

/**
 * fourInLineWithBullets + a single free-floating text label well above
 * the row. Used to exercise group-drag interactions that mix stations,
 * bullets, and labels.
 */
export const fourInLineWithBulletsAndLabel: Seed = {
  ...fourInLineWithBullets,
  // Placed below the station row at y=200 — comfortably inside the
  // default viewport (the row sits at y=0, bullets at y=-200, so the
  // visible band extends well past y=200 at zoom=1).
  textLabels: [{ id: 'g1', x: 0, y: 200, text: 'Midtown', fontSize: 20, weight: 700 }],
};

/**
 * Returns the centroid of a station's bg <g> as page coords. Stable hit
 * point for clicks/drags regardless of the station's rotation.
 */
export async function stationCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const handle = page.locator(`[data-station-id="${id}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`station ${id} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Page-coord centroid of a route bullet's <g>. */
export async function bulletCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const handle = page.locator(`[data-bullet-id="${id}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`bullet ${id} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Page-coord centroid of a text label's <g>. */
export async function labelCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const handle = page.locator(`[data-text-label-id="${id}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`label ${id} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Click at a page coordinate while holding a set of modifier keys. Wraps
 * `mouse.click` (which silently ignores any modifiers option) with explicit
 * keyboard.down/up so the synthesized mouse events carry shiftKey/ctrlKey.
 */
export async function clickAtWithModifiers(
  page: Page,
  pt: { x: number; y: number },
  modifiers: ('Shift' | 'Control' | 'Meta' | 'Alt')[],
): Promise<void> {
  for (const m of modifiers) await page.keyboard.down(m);
  try {
    await page.mouse.click(pt.x, pt.y);
  } finally {
    for (const m of [...modifiers].reverse()) await page.keyboard.up(m);
  }
}
