import { ChevronDownIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { useDoc } from '../state/store';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { FieldSelectContent } from './FieldSelectContent';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import { SegmentedToggle } from './SegmentedToggle';
import { StyleRow } from './StyleRow';
import {
  ROUTE_BULLET_SHAPES,
  ROUTE_BULLET_SIZE_MAX,
  ROUTE_BULLET_SIZE_MIN,
  ROUTE_BULLET_SIZE_STEP,
} from '../model/transforms';
import type { RouteBullet, RouteBulletShape } from '../model/types';

// Radix Select forbids empty-string item values; line ids are UUIDs, so the
// dunder can't collide (same convention as StyleRow's sentinels).
const NO_LINE = '__none__';

interface Props {
  bullet: RouteBullet;
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers.
  hostW: number;
  onClose: () => void;
}

// How a shape is NAMED to the user, on the chips in this popover and in the
// Styles panel's route-bullet editor. The model's own values are lowercase
// tokens, which read as a typo wherever they surface; the stop-dot shape
// chips already carry proper names (DOT_BASE_SHAPE_LABELS), so these match.
//
// Doubling as the exhaustiveness guard for `ROUTE_BULLET_SHAPES`: a shape added
// to the union leaves a missing key here and fails to compile, so the ladder
// the chips and both load-path gates read can't fall behind the type.
export const ROUTE_BULLET_SHAPE_LABEL: Record<RouteBulletShape, string> = {
  circle: 'Circle',
  square: 'Square',
  diamond: 'Diamond',
};

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

export function RouteBulletPopover({ bullet, hostW, onClose }: Props) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
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

  const shapes = ROUTE_BULLET_SHAPES;

  return (
    <PopoverShell
      className="bullet-popover"
      title="Route bullet"
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
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
          <FieldSelectContent>
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
          </FieldSelectContent>
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
          <SegmentedToggle
            value={bullet.shape}
            disabled={locked}
            itemClassName="shape-btn"
            onSelect={(v) => onShape(v as RouteBulletShape)}
            options={shapes.map((s) => ({
              value: s,
              label: ROUTE_BULLET_SHAPE_LABEL[s],
              title: ROUTE_BULLET_SHAPE_LABEL[s],
              content: <ShapeIcon shape={s} />,
            }))}
          />
        </div>
      </div>
      {/* textboxAllowAboveMax: the spinbutton (typing and step buttons) accepts
          sizes beyond the slider's range; the transform clamps at MIN only. */}
      <NumericFieldRow
        id="bullet-size"
        label="Size"
        min={ROUTE_BULLET_SIZE_MIN}
        max={ROUTE_BULLET_SIZE_MAX}
        step={ROUTE_BULLET_SIZE_STEP}
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
    </PopoverShell>
  );
}
