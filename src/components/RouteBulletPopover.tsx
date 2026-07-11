import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import type { AABB } from '../geometry/rectPolygon';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import { StyleRow } from './StyleRow';
import { ROUTE_BULLET_SIZE_MAX, ROUTE_BULLET_SIZE_MIN } from '../model/transforms';
import type { RouteBullet, RouteBulletShape } from '../model/types';

interface Props {
  bullet: RouteBullet;
  // The bullet's world AABB at the moment of selection — the spawn opens the
  // popover beside it. Placement is frozen at spawn (useDraggablePopover) but
  // projected through the live viewport, so the popover tracks canvas
  // pan/zoom like the other item popovers.
  worldRect: AABB;
  view: ViewportProjection;
  // Spawn-placement box (host minus the open sidebar strip); see ItemPopovers.
  spawnBox?: { w: number; h: number };
  onClose: () => void;
}

function ShapeIcon({ shape }: { shape: RouteBulletShape }) {
  // currentColor: inherits the button's themed text color, so the glyph stays
  // visible on the dark control face too.
  const fill = 'currentColor';
  if (shape === 'circle') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" fill={fill} />
      </svg>
    );
  }
  if (shape === 'square') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <rect x="1.5" y="1.5" width="11" height="11" fill={fill} />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <polygon points="7,1 13,7 7,13 1,7" fill={fill} />
    </svg>
  );
}

export function RouteBulletPopover({ bullet, worldRect, view, spawnBox, onClose }: Props) {
  // Frozen-anchor + header-drag mechanism shared with the other item popovers.
  const { anchor, measuring, shellRef, headerHandlers } = useDraggablePopover(
    bullet.id,
    worldRect,
    view,
    false,
    spawnBox,
  );
  const lines = useDoc((s) => s.lines);
  const lineOrder = useDoc((s) => s.lineOrder);
  const updateRouteBullet = useDoc((s) => s.updateRouteBullet);
  const deleteRouteBullet = useDoc((s) => s.deleteRouteBullet);

  const orderedLines = lineOrder.map((id) => lines[id]).filter((l) => l);

  const locked = bullet.locked ?? false;
  const onShape = (shape: RouteBulletShape) => updateRouteBullet(bullet.id, { shape });
  const onLine = (lineId: string) =>
    updateRouteBullet(bullet.id, { lineId: lineId === '' ? null : lineId });
  const onSize = (size: number) => updateRouteBullet(bullet.id, { size });
  const onToggleLock = () => updateRouteBullet(bullet.id, { locked: !locked });
  const onDelete = () => {
    deleteRouteBullet(bullet.id);
    onClose();
  };

  const shapes: RouteBulletShape[] = ['circle', 'square', 'diamond'];

  return (
    <DraggablePopoverShell
      className="bullet-popover"
      left={anchor.x}
      top={anchor.y}
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <div className="row">
        <label>Line</label>
        <select
          aria-label="Line"
          value={bullet.lineId ?? ''}
          disabled={locked}
          onChange={(e) => onLine(e.target.value)}
        >
          <option value="">— none —</option>
          {orderedLines.map((ln) => (
            <option key={ln.id} value={ln.id}>
              {ln.service}
            </option>
          ))}
        </select>
      </div>
      {/* The Line select above is identity, not style — the style row covers
          shape + size only, so it sits between them. */}
      <StyleRow
        key={bullet.id}
        kind="routeBullet"
        itemId={bullet.id}
        styleId={bullet.styleId}
        disabled={locked}
      />
      <hr className="popover-divider" aria-hidden="true" />
      <div className="row">
        <label>Shape</label>
        <div className="shape-group">
          {shapes.map((s) => (
            <button
              key={s}
              className={'shape-btn' + (bullet.shape === s ? ' active' : '')}
              disabled={locked}
              onClick={() => onShape(s)}
              title={s}
              aria-label={s}
            >
              <ShapeIcon shape={s} />
            </button>
          ))}
        </div>
      </div>
      {/* textboxAllowAboveMax: the spinbutton (typing and step buttons) accepts
          sizes beyond the slider's range; the transform clamps at MIN only. */}
      <NumericFieldRow
        id="bullet-size"
        label="Size"
        min={ROUTE_BULLET_SIZE_MIN}
        max={ROUTE_BULLET_SIZE_MAX}
        step={1}
        value={bullet.size}
        onChange={onSize}
        getCurrent={() => useDoc.getState().routeBullets[bullet.id]?.size ?? bullet.size}
        textboxAllowAboveMax
        disabled={locked}
      />
      <PopoverFooter
        noun="route bullet"
        locked={locked}
        onToggleLock={onToggleLock}
        onDelete={onDelete}
      />
    </DraggablePopoverShell>
  );
}
