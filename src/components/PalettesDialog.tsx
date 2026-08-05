import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Select from '@radix-ui/react-select';
import * as Toggle from '@radix-ui/react-toggle';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  Cross2Icon,
  DownloadIcon,
  DragHandleDots2Icon,
  Pencil1Icon,
  StarIcon,
  StarFilledIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { useCustomPalettes } from '../state/customPalettes';
import { parseCustomPalette, serializeCustomPalette } from '../model/customPalette';
import {
  BUILTIN_PALETTE_NAMES,
  customLineColors,
  freshPaletteName,
  libraryPalettes,
  PALETTES,
  type Palette,
  type PaletteSort,
} from '../model/palettes';
import { normalizeHex } from '../util/color';
import { redo, undo } from '../state/history';
import { pointerLost } from './canvas/dragGesture';
import { downloadBlob, sanitizeBasename } from '../export/exportCanvas';
import { IconButton, useSpeedBump } from './dialogRow';
import { rowShiftStyle, useRowDragReorder } from './useRowDragReorder';
import { PaletteEditor, type PaletteSource } from './PaletteEditor';

/** The map column's fixed row height — the drag hook divides by it (CSS pins it). */
export const PALETTE_ROW_HEIGHT = 44;

const SORT_LABELS: { value: PaletteSort; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'starred', label: 'Starred' },
];

const isPaletteSort = (v: string): v is PaletteSort => v === 'name' || v === 'starred';

const samePaletteContent = (a: Palette, b: Palette): boolean =>
  a.description === b.description &&
  a.swatches.length === b.swatches.length &&
  a.swatches.every(
    (s, i) =>
      s.name === b.swatches[i].name &&
      s.color === b.swatches[i].color &&
      s.night === b.swatches[i].night,
  );

/** A palette's colors as a strip — how you recognise one without reading it. */
function Strip({ palette }: { palette: Palette }) {
  return (
    <div className="palette-strip" aria-hidden="true">
      {palette.swatches.map((s, i) => (
        <span key={i} style={{ background: s.color }} />
      ))}
    </div>
  );
}

/** A slot this row has no command for — held open so the columns stay aligned. */
const Blank = () => <span className="palette-action-blank" aria-hidden="true" />;

/** A star as it appears in the map library: state first, command on approach. */
function StarToggle({
  name,
  starred,
  onToggle,
}: {
  name: string;
  starred: boolean;
  onToggle: () => void;
}) {
  return (
    <Toggle.Root
      className={'star-btn' + (starred ? ' starred' : '')}
      pressed={starred}
      onPressedChange={onToggle}
      aria-label={`${starred ? 'Unstar' : 'Star'} ${name}`}
      title={
        starred
          ? 'Starred — kept by the Starred sort'
          : 'Star this palette: the Starred sort keeps it'
      }
    >
      {starred ? <StarFilledIcon /> : <StarIcon />}
    </Toggle.Root>
  );
}

/**
 * The palette manager: your library on the left, the palettes this map paints
 * with on the right. Reached from the toolbar's Manage palettes button, and the
 * only place palettes are created, imported, edited, starred or thrown away —
 * a row's pencil (and the New… menu) swaps this window for the PaletteEditor
 * view, where renaming lives too.
 *
 * The two columns are independent lists, not a master and its detail — nothing
 * here is "selected", so every command lives in the row it acts on.
 *
 * Adding a palette to the map COPIES it, which is what makes the two columns
 * genuinely separate: deleting from the library never disturbs a map, and
 * renaming a map's copy never touches the library's.
 *
 * Both destinations are keyed by NAME, so anything landing on a name already
 * there REPLACES it. Every command that destroys or displaces a palette — in
 * either column, whether or not undo could reach it — takes the map library's
 * in-place speed bump: the same glyph washed red, its tooltip naming what the
 * second click will cost. One gesture for the whole window; a Delete that
 * needed a confirmation beside a Remove that didn't taught the wrong thing
 * about both. Only the commands that displace nothing go on a single click.
 */
