import { useEffect, useRef, type MutableRefObject } from 'react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Cross2Icon, DragHandleDots2Icon, PlusIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { useCustomPalettes } from '../state/customPalettes';
import {
  customLineColors,
  FALLBACK_LINE_COLOR,
  type Palette,
  type PaletteSwatch,
} from '../model/palettes';
import { legibleTextOn, normalizeHex } from '../util/color';
import { ColorField } from './ColorField';
import { MenuItem, SubMenu } from './Menu';
import { useInlineRename } from './useInlineRename';
import { useSpeedBump } from './dialogRow';
import { rowShiftStyle, useRowDragReorder } from './useRowDragReorder';

/** The fixed row height the drag hook divides by — pinned in CSS. */
export const PALETTE_EDITOR_ROW_HEIGHT = 40;

export type PaletteSource = 'library' | 'map';

/**
 * A text that edits on double-click: the display element swaps for an input,
 * Enter/blur commits, Escape reverts. `inlineEditRef` mirrors "an edit is
 * open" synchronously for the dialog's Escape layering — Radix hears Escape
 * on a document listener, so a state flag would read one keypress late.
 */
function EditableText({
  tag: Tag,
  className,
  value,
  placeholder,
  ariaLabel,
  autoStart,
  inlineEditRef,
  onCommit,
}: {
  tag: 'h3' | 'div' | 'span';
  className: string;
  value: string;
  /** Shown faint when the value is empty — the double-click target. */
  placeholder?: string;
  ariaLabel: string;
  autoStart?: boolean;
  inlineEditRef: MutableRefObject<boolean>;
  onCommit: (draft: string) => void;
}) {
  const rename = useInlineRename(onCommit);
  // Hand-rolled double-click detection: the browser's dblclick drops the pair
  // when a re-render lands between the two presses (a blur elsewhere
  // committing on click one), so the pair is judged here — time and distance
  // in a ref that outlives renders.
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null);
  const start = () => {
    inlineEditRef.current = true;
    rename.start(value);
  };
  const onClickMaybeStart = (e: React.MouseEvent) => {
    const prev = lastClick.current;
    const now = performance.now();
    lastClick.current = { t: now, x: e.clientX, y: e.clientY };
    if (prev && now - prev.t < 500 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 8) {
      lastClick.current = null;
      start();
    }
  };
  // A fresh palette opens straight into naming itself.
  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);
  if (rename.editing) {
    return (
      <input
        className={className}
        aria-label={ariaLabel}
        {...rename.inputProps}
        onBlur={() => {
          // Both enders (Enter commits, Escape cancels) arrive here via blur.
          inlineEditRef.current = false;
          rename.inputProps.onBlur();
        }}
        onKeyDown={(e) => {
          // The dialog must not read the cancel as "close" (belt; the braces
          // are the inlineEditRef gate on its onEscapeKeyDown).
          if (e.key === 'Escape') e.stopPropagation();
          rename.inputProps.onKeyDown(e);
        }}
      />
    );
  }
  return (
    <Tag
      className={className + (value ? '' : ' placeholder')}
      title="Double-click to edit"
      onClick={onClickMaybeStart}
    >
      {value || placeholder}
    </Tag>
  );
}

/**
 * The palette editor: the manager's second view, reached from a row's pencil,
 * from New…, or from the custom colors row's `+`. Title and description edit
 * on double-click; below them, one row per color — drag handle, an index
 * bullet in the color itself, the color field, the name, a speed-bumped
 * delete — under an Add color row.
 *
 * Add color is a plain button while the map has no colors of its own, and a
 * menu once it does: New, or one of the map's CUSTOM COLORS — the same set the
 * manager's custom colors row collects. That second answer is the whole point:
 * a color picked by hand on the canvas is filed into a palette by pointing at
 * it, never by reading a hex off one window and typing it into another.
 *
 * Edits are LIVE against exactly one copy, named by `source`: a map palette
 * goes through the doc's upsert (each gesture one undo entry, the picker
 * repainting as you drag the hue), a library palette through the library's
 * (outside undo, like every library command — which is why delete keeps the
 * speed bump). The editor never touches the other copy; the manager's
 * transfer arrows stay the only crossing.
 *
 * Day == night, invisibly: recoloring writes the day color and drops any
 * stored night, so a palette authored here never carries the split the file
 * format reserves for the future.
 */
