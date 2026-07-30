import { soleSelection, type SelectionState } from '../../state/selection';
import {
  polygonsForRect,
  routeBulletsForRect,
  stationsForRect,
  svgImagesForRect,
  textLabelsForRect,
} from '../../geometry/stationBoundary';
import { stopMetricsOf } from '../../model/stopMetrics';
import { effectiveBackgroundOrder } from '../../model/transforms';
import { pairKeyOf } from '../../model/pairKey';
import type { AppendCursor } from '../../model/appendGestures';
import type { Pt } from '../../geometry/polygonUnion';
import type {
  Line,
  LineId,
  Polygon,
  RouteBullet,
  Station,
  StationId,
  SvgImage,
  TextLabel,
  Transfer,
} from '../../model/types';

/**
 * Pure logic for Alt+click deep-picking: resolving the stack of selectable
 * entities under the cursor from a `document.elementsFromPoint` snapshot, and
 * cycling the selection through that stack. The rendered DOM is the geometry
 * oracle — every interactive hit surface already carries a `data-*` identity
 * attribute — so no hit-shape math is duplicated here.
 */

export type HitKind =
  | 'station'
  | 'line'
  | 'transfer'
  | 'lineTag'
  | 'bullet'
  | 'label'
  | 'polygon'
  | 'svgImage'
  | 'anchor'
  // Line circles cycle via their rim hit stroke. LOCKED circles are the one
  // exception to the locked-geometry merge below: a locked, unselected circle
  // renders no rim element to dispatch to, so its recovery path is the
  // Alt-marquee, not the deep-pick.
  | 'lineCircle';

export interface HitRef {
  kind: HitKind;
  id: string;
}

/** One entity in the under-cursor stack, with the DOM element that resolved
 *  it (the synthetic-click dispatch target). */
export interface HitEntry extends HitRef {
  element: Element;
}

// Selector → entity resolution table, tried in order per element. Each hit
// surface either carries its identity attribute itself (band stripes, tag
// rects) or sits inside a group that does (station rects, bullet/label/image
// groups), so closest() finds it either way. Station dots carry
// data-stop-station instead of data-station-id (a second data-station-id
// element per station would break the id-keyed strict-mode locators); a
// split-border dot's stroke-pass silhouette carries the station id as
// data-stop-stroke's value for the same reason.
const RESOLVERS: { selector: string; kind: HitKind; attr: string }[] = [
  { selector: '[data-stop-station]', kind: 'station', attr: 'data-stop-station' },
  { selector: '[data-stop-stroke]', kind: 'station', attr: 'data-stop-stroke' },
  { selector: '[data-station-id]', kind: 'station', attr: 'data-station-id' },
  { selector: '[data-band-stripe]', kind: 'line', attr: 'data-line-id' },
  { selector: '[data-transfer-id]', kind: 'transfer', attr: 'data-transfer-id' },
  { selector: '[data-line-tag-id]', kind: 'lineTag', attr: 'data-line-tag-id' },
  { selector: '[data-bullet-id]', kind: 'bullet', attr: 'data-bullet-id' },
  { selector: '[data-text-label-id]', kind: 'label', attr: 'data-text-label-id' },
  { selector: '[data-polygon-id]', kind: 'polygon', attr: 'data-polygon-id' },
  { selector: '[data-svg-image-id]', kind: 'svgImage', attr: 'data-svg-image-id' },
  // Only FREE anchors carry this attribute; station-hosted ones render with
  // pointer-events none and no id, so they never enter the snapshot at all and
  // an alt-click reaches whatever sits beneath them.
  { selector: '[data-anchor-id]', kind: 'anchor', attr: 'data-anchor-id' },
  // The rim hit stroke; a locked circle renders none (see HitKind).
  { selector: '[data-line-circle-rim]', kind: 'lineCircle', attr: 'data-line-circle-rim' },
];

// Selected-item drag proxies re-assert footprints at top z; they must never
// resolve as entities (the caller hides the proxy layer during the
// elementsFromPoint snapshot — this is belt-and-suspenders for direct feeds).
const PROXY_SELECTOR =
  '[data-station-hit],[data-polygon-hit],[data-svg-image-hit],[data-bullet-hit],[data-text-label-hit]';

/**
 * Map an elementsFromPoint snapshot (topmost first) to the deduped stack of
 * selectable entities under the point, preserving topmost-first order. An
 * entity hit by several surfaces (a station's two rects + its dots, a
 * transfer's casing lines) appears once, at its topmost surface's position.
 * Elements that resolve to nothing (background, chrome, handles) are skipped.
 */
