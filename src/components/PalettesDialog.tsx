import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Toggle from '@radix-ui/react-toggle';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  Cross2Icon,
  DownloadIcon,
  DragHandleDots2Icon,
  Pencil1Icon,
  PlusIcon,
  StarIcon,
  StarFilledIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { useCustomLineColors } from '../state/customLineColors';
import { useCustomPalettes } from '../state/customPalettes';
import { parseCustomPalette, serializeCustomPalette } from '../model/customPalette';
import {
  BUILTIN_PALETTE_NAMES,
  copyPalette,
  freshPaletteName,
  libraryPalettes,
  paletteContentEqual,
  PALETTES,
  PALETTE_SORTS,
  isPaletteSort,
  type Palette,
  type PaletteSort,
  type PaletteSwatch,
} from '../model/palettes';
import { normalizeHex } from '../util/color';
import { markHistory, redo, undo } from '../state/history';
import { pointerLost } from './canvas/dragGesture';
import { downloadBlob, sanitizeBasename } from '../export/exportCanvas';
import { MenuItem } from './Menu';
import { DialogSortSelect, IconButton, RowCommands, useSpeedBump } from './dialogRow';
import { rowShiftStyle, useRowDragReorder } from './useRowDragReorder';
import { PaletteEditor, type PaletteSource } from './PaletteEditor';

/**
 * The map column's fixed row height — the drag hook divides by it (CSS pins it).
 * One height for BOTH palette kinds: a design row's stacked day/night pair is
 * what sets it, and a line row reserves the same band, because a per-kind
 * height would put the drag preview's arithmetic out by a row.
 */
export const PALETTE_ROW_HEIGHT = 56;

// The picker's wording, one entry per PALETTE_SORTS rung — a Record over the
// union, so a mode added to PaletteSort fails to compile until it is named here.
const SORT_LABELS: Record<PaletteSort, string> = {
  name: 'Name',
  starred: 'Starred',
};

/**
 * What the map column calls the row holding the colors no palette covers. It
 * is not a palette and never lands in the doc — the name is a LABEL, not a key
 * — so it is italic in the list, and a map may perfectly well hold a real
 * palette of the same name.
 *
 * Which is why the export carries the other one: a file loaded back mints a
 * real palette under the name inside it, and a palette called "Custom colors
 * (not in a palette)" would sit in the map column impersonating this row.
 */
const CUSTOM_COLORS_NAME = 'Custom colors (not in a palette)';
const CUSTOM_COLORS_EXPORT_NAME = 'Custom colors';

/**
 * Loose colors as a palette's swatches — numbered, because a hand-picked color
 * has no name to carry. Both the custom colors row and the palette its `+`
 * mints read from here, so what you see in the strip is what you get.
 */
const swatchesFromColors = (colors: readonly string[]): PaletteSwatch[] =>
  colors.map((c, i) => ({ name: String(i + 1), color: normalizeHex(c) }));

/**
 * A palette's colors as a strip — how you recognise one without reading it, and
 * how you tell the two KINDS apart before reading anything at all. The SHAPE
 * carries that: a LINE palette is a row of round color bullets (its swatches
 * are line identities, one color each), while a DESIGN palette keeps the
 * rectangular bars, stacked — every swatch's day color over its night one. A
 * collapsed night means night == day, so that pair shows the same color twice,
 * which is exactly what the map paints in both themes.
 *
 * One direct child per swatch either way, so "how many colors is this?" reads
 * the same from both, and the rows keep a single fixed height (the drag hook's
 * contract) whichever kind fills them.
 */
function Strip({ palette }: { palette: Palette }) {
  const design = palette.kind === 'design';
  return (
    <div className={'palette-strip' + (design ? ' design' : '')} aria-hidden="true">
      {/* The swatch's own name on hover — the one place the strip can say which
          color is which without the editor. An unnamed swatch offers no
          tooltip at all rather than an empty one. */}
      {palette.swatches.map((s, i) =>
        design ? (
          <span key={i} className="palette-dot-pair" title={s.name || undefined}>
            <span className="palette-bar" style={{ background: s.color }} />
            <span className="palette-bar" style={{ background: s.night ?? s.color }} />
          </span>
        ) : (
          <span
            key={i}
            className="palette-dot"
            title={s.name || undefined}
            style={{ background: s.color }}
          />
        ),
      )}
    </div>
  );
}

