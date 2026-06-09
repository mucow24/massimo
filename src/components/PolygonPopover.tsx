import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { NumericFieldRow } from './NumericFieldRow';
import { useFieldHistory } from './useFieldHistory';
import { polygonCentroid } from '../geometry/polygon';
import {
  POLYGON_CURVE_RADIUS_DEFAULT,
  POLYGON_CURVE_RADIUS_MAX,
  POLYGON_CURVE_RADIUS_MIN,
  POLYGON_FILL_OPACITY_DEFAULT,
  POLYGON_FILL_OPACITY_MAX,
  POLYGON_FILL_OPACITY_MIN,
  POLYGON_STROKE_WIDTH_MAX,
  POLYGON_STROKE_WIDTH_MIN,
} from '../model/transforms';
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
  // Frozen-anchor + header-drag mechanism (freeze the centroid at mount so
  // vertex edits / whole-polygon drags don't slide the popover; re-freeze when
  // the selected polygon changes; project live for pan/zoom). Shared with the
  // text-label popover.
  const { anchor, dragOffset, headerHandlers } = useDraggablePopover(
    polygon.id,
    polygonCentroid(polygon.vertices),
    view,
  );
  const updatePolygon = useDoc((s) => s.updatePolygon);
  const deletePolygon = useDoc((s) => s.deletePolygon);
  const movePolygonUp = useDoc((s) => s.movePolygonUp);
  const movePolygonDown = useDoc((s) => s.movePolygonDown);
  // Group each color picker's continuous edits into one undo entry, matching
  // the Transfer color control in the Options popover.
  const fillField = useFieldHistory();
  const strokeField = useFieldHistory();
  const darkFillField = useFieldHistory();
  const darkStrokeField = useFieldHistory();

  const locked = polygon.locked ?? false;
  const fillOpacity = polygon.fillOpacity ?? POLYGON_FILL_OPACITY_DEFAULT;
  // Dark-mode colors are concrete (initialized to the light colors at creation,
  // independent thereafter).
  const darkFill = polygon.darkFill;
  const darkStroke = polygon.darkStroke;

  const onFill = (fill: string) => updatePolygon(polygon.id, { fill });
  const onStroke = (stroke: string) => updatePolygon(polygon.id, { stroke });
  const onDarkFill = (darkFill: string) => updatePolygon(polygon.id, { darkFill });
  const onDarkStroke = (darkStroke: string) => updatePolygon(polygon.id, { darkStroke });
  const onStrokeWidth = (strokeWidth: number) => updatePolygon(polygon.id, { strokeWidth });
  const onFillOpacity = (o: number) => updatePolygon(polygon.id, { fillOpacity: o });
  const onCurveRadius = (r: number) => updatePolygon(polygon.id, { curveRadius: r });
  const onToggleLock = () => updatePolygon(polygon.id, { locked: !locked });
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
      <div className="header" {...headerHandlers} />
      <div className="body">
        <div className="row">
          <label htmlFor="polygon-fill">Color</label>
          <span aria-hidden="true">☀️</span>
          <input
            id="polygon-fill"
            type="color"
            aria-label="Polygon color"
            title="Light mode fill"
            value={polygon.fill}
            disabled={locked}
            onChange={(e) => onFill(e.target.value)}
            {...fillField}
          />
          <span aria-hidden="true">🌙</span>
          <input
            id="polygon-dark-fill"
            type="color"
            aria-label="Dark mode color"
            title="Dark mode fill"
            value={darkFill}
            disabled={locked}
            onChange={(e) => onDarkFill(e.target.value)}
            {...darkFillField}
          />
        </div>
        <NumericFieldRow
          id="polygon-fill-opacity"
          label="Fill opacity"
          min={POLYGON_FILL_OPACITY_MIN}
          max={POLYGON_FILL_OPACITY_MAX}
          step={1}
          value={fillOpacity}
          onChange={onFillOpacity}
          getCurrent={() =>
            useDoc.getState().polygons[polygon.id]?.fillOpacity ?? POLYGON_FILL_OPACITY_DEFAULT
          }
          disabled={locked}
        />
        <NumericFieldRow
          id="polygon-stroke-width"
          label="Stroke width"
          min={POLYGON_STROKE_WIDTH_MIN}
          max={POLYGON_STROKE_WIDTH_MAX}
          step={1}
          value={polygon.strokeWidth}
          onChange={onStrokeWidth}
          getCurrent={() => useDoc.getState().polygons[polygon.id]?.strokeWidth ?? 0}
          disabled={locked}
        />
        <NumericFieldRow
          id="polygon-curve-radius"
          label="Curve radius"
          min={POLYGON_CURVE_RADIUS_MIN}
          max={POLYGON_CURVE_RADIUS_MAX}
          step={1}
          value={polygon.curveRadius ?? POLYGON_CURVE_RADIUS_DEFAULT}
          onChange={onCurveRadius}
          getCurrent={() =>
            useDoc.getState().polygons[polygon.id]?.curveRadius ?? POLYGON_CURVE_RADIUS_DEFAULT
          }
          disabled={locked}
        />
        <div className="row">
          <label htmlFor="polygon-stroke">Stroke color</label>
          <span aria-hidden="true">☀️</span>
          <input
            id="polygon-stroke"
            type="color"
            aria-label="Stroke color"
            title="Light mode stroke"
            value={polygon.stroke}
            disabled={locked}
            onChange={(e) => onStroke(e.target.value)}
            {...strokeField}
          />
          <span aria-hidden="true">🌙</span>
          <input
            id="polygon-dark-stroke"
            type="color"
            aria-label="Dark mode stroke color"
            title="Dark mode stroke"
            value={darkStroke}
            disabled={locked}
            onChange={(e) => onDarkStroke(e.target.value)}
            {...darkStrokeField}
          />
        </div>
        <div className="row">
          <label>Layer</label>
          <div className="shape-group">
            <button
              type="button"
              className="shape-btn"
              aria-label="Move polygon down"
              title="Send backward"
              disabled={locked}
              onClick={() => movePolygonDown(polygon.id)}
            >
              ↓
            </button>
            <button
              type="button"
              className="shape-btn"
              aria-label="Move polygon up"
              title="Bring forward"
              disabled={locked}
              onClick={() => movePolygonUp(polygon.id)}
            >
              ↑
            </button>
          </div>
        </div>
        <div className="footer">
          <button
            type="button"
            className={'lock-btn' + (locked ? ' active' : '')}
            aria-label={locked ? 'Unlock polygon' : 'Lock polygon'}
            aria-pressed={locked}
            title={locked ? 'Unlock' : 'Lock (prevents editing)'}
            onClick={onToggleLock}
          >
            {locked ? '🔒 Locked' : '🔓 Lock'}
          </button>
          <button className="delete-btn" onClick={onDelete} disabled={locked}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
