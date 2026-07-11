import type { Vec2 } from '../../geometry/vec';
import type { TextLabel, TextLabelStyleProps } from '../../model/types';
import { TEXT_LABEL_DEFAULTS } from '../../model/transforms';
import { LabelView } from '../LabelView';

const PREVIEW_ID = '__placing_label_preview__';

// `style` = the doc's "Default" label style, when one exists — the dropped
// label will be stamped with it, so the ghost wears it too.
export function makePreviewTextLabel(world: Vec2, style?: TextLabelStyleProps): TextLabel {
  return { id: PREVIEW_ID, x: world.x, y: world.y, ...TEXT_LABEL_DEFAULTS, ...style };
}

interface Props {
  world: Vec2 | null;
  style?: TextLabelStyleProps;
}

// Ghost label that follows the cursor while in place-label mode. LabelView is
// doc-agnostic — it reads only label.* — so a synthetic label that doesn't
// exist in `textLabels` renders fine.
export function LabelPlacingPreview({ world, style }: Props) {
  if (!world) return null;
  const label = makePreviewTextLabel(world, style);
  return (
    <g pointerEvents="none" opacity={0.5} data-text-label-preview="">
      <LabelView label={label} selected={false} layer="bg" />
    </g>
  );
}