export function resolveHitStack(elements: readonly Element[]): HitEntry[] {
  const stack: HitEntry[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    if (el.closest(PROXY_SELECTOR)) continue;
    for (const { selector, kind, attr } of RESOLVERS) {
      const owner = el.closest(selector);
      if (!owner) continue;
      const id = owner.getAttribute(attr);
      if (!id) break;
      const key = kind + ':' + id;
      if (!seen.has(key)) {
        seen.add(key);
        stack.push({ kind, id, element: el });
      }
      break;
    }
  }
  return stack;
}

/**
 * Edit Stops (line editor) alt-pick. Alt-click cycles the overlapping items
 * under the cursor — the SAME convention as the idle deep-pick — scoped to what
 * the line editor can arm: stations (the pen) and the EDITED line's segments
 * (keyed by pair key). A station's hit rect painting over a short segment's band
 * is exactly why cycling matters here: a plain click lands on the station,
 * alt-click steps on to the buried segment. The idle resolver's re-dispatch is
 * NOT reused (a plain click MUTATES in Edit Stops — connect/splice); the caller
 * arms the cursor directly. Free items and other lines' stripes are irrelevant
 * and dropped.
 */
export type AppendStackEntry = { kind: 'station' | 'segment'; id: string };

// The three station identity carriers the idle resolver leads with, plus the
// edited line's segment stripe (which carries data-pair-key for the exact edge).
const APPEND_STATION_SELECTORS = ['[data-stop-station]', '[data-stop-stroke]', '[data-station-id]'];

/**
 * Resolve the Edit Stops alt-pick stack from an elementsFromPoint snapshot
 * (topmost-first), deduped: stations and the EDITED line's segments under the
 * cursor. `elementsFromPoint` reports a band stripe even when a station's hit
 * rect is painted on top of it — that is exactly how a short segment buried
 * under its endpoint stations becomes reachable by cycling.
 */
export function resolveAppendStack(
  elements: readonly Element[],
  editedLineId: string,
): AppendStackEntry[] {
  const stack: AppendStackEntry[] = [];
  const seen = new Set<string>();
  const push = (kind: AppendStackEntry['kind'], id: string) => {
    const key = kind + ':' + id;
    if (id && !seen.has(key)) {
      seen.add(key);
      stack.push({ kind, id });
    }
  };
  for (const el of elements) {
    if (el.closest(PROXY_SELECTOR)) continue;
    let station: string | null = null;
    for (const sel of APPEND_STATION_SELECTORS) {
      const owner = el.closest(sel);
      if (owner) {
        station = owner.getAttribute(sel.slice(1, -1)); // '[attr]' → 'attr'
        break;
      }
    }
    if (station) {
      push('station', station);
      continue;
    }
    const stripe = el.closest('[data-band-stripe]');
    if (stripe && stripe.getAttribute('data-line-id') === editedLineId) {
      const pk = stripe.getAttribute('data-pair-key');
      if (pk) push('segment', pk);
    }
  }
  return stack;
}

/**
 * The append cursor as an alt-pick ref (mirrors `currentHitEntity` for idle):
 * a station cursor is that station; an armed edge is its segment (pair key), so
 * cycling advances PAST whichever is current; no cursor cycles from the top.
 */
export function appendCursorRef(cursor: AppendCursor): AppendStackEntry | null {
  if (!cursor) return null;
  if (cursor.kind === 'station') return { kind: 'station', id: cursor.stationId };
  return { kind: 'segment', id: pairKeyOf(cursor.from, cursor.to) };
}

/**
 * The stack entry an Alt+click should select: the one AFTER the currently
 * selected entity (wrapping past the bottom), or the topmost when nothing —
 * or something not in the stack, or a multi-selection — is current. The
 * selection itself is the cycle cursor, so there is no positional state to
 * go stale.
 */
export function nextInStack<T extends { kind: string; id: string }>(
  stack: readonly T[],
  current: { kind: string; id: string } | null,
): T | null {
  if (stack.length === 0) return null;
  if (!current) return stack[0];
  const i = stack.findIndex((e) => e.kind === current.kind && e.id === current.id);
  if (i === -1) return stack[0];
  return stack[(i + 1) % stack.length];
}

// Screen-pixel pad for the locked-item point test (divided by zoom by the
// caller): gives an open locked polygon's stroke a graspable corridor and
// forgives near-misses, mirroring the 10px/zoom floor on open-polygon proxies.
export const LOCKED_HIT_PAD_PX = 4;

/** The slice of the doc lockedHitsAt reads — matches useDoc's state shape. */
export interface LockedHitDocSlice {
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
  // Station hits go through the label geometry, which clears a transfer's cap
  // at the stop it lands on (see StopMetrics).
  transfers: Record<string, Transfer>;
  polygons: Record<string, Polygon>;
  svgImages: Record<string, SvgImage>;
  backgroundOrder: string[];
  textLabels: Record<string, TextLabel>;
  routeBullets: Record<string, RouteBullet>;
}

