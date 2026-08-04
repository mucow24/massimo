import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Toggle from '@radix-ui/react-toggle';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Cross2Icon,
  DownloadIcon,
  Pencil1Icon,
  StarIcon,
  StarFilledIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { useCustomPalettes } from '../state/customPalettes';
import { parseCustomPalette, serializeCustomPalette } from '../model/customPalette';
import {
  BUILTIN_PALETTE_NAMES,
  libraryPalettes,
  PALETTES,
  type Palette,
  type PaletteSort,
} from '../model/palettes';
import { downloadBlob, sanitizeBasename } from '../export/exportCanvas';

const SORT_LABELS: { value: PaletteSort; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'starred', label: 'Starred' },
];

const isPaletteSort = (v: string): v is PaletteSort => v === 'name' || v === 'starred';

const sameSwatches = (a: Palette, b: Palette): boolean =>
  a.swatches.length === b.swatches.length &&
  a.swatches.every((s, i) => s.name === b.swatches[i].name && s.color === b.swatches[i].color);

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

/**
 * A row command. Every row spends the same fixed set of these slots whether or
 * not it can use them all (see `Blank`), so the color strips beside them all
 * end at one edge instead of stepping in and out with the buttons.
 */
function IconButton({
  label,
  title,
  danger,
  armed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  danger?: boolean;
  /** Primed by a first click: the same glyph, washed red, awaiting the second. */
  armed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={'icon-btn' + (danger || armed ? ' danger' : '') + (armed ? ' armed' : '')}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
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

/** A row's name, or the input that is renaming it. */
function RowName({
  name,
  renaming,
  onCommit,
  onCancel,
}: {
  name: string;
  renaming: boolean;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  if (!renaming) return <strong>{name}</strong>;
  return (
    <input
      autoFocus
      aria-label={`Rename ${name}`}
      defaultValue={name}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(e.currentTarget.value);
        // Escape cancels the rename without closing the dialog.
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}

/**
 * The palette manager: your library on the left, the palettes this map paints
 * with on the right. Reached from the toolbar's Manage palettes button, and the
 * only place palettes are imported, renamed, starred or thrown away.
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
  const addPaletteToMap = useDoc((s) => s.addPaletteToMap);
  const removePaletteFromMap = useDoc((s) => s.removePaletteFromMap);
  const renameMapPalette = useDoc((s) => s.renameMapPalette);
  const movePaletteInMap = useDoc((s) => s.movePaletteInMap);

  const custom = useCustomPalettes((s) => s.palettes);
  const starred = useCustomPalettes((s) => s.starred);
  const sort = useCustomPalettes((s) => s.sort);
  const setSort = useCustomPalettes((s) => s.setSort);
  const setStarred = useCustomPalettes((s) => s.setStarred);
  const addToLibrary = useCustomPalettes((s) => s.addPalette);
  const removeFromLibrary = useCustomPalettes((s) => s.removePalette);
  const renameInLibrary = useCustomPalettes((s) => s.renamePalette);

  // One message line, but a load that displaced something is NOT a failure and
  // must not wear the red band a rejected file does.
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'notice' } | null>(null);
  const setError = (text: string | null) =>
    setMessage(text === null ? null : { text, tone: 'error' });
  const setNotice = (text: string) => setMessage({ text, tone: 'notice' });
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = libraryPalettes(custom, starred, sort);
  const inMap = new Map(mapPalettes.map((p) => [p.name, p]));
  const inLibrary = new Map(custom.map((p) => [p.name, p]));

  const onLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    const result = parseCustomPalette(await f.text());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const palette = { name: result.name, swatches: result.swatches };
    // A load is the one place a name collision can't be shown before the fact —
    // the name arrives with the file, and it lands in BOTH destinations. So it
    // reports afterwards, naming every palette it displaced.
    const held = inMap.get(palette.name);
    const replacedMap = held !== undefined && !sameSwatches(held, palette);
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
    setConfirmKey(null);
    if (!addToLibrary(palette)) {
      setError(`“${palette.name}” is a built-in palette’s name, so the library keeps its own.`);
      return;
    }
    setError(null);
  };

  const onDeleteFromLibrary = (name: string) => {
    setConfirmKey(null);
    removeFromLibrary(name);
  };

  const commitLibraryRename = (from: string, to: string) => {
    setRenaming(null);
    if (to.trim() === from || !to.trim()) return;
    if (!renameInLibrary(from, to)) setError(`“${to.trim()}” is already taken in your library.`);
  };

  const commitMapRename = (from: string, to: string) => {
    setRenaming(null);
    const name = to.trim();
    if (!name || name === from) return;
    if (mapPalettes.some((p) => p.name === name)) {
      setError(`“${name}” is already one of this map’s palettes.`);
      return;
    }
    renameMapPalette(from, name);
  };

  /**
   * A command that would destroy or displace a palette: the first click arms
   * it, the second runs it. Undo-reachability is deliberately NOT the test —
   * these buttons sit in one window, several of them side by side in a row, and
   * a gesture that changed meaning between two adjacent glyphs would be worse
   * than a redundant click on the one the user could have undone.
   */
  const speedBump = (
    key: string,
    label: string,
    armedLabel: string,
    /** What the second click will cost — the whole point of the first one. */
    armedTitle: string,
    icon: React.ReactNode,
    run: () => void,
  ) =>
    confirmKey === key ? (
      <IconButton label={armedLabel} title={armedTitle} armed onClick={run}>
        {icon}
      </IconButton>
    ) : (
      <IconButton label={label} onClick={() => setConfirmKey(key)}>
        {icon}
      </IconButton>
    );

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
            className="dialog palette-manager"
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => {
              // Mid-rename, Escape belongs to the input (which cancels the edit).
              if (renaming !== null) e.preventDefault();
            }}
          >
            <header>
              <Dialog.Title asChild>
                <h2>Palettes</h2>
              </Dialog.Title>
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

            <div className="dialog-columns">
              <section className="palette-library" aria-label="Palette library">
                <div className="dialog-colhead">
                  <h3>Library</h3>
                  <div className="dialog-colhead-controls">
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
                    const identical = held !== undefined && sameSwatches(held, p);
                    return (
                      <div key={p.name} className="dialog-row palette-row">
                        <StarToggle
                          name={p.name}
                          starred={p.starred ?? false}
                          onToggle={() => setStarred(p.name, !p.starred)}
                        />
                        <div className="dialog-row-body">
                          <RowName
                            name={p.name}
                            renaming={renaming === `lib:${p.name}`}
                            onCommit={(next) => commitLibraryRename(p.name, next)}
                            onCancel={() => setRenaming(null)}
                          />
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
                          {/* Built-ins are the one fixed thing here: rename or
                              delete a copy in the map instead. */}
                          {p.builtin ? (
                            <Blank />
                          ) : (
                            <IconButton
                              label={`Rename ${p.name}`}
                              onClick={() => setRenaming(`lib:${p.name}`)}
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
                              () => {
                                setConfirmKey(null);
                                addPaletteToMap(p);
                              },
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
                <div className="dialog-list">
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
                      (library !== undefined && sameSwatches(library, p)) ||
                      (builtin !== undefined && sameSwatches(builtin, p));
                    const saveKey = `map:${p.name}`;
                    return (
                      <div key={p.name} className="dialog-row palette-row">
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
                          <RowName
                            name={p.name}
                            renaming={renaming === saveKey}
                            onCommit={(next) => commitMapRename(p.name, next)}
                            onCancel={() => setRenaming(null)}
                          />
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
                            label={`Rename ${p.name} in the map`}
                            onClick={() => setRenaming(saveKey)}
                          >
                            <Pencil1Icon />
                          </IconButton>
                          {speedBump(
                            `rm:${p.name}`,
                            `Remove ${p.name} from the map`,
                            `Confirm removing ${p.name} from the map`,
                            'Will take this palette out of this map',
                            <Cross2Icon />,
                            () => {
                              setConfirmKey(null);
                              removePaletteFromMap(p.name);
                            },
                          )}
                          <div className="palette-move">
                            <button
                              type="button"
                              aria-label={`Move ${p.name} up`}
                              disabled={i === 0}
                              onClick={() => movePaletteInMap(p.name, -1)}
                            >
                              <ChevronUpIcon />
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${p.name} down`}
                              disabled={i === mapPalettes.length - 1}
                              onClick={() => movePaletteInMap(p.name, 1)}
                            >
                              <ChevronDownIcon />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