/** A quiet "design" tag after the palette's name — line palettes go unmarked. */
const KindBadge = ({ palette }: { palette: Palette }) =>
  palette.kind === 'design' ? <span className="palette-kind-badge">design</span> : null;

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
          : 'Star this palette — the Starred sort keeps it'
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
 * a row's pencil (and New…) swaps this window for the PaletteEditor view,
 * where renaming lives too.
 *
 * The two columns are independent lists, not a master and its detail — nothing
 * here is "selected", so every command lives in the row it acts on. A row
 * shows two of them: the star or the transfer arrow, and the map's drag
 * handle. Those stay out because they are not really commands — two carry
 * STATE (already in the map; built-in, so unsaveable) and one is a grab
 * target. Everything else stands in the row's `…` toolbar, which is what
 * keeps a column of rows from reading as a wall of identical glyphs.
 *
 * Under the map's palettes stands the one row the map does not carry: the
 * CUSTOM COLORS row, the line colors no palette accounts for, derived from the
 * doc rather than stored in it. It is the only row that breaks the grid above —
 * see it at the foot of the map column for why.
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
  const { speedBump, disarm } = useSpeedBump();
  // Which palette the editor view is open on, or null for the two columns.
  // `fresh` marks a just-created palette, whose title opens already editing;
  // `rewind` is New…'s undo mark, spent only if that palette is thrown away
  // again (see leaveEditor).
  const [editing, setEditing] = useState<{
    source: PaletteSource;
    name: string;
    fresh?: boolean;
    rewind?: () => void;
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
      ...(result.kind !== undefined && { kind: result.kind }),
    };
    // A load is the one place a name collision can't be shown before the fact —
    // the name arrives with the file, and it lands in BOTH destinations. So it
    // reports afterwards, naming every palette it displaced.
    const held = inMap.get(palette.name);
    const replacedMap = held !== undefined && !paletteContentEqual(held, palette);
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
    // Undo can empty a map palette where it stands (it replays the doc, and
    // rightly so), and the library keeps no palette without colors.
    if (palette.swatches.length === 0) {
      setError(`“${palette.name}” has no colors — a palette keeps at least one.`);
      return;
    }
    if (!addToLibrary(palette)) {
      setError(`“${palette.name}” is a built-in palette’s name, so the library keeps its own.`);
      return;
    }
    setError(null);
  };

  const onDeleteFromLibrary = (name: string) => {
    removeFromLibrary(name);
  };

  /**
   * Duplicate a palette into the column it came from, as "<name> copy". The
   * copy stays on its own side because the arrows are what cross the divider —
   * a Make copy that also landed one over there would be doing two things.
   *
   * Copying is what a BUILT-IN has instead of an edit: the fork is an ordinary
   * library palette, renameable and deletable like any other. So the library's
   * taken-names must include the built-ins, or a fork could be minted onto a
   * name the library is unable to store.
   *
   * Both report the name they minted, because the caller didn't choose it and
   * may not be able to see it: the row lands wherever A–Z puts it, and under
   * the Starred sort — which FILTERS — an unstarred copy lands nowhere at all.
   * Silence there is indistinguishable from a dead button, and the next click
   * would quietly mint "<name> copy 2".
   */
  const onCopyInLibrary = (p: Palette) => {
    const taken = new Set<string>([...BUILTIN_PALETTE_NAMES, ...custom.map((x) => x.name)]);
    const name = freshPaletteName(taken, `${p.name} copy`);
    // Never refused: `taken` holds every built-in name, so the minted name is
    // never one the library declines.
    addToLibrary({ ...copyPalette(p), name });
    setNotice(`Copied “${p.name}” as “${name}”.`);
  };

  const onCopyInMap = (p: Palette) => {
    const taken = new Set(mapPalettes.map((x) => x.name));
    const name = freshPaletteName(taken, `${p.name} copy`);
    addPaletteToMap({ ...copyPalette(p), name });
    setNotice(`Copied “${p.name}” as “${name}”.`);
  };

  /** Open the editor view on one palette, leaving any stale message behind. */
  const openEditor = (
    source: PaletteSource,
    name: string,
    extra?: { fresh?: boolean; rewind?: () => void },
  ) => {
    setMessage(null);
    setEditing({ source, name, ...extra });
  };

  /**
   * Leave the editor view — and throw the palette away if it is still carrying
   * no colors. A palette holds at least one wherever it comes to rest, and the
   * editor is the single exception: New… mints one empty so its first color is
   * chosen in there. That licence lasts exactly as long as the view does, so
   * EVERY way out runs through here: the back arrow, Escape's middle layer,
   * the editor asking to be left, and the dialog closing outright with the
   * editor still up.
   */
  const leaveEditor = () => {
    if (editing) {
      const { source, name, rewind } = editing;
      const held = (source === 'map' ? mapPalettes : custom).find((p) => p.name === name);
      if (held?.swatches.length === 0) {
        if (source === 'map') {
          removePaletteFromMap(name);
          // The doc now reads exactly as this visit found it, so the undo
          // stack goes back too (New…'s mark). Otherwise a cancelled New…
          // leaves a create and a remove standing there, and the first Ctrl+Z
          // hands back the very palette the cancel threw away.
          rewind?.();
        } else removeFromLibrary(name);
      }
    }
    setMessage(null);
    setEditing(null);
  };

  // The map's custom colors — line colors no palette covers — stand as a row
  // of their own at the foot of the map column, where the `+` absorbs them
  // into a palette (and so empties the row away).
  const customColors = useCustomLineColors();
  const customColorsPalette: Palette = {
    name: CUSTOM_COLORS_EXPORT_NAME,
    swatches: swatchesFromColors(customColors),
  };

  /**
   * Mint a palette and open the editor on it. The editor edits the MAP copy
   * (undoable, and the picker follows along), so a SEEDED palette lands in both
   * destinations like Load…, the library keeping the creation-time colors until
   * it's saved back with the arrow.
   *
   * From empty there is nothing to keep: the library holds no palette without
   * colors, so this one lands in the map alone, provisionally, and reaches the
   * library the ordinary way once the editor has given it something to hold.
   */
  const createNew = (colors: readonly string[], kind?: 'design') => {
    const taken = new Set<string>([
      ...BUILTIN_PALETTE_NAMES,
      ...custom.map((p) => p.name),
      ...mapPalettes.map((p) => p.name),
    ]);
    const palette: Palette = {
      name: freshPaletteName(taken, kind === 'design' ? 'New design palette' : undefined),
      swatches: swatchesFromColors(colors),
      ...(kind !== undefined && { kind }),
    };
    // Never gated here: the library refuses a palette with no colors on its
    // own, so a from-empty mint lands in the map alone by that refusal rather
    // than by a second copy of the same rule standing at this door.
    addToLibrary(palette);
    // Marked BEFORE the doc write, so backing out of an unfilled palette can
    // put the undo stack back where it stood as well as the doc.
    const rewind = markHistory();
    addPaletteToMap(palette);
    openEditor('map', palette.name, { fresh: true, rewind });
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // Closing the window from inside the editor is a way out of the editor
        // like any other — an empty palette does not survive it.
        if (!open) {
          leaveEditor();
          onClose();
        }
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
                leaveEditor();
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
                    onClick={leaveEditor}
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
                onBack={leaveEditor}
                // The rename carries the undo mark along (a palette renamed and
                // then left empty is still this visit's, and still goes back);
                // `fresh` is spent, and re-arming the title edit on a rename
                // would fight the one that just committed.
                onRenamed={(to) =>
                  setEditing({ source: editing.source, name: to, rewind: editing.rewind })
                }
                setError={setError}
                inlineEditRef={inlineEditRef}
              />
            ) : (
              <div className="dialog-columns">
                <section className="palette-library" aria-label="Palette library">
                  <div className="dialog-colhead">
                    <h3>Library</h3>
                    <div className="dialog-colhead-controls">
                      {/* ONE command with two answers: the kinds differ in what
                        they are FOR, not in how you mint one, so they share a
                        button and the menu says which is which. The map's
                        custom colors are seeded from the row that holds them,
                        where they can be seen. */}
                      <Dropdown.Root modal={false}>
                        <Dropdown.Trigger asChild>
                          <button
                            type="button"
                            className="dialog-colhead-btn"
                            title="Create an empty palette in this map"
                          >
                            New…
                          </button>
                        </Dropdown.Trigger>
                        {/* Non-portalled, like every menu in the app: inside
                            `.app` for the design tokens, and inside the dialog
                            for its focus trap. */}
                        <Dropdown.Content
                          className="menu-panel"
                          align="start"
                          sideOffset={4}
                          collisionPadding={8}
                          loop
                        >
                          <MenuItem onClick={() => createNew([])}>New line color palette</MenuItem>
                          <MenuItem onClick={() => createNew([], 'design')}>
                            New design palette
                          </MenuItem>
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
                      <DialogSortSelect
                        value={sort}
                        sorts={PALETTE_SORTS}
                        labels={SORT_LABELS}
                        isSort={isPaletteSort}
                        onChange={setSort}
                        ariaLabel="Sort palettes"
                        className="dialog-sort"
                      />
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
                      const identical = held !== undefined && paletteContentEqual(held, p);
                      return (
                        <div key={p.name} className="dialog-row palette-row">
                          <StarToggle
                            name={p.name}
                            starred={p.starred ?? false}
                            onToggle={() => setStarred(p.name, !p.starred)}
                          />
                          <div className="dialog-row-body">
                            <strong>
                              {p.name}
                              <KindBadge palette={p} />
                            </strong>
                            <Strip palette={p} />
                          </div>
                          <div className="dialog-row-actions">
                            <RowCommands label={`More actions for ${p.name}`} onClose={disarm}>
                              {(close) => (
                                <>
                                  <IconButton
                                    label={`Export ${p.name}`}
                                    title={`Export ${p.name} as a palette file`}
                                    onClick={() => {
                                      onExport(p);
                                      close();
                                    }}
                                  >
                                    <DownloadIcon />
                                  </IconButton>
                                  {/* Built-ins are the one fixed thing here —
                                    so Make copy is how you get an editable
                                    one, without going by way of a map. */}
                                  {!p.builtin && (
                                    <IconButton
                                      label={`Edit ${p.name}`}
                                      title={`Edit ${p.name} — rename it, recolor it, reorder it`}
                                      onClick={() => {
                                        openEditor('library', p.name);
                                        close();
                                      }}
                                    >
                                      <Pencil1Icon />
                                    </IconButton>
                                  )}
                                  <IconButton
                                    label={`Make a copy of ${p.name}`}
                                    title={`Copy ${p.name} into your library as “${p.name} copy”`}
                                    onClick={() => {
                                      onCopyInLibrary(p);
                                      close();
                                    }}
                                  >
                                    <CopyIcon />
                                  </IconButton>
                                  {!p.builtin &&
                                    speedBump(
                                      `lib:${p.name}`,
                                      `Delete ${p.name}`,
                                      `Confirm deleting ${p.name}`,
                                      'Will delete this palette from your library — maps keep their copies',
                                      <Cross2Icon />,
                                      () => {
                                        onDeleteFromLibrary(p.name);
                                        close();
                                      },
                                    )}
                                </>
                              )}
                            </RowCommands>
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
                    {/* With no palettes AND no custom colors there is nothing
                        here at all — which means nothing on the map is painted
                        yet, so the old "line colors are all picked by hand"
                        would be describing colors that don't exist. Where they
                        DO, the custom colors row below says it better. */}
                    {mapPalettes.length === 0 && customColors.length === 0 && (
                      <div className="empty">This map carries no palettes.</div>
                    )}
                    {mapPalettes.map((p, i) => {
                      const library = inLibrary.get(p.name);
                      // A built-in counts as "in the library" only while the map's
                      // copy still matches it — rename or replace that copy and
                      // the library holds something else under the name.
                      const builtin = PALETTES.find((b) => b.name === p.name);
                      const alreadyThere =
                        (library !== undefined && paletteContentEqual(library, p)) ||
                        (builtin !== undefined && paletteContentEqual(builtin, p));
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
                            <strong>
                              {p.name}
                              <KindBadge palette={p} />
                            </strong>
                            <Strip palette={p} />
                          </div>
                          <div className="dialog-row-actions">
                            <RowCommands
                              label={`More actions for ${p.name} in the map`}
                              onClose={disarm}
                            >
                              {(close) => (
                                <>
                                  {/* The map's copy is the one that may have
                                    been renamed or replaced since, so it
                                    exports — and copies — on its own terms
                                    rather than through the library. */}
                                  <IconButton
                                    label={`Export ${p.name} from the map`}
                                    title={`Export this map’s ${p.name} as a palette file`}
                                    onClick={() => {
                                      onExport(p);
                                      close();
                                    }}
                                  >
                                    <DownloadIcon />
                                  </IconButton>
                                  <IconButton
                                    label={`Edit ${p.name} in the map`}
                                    title={`Edit this map’s ${p.name} — rename it, recolor it, reorder it`}
                                    onClick={() => {
                                      openEditor('map', p.name);
                                      close();
                                    }}
                                  >
                                    <Pencil1Icon />
                                  </IconButton>
                                  <IconButton
                                    label={`Make a copy of ${p.name} in the map`}
                                    title={`Copy ${p.name} into this map as “${p.name} copy”`}
                                    onClick={() => {
                                      onCopyInMap(p);
                                      close();
                                    }}
                                  >
                                    <CopyIcon />
                                  </IconButton>
                                  {speedBump(
                                    `rm:${p.name}`,
                                    `Remove ${p.name} from the map`,
                                    `Confirm removing ${p.name} from the map`,
                                    'Will take this palette out of this map',
                                    <Cross2Icon />,
                                    () => {
                                      removePaletteFromMap(p.name);
                                      close();
                                    },
                                  )}
                                </>
                              )}
                            </RowCommands>
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
                    {/* The colors this map paints with that no palette accounts
                      for — the picker's "Custom" section, seen from the palette
                      side. It stands under the palettes because it is what is
                      left over, and it is the only row here the map does not
                      carry: it is derived from the lines, and turning it into a
                      palette is what empties it away.

                      So it breaks the row grid on purpose. The two slots that
                      would be lies — save to the library, and the drag handle —
                      stand EMPTY rather than disabled, because there is nothing
                      here to save and nothing to reorder; keeping the width
                      keeps the strips and the `…` in the columns they hold in
                      every other row. In their place the row spends a slot of
                      its own on the one command it has, which is why its strip
                      is a slot shorter than its neighbours'. */}
                    {customColors.length > 0 && (
                      <div className="dialog-row palette-row palette-row-custom">
                        <div className="palette-row-slot" aria-hidden="true" />
                        <div className="dialog-row-body">
                          <strong>{CUSTOM_COLORS_NAME}</strong>
                          <Strip palette={customColorsPalette} />
                        </div>
                        <div className="dialog-row-actions">
                          <IconButton
                            label="Create palette from these colors"
                            onClick={() => createNew(customColors)}
                          >
                            <PlusIcon />
                          </IconButton>
                          <RowCommands label="More actions for custom colors" onClose={disarm}>
                            {(close) => (
                              <IconButton
                                label="Export these colors as a palette file"
                                onClick={() => {
                                  onExport(customColorsPalette);
                                  close();
                                }}
                              >
                                <DownloadIcon />
                              </IconButton>
                            )}
                          </RowCommands>
                          <div className="palette-row-slot" aria-hidden="true" />
                        </div>
                      </div>
                    )}
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
