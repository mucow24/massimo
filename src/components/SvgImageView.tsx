import type { SvgImage } from '../model/types';
import { useThemeColors } from '../state/theme';
import { useLiveZoom } from '../state/viewportStore';
import { itemCursor } from './canvas/itemCursor';
import { SELECTION_DASH, selectionOutlineTones } from './selectionStyle';

// Handle half-size and rotation-knob geometry, authored in world units at zoom
// 1. The overlay divides every adornment dimension (and stroke) by zoom so they
// stay a CONSTANT size on screen at any zoom — mirroring PolygonView's handles.
const HANDLE_HALF = 5;
const ROTATE_KNOB_DIST = 24;
const ROTATE_KNOB_R = 6;

const RESIZE_CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'] as const;

/**
 * Resize cursor for a transform handle, rotated with the image. `octant` is
 * the handle's unrotated 45°-step direction (n=0, ne=1, e=2, se=3; opposite
 * handles share the value mod 4). The handle tables are in the image's LOCAL
 * frame, so on a quarter-turned image the local top edge sits on the screen's
 * left — a fixed ns-resize there points 90° wrong. Resize cursors repeat with
 * period 180°, so shifting the index by the rotation in 45° steps keeps the
 * arrow aligned with the handle's on-screen drag axis.
 */
export function resizeCursor(octant: number, rotationDeg: number): string {
  const shift = Math.round(rotationDeg / 45);
  return RESIZE_CURSORS[(((octant + shift) % 4) + 4) % 4];
}

interface Props {
  image: SvgImage;
  // 'body' is painted in the polygon band (under all map content); 'overlay'
  // (selected only) is painted on top so the handles stay clickable. 'hit'
  // (selected only) is a transparent top-z copy of the box — the selected-on-top
  // drag proxy — painted above all map content so the image wins pointer hits.
  layer: 'body' | 'overlay' | 'hit';
  selected: boolean;
  // When false, the image ignores pointer events so a canvas click falls
  // through to placement (used while a click-to-place tool is active).
  interactive: boolean;
  inHandMode?: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
  // Corner index 0=TL,1=TR,2=BR,3=BL (proportional scale).
  onCornerPointerDown: (id: string, cornerIndex: number, e: React.PointerEvent) => void;
  // Edge index 0=top,1=right,2=bottom,3=left (single-axis stretch).
  onEdgePointerDown: (id: string, edgeIndex: number, e: React.PointerEvent) => void;
  onRotatePointerDown: (id: string, e: React.PointerEvent) => void;
  // Canvas mouseover → preview this image's selection box at 50% (see
  // MapCanvas). Only the body layer wires them; the id lets leave no-op when
  // the hover already moved on. Optional so the proxy/hit uses skip them.
  onHoverEnter?: (id: string) => void;
  onHoverLeave?: (id: string) => void;
}

/**
 * The two-tone dashed box rects in the image's LOCAL (unrotated, centered)
 * frame — no transform of their own. Shared by the selection overlay and the
 * hovered-image preview so both draw the identical ring. `preview` swaps to
 * `data-svg-image-box-preview` so `data-svg-image-box` stays a pure "this image
 * is selected" marker.
 */