export function PaletteEditor({
  source,
  name,
  autoEditTitle,
  onBack,
  onRenamed,
  setError,
  inlineEditRef,
}: {
  source: PaletteSource;
  name: string;
  autoEditTitle?: boolean;
  onBack: () => void;
  onRenamed: (to: string) => void;
  setError: (text: string | null) => void;
  inlineEditRef: MutableRefObject<boolean>;
}) {
  const mapPalettes = useDoc((s) => s.palettes);
  const lines = useDoc((s) => s.lines);
  const addPaletteToMap = useDoc((s) => s.addPaletteToMap);
  const renameMapPalette = useDoc((s) => s.renameMapPalette);
  const recolorMapPaletteColor = useDoc((s) => s.recolorMapPaletteColor);
  const custom = useCustomPalettes((s) => s.palettes);
  const addToLibrary = useCustomPalettes((s) => s.addPalette);
  const renameInLibrary = useCustomPalettes((s) => s.renamePalette);
  const { speedBump, disarm } = useSpeedBump();

  const palette = (source === 'map' ? mapPalettes : custom).find((p) => p.name === name);
  const swatches = palette?.swatches ?? [];

  // The palette can vanish under the editor — the create undone, a file
  // loaded over the doc, a rename undone — so fall back to the manager
  // rather than editing a ghost.
  useEffect(() => {
    if (!palette) onBack();
  }, [palette, onBack]);

  /** Every content edit lands here: one upsert into this editor's ONE copy. */
  const write = (next: Palette) => {
    disarm(); // rows may have shifted under an armed delete
    if (source === 'map') addPaletteToMap(next);
    else addToLibrary(next);
  };
  const withSwatches = (next: PaletteSwatch[]) => palette && write({ ...palette, swatches: next });

  const reorder = (from: number, to: number) => {
    const next = swatches.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    withSwatches(next);
  };

  const { drag, handleProps } = useRowDragReorder({
    count: swatches.length,
    rowHeight: PALETTE_EDITOR_ROW_HEIGHT,
    onCommit: reorder,
  });

  if (!palette) return null;

  const commitTitle = (raw: string) => {
    const next = raw.trim();
    if (!next || next === name) return;
    if (source === 'map') {
      if (mapPalettes.some((p) => p.name === next)) {
        setError(`“${next}” is already one of this map’s palettes.`);
        return;
      }
      renameMapPalette(name, next);
    } else if (!renameInLibrary(name, next)) {
      setError(`“${next}” is already taken in your library.`);
      return;
    }
    onRenamed(next);
  };

  const commitDescription = (raw: string) => {
    const next = raw.trim();
    const { description: _drop, ...rest } = palette;
    write(next ? { ...rest, description: next } : rest);
  };

  const commitSwatchName = (i: number, raw: string) => {
    const next = raw.trim();
    if (!next || next === swatches[i].name) return;
    withSwatches(swatches.map((s, j) => (j === i ? { ...s, name: next } : s)));
  };

  // Day == night: the recolored swatch is rebuilt without its night color. A
  // MAP recolor goes through the transform that also repaints the lines
  // wearing the old color — that's what makes the map follow a picker drag
  // live. A library palette has no lines to take along.
  const recolor = (i: number, c: string) =>
    source === 'map'
      ? recolorMapPaletteColor(palette.name, i, c)
      : withSwatches(
          swatches.map((s, j) => (j === i ? { name: s.name, color: normalizeHex(c) } : s)),
        );

  const addColor = (color: string = FALLBACK_LINE_COLOR) =>
    withSwatches([...swatches, { name: String(swatches.length + 1), color: normalizeHex(color) }]);

  // The colors this MAP paints with that no palette of its own covers — the
  // same set the manager's custom colors row collects, offered here one at a
  // time. Always the map's, even while a LIBRARY palette is open: a library
  // palette is where you keep them, and keeping one covers nothing, so that
  // list simply doesn't shrink as you take from it.
  const customColors = customLineColors(
    Object.values(lines).map((l) => l.color),
    mapPalettes,
  );

  return (
    <div className="palette-editor">
      <div className="palette-editor-head">
        <EditableText
          tag="h3"
          className="palette-editor-title"
          value={palette.name}
          ariaLabel="Palette name"
          autoStart={autoEditTitle}
          inlineEditRef={inlineEditRef}
          onCommit={commitTitle}
        />
        {/* The description takes the line; Add color ends it. A command that
            sat across the whole list — as this one used to — anchors any menu
            it opens to a button as wide as the window, and a menu is never
            that wide: it opened stranded at the far edge of its own trigger. */}
        <div className="palette-editor-subhead">
          <EditableText
            tag="div"
            className="palette-editor-desc"
            value={palette.description ?? ''}
            placeholder="Double-click to add a description"
            ariaLabel="Palette description"
            inlineEditRef={inlineEditRef}
            onCommit={commitDescription}
          />
          {/* Nothing to choose between until the map has colors of its own, so
              the button adds on the click. Once it does, the same button opens
              a menu of the two answers — a fresh gray to work from, or one of
              the colors already on the map. */}
          {customColors.length === 0 ? (
            <button type="button" className="palette-editor-add" onClick={() => addColor()}>
              <PlusIcon aria-hidden="true" /> Add color
            </button>
          ) : (
            <Dropdown.Root modal={false}>
              <Dropdown.Trigger asChild>
                <button type="button" className="palette-editor-add">
                  <PlusIcon aria-hidden="true" /> Add color
                </button>
              </Dropdown.Trigger>
              {/* Non-portalled, like every menu in the app: inside `.app` for
                  the design tokens, and inside the dialog for its focus trap.
                  Aligned to the button's far edge, which is the window's — so
                  the panel opens back across the head rather than off it. */}
              <Dropdown.Content
                className="menu-panel"
                align="end"
                sideOffset={4}
                collisionPadding={8}
                loop
              >
                <MenuItem onClick={() => addColor()}>New</MenuItem>
                <SubMenu label="Custom color">
                  {/* The picker's own swatches, standing as menu items — a
                      custom color looks the same wherever it is offered. */}
                  <div className="menu-swatches">
                    {customColors.map((c) => {
                      const hex = normalizeHex(c);
                      return (
                        <Dropdown.Item
                          key={hex}
                          className="color-swatch menu-swatch"
                          aria-label={`Add ${hex}`}
                          title={hex}
                          style={{ background: c }}
                          onSelect={() => addColor(c)}
                        />
                      );
                    })}
                  </div>
                </SubMenu>
              </Dropdown.Content>
            </Dropdown.Root>
          )}
        </div>
      </div>
      <div className={'palette-editor-list' + (drag ? ' dragging' : '')}>
        {swatches.map((s, i) => (
          <div
            key={i}
            className={'palette-editor-row' + (drag?.from === i ? ' dragging' : '')}
            style={rowShiftStyle(drag, i, PALETTE_EDITOR_ROW_HEIGHT)}
          >
            <button
              type="button"
              className="palette-drag-handle"
              aria-label={`Reorder color ${i + 1}`}
              title="Drag to reorder"
              {...handleProps(i)}
            >
              <DragHandleDots2Icon />
            </button>
            <span
              className="palette-bullet"
              aria-hidden="true"
              style={{ background: s.color, color: legibleTextOn(s.color) }}
            >
              {i + 1}
            </span>
            <ColorField
              value={s.color}
              onChange={(c) => recolor(i, c)}
              ariaLabel={`Color ${i + 1}`}
              title="Edit color"
            />
            <EditableText
              tag="span"
              className="palette-color-name"
              value={s.name}
              placeholder="unnamed"
              ariaLabel={`Rename color ${i + 1}`}
              inlineEditRef={inlineEditRef}
              onCommit={(raw) => commitSwatchName(i, raw)}
            />
            {speedBump(
              `sw:${i}`,
              `Delete color ${i + 1}`,
              `Confirm deleting color ${i + 1}`,
              'Will delete this color from the palette',
              <Cross2Icon />,
              () => withSwatches(swatches.filter((_, j) => j !== i)),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
