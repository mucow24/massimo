import type { Vec2 } from '../../geometry/vec';

interface Props {
  world: Vec2 | null;
  image: { href: string; width: number; height: number } | null;
}

// Ghost of the imported svg image that follows the cursor while in placing-svg
// mode, centered under the cursor at its intrinsic size, so the user sees where
// and how big it will drop. Mirrors the polygon/label placing ghosts:
// semitransparent and pointer-transparent.
export function SvgImagePlacingPreview({ world, image }: Props) {
  if (!world || !image) return null;
  return (
    <g pointerEvents="none" opacity={0.5} data-svg-image-preview="">
      <image
        href={image.href}
        x={world.x - image.width / 2}
        y={world.y - image.height / 2}
        width={image.width}
        height={image.height}
        preserveAspectRatio="none"
      />
    </g>
  );
}
