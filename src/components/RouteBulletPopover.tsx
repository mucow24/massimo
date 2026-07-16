import { ChevronDownIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
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

// Radix Select forbids empty-string item values; line ids are UUIDs, so the
// dunder can't collide (same convention as StyleRow's sentinels).
const NO_LINE = '__none__';

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

// Exported for the Styles panel editor, which renders the same shape chips.
export function ShapeIcon({ shape }: { shape: RouteBulletShape }) {
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
      title="Route bullet"
      left={anchor.x}
      top={anchor.y}
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <div className="row">
        <label>Line</label>
        <Select.Root
          value={bullet.lineId ?? NO_LINE}
          disabled={locked}
          onValueChange={(v) => onLine(v === NO_LINE ? '' : v)}
        >
          <Select.Trigger className="field-select" aria-label="Line">
            <Select.Value />
            <Select.Icon className="field-select-caret" aria-hidden="true">
              <ChevronDownIcon />
            </Select.Icon>
          </Select.Trigger>
          <Select.Content className="field-select-panel" position="popper" sideOffset={4}>
            <Select.Viewport>
              <Select.Item value={NO_LINE} className="field-select-item field-select-action">
                <Select.ItemText>— none —</Select.ItemText>
              </Select.Item>
              {orderedLines.map((ln) => (
                <Select.Item key={ln.id} value={ln.id} className="field-select-item">
                  <Select.ItemText>
                    {/* Swatch + service code: the list previews the line it
                        picks, like the weight dropdown's per-face options. */}
                    <span className="line-swatch" style={{ background: ln.color }} aria-hidden />
                    {ln.service}
                  </Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Root>
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
          {/* One roving-focus group; the empty-string guard keeps it
              radio-like (re-clicking the selected shape doesn't deselect). */}
          <ToggleGroup.Root
            type="single"
            className="align-group"
            value={bullet.shape}
            disabled={locked}
            onValueChange={(v) => {
              if (v) onShape(v as RouteBulletShape);
            }}
          >
            {shapes.map((s) => (
              <ToggleGroup.Item
                key={s}
                value={s}
                className={'shape-btn' + (bullet.shape === s ? ' active' : '')}
                title={s}
                aria-label={s}
              >
                <ShapeIcon shape={s} />
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
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
