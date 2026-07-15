import { MoonIcon, SunIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { LayerOrderRow } from './LayerOrderRow';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import { ColorField } from './ColorField';
import { StyleRow } from './StyleRow';
import type { AABB } from '../geometry/rectPolygon';
import {
  POLYGON_CURVE_RADIUS_DEFAULT,
  POLYGON_CURVE_RADIUS_MAX,
  POLYGON_CURVE_RADIUS_MIN,
  POLYGON_STROKE_STEP,
  POLYGON_STROKE_WIDTH_MAX,
  POLYGON_STROKE_WIDTH_MIN,
} from '../model/transforms';
import type { Polygon } from '../model/types';

interface Props {
  polygon: Polygon;
  // The polygon's world AABB at the moment of selection — the spawn opens the
  // popover beside it (vertex bounds; stroke ink is ignored).
  worldRect: AABB;
  view: ViewportProjection;
  // Spawn-placement box (host minus the open sidebar strip); see ItemPopovers.
  spawnBox?: { w: number; h: number };
  onClose: () => void;
}

/**
 * Editing popover for a selected polygon: fill color + opacity, stroke color +
 * width, curve radius, closed toggle, layer order, and delete. The spawn
 * placement is frozen at first display and projected through the live viewport
 * so it tracks pan/zoom without sliding when vertices move; the header drag
 * (world-space, via useDraggablePopover) stays pinned to the canvas through
 * zoom. Mirrors {@link TextLabelPopover}.
 */
export function PolygonPopover({ polygon, worldRect, view, spawnBox, onClose }: Props) {
  // Frozen-anchor + header-drag mechanism (freeze the spawn at first display
  // so vertex edits / whole-polygon drags don't slide the popover; re-freeze
  // when the selected polygon changes; project live for pan/zoom). Shared
  // with the text-label popover.
  const { anchor, measuring, shellRef, headerHandlers } = useDraggablePopover(
    polygon.id,
    worldRect,
    view,
    false,
    spawnBox,
  );
  const updatePolygon = useDoc((s) => s.updatePolygon);
  const deletePolygon = useDoc((s) => s.deletePolygon);
  const moveBackgroundUp = useDoc((s) => s.moveBackgroundUp);
  const moveBackgroundDown = useDoc((s) => s.moveBackgroundDown);

  const locked = polygon.locked ?? false;
  const closed = polygon.closed !== false;
  // Dark-mode colors are concrete (initialized to the light colors at creation,
  // independent thereafter).
  const darkFill = polygon.darkFill;
  const darkStroke = polygon.darkStroke;

  const onFill = (fill: string) => updatePolygon(polygon.id, { fill });
  const onStroke = (stroke: string) => updatePolygon(polygon.id, { stroke });
  const onDarkFill = (darkFill: string) => updatePolygon(polygon.id, { darkFill });
  const onDarkStroke = (darkStroke: string) => updatePolygon(polygon.id, { darkStroke });
  const onStrokeWidth = (strokeWidth: number) => updatePolygon(polygon.id, { strokeWidth });
  const onCurveRadius = (r: number) => updatePolygon(polygon.id, { curveRadius: r });
  const onClosed = (c: boolean) => updatePolygon(polygon.id, { closed: c });
  const onToggleLock = () => updatePolygon(polygon.id, { locked: !locked });
  const onDelete = () => {
    deletePolygon(polygon.id);
    onClose();
  };

  return (
    <DraggablePopoverShell
      className="bullet-popover polygon-popover"
      left={anchor.x}
      top={anchor.y}
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <StyleRow
        key={polygon.id}
        kind="polygon"
        itemId={polygon.id}
        styleId={polygon.styleId}
        disabled={locked}
      />
      <hr className="popover-divider" aria-hidden="true" />
      <div className="row">
        <label htmlFor="polygon-fill">Fill color</label>
        <SunIcon aria-hidden="true" />
        <ColorField
          id="polygon-fill"
          ariaLabel="Polygon color"
          title="Light mode fill"
          value={polygon.fill}
          disabled={locked || !closed}
          onChange={onFill}
        />
        <MoonIcon aria-hidden="true" />
        <ColorField
          id="polygon-dark-fill"
          ariaLabel="Dark mode color"
          title="Dark mode fill"
          value={darkFill}
          disabled={locked || !closed}
          onChange={onDarkFill}
        />
      </div>
      <hr className="popover-divider" aria-hidden="true" />
      <div className="row">
        <label htmlFor="polygon-stroke">Stroke color</label>
        <SunIcon aria-hidden="true" />
        <ColorField
          id="polygon-stroke"
          ariaLabel="Stroke color"
          title="Light mode stroke"
          value={polygon.stroke}
          disabled={locked}
          onChange={onStroke}
        />
        <MoonIcon aria-hidden="true" />
        <ColorField
          id="polygon-dark-stroke"
          ariaLabel="Dark mode stroke color"
          title="Dark mode stroke"
          value={darkStroke}
          disabled={locked}
          onChange={onDarkStroke}
        />
      </div>
      <NumericFieldRow
        id="polygon-stroke-width"
        label="Stroke width"
        min={POLYGON_STROKE_WIDTH_MIN}
        max={POLYGON_STROKE_WIDTH_MAX}
        step={POLYGON_STROKE_STEP}
        value={polygon.strokeWidth}
        onChange={onStrokeWidth}
        getCurrent={() => useDoc.getState().polygons[polygon.id]?.strokeWidth ?? 0}
        textboxAllowAboveMax
        disabled={locked}
      />
      <hr className="popover-divider" aria-hidden="true" />
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
        textboxAllowAboveMax
        disabled={locked}
      />
      {/* Open polygons render stroke-only along the vertex chain — no fill,
            no closing edge — so unchecking this also greys the fill controls. */}
      <div className="row">
        <label htmlFor="polygon-closed">Closed</label>
        <input
          id="polygon-closed"
          type="checkbox"
          aria-label="Closed"
          title="Closed (uncheck for an open, stroke-only polygon)"
          checked={closed}
          disabled={locked}
          onChange={(e) => onClosed(e.target.checked)}
        />
      </div>
      <LayerOrderRow
        noun="polygon"
        onMoveDown={() => moveBackgroundDown(polygon.id)}
        onMoveUp={() => moveBackgroundUp(polygon.id)}
        disabled={locked}
      />
      <PopoverFooter
        noun="polygon"
        locked={locked}
        onToggleLock={onToggleLock}
        onDelete={onDelete}
      />
    </DraggablePopoverShell>
  );
}
