/**
 * The RENDER-SOURCE doc: the state the canvas paints from.
 *
 * At rest it mirrors the live doc exactly — same field references, a
 * notification per doc write, selectors and equality behaving precisely as
 * they do against `useDoc`. While a pipelined drag frame is armed, it serves
 * that frame's snapshot INSTEAD, and live doc writes stop notifying: the
 * gesture keeps writing `moveStation` per pointermove exactly as today, but
 * a canvas showing frame N-1 has nothing to re-render until frame N's
 * computed results arrive. That equality-bail is half the point of the
 * worker pipeline — without it, every input event costs a no-op render of
 * the whole canvas at 60-125Hz while the real frame is still computing.
 *
 * Everything that PAINTS map content must read positions through this store
 * (or receive them as props from something that does), never through
 * `useDoc` — that is what makes every painted frame internally coherent:
 * strokes, clips, dots, labels, chrome all resolve from one snapshot.
 * Actions stay on `useDoc`; this store carries data only.
 */
import { create } from 'zustand';
import { pickDocSnapshot, useDoc, type DocSnapshot } from './store';

/**
 * The collections a geometry gesture can move per frame. A group drag tows
 * co-selected items of every kind and a ring carries its bound stations
 * (`groupDrag.translateSiblings` writes all seven), so a drag frame overlays
 * exactly these; nothing else changes mid-drag, and non-overlaid fields keep
 * reading through from the live doc.
 */
export type DragFrameDoc = Pick<
  DocSnapshot,
  | 'stations'
  | 'lineCircles'
  | 'polygons'
  | 'svgImages'
  | 'routeBullets'
  | 'textLabels'
  | 'transferAnchors'
>;

export const useRenderDoc = create<DocSnapshot>(() => pickDocSnapshot(useDoc.getState()));

let armedOverlay: DragFrameDoc | null = null;

/** True while the canvas is rendering pipelined drag frames instead of the
 *  live doc. Instrumentation and tests; render code just selects. */
export function renderDocArmed(): boolean {
  return armedOverlay !== null;
}

/**
 * Serve `overlay`'s collections instead of the live doc's (pass `null` to
 * snap back to mirroring). The pipeline calls this once per computed frame
 * and once on every gesture exit — commit, rollback, and steal alike — so a
 * canceled drag can never strand a stale frame over a reverted doc.
 */
export function setRenderDocOverlay(overlay: DragFrameDoc | null): void {
  armedOverlay = overlay;
  const base = pickDocSnapshot(useDoc.getState());
  useRenderDoc.setState(overlay ? { ...base, ...overlay } : base, true);
}

// The at-rest mirror. Subscribed once at module load; while an overlay is
// armed, live writes are absorbed here (the canvas shows the frame, not the
// in-flight doc) and the next setRenderDocOverlay call re-bases on the
// then-current doc.
useDoc.subscribe((s) => {
  if (armedOverlay === null) useRenderDoc.setState(pickDocSnapshot(s), true);
});
