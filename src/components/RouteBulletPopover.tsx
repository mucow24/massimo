import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { useNumericField } from './useNumericField';
import { PopoverFooter } from './PopoverFooter';
import { ROUTE_BULLET_SIZE_MAX, ROUTE_BULLET_SIZE_MIN } from '../model/transforms';
import type { RouteBullet, RouteBulletShape } from '../model/types';

interface Props {
  bullet: RouteBullet;
  // The bullet's world position at the moment of selection. Frozen at mount
  // (useDraggablePopover) but projected through the live viewport, so the
  // popover tracks canvas pan/zoom like the other item popovers.
  world: { x: number; y: number };
  view: ViewportProjection;
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

export function RouteBulletPopover({ bullet, world, view, onClose }: Props) {
  // Frozen-anchor + header-drag mechanism shared with the other item popovers.
  const { anchor, headerHandlers } = useDraggablePopover(bullet.id, world, view);
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
    <DraggablePopoverShell
      className="bullet-popover"
      left={anchor.x}
      top={anchor.y}
      headerHandlers={headerHandlers}
    >
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
      {/* Wheel is handled once at the row level so scrolling over the slider
          (which ignores wheel natively) or the spinbutton both nudge the size
          by one step — putting onWheel on the spinbutton too would double-count. */}
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
    </DraggablePopoverShell>
  );
}
