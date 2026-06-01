import { useDoc } from '../state/store';
import { projectToScreen, type ViewportProjection } from './canvas/screenAnchor';
import { ColorPalette } from './inspector/ColorPalette';
import { NumericFieldRow } from './NumericFieldRow';
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
 * color, and delete. Anchored at the polygon's centroid, projected through the
 * live viewport so it tracks pan/zoom (mirrors {@link RouteBulletPopover}).
 */
export function PolygonPopover({ polygon, view, onClose }: Props) {
  const anchor = projectToScreen(polygonCentroid(polygon.vertices), view);
  const updatePolygon = useDoc((s) => s.updatePolygon);
  const deletePolygon = useDoc((s) => s.deletePolygon);

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
      style={{ position: 'absolute', left: anchor.x + 14, top: anchor.y + 14, zIndex: 1100 }}
      // Keep pointerdowns/clicks from reaching the canvas (which would deselect
      // the polygon and close the popover).
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="header" />
      <div className="body">
        <div className="row">
          <label>Color</label>
        </div>
        <ColorPalette value={polygon.fill} onChange={onFill} />
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
          <label>Stroke color</label>
        </div>
        <ColorPalette value={polygon.stroke} onChange={onStroke} />
        <div className="footer">
          <button className="delete-btn" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
