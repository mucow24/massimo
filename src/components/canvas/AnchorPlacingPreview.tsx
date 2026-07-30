import type { Vec2 } from '../../geometry/vec';
import { AnchorLayer } from './AnchorLayer';

const noop = () => {};

/**
 * Ghost of the transfer anchor that follows the cursor in placing-anchor mode.
 * Mirrors the station / bullet / label / polygon ghosts: semitransparent and
 * pointer-transparent.
 *
 * Drawn through AnchorLayer itself rather than a hand-rolled copy, so the ghost
 * is literally the thing the click will create — a second drawing of the same
 * mark is exactly how a preview drifts from its drop.
 */
export function AnchorPlacingPreview({ world }: { world: Vec2 | null }) {
  if (!world) return null;
  return (
    <g pointerEvents="none" opacity={0.5} data-anchor-preview="">
      <AnchorLayer
        transferAnchors={{ __preview: { id: '__preview', x: world.x, y: world.y } }}
        stations={{}}
        lineCircles={{}}
        selectedIds={[]}
        hoveredKey={null}
        onHover={noop}
        freeLive={false}
        picking={false}
        dimHostedExcept={null}
        onPointerDown={noop}
        onClick={noop}
      />
    </g>
  );
}
