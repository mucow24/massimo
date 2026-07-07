import { soleSelection, type SelectionState } from '../../state/selection';

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
  | 'svgImage';

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
 * The stack entry an Alt+click should select: the one AFTER the currently
 * selected entity (wrapping past the bottom), or the topmost when nothing —
 * or something not in the stack, or a multi-selection — is current. The
 * selection itself is the cycle cursor, so there is no positional state to
 * go stale.
 */
export function nextInStack<T extends HitRef>(
  stack: readonly T[],
  current: HitRef | null,
): T | null {
  if (stack.length === 0) return null;
  if (!current) return stack[0];
  const i = stack.findIndex((e) => e.kind === current.kind && e.id === current.id);
  if (i === -1) return stack[0];
  return stack[(i + 1) % stack.length];
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
