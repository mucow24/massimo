import { useRef, useState } from 'react';
import { useDoc } from '../state/store';
import { projectToScreen, type ViewportProjection } from './canvas/screenAnchor';
import { NumericFieldRow } from './NumericFieldRow';
import { useFieldHistory } from './useFieldHistory';
import { polygonCentroid } from '../geometry/polygon';
import { POLYGON_STROKE_WIDTH_MAX, POLYGON_STROKE_WIDTH_MIN } from '../model/transforms';
import type { Polygon } from '../model/types';

interface Props {
  polygon: Polygon;
  view: ViewportProjection;
  onClose: () => void;
}

/**
 * Editing popover for a selected polygon: fill color, stroke width, stroke
 * color, and delete. The anchor (centroid) is frozen at mount and projected
 * through the live viewport so it tracks pan/zoom without sliding when vertices
 * move; the header drags the popover via `dragOffset` (mirrors
 * {@link TextLabelPopover}).
 */
export function PolygonPopover({ polygon, view, onClose }: Props) {
  // Freeze the centroid at mount so vertex edits / whole-polygon drags don't
  // slide the popover out from under the cursor. Still projected live for
  // pan/zoom; user drags add dragOffset on top.
  const [frozenWorld] = useState(() => polygonCentroid(polygon.vertices));
  const anchor = projectToScreen(frozenWorld, view);
  const updatePolygon = useDoc((s) => s.updatePolygon);
  const deletePolygon = useDoc((s) => s.deletePolygon);
  // Group each color picker's continuous edits into one undo entry, matching
  // the Transfer color control in the Options popover.
  const fillField = useFieldHistory();
  const strokeField = useFieldHistory();

  // Header drag — same mechanism as the text-label popover.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStart = useRef<{ mouseX: number; mouseY: number; offX: number; offY: number } | null>(
    null,
  );
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offX: dragOffset.x,
      offY: dragOffset.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s) return;
    setDragOffset({ x: s.offX + (e.clientX - s.mouseX), y: s.offY + (e.clientY - s.mouseY) });
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onFill = (fill: string) => updatePolygon(polygon.id, { fill });
  const onStroke = (stroke: string) => updatePolygon(polygon.id, { stroke });
  const onStrokeWidth = (strokeWidth: number) => updatePolygon(polygon.id, { strokeWidth });
  const onDelete = () => {
    deletePolygon(polygon.id);
    onClose();
  };

  return (
    <div
      className="bullet-popover polygon-popover"
      style={{
        position: 'absolute',
        left: anchor.x + 14 + dragOffset.x,
        top: anchor.y + 14 + dragOffset.y,
        zIndex: 1100,
      }}
      // Keep pointer events from reaching the canvas (which would deselect the
      // polygon and close the popover, or right-click-rotate underneath it).
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        className="header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      />
      <div className="body">
        <div className="row">
          <label htmlFor="polygon-fill">Color</label>
          <input
            id="polygon-fill"
            type="color"
            aria-label="Polygon color"
            value={polygon.fill}
            onChange={(e) => onFill(e.target.value)}
            {...fillField}
          />
        </div>
        <NumericFieldRow
          id="polygon-stroke-width"
          label="Stroke width"
          min={POLYGON_STROKE_WIDTH_MIN}
          max={POLYGON_STROKE_WIDTH_MAX}
          step={1}
          value={polygon.strokeWidth}
          onChange={onStrokeWidth}
          getCurrent={() => useDoc.getState().polygons[polygon.id]?.strokeWidth ?? 0}
        />
        <div className="row">
          <label htmlFor="polygon-stroke">Stroke color</label>
          <input
            id="polygon-stroke"
            type="color"
            aria-label="Stroke color"
            value={polygon.stroke}
            onChange={(e) => onStroke(e.target.value)}
            {...strokeField}
          />
        </div>
        <div className="footer">
          <button className="delete-btn" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
