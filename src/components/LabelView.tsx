import { useMemo } from 'react';
import type { Line, RouteBulletShape, TextLabel } from '../model/types';
import { measureAdvance, measureTextLabel, type MeasuredBBox } from '../geometry/textMeasure';
import { justifyLine, type JustifyAtom } from '../geometry/labelJustify';
import { resolveRunFontSize, resolveRunWeight, type SegmentStyle } from '../geometry/labelTokens';
import { TEXT_LABEL_HIT_PAD } from '../geometry/stationBoundary';
import { FONT_STACK } from '../util/fonts';
import { useDoc } from '../state/store';
import { useThemeColors } from '../state/theme';
import { resolveTextLabelColor } from '../model/transforms';
import { InlineBullet } from './InlineBullet';
import { itemCursor } from './canvas/itemCursor';
import { SELECTION_DASH, selectionOutlineTones } from './selectionStyle';

export type LabelLayer = 'bg' | 'stroke' | 'hit';

interface Props {
  label: TextLabel;
  selected: boolean;
  // Selection stroke is rendered in a second pass over the same labels so the
  // dashed ring sits above the network. The `bg` layer paints the visible text
  // plus an invisible hit rect (click + drag + contextmenu target). The
  // `stroke` layer paints only the dashed selection ring.
  layer?: LabelLayer;
  // Interaction handlers. All three default to no-op so the placement-preview
  // ghost can render the same component without wiring anything up.
  onPointerDown?: (id: string, e: React.PointerEvent) => void;
  onClick?: (id: string, e: React.MouseEvent) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  // Canvas mouseover → preview this label's selection ring at 50% (see
  // MapCanvas). Only the bg layer wires them; the id lets leave no-op when the
  // hover already moved on. Optional so the stroke/hit/preview uses skip them.
  onHoverEnter?: (id: string) => void;
  onHoverLeave?: (id: string) => void;
  // Marks a `stroke` layer as a 50%-opacity mouseover preview: swaps to
  // `data-text-label-stroke-preview` so `data-text-label-stroke` stays a pure
  // "this label is selected" marker.
  preview?: boolean;
  // Hand mode → grab cursor (pannable). Defaults false for non-canvas uses.
  inHandMode?: boolean;
}

// Per-line start cursor (pen origin) X. Lines align by their PEN advance, not by
// raw ink, so they flush on the font's designed side bearings and read even.
// Aligning by ink instead pins each line's leftmost/rightmost ink *pixel* to the
// bbox edge, which shoves round/hooked initials (o, c, w, f, v, s…) visibly
// inward — the ragged, letter-shape-dependent edge this replaced. The tiny ink
// overhang past the pen box is a side bearing (< a couple px) and sits inside
// the selection padding (TEXT_LABEL_HIT_PAD).
function lineCursorX(align: TextLabel['align'], halfWidth: number, advanceWidth: number): number {
  if (align === 'right') return halfWidth - advanceWidth;
  if (align === 'center') return -advanceWidth / 2;
  // left (and justify's ragged last line)
  return -halfWidth;
}

