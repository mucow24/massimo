import { useDoc } from '../state/store';
import { projectToScreen, type ViewportProjection } from './canvas/screenAnchor';
import { useNumericField } from './useNumericField';
import { PopoverFooter } from './PopoverFooter';
import { ROUTE_BULLET_SIZE_MAX, ROUTE_BULLET_SIZE_MIN } from '../model/transforms';
import type { RouteBullet, RouteBulletShape } from '../model/types';

interface Props {
  bullet: RouteBullet;
  // The bullet's world position. Projected through the live viewport every
  // render so the popover tracks canvas pan/zoom.
  world: { x: number; y: number };
  view: ViewportProjection;
  onClose: () => void;
}

function ShapeIcon({ shape }: { shape: RouteBulletShape }) {
  const fill = '#000';
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

export function RouteBulletPopover({ bullet, world, view, onClose }: Props) {
  const anchor = projectToScreen(world, view);
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
  // Standard numeric-field-with-history idiom (matches the other popovers): one
  // undo entry per slider drag / spinbutton edit instead of ~one per frame.
  const size = useNumericField(
    bullet.size,
    onSize,
    () => useDoc.getState().routeBullets[bullet.id]?.size ?? bullet.size,
  );
  const onDelete = () => {
    deleteRouteBullet(bullet.id);
    onClose();
  };

  const shapes: RouteBulletShape[] = ['circle', 'square', 'diamond'];

  return (
    <div
      className="bullet-popover"
      style={{
        position: 'absolute',
        left: anchor.x + 14,
        top: anchor.y + 14,
        zIndex: 1100,
      }}
      // Stop pointerdowns from reaching the canvas (so the popover doesn't
      // close itself by deselecting the bullet).
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="header" />
      <div className="body">
        <div className="row">
          <label>Line</label>
          <select
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
        <div className="row" onWheel={size.onNumberWheel}>
          <label>Size</label>
          <input
            type="range"
            min={ROUTE_BULLET_SIZE_MIN}
            max={ROUTE_BULLET_SIZE_MAX}
            step={1}
            value={bullet.size}
            disabled={locked}
            onChange={(e) => onSize(Number(e.target.value))}
            onMouseDown={size.history.onFocus}
            onMouseUp={size.history.onBlur}
          />
          <input
            type="number"
            className="size-spin"
            // No `max` — the spinbutton (typing and step buttons) accepts sizes
            // beyond the slider's range; the transform clamps at MIN only.
            min={ROUTE_BULLET_SIZE_MIN}
            step={1}
            value={size.text}
            disabled={locked}
            onChange={size.onNumberChange}
            onWheel={size.onNumberWheel}
            onFocus={size.onNumberFocus}
            onBlur={size.onNumberBlur}
          />
        </div>
        <PopoverFooter
          noun="route bullet"
          locked={locked}
          onToggleLock={onToggleLock}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
