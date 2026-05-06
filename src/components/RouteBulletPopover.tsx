import { useDoc } from '../state/store';
import type { RouteBullet, RouteBulletShape } from '../model/types';

interface Props {
  bullet: RouteBullet;
  // Anchor in screen pixels (the bullet's screen-space position).
  anchor: { x: number; y: number };
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

export function RouteBulletPopover({ bullet, anchor, onClose }: Props) {
  const lines = useDoc((s) => s.lines);
  const lineOrder = useDoc((s) => s.lineOrder);
  const updateRouteBullet = useDoc((s) => s.updateRouteBullet);
  const deleteRouteBullet = useDoc((s) => s.deleteRouteBullet);

  const orderedLines = lineOrder.map((id) => lines[id]).filter((l) => l);

  const onShape = (shape: RouteBulletShape) => updateRouteBullet(bullet.id, { shape });
  const onLine = (lineId: string) =>
    updateRouteBullet(bullet.id, { lineId: lineId === '' ? null : lineId });
  const onSize = (size: number) => updateRouteBullet(bullet.id, { size });
  const onDelete = () => {
    deleteRouteBullet(bullet.id);
    onClose();
  };

  const shapes: RouteBulletShape[] = ['circle', 'square', 'diamond'];

  return (
    <div
      className="bullet-popover"
      style={{
        position: 'fixed',
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
          <select value={bullet.lineId ?? ''} onChange={(e) => onLine(e.target.value)}>
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
                onClick={() => onShape(s)}
                title={s}
                aria-label={s}
              >
                <ShapeIcon shape={s} />
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label>Size</label>
          <input
            type="range"
            min={6}
            max={48}
            step={1}
            value={bullet.size}
            onChange={(e) => onSize(Number(e.target.value))}
          />
          <span style={{ width: 28, textAlign: 'right' }}>{bullet.size}</span>
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