export function LabelView({
  label,
  selected,
  layer = 'bg',
  onPointerDown,
  onClick,
  onContextMenu,
  onHoverEnter,
  onHoverLeave,
  preview = false,
  inHandMode = false,
}: Props) {
  const docLines = useDoc((s) => s.lines);
  const darkMode = useDoc((s) => s.darkMode);
  // Two-tone selection ring flips with the theme (WBW on light, BWB on dark).
  const themeColors = useThemeColors();
  // Per-label day/night color (defaults match the old theme-driven colors).
  const labelColor = resolveTextLabelColor(label, darkMode);
  const lineByService = useMemo(() => {
    const map = new Map<string, Line>();
    for (const ln of Object.values(docLines)) map.set(ln.service, ln);
    return map;
  }, [docLines]);

  const m: MeasuredBBox = measureTextLabel(label);
  const angle = label.rotation * 45;
  const halfW = m.width / 2;
  const halfH = m.height / 2;
  const letterSpacingPx = (label.tracking ?? 0) * label.fontSize;

  if (layer === 'stroke') {
    if (!selected) return null;
    return (
      <g
        transform={`translate(${label.x} ${label.y}) rotate(${angle})`}
        pointerEvents="none"
        data-text-label-stroke={preview ? undefined : label.id}
        data-text-label-stroke-preview={preview ? label.id : undefined}
      >
        {/* Two-tone ring: black core over white underlay, screen-constant via
            vector-effect (no zoom subscription → no snap on commit). The pad
            (TEXT_LABEL_HIT_PAD) is world units, so the gap scales with the map. */}
        {selectionOutlineTones(themeColors).map(({ tone, stroke, strokeWidth }) => (
          <rect
            key={tone}
            x={-halfW - TEXT_LABEL_HIT_PAD}
            y={-halfH - TEXT_LABEL_HIT_PAD}
            width={m.width + 2 * TEXT_LABEL_HIT_PAD}
            height={m.height + 2 * TEXT_LABEL_HIT_PAD}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={SELECTION_DASH}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    );
  }

  if (layer === 'hit') {
    // Transparent, top-z drag proxy for a SELECTED label: re-asserts the label's
    // bbox hit footprint above all map content so the selected label wins
    // pointer hit-testing over anything stacked above it. Routes to the same
    // move/click handlers. Skipped while locked (not draggable). Uses
    // data-text-label-hit (never data-text-label-id).
    if (!selected || label.locked) return null;
    return (
      <g
        transform={`translate(${label.x} ${label.y}) rotate(${angle})`}
        data-text-label-hit={label.id}
        onPointerDown={onPointerDown ? (e) => onPointerDown(label.id, e) : undefined}
        onClick={onClick ? (e) => onClick(label.id, e) : undefined}
        onContextMenu={onContextMenu ? (e) => onContextMenu(label.id, e) : undefined}
        style={{ cursor: itemCursor(inHandMode, label.locked) }}
      >
        <rect
          x={-halfW - TEXT_LABEL_HIT_PAD}
          y={-halfH - TEXT_LABEL_HIT_PAD}
          width={m.width + 2 * TEXT_LABEL_HIT_PAD}
          height={m.height + 2 * TEXT_LABEL_HIT_PAD}
          fill="transparent"
        />
      </g>
    );
  }

  const interactive = !!(onPointerDown || onClick || onContextMenu);

  return (
    <g
      transform={`translate(${label.x} ${label.y}) rotate(${angle})`}
      data-text-label-id={label.id}
      data-text-label-selected={selected || undefined}
      // Generic lock marker (shared with stations + polygons): the rect-select
      // gate keys off [data-locked] so a drag over a locked label begins a
      // marquee instead of doing nothing.
      data-locked={label.locked || undefined}
      // Locked + unselected → click-through: lock means "this is background —
      // stop catching my clicks", so clicks land on whatever is beneath the
      // padded hit rect. Selection keeps a locked label clickable so the
      // popover's unlock toggle stays reachable.
      pointerEvents={label.locked && !selected ? 'none' : undefined}
      onPointerDown={onPointerDown ? (e) => onPointerDown(label.id, e) : undefined}
      onClick={onClick ? (e) => onClick(label.id, e) : undefined}
      onContextMenu={onContextMenu ? (e) => onContextMenu(label.id, e) : undefined}
      onPointerEnter={onHoverEnter ? () => onHoverEnter(label.id) : undefined}
      onPointerLeave={onHoverLeave ? () => onHoverLeave(label.id) : undefined}
      style={interactive ? { cursor: itemCursor(inHandMode, label.locked) } : undefined}
    >
      {/* Invisible hit rect covering the measured bbox + padding. Catches
          clicks, drags, and right-clicks anywhere inside the label's visual
          footprint — not just the glyphs. */}
      {interactive && (
        <rect
          x={-halfW - TEXT_LABEL_HIT_PAD}
          y={-halfH - TEXT_LABEL_HIT_PAD}
          width={m.width + 2 * TEXT_LABEL_HIT_PAD}
          height={m.height + 2 * TEXT_LABEL_HIT_PAD}
          fill="transparent"
        />
      )}
      {m.lines.map((lm, i) => {
        if (lm.segments.length === 0) return null;
        // Every run on the line shares this baseline; the measurer placed it
        // cumulatively, so a bigger inline <size> already pushed the lines apart.
        const baselineY = -halfH + lm.baselineFromTop;

        // Per-run style resolution for the formatting tags: <w=…>/<b> resolve the
        // weight against the label's base, <i> ORs with the label's italic,
        // <size=…> resolves the run size against the base, <color=…> overrides the
        // day/night label color for that run only.
        const runWeight = (style?: SegmentStyle) => resolveRunWeight(label.weight, style);
        const runItalic = (style?: SegmentStyle) => label.italic || !!style?.italic;
        const runFontSize = (style?: SegmentStyle) => resolveRunFontSize(label.fontSize, style);
        const runFill = (style?: SegmentStyle) => style?.color ?? labelColor;
        const runAdvance = (s: string, style?: SegmentStyle) =>
          measureAdvance(
            s,
            runFontSize(style),
            runWeight(style),
            runItalic(style),
            letterSpacingPx,
          );

        const textNode = (
          x: number,
          value: string,
          key: string,
          fontSize: number,
          style?: SegmentStyle,
        ) => (
          <text
            key={key}
            x={x}
            // Every run sits ON the shared alphabetic baseline, so differently-
            // sized runs align with no per-size anchor back-off to get wrong.
            // (Was: a "hanging" anchor at baseline − BASELINE_FRACTION·size,
            // which Chrome resolved from platform font metrics — 0.71em, not
            // the 0.8 assumed here — so the paint drifted off the measured box.)
            y={baselineY}
            textAnchor="start"
            fontFamily={FONT_STACK}
            fontSize={fontSize}
            fontWeight={runWeight(style)}
            fontStyle={runItalic(style) ? 'italic' : 'normal'}
            letterSpacing={letterSpacingPx !== 0 ? letterSpacingPx : undefined}
            fill={runFill(style)}
            pointerEvents="none"
            style={{ userSelect: 'none', whiteSpace: 'pre' }}
          >
            {value}
          </text>
        );
        // <u>/<s> as explicit <line> geometry, matching the station-label
        // pattern: Chromium mishandles toggling the text-decoration SVG
        // attribute on rotated <text>, and svg2pdf ignores it outright.
        // Decoration geometry scales with the RUN's size (offsets + thickness),
        // so a bigger <size> run gets a proportionally placed, heavier rule.
        const decorationY = (kind: 'underline' | 'strike', fontSize: number) =>
          kind === 'underline' ? baselineY + fontSize * 0.1 : baselineY - fontSize * 0.28;
        const decorationLine = (
          kind: 'underline' | 'strike',
          x: number,
          width: number,
          key: string,
          fontSize: number,
          style: SegmentStyle,
        ) => (
          <line
            key={`${key}-${kind}`}
            data-text-decoration={kind}
            x1={x}
            x2={x + width}
            y1={decorationY(kind, fontSize)}
            y2={decorationY(kind, fontSize)}
            stroke={runFill(style)}
            strokeWidth={fontSize * 0.07}
          />
        );
        const decorationNodes = (
          x: number,
          width: number,
          key: string,
          fontSize: number,
          style?: SegmentStyle,
        ): React.ReactNode[] => {
          if (!style || (!style.underline && !style.strike) || width <= 0) return [];
          const out: React.ReactNode[] = [];
          if (style.underline)
            out.push(decorationLine('underline', x, width, key, fontSize, style));
          if (style.strike) out.push(decorationLine('strike', x, width, key, fontSize, style));
          return out;
        };
        // Justify splits each line into per-word atoms, so a single '<u>foo and
        // bar</u>' arrives as several word atoms — decorating each on its own
        // would draw a broken underline per word. Coalesce consecutive atoms
        // that come from the SAME formatting run (same style object) into one
        // line spanning the whole run, gaps included: every token a segment
        // emits shares one style reference, so '<u>a b</u>' bridges the space
        // while '<u>a</u> <u>b</u>' (two references) stays two underlines with
        // the bare gap between them.
        const justifyDecorationNodes = (
          atoms: JustifyAtom[],
          lineStartX: number,
        ): React.ReactNode[] => {
          const out: React.ReactNode[] = [];
          (['underline', 'strike'] as const).forEach((kind) => {
            let run: { x: number; end: number; style: SegmentStyle; key: number } | null = null;
            const flush = () => {
              if (run && run.end > run.x) {
                out.push(
                  decorationLine(
                    kind,
                    run.x,
                    run.end - run.x,
                    `${i}-${run.key}`,
                    runFontSize(run.style),
                    run.style,
                  ),
                );
              }
              run = null;
            };
            atoms.forEach((a, j) => {
              if (a.kind !== 'text' || !a.style?.[kind]) {
                flush();
                return;
              }
              const x = lineStartX + a.x;
              const end = x + runAdvance(a.value ?? '', a.style);
              if (run && run.style === a.style) {
                run.end = end;
              } else {
                flush();
                run = { x, end, style: a.style, key: j };
              }
            });
            flush();
          });
          return out;
        };
        const bulletNode = (
          x: number,
          b: { code: string; shape: RouteBulletShape; filled: boolean; diameter: number },
          key: string,
        ) => (
          <InlineBullet
            key={key}
            code={b.code}
            shape={b.shape}
            filled={b.filled}
            diameter={b.diameter}
            cx={x + b.diameter / 2}
            cy={baselineY - b.diameter / 2}
            lineByService={lineByService}
          />
        );

        // Full-justify interior lines of a justified label: spread the words to
        // both box edges. The ragged last line of each paragraph
        // (`endsParagraph`) and any line with no interior gap return null and
        // fall through to the normal path, where lineCursorX left-flushes
        // 'justify' via its default branch.
        const atoms =
          label.align === 'justify' && !lm.endsParagraph
            ? justifyLine(
                lm.raw,
                label.fontSize,
                letterSpacingPx,
                lm.alignAdvance,
                m.width,
                runAdvance,
                lm.entryStyle,
              )
            : null;

        const nodes: React.ReactNode[] = [];
        if (atoms) {
          const lineStartX = -halfW;
          nodes.push(...justifyDecorationNodes(atoms, lineStartX));
          atoms.forEach((a, j) => {
            const x = lineStartX + a.x;
            if (a.kind === 'text') {
              nodes.push(textNode(x, a.value ?? '', `${i}-${j}-t`, runFontSize(a.style), a.style));
            } else {
              nodes.push(
                bulletNode(
                  x,
                  {
                    code: a.code ?? '',
                    shape: a.shape ?? 'circle',
                    filled: a.filled ?? true,
                    diameter: a.diameter ?? 0,
                  },
                  `${i}-${j}-b`,
                ),
              );
            }
          });
        } else {
          let cursor = lineCursorX(label.align, halfW, lm.alignAdvance);
          lm.segments.forEach((seg, j) => {
            const segCursor = cursor;
            cursor += seg.advance;
            if (seg.kind === 'text') {
              nodes.push(textNode(segCursor, seg.value, `${i}-${j}-t`, seg.fontSize, seg.style));
              nodes.push(
                ...decorationNodes(segCursor, seg.advance, `${i}-${j}`, seg.fontSize, seg.style),
              );
            } else {
              nodes.push(bulletNode(segCursor, seg, `${i}-${j}-b`));
            }
          });
        }

        return (
          <g key={i} data-label-line={i}>
            {nodes}
          </g>
        );
      })}
    </g>
  );
}
