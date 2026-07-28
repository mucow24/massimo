import { useDoc } from '../state/store';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { LayerOrderRow } from './LayerOrderRow';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import { DayNightColorRow } from './DayNightColorRow';
import { StyleRow } from './StyleRow';
import {
  POLYGON_CURVE_RADIUS_DEFAULT,
  POLYGON_CURVE_RADIUS_MAX,
  POLYGON_CURVE_RADIUS_MIN,
  POLYGON_CURVE_RADIUS_STEP,
  POLYGON_STROKE_STEP,
  POLYGON_STROKE_WIDTH_MAX,
  POLYGON_STROKE_WIDTH_MIN,
} from '../model/transforms';
import type { Polygon } from '../model/types';
import { FieldCheckbox } from './FieldCheckbox';

interface Props {
  polygon: Polygon;
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers.
  hostW: number;
  onClose: () => void;
}

/**
 * Editing popover for a selected polygon: fill color + opacity, stroke color +
 * width, curve radius, closed toggle, layer order, and delete. Docked to the
 * host's top-right corner (usePinnedPopover). Mirrors {@link TextLabelPopover}.
 */
export function PolygonPopover({ polygon, hostW, onClose }: Props) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
  const updatePolygon = useDoc((s) => s.updatePolygon);
  const deletePolygon = useDoc((s) => s.deletePolygon);
  const moveBackgroundUp = useDoc((s) => s.moveBackgroundUp);
  const moveBackgroundDown = useDoc((s) => s.moveBackgroundDown);
  const moveBackgroundToTop = useDoc((s) => s.moveBackgroundToTop);
  const moveBackgroundToBottom = useDoc((s) => s.moveBackgroundToBottom);

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
    <PopoverShell
      className="bullet-popover polygon-popover"
      title="Polygon"
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
    >
      <StyleRow
        key={polygon.id}
        kind="polygon"
        itemId={polygon.id}
        styleId={polygon.styleId}
        disabled={locked}
      />
      <hr className="popover-divider" aria-hidden="true" />
      <DayNightColorRow
        label="Fill color"
        id="polygon-fill"
        darkId="polygon-dark-fill"
        lightAriaLabel="Polygon color"
        darkAriaLabel="Dark mode color"
        titleNoun="fill"
        value={polygon.fill}
        darkValue={darkFill}
        disabled={locked || !closed}
        onChange={onFill}
        onDarkChange={onDarkFill}
      />
      <hr className="popover-divider" aria-hidden="true" />
      <DayNightColorRow
        label="Stroke color"
        id="polygon-stroke"
        darkId="polygon-dark-stroke"
        lightAriaLabel="Stroke color"
        darkAriaLabel="Dark mode stroke color"
        titleNoun="stroke"
        value={polygon.stroke}
        darkValue={darkStroke}
        disabled={locked}
        onChange={onStroke}
        onDarkChange={onDarkStroke}
      />
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
        step={POLYGON_CURVE_RADIUS_STEP}
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
        <FieldCheckbox
          id="polygon-closed"
          ariaLabel="Closed"
          title="Closed (uncheck for an open, stroke-only polygon)"
          checked={closed}
          disabled={locked}
          onCheckedChange={onClosed}
        />
      </div>
      <LayerOrderRow
        noun="polygon"
        onMoveToTop={() => moveBackgroundToTop(polygon.id)}
        onMoveUp={() => moveBackgroundUp(polygon.id)}
        onMoveDown={() => moveBackgroundDown(polygon.id)}
        onMoveToBottom={() => moveBackgroundToBottom(polygon.id)}
        disabled={locked}
      />
      <PopoverFooter
        noun="polygon"
        locked={locked}
        onToggleLock={onToggleLock}
        onDelete={onDelete}
      />
    </PopoverShell>
  );
}