/**
 * Locked items under a world point, topmost-first. Locked, unselected items
 * are click-through (pointer-events: none), so document.elementsFromPoint
 * never reports them — this geometric point-test (a pad×pad rect through the
 * same *ForRect helpers the marquee uses) is how the alt+click deep-pick
 * reaches them. Order mirrors the canvas paint bands (labels over bullets over
 * stations over the background band); within the background band polygons and
 * images interleave in the one explicit `backgroundOrder` (later = on top →
 * first here).
 */
export function lockedHitsAt(pt: Pt, doc: LockedHitDocSlice, pad: number): HitRef[] {
  const rect = { x0: pt.x - pad, y0: pt.y - pad, x1: pt.x + pad, y1: pt.y + pad };
  const out: HitRef[] = [];
  const push = (kind: HitKind, ids: string[]) => {
    for (const id of ids) out.push({ kind, id });
  };
  push(
    'label',
    textLabelsForRect(doc.textLabels, rect, true).filter((id) => doc.textLabels[id].locked),
  );
  push(
    'bullet',
    routeBulletsForRect(doc.routeBullets, rect, true).filter((id) => doc.routeBullets[id].locked),
  );
  push(
    'station',
    stationsForRect(doc.stations, rect, stopMetricsOf(doc), true).filter(
      (id) => doc.stations[id].locked,
    ),
  );
  // One walk of the shared background stack, topmost first — polygons and
  // images interleave, so they can't be pushed as two kind-grouped blocks.
  // `effectiveBackgroundOrder` returns a fresh array (reconcileOrder always
  // rebuilds it), so reversing it in place is safe — no defensive copy needed.
  for (const id of effectiveBackgroundOrder(
    doc.polygons,
    doc.svgImages,
    doc.backgroundOrder,
  ).reverse()) {
    const poly = doc.polygons[id];
    if (poly) {
      if (poly.locked && polygonsForRect({ [id]: poly }, rect, true).length > 0) {
        out.push({ kind: 'polygon', id });
      }
      continue;
    }
    const image = doc.svgImages[id];
    if (image?.locked && svgImagesForRect({ [id]: image }, rect, true).length > 0) {
      out.push({ kind: 'svgImage', id });
    }
  }
  return out;
}

// Where to send the synthetic click for a locked entity: pointer-events only
// blocks HIT-TESTING, not dispatched events, so the entity's regular body
// element (whose React handlers stay wired) still runs its normal selection
// logic. Lines/transfers/line tags have no locked flag → never looked up.
const LOCKED_TARGET_SELECTORS: Partial<Record<HitKind, (id: string) => string>> = {
  station: (id) => `[data-station-id="${id}"] rect`,
  polygon: (id) => `path[data-polygon-id="${id}"]`,
  svgImage: (id) => `g[data-svg-image-id="${id}"] image`,
  label: (id) => `g[data-text-label-id="${id}"]`,
  bullet: (id) => `g[data-bullet-id="${id}"]`,
};

/** The DOM element a locked entity's synthetic click should be dispatched to. */
export function lockedDispatchTarget(ref: HitRef): Element | null {
  const selector = LOCKED_TARGET_SELECTORS[ref.kind];
  return selector ? document.querySelector(selector(ref.id)) : null;
}

/**
 * Append locked entries BELOW the live stack — locked reads as background, so
 * cycling reaches live items first. A locked-but-selected item has live
 * pointer events and already sits in the DOM stack at its true paint
 * position; the dedupe keeps that entry.
 */
export function mergeLockedIntoStack(stack: HitEntry[], locked: HitEntry[]): HitEntry[] {
  const seen = new Set(stack.map((e) => e.kind + ':' + e.id));
  return [...stack, ...locked.filter((e) => !seen.has(e.kind + ':' + e.id))];
}

/**
 * The current selection as a deep-pick cursor, or null when there is no sole
 * selected entity. Extends `soleSelection` (the five multi-select item types)
 * with the single-id primaries it doesn't cover: line, transfer, line tag —
 * without those, cycling would restart at the top every time it passed
 * through a line.
 */
export function currentHitEntity(sel: SelectionState): HitRef | null {
  const sole = soleSelection(sel);
  if (sole) return { kind: sole.type, id: sole.id };
  if (sel.selectedLineId) return { kind: 'line', id: sel.selectedLineId };
  if (sel.selectedTransferId) return { kind: 'transfer', id: sel.selectedTransferId };
  if (sel.selectedLineTagId) return { kind: 'lineTag', id: sel.selectedLineTagId };
  return null;
}
