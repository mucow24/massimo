import { useEffect } from 'react';
import { useSelection } from '../state/store';
import type { Station } from '../model/types';
import { type ViewportProjection } from './canvas/screenAnchor';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { StationInspector } from './inspector';

// Shell width (matches .station-popover in styles.css) — used to clamp the
// anchor into the canvas host.
const POPOVER_W = 320;
const EDGE_PAD = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The station editor as an on-canvas popover — stations join every other
 * entity type in ItemPopovers instead of living in the sidebar. Hosts the
 * full StationInspector; draggable by the header; anchored to the station's
 * position at selection time (frozen-world mechanism shared with the other
 * popovers) and CLAMPED into the canvas host, so selecting an off-screen
 * station from the sidebar list still shows the editor instead of
 * projecting it outside the overflow:hidden host.
 */
export function StationPopover({
  station,
  view,
  onClose,
}: {
  station: Station;
  view: ViewportProjection;
  onClose: () => void;
}) {
  const { anchor, headerHandlers } = useDraggablePopover(
    station.id,
    { x: station.x, y: station.y },
    view,
  );

  // Escape closes — unless a form field should swallow it, or the layout-edit
  // mode is active (App's Escape handler exits the MODE first; the popover
  // stays for the still-selected station).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable;
      if (inField) return;
      if (useSelection.getState().uiMode.kind === 'editing-station-layout') return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const left = clamp(
    anchor.x + 14,
    EDGE_PAD,
    Math.max(EDGE_PAD, view.size.w - POPOVER_W - EDGE_PAD),
  );
  const top = clamp(anchor.y + 14, EDGE_PAD, Math.max(EDGE_PAD, view.size.h - 120));

  return (
    <div
      className="text-label-popover station-popover"
      style={{ position: 'absolute', left, top, zIndex: 1100 }}
      // Stop pointer events from reaching the canvas so clicks inside the
      // popover don't deselect the station or place items.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="header" {...headerHandlers} />
      <div className="body">
        <StationInspector id={station.id} />
      </div>
    </div>
  );
}