export function PalettesDialog({ onClose }: { onClose: () => void }) {
  const mapPalettes = useDoc((s) => s.palettes);
  const lines = useDoc((s) => s.lines);
  const addPaletteToMap = useDoc((s) => s.addPaletteToMap);
  const removePaletteFromMap = useDoc((s) => s.removePaletteFromMap);
  const reorderMapPalette = useDoc((s) => s.reorderMapPalette);

  const custom = useCustomPalettes((s) => s.palettes);
  const starred = useCustomPalettes((s) => s.starred);
  const sort = useCustomPalettes((s) => s.sort);
  const setSort = useCustomPalettes((s) => s.setSort);
  const setStarred = useCustomPalettes((s) => s.setStarred);
  const addToLibrary = useCustomPalettes((s) => s.addPalette);
  const removeFromLibrary = useCustomPalettes((s) => s.removePalette);

  // One message line, but a load that displaced something is NOT a failure and
  // must not wear the red band a rejected file does.
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'notice' } | null>(null);
  const setError = (text: string | null) =>
    setMessage(text === null ? null : { text, tone: 'error' });
  const setNotice = (text: string) => setMessage({ text, tone: 'notice' });
  const { speedBump } = useSpeedBump();
  // Which palette the editor view is open on, or null for the two columns.
  // `fresh` marks a just-created palette, whose title opens already editing.
  const [editing, setEditing] = useState<{
    source: PaletteSource;
    name: string;
    fresh?: boolean;
  } | null>(null);
  // True while any double-click edit (title, description, a color name) is
  // open — Radix hears Escape on a document listener, so the gate has to be a
  // ref the editor flips synchronously, not state.
  const inlineEditRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Drag the window by its title band. The offset applies as position:relative
  // left/top, NOT a transform — a transform would become the containing block
  // for the ColorField popover's position:fixed and strand it mid-window.
  const [windowOffset, setWindowOffset] = useState({ x: 0, y: 0 });
  const windowDrag = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const headerDragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      // Primary button only (the house drag rule), and the band's buttons
      // (back, close) stay buttons.
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      windowDrag.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: windowOffset.x,
        baseY: windowOffset.y,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer may not be capturable
      }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = windowDrag.current;
      if (!d) return;
      if (pointerLost(e)) {
        windowDrag.current = null;
        return;
      }
      setWindowOffset({ x: d.baseX + e.clientX - d.startX, y: d.baseY + e.clientY - d.startY });
    },
    onPointerUp: () => {
      windowDrag.current = null;
    },
    onPointerCancel: () => {
      windowDrag.current = null;
    },
  };

  const rows = libraryPalettes(custom, starred, sort);
  const inMap = new Map(mapPalettes.map((p) => [p.name, p]));
  const inLibrary = new Map(custom.map((p) => [p.name, p]));

  // The map column reorders by dragging a row's handle — the editor's gesture,
  // one doc write at the drop.
  const mapDrag = useRowDragReorder({
    count: mapPalettes.length,
    rowHeight: PALETTE_ROW_HEIGHT,
    onCommit: reorderMapPalette,
  });

  const onLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    const result = parseCustomPalette(await f.text());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const palette: Palette = {
      name: result.name,
      swatches: result.swatches,
      ...(result.description !== undefined && { description: result.description }),
    };
    // A load is the one place a name collision can't be shown before the fact —
    // the name arrives with the file, and it lands in BOTH destinations. So it
    // reports afterwards, naming every palette it displaced.
    const held = inMap.get(palette.name);
    const replacedMap = held !== undefined && !samePaletteContent(held, palette);
    const replacedLibrary = inLibrary.has(palette.name);
    if (!addToLibrary(palette)) {
      setError(`“${palette.name}” is a built-in palette’s name. Rename it in the file and retry.`);
      return;
    }
    addPaletteToMap(palette);
    const displaced = [
      replacedLibrary && 'the one in your library',
      replacedMap && 'the one in this map',
    ].filter(Boolean);
    setNotice(
      displaced.length
        ? `Loaded “${palette.name}”, replacing ${displaced.join(' and ')}.`
        : `Loaded “${palette.name}” into your library and this map.`,
    );
  };

  const onExport = (palette: Palette) => {
    const blob = new Blob([serializeCustomPalette(palette)], { type: 'application/json' });
    // Palette names arrive from imported files, so they reach the filename with
    // whatever the author put in them — through the same sanitizer every other
    // export uses.
    downloadBlob(blob, `${sanitizeBasename(palette.name) || 'palette'}.palette.json`);
  };

  /** Save a map palette back to the library, overwriting by name. */
  const onSaveToLibrary = (palette: Palette) => {
    if (!addToLibrary(palette)) {
      setError(`“${palette.name}” is a built-in palette’s name, so the library keeps its own.`);
      return;
    }
    setError(null);
  };

  const onDeleteFromLibrary = (name: string) => {
    removeFromLibrary(name);
  };

  /** Open the editor view on one palette, leaving any stale message behind. */
  const openEditor = (source: PaletteSource, name: string, fresh?: boolean) => {
    setMessage(null);
    setEditing({ source, name, fresh });
  };

  // The map's custom colors — line colors no palette covers — are what the
  // "From map's custom colors…" seed absorbs into a palette of their own.
  const customColors = customLineColors(
    Object.values(lines).map((l) => l.color),
    mapPalettes,
  );

  /**
   * Mint a palette and open the editor on it. Like Load…, it lands in BOTH
   * destinations; the editor then edits the MAP copy (undoable, and the
   * picker follows along), so the library keeps the creation-time seed until
   * it's saved back with the arrow.
   */
  const createNew = (colors: readonly string[]) => {
    const taken = new Set<string>([
      ...BUILTIN_PALETTE_NAMES,
      ...custom.map((p) => p.name),
      ...mapPalettes.map((p) => p.name),
    ]);
    const palette: Palette = {
      name: freshPaletteName(taken),
      swatches: colors.map((c, i) => ({ name: String(i + 1), color: normalizeHex(c) })),
    };
    addToLibrary(palette);
    addPaletteToMap(palette);
    openEditor('map', palette.name, true);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* `.app` is absent in standalone component tests; Radix then portals to
          document.body, exactly as the map library does. */}
      <Dialog.Portal container={document.querySelector<HTMLElement>('.app') ?? undefined}>
        <Dialog.Overlay className="dialog-backdrop">
          <Dialog.Content
            className={'dialog palette-manager' + (editing ? ' palette-editing' : '')}
            aria-describedby={undefined}
            style={{ position: 'relative', left: windowOffset.x, top: windowOffset.y }}
            onKeyDown={(e) => {
              // The app's global shortcut handler reads anything inside a
              // role=dialog as a form context, so the dialog owns its own undo
              // keys — same contract as App's: blur first so an open field
              // group commits, and leave text inputs their native Ctrl+Z.
              if (!(e.ctrlKey || e.metaKey)) return;
              const tag = (e.target as HTMLElement | null)?.tagName;
              if (tag === 'INPUT' || tag === 'TEXTAREA') return;
              if (e.key === 'z' || e.key === 'Z') {
                e.preventDefault();
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                if (e.shiftKey) redo();
                else undo();
              } else if (e.key === 'y' || e.key === 'Y') {
                e.preventDefault();
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                redo();
              }
            }}
            onEscapeKeyDown={(e) => {
              // Escape peels one layer at a time: an open double-click edit
              // (which cancels itself), then the editor view, then the dialog.
              if (inlineEditRef.current) {
                e.preventDefault();
              } else if (editing) {
                e.preventDefault();
                setEditing(null);
              }
            }}
          >
            <header {...headerDragProps}>
              <div className="dialog-head-left">
                {editing && (
                  <button
                    type="button"
                    className="dialog-close dialog-back"
                    aria-label="Back to palettes"
                    onClick={() => setEditing(null)}
                  >
                    <ArrowLeftIcon />
                  </button>
                )}
                <Dialog.Title asChild>
                  <h2>{editing ? 'Palette Editor' : 'Palettes'}</h2>
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="dialog-close" aria-label="Close palettes">
                  <Cross2Icon />
                </button>
              </Dialog.Close>
            </header>

            {message && (
              <div
                role={message.tone === 'error' ? 'alert' : 'status'}
                className={message.tone === 'error' ? 'dialog-error' : 'dialog-notice'}
              >
                {message.text}
              </div>
            )}

            {editing ? (
              <PaletteEditor
                source={editing.source}
                name={editing.name}
                autoEditTitle={editing.fresh}
                onBack={() => {
                  setMessage(null);
                  setEditing(null);
                }}
                onRenamed={(to) => setEditing({ source: editing.source, name: to })}
                setError={setError}
                inlineEditRef={inlineEditRef}
              />
            ) : (
              <div className="dialog-columns">
                <section className="palette-library" aria-label="Palette library">
                  <div className="dialog-colhead">
                    <h3>Library</h3>
                    <div className="dialog-colhead-controls">
                      {/* Not the toolbar Menu wrapper: its trigger is the
                        underlined toolbar label, and this one is a colhead
                        button. Same panel classes, so it reads as one menu
                        system. Non-portalled, like every menu — it stays
                        inside `.app` where the design tokens live. */}
                      <Dropdown.Root modal={false}>
                        <Dropdown.Trigger asChild>
                          <button
                            type="button"
                            className="dialog-colhead-btn"
                            title="Create a palette in the library and this map"
                          >
                            New…
                          </button>
                        </Dropdown.Trigger>
                        <Dropdown.Content className="menu-panel" align="start" sideOffset={4} loop>
                          <Dropdown.Item className="menu-item" onSelect={() => createNew([])}>
                            From empty…
                          </Dropdown.Item>
                          <Dropdown.Item
                            className="menu-item"
                            disabled={customColors.length === 0}
                            title={
                              customColors.length === 0
                                ? 'No line colors outside the map’s palettes right now'
                                : undefined
                            }
                            onSelect={() => createNew(customColors)}
                          >
                            From map’s custom colors…
                          </Dropdown.Item>
                        </Dropdown.Content>
                      </Dropdown.Root>
                      <button
                        type="button"
                        className="dialog-colhead-btn"
                        title="Load a palette file into the library and this map"
                        onClick={() => fileRef.current?.click()}
                      >
                        Load…
                      </button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".json,application/json"
                        aria-label="Load palette file"
                        style={{ display: 'none' }}
                        onChange={onLoad}
                      />
                      <Select.Root
                        value={sort}
                        onValueChange={(v) => {
                          if (isPaletteSort(v)) setSort(v);
                        }}
                      >
                        <Select.Trigger
                          className="field-select dialog-sort"
                          aria-label="Sort palettes"
                        >
                          <Select.Value />
                          <Select.Icon className="field-select-caret" aria-hidden="true">
                            <ChevronDownIcon />
                          </Select.Icon>
                        </Select.Trigger>
                        <Select.Content
                          className="field-select-panel"
                          position="popper"
                          sideOffset={4}
                          align="end"
                        >
                          <Select.Viewport>
                            {SORT_LABELS.map((s) => (
                              <Select.Item
                                key={s.value}
                                value={s.value}
                                className="field-select-item"
                              >
                                <Select.ItemText>{s.label}</Select.ItemText>
                              </Select.Item>
                            ))}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Root>
                    </div>
                  </div>
                  <div className="dialog-list">
                    {rows.length === 0 && (
                      <div className="empty">
                        {sort === 'starred' ? 'No starred palettes.' : 'No palettes.'}
                      </div>
                    )}
                    {rows.map((p) => {
                      const held = inMap.get(p.name);
                      const identical = held !== undefined && samePaletteContent(held, p);
                      return (
                        <div key={p.name} className="dialog-row palette-row">
                          <StarToggle
                            name={p.name}
                            starred={p.starred ?? false}
                            onToggle={() => setStarred(p.name, !p.starred)}
                          />
                          <div className="dialog-row-body">
                            <strong>{p.name}</strong>
                            <Strip palette={p} />
                          </div>
                          <div className="dialog-row-actions">
                            <IconButton
                              label={`Export ${p.name}`}
                              title={`Export ${p.name} as a palette file`}
                              onClick={() => onExport(p)}
                            >
                              <DownloadIcon />
                            </IconButton>
                            {/* Built-ins are the one fixed thing here: edit a
                              copy in the map instead. */}
                            {p.builtin ? (
                              <Blank />
                            ) : (
                              <IconButton
                                label={`Edit ${p.name}`}
                                title={`Edit ${p.name} — rename it, recolor it, reorder it`}
                                onClick={() => openEditor('library', p.name)}
                              >
                                <Pencil1Icon />
                              </IconButton>
                            )}
                            {p.builtin ? (
                              <Blank />
                            ) : (
                              speedBump(
                                `lib:${p.name}`,
                                `Delete ${p.name}`,
                                `Confirm deleting ${p.name}`,
                                'Will delete this palette from your library — maps keep their copies',
                                <Cross2Icon />,
                                () => onDeleteFromLibrary(p.name),
                              )
                            )}
                            {/* The arrow sits against the map column it points
                              into. Adding over a name the map already uses
                              replaces that palette, so it asks first. */}
                            {identical ? (
                              <IconButton label={`${p.name} is already in the map`} disabled>
                                <CheckIcon />
                              </IconButton>
                            ) : held ? (
                              speedBump(
                                `add:${p.name}`,
                                `Replace ${p.name} in the map`,
                                `Confirm replacing ${p.name} in the map`,
                                'Will overwrite a palette used in this map',
                                <ArrowRightIcon />,
                                () => addPaletteToMap(p),
                              )
                            ) : (
                              <IconButton
                                label={`Add ${p.name} to the map`}
                                onClick={() => addPaletteToMap(p)}
                              >
                                <ArrowRightIcon />
                              </IconButton>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="palette-in-map" aria-label="Palettes in this map">
                  <div className="dialog-colhead">
                    <h3>In this map</h3>
                  </div>
                  <div className={'dialog-list' + (mapDrag.drag ? ' dragging' : '')}>
                    {mapPalettes.length === 0 && (
                      <div className="empty">
                        This map carries no palettes — line colors are all picked by hand.
                      </div>
                    )}
                    {mapPalettes.map((p, i) => {
                      const library = inLibrary.get(p.name);
                      // A built-in counts as "in the library" only while the map's
                      // copy still matches it — rename or replace that copy and
                      // the library holds something else under the name.
                      const builtin = PALETTES.find((b) => b.name === p.name);
                      const alreadyThere =
                        (library !== undefined && samePaletteContent(library, p)) ||
                        (builtin !== undefined && samePaletteContent(builtin, p));
                      const saveKey = `map:${p.name}`;
                      return (
                        <div
                          key={p.name}
                          className={
                            'dialog-row palette-row' + (mapDrag.drag?.from === i ? ' dragging' : '')
                          }
                          style={rowShiftStyle(mapDrag.drag, i, PALETTE_ROW_HEIGHT)}
                        >
                          {/* Mirror of the library's arrow: against the column it
                            points into, and asking first when it overwrites. */}
                          {alreadyThere ? (
                            <IconButton label={`${p.name} is in the library`} disabled>
                              <CheckIcon />
                            </IconButton>
                          ) : BUILTIN_PALETTE_NAMES.has(p.name) ? (
                            <IconButton
                              label={`Rename ${p.name} to save it — the library’s is built in`}
                              disabled
                            >
                              <ArrowLeftIcon />
                            </IconButton>
                          ) : library ? (
                            speedBump(
                              saveKey,
                              `Save ${p.name} to the library, replacing the one there`,
                              `Confirm replacing ${p.name} in the library`,
                              'Will overwrite a palette in your library',
                              <ArrowLeftIcon />,
                              () => onSaveToLibrary(p),
                            )
                          ) : (
                            <IconButton
                              label={`Save ${p.name} to the library`}
                              onClick={() => onSaveToLibrary(p)}
                            >
                              <ArrowLeftIcon />
                            </IconButton>
                          )}
                          <div className="dialog-row-body">
                            <strong>{p.name}</strong>
                            <Strip palette={p} />
                          </div>
                          <div className="dialog-row-actions">
                            {/* The map's copy is the one that may have been
                              renamed or replaced since, so it exports on its
                              own terms rather than through the library. */}
                            <IconButton
                              label={`Export ${p.name} from the map`}
                              title={`Export this map’s ${p.name} as a palette file`}
                              onClick={() => onExport(p)}
                            >
                              <DownloadIcon />
                            </IconButton>
                            <IconButton
                              label={`Edit ${p.name} in the map`}
                              title={`Edit this map’s ${p.name} — rename it, recolor it, reorder it`}
                              onClick={() => openEditor('map', p.name)}
                            >
                              <Pencil1Icon />
                            </IconButton>
                            {speedBump(
                              `rm:${p.name}`,
                              `Remove ${p.name} from the map`,
                              `Confirm removing ${p.name} from the map`,
                              'Will take this palette out of this map',
                              <Cross2Icon />,
                              () => removePaletteFromMap(p.name),
                            )}
                            <button
                              type="button"
                              className="palette-drag-handle"
                              aria-label={`Reorder ${p.name}`}
                              title="Drag to reorder"
                              {...mapDrag.handleProps(i)}
                            >
                              <DragHandleDots2Icon />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
