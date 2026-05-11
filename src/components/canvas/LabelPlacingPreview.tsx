import type { Vec2 } from '../../geometry/vec';
import type { TextLabel } from '../../model/types';
import { TEXT_LABEL_DEFAULTS } from '../../model/transforms';
import { LabelView } from '../LabelView';

const PREVIEW_ID = '__placing_label_preview__';

export function makePreviewTextLabel(world: Vec2): TextLabel {
  return { id: PREVIEW_ID, x: world.x, y: world.y, ...TEXT_LABEL_DEFAULTS };
}

interface Props {
  world: Vec2 | null;
}

// Ghost label that follows the cursor while in place-label mode. LabelView is
// doc-agnostic — it reads only label.* — so a synthetic label that doesn't
// exist in `textLabels` renders fine.
export function LabelPlacingPreview({ world }: Props) {
  if (!world) return null;
  const label = makePreviewTextLabel(world);
  return (
    <g pointerEvents="none" opacity={0.5} data-text-label-preview="">
      <LabelView label={label} selected={false} layer="bg" />
    </g>
  );
}