function SvgImageBoxRects({ image, preview = false }: { image: SvgImage; preview?: boolean }) {
  const themeColors = useThemeColors();
  const hw = image.width / 2;
  const hh = image.height / 2;
  return (
    <>
      {selectionOutlineTones(themeColors).map(({ tone, stroke, strokeWidth }) => (
        <rect
          key={tone}
          data-svg-image-box={preview ? undefined : ''}
          data-svg-image-box-preview={preview ? '' : undefined}
          x={-hw}
          y={-hh}
          width={image.width}
          height={image.height}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={SELECTION_DASH}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </>
  );
}

/**
 * The image's selection box, self-positioned in world coords — the chrome-only
 * half of the overlay, with none of the resize/rotate handles. A hovered
 * (unselected) image renders JUST this at 50% opacity, so the mouseover preview
 * shows the box alone, never the manipulators.
 */
export function SvgImageSelectionBox({ image }: { image: SvgImage }) {
  const transform = `translate(${image.x} ${image.y}) rotate(${image.rotation})`;
  return (
    <g transform={transform} pointerEvents="none">
      <SvgImageBoxRects image={image} preview />
    </g>
  );
}

export function SvgImageView({
  image,
  layer,
  selected,
  interactive,
  inHandMode = false,
  onPointerDown,
  onClick,
  onContextMenu,
  onCornerPointerDown,
  onEdgePointerDown,
  onRotatePointerDown,
  onHoverEnter,
  onHoverLeave,
}: Props) {
  const hw = image.width / 2;
  const hh = image.height / 2;
  const transform = `translate(${image.x} ${image.y}) rotate(${image.rotation})`;

  if (layer === 'body') {
    // Click-through cases: while a placement tool is active, clicks must reach
    // the canvas to place the new item over the image; while locked AND not
    // selected, lock means "this is background — stop catching my clicks".
    // Selection keeps a locked image clickable so the popover's unlock toggle
    // stays reachable.
    const clickThrough = !interactive || (image.locked && !selected);
    return (
      <g
        data-svg-image-id={image.id}
        data-svg-image-selected={selected || undefined}
        transform={transform}
      >
        <image
          href={image.href}
          x={-hw}
          y={-hh}
          width={image.width}
          height={image.height}
          // Fill the box exactly. The default "xMidYMid meet" would keep the
          // SVG's own aspect ratio and letterbox it, so an edge (single-axis)
          // resize would only shrink the box instead of stretching the image.
          preserveAspectRatio="none"
          // Absent ⇒ React omits the attribute, so an untouched image's
          // markup (and its export) is exactly as before the slider existed.
          // Only the artwork fades — the selection box, handles, and this
          // element's hit area are unaffected, so a 0% image stays clickable.
          opacity={image.opacity}
          // Generic lock marker shared with polygons/stations: the rect-select
          // gate keys off [data-locked] so a drag starting on a locked image
          // begins a marquee instead of doing nothing.
          data-locked={image.locked || undefined}
          pointerEvents={clickThrough ? 'none' : undefined}
          onPointerDown={(e) => onPointerDown(image.id, e)}
          onClick={(e) => onClick(image.id, e)}
          onContextMenu={(e) => onContextMenu(image.id, e)}
          onPointerEnter={onHoverEnter ? () => onHoverEnter(image.id) : undefined}
          onPointerLeave={onHoverLeave ? () => onHoverLeave(image.id) : undefined}
          style={{ cursor: itemCursor(inHandMode, image.locked) }}
        />
      </g>
    );
  }

  if (layer === 'hit') {
    // Transparent, top-z drag proxy for a SELECTED image: re-asserts the box's
    // grab footprint above all map content so the selected image wins pointer
    // hit-testing over anything stacked above it. Routes to the same move
    // handler; the transform handles render in the later 'overlay' pass, so
    // corner/edge/rotate still win over this body proxy. Skipped while locked or
    // non-interactive. Uses data-svg-image-hit (never data-svg-image-id).
    if (!selected || image.locked || !interactive) return null;
    return (
      <g data-svg-image-hit={image.id} transform={transform}>
        <rect
          x={-hw}
          y={-hh}
          width={image.width}
          height={image.height}
          fill="transparent"
          pointerEvents="all"
          onPointerDown={(e) => onPointerDown(image.id, e)}
          onClick={(e) => onClick(image.id, e)}
          onContextMenu={(e) => onContextMenu(image.id, e)}
          style={{ cursor: itemCursor(inHandMode, image.locked) }}
        />
      </g>
    );
  }

  if (!selected) return null;
  // The selection overlay lives in its own component so it — and only the
  // selected image — subscribes to the live gesture zoom (see below).
  return (
    <SvgImageSelectionOverlay
      image={image}
      onCornerPointerDown={onCornerPointerDown}
      onEdgePointerDown={onEdgePointerDown}
      onRotatePointerDown={onRotatePointerDown}
    />
  );
}

/**
 * The selected image's transform overlay: the two-tone selection box plus 8
 * resize handles and a rotate knob.
 *
 * Sizes every handle off the LIVE gesture zoom (useLiveZoom), not the committed
 * zoom, so the handles stay a constant screen size AND track a pan/zoom in
 * flight instead of snapping when it commits — the box gets the same
 * screen-constancy for free from vector-effect. Only the selected image mounts
 * this, so the per-frame re-render during a gesture is one item, not the whole
 * canvas. The box extents (±hw/±hh) track the real image size and never scale.
 */
function SvgImageSelectionOverlay({
  image,
  onCornerPointerDown,
  onEdgePointerDown,
  onRotatePointerDown,
}: Pick<Props, 'image' | 'onCornerPointerDown' | 'onEdgePointerDown' | 'onRotatePointerDown'>) {
  const themeColors = useThemeColors();
  const zoom = useLiveZoom();
  const hw = image.width / 2;
  const hh = image.height / 2;
  const transform = `translate(${image.x} ${image.y}) rotate(${image.rotation})`;
  const s = 1 / zoom;
  const half = HANDLE_HALF * s;
  const knobDist = ROTATE_KNOB_DIST * s;
  const knobR = ROTATE_KNOB_R * s;
  const accent = themeColors.selectionStroke;
  const contrast = themeColors.canvasBg;
  const corners = [
    { name: 'nw', index: 0, x: -hw, y: -hh, octant: 3 },
    { name: 'ne', index: 1, x: hw, y: -hh, octant: 1 },
    { name: 'se', index: 2, x: hw, y: hh, octant: 3 },
    { name: 'sw', index: 3, x: -hw, y: hh, octant: 1 },
  ];
  const edges = [
    { name: 'n', index: 0, x: 0, y: -hh, octant: 0 },
    { name: 'e', index: 1, x: hw, y: 0, octant: 2 },
    { name: 's', index: 2, x: 0, y: hh, octant: 0 },
    { name: 'w', index: 3, x: -hw, y: 0, octant: 2 },
  ];
  return (
    <g data-svg-image-overlay={image.id} transform={transform}>
      {/* Two-tone selection box (chrome only — no handles). Shared with the
          hovered-image preview, which renders JUST this at 50% opacity. */}
      <SvgImageBoxRects image={image} />
      {/* Transform handles + rotate knob. On a LOCKED image they render
          GHOSTED — still visible, so a re-selected locked image reads as
          selected (the thin box alone is easy to miss) — but inert:
          reduced opacity, no pointer events, no cursors. */}
      <g
        data-svg-image-adornments={image.locked ? 'inactive' : 'active'}
        opacity={image.locked ? 0.4 : undefined}
        pointerEvents={image.locked ? 'none' : undefined}
      >
        <>
          <line
            x1={0}
            y1={-hh}
            x2={0}
            y2={-hh - knobDist}
            stroke={accent}
            strokeWidth={1.5 * s}
            pointerEvents="none"
          />
          <circle
            data-svg-image-handle="rotate"
            cx={0}
            cy={-hh - knobDist}
            r={knobR}
            fill={contrast}
            stroke={accent}
            strokeWidth={1.5 * s}
            onPointerDown={(e) => onRotatePointerDown(image.id, e)}
            // NOT 'grab' — that's the pan-hand cursor, which advertises the
            // wrong gesture. CSS has no rotate cursor; crosshair reads as
            // "precise manipulation" without lying.
            style={{ cursor: 'crosshair' }}
          />
          {/* Edge handles are CIRCLES: they stretch one axis (distorting the
              artwork via preserveAspectRatio="none"), while the square
              corners scale proportionally — different behavior, different
              shape. */}
          {edges.map((ed) => (
            <circle
              key={ed.name}
              data-svg-image-handle={ed.name}
              cx={ed.x}
              cy={ed.y}
              r={half}
              fill={contrast}
              stroke={accent}
              strokeWidth={1.5 * s}
              onPointerDown={(e) => onEdgePointerDown(image.id, ed.index, e)}
              style={{ cursor: resizeCursor(ed.octant, image.rotation) }}
            />
          ))}
          {corners.map((c) => (
            <rect
              key={c.name}
              data-svg-image-handle={c.name}
              x={c.x - half}
              y={c.y - half}
              width={half * 2}
              height={half * 2}
              fill={contrast}
              stroke={accent}
              strokeWidth={1.5 * s}
              onPointerDown={(e) => onCornerPointerDown(image.id, c.index, e)}
              style={{ cursor: resizeCursor(c.octant, image.rotation) }}
            />
          ))}
        </>
      </g>
    </g>
  );
}
