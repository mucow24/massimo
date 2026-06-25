import type { SvgImage } from '../model/types';
import { useThemeColors } from '../state/theme';
import { useViewportStore } from '../state/viewportStore';
import { itemCursor } from './canvas/itemCursor';

// Handle half-size and rotation-knob geometry, authored in world units at zoom
// 1. The overlay divides every adornment dimension (and stroke) by zoom so they
// stay a CONSTANT size on screen at any zoom — mirroring PolygonView's handles.
const HANDLE_HALF = 5;
const ROTATE_KNOB_DIST = 24;
const ROTATE_KNOB_R = 6;

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
}: Props) {
  const themeColors = useThemeColors();
  const zoom = useViewportStore((s) => s.zoom);
  const hw = image.width / 2;
  const hh = image.height / 2;
  const transform = `translate(${image.x} ${image.y}) rotate(${image.rotation})`;

  if (layer === 'body') {
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
          // Generic lock marker shared with polygons/stations: the rect-select
          // gate keys off [data-locked] so a drag starting on a locked image
          // begins a marquee instead of doing nothing.
          data-locked={image.locked || undefined}
          // Ignore pointer events while a placement tool is active so the click
          // reaches the canvas and places the new item over the image.
          pointerEvents={interactive ? undefined : 'none'}
          onPointerDown={(e) => onPointerDown(image.id, e)}
          onClick={(e) => onClick(image.id, e)}
          onContextMenu={(e) => onContextMenu(image.id, e)}
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
  // Inverse-zoom scale so adornments render at a constant screen size; the box
  // extents (±hw/±hh) track the real image size and do NOT scale.
  const s = 1 / zoom;
  const half = HANDLE_HALF * s;
  const knobDist = ROTATE_KNOB_DIST * s;
  const knobR = ROTATE_KNOB_R * s;
  const accent = themeColors.selectionStroke;
  const contrast = themeColors.canvasBg;
  const corners = [
    { name: 'nw', index: 0, x: -hw, y: -hh, cursor: 'nwse-resize' },
    { name: 'ne', index: 1, x: hw, y: -hh, cursor: 'nesw-resize' },
    { name: 'se', index: 2, x: hw, y: hh, cursor: 'nwse-resize' },
    { name: 'sw', index: 3, x: -hw, y: hh, cursor: 'nesw-resize' },
  ];
  const edges = [
    { name: 'n', index: 0, x: 0, y: -hh, cursor: 'ns-resize' },
    { name: 'e', index: 1, x: hw, y: 0, cursor: 'ew-resize' },
    { name: 's', index: 2, x: 0, y: hh, cursor: 'ns-resize' },
    { name: 'w', index: 3, x: -hw, y: 0, cursor: 'ew-resize' },
  ];
  return (
    <g data-svg-image-overlay={image.id} transform={transform}>
      <rect
        data-svg-image-box=""
        x={-hw}
        y={-hh}
        width={image.width}
        height={image.height}
        fill="none"
        stroke={accent}
        strokeWidth={1.5 * s}
        strokeDasharray={`${4 * s} ${3 * s}`}
        pointerEvents="none"
      />
      {/* A locked image shows only the selection box — no transform handles —
          but stays selected so the popover's unlock toggle is reachable. */}
      {!image.locked && (
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
            style={{ cursor: 'grab' }}
          />
          {edges.map((ed) => (
            <rect
              key={ed.name}
              data-svg-image-handle={ed.name}
              x={ed.x - half}
              y={ed.y - half}
              width={half * 2}
              height={half * 2}
              fill={contrast}
              stroke={accent}
              strokeWidth={1.5 * s}
              onPointerDown={(e) => onEdgePointerDown(image.id, ed.index, e)}
              style={{ cursor: ed.cursor }}
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
              style={{ cursor: c.cursor }}
            />
          ))}
        </>
      )}
    </g>
  );
}
