import { useEffect } from 'react';
import { useSelection } from '../state/store';
import type { Station } from '../model/types';
import { type ViewportProjection } from './canvas/screenAnchor';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { isInFormField } from './usePopover';
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

  // Escape steps OUT one level instead of slamming the editor shut:
  // 1. a focused form field swallows it;
  // 2. an active stop/label sub-selection clears (this handler owns it — the
  //    inspector's useDismiss deliberately skips Escape so two listeners
  //    can't race over the same state) — the popover stays;
  // 3. the layout-edit mode is exited by App's Escape handler — stays;
  // 4. otherwise close (deselect the station).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isInFormField(e.target)) return;
      const sel = useSelection.getState();
      if (sel.selectedStopLineId || sel.labelSelected) {
        sel.setSelectedStopLineId(null);
        sel.setLabelSelected(false);
        return;
      }
      if (sel.uiMode.kind === 'editing-station-layout') return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // While the layout editor is active the popover pins to the host's top-right
  // corner: its default spot (station + 14px) would sit exactly over the
  // handles the mode exists to expose (the framing effect centers the station
  // under it). Otherwise it anchors to the station, clamped into the host.
  const inLayoutEdit = useSelection((s) => s.uiMode.kind === 'editing-station-layout');
  const left = inLayoutEdit
    ? Math.max(EDGE_PAD, view.size.w - POPOVER_W - EDGE_PAD)
    : clamp(anchor.x + 14, EDGE_PAD, Math.max(EDGE_PAD, view.size.w - POPOVER_W - EDGE_PAD));
  const top = inLayoutEdit
    ? EDGE_PAD
    : clamp(anchor.y + 14, EDGE_PAD, Math.max(EDGE_PAD, view.size.h - 120));

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
