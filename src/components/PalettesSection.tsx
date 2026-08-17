import { Fragment, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  Cross2Icon,
  MoonIcon,
  PlusIcon,
  SunIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { ColorField } from './ColorField';
import { useInlineRename } from './useInlineRename';
import {
  FALLBACK_LINE_COLOR,
  freshPaletteName,
  isLinePalette,
  type Palette,
} from '../model/palettes';

/**
 * Click-to-edit swatch name (the StylesPanel name-field idiom). A refused
 * rename — empty, or a name another swatch of the palette holds — no-ops in
 * the transform and simply re-renders the old name.
 */
function SwatchNameField({
  palette,
  index,
  name,
}: {
  palette: string;
  index: number;
  name: string;
}) {
  const renameMapPaletteSwatch = useDoc((s) => s.renameMapPaletteSwatch);
  const { editing, start, inputProps } = useInlineRename((draft) =>
    renameMapPaletteSwatch(palette, index, draft),
  );

  if (editing) {
    return <input className="style-name-input grow" aria-label="Color name" {...inputProps} />;
  }

  return (
    <button
      type="button"
      className="style-name grow"
      aria-label={`Rename ${palette} ${name}`}
      title="Rename color"
      onClick={() => start(name)}
    >
      {name}
    </button>
  );
}

/**
 * Click-to-edit palette name, the swatch field's twin one level up. A refused
 * rename — empty, or a name the map already carries — no-ops in the transform
 * and re-renders the old name.
 */
function PaletteNameField({ name }: { name: string }) {
  const renameMapPalette = useDoc((s) => s.renameMapPalette);
  const { editing, start, inputProps } = useInlineRename((draft) => renameMapPalette(name, draft));

  if (editing) {
    return <input className="style-name-input grow" aria-label="Palette name" {...inputProps} />;
  }

  return (
    <button
      type="button"
      className="style-name grow"
      aria-label={`Rename ${name}`}
      title="Rename palette"
      onClick={() => start(name)}
    >
      {name}
    </button>
  );
}

/** One palette's rows, under a collapsible heading carrying its `+`. */
function PaletteGroup({
  palette,
  design,
  collapsed,
  onToggle,
}: {
  palette: Palette;
  design: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const recolorMapPaletteColor = useDoc((s) => s.recolorMapPaletteColor);
  const addPaletteToMap = useDoc((s) => s.addPaletteToMap);
  const { name, swatches } = palette;

  /**
   * Add, duplicate and delete are all ONE upsert of the whole palette, which
   * is also what reconciles the refs: a deleted swatch's links drop and the
   * fields keep what they were painting. A blank name arrives NAMED by that
   * door (`copyPalette` positions it against the names already taken), which
   * is how `+` gets its "3"; a duplicate names itself first, or that same
   * positional pass would hand the copy the free name and rename the original.
   */
  const withSwatches = (next: typeof swatches) => addPaletteToMap({ ...palette, swatches: next });

  return (
    <>
      <div className="list-header palettes-section-palette">
        {/* Chevron and name are separate controls (the StylesPanel row idiom):
            the name is click-to-EDIT, so it cannot also be the toggle. */}
        <button
          type="button"
          className="section-toggle"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name}`}
          title={collapsed ? 'Expand palette' : 'Collapse palette'}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </button>
        <PaletteNameField name={name} />
        <button
          className="btn-mini icon"
          aria-label={`Add a color to ${name}`}
          title="Add a color"
          onClick={() => withSwatches([...swatches, { name: '', color: FALLBACK_LINE_COLOR }])}
        >
          <PlusIcon />
        </button>
      </div>
      {!collapsed &&
        swatches.map((s, i) => (
          <div key={s.name} className="list-row palettes-section-row">
            {/* The sun/moon pair every themed-color row in the app speaks — a
                design swatch is a day/night color like any other. */}
            {design && <SunIcon aria-hidden="true" />}
            <ColorField
              value={s.color}
              onChange={(c) => recolorMapPaletteColor(name, i, c)}
              ariaLabel={`${name} ${s.name}`}
              title={design ? 'Light mode color' : 'Edit color'}
            />
            {design && (
              <>
                <MoonIcon aria-hidden="true" />
                <ColorField
                  value={s.night ?? s.color}
                  onChange={(c) => recolorMapPaletteColor(name, i, c, 'night')}
                  ariaLabel={`${name} ${s.name} dark`}
                  title="Dark mode color"
                />
              </>
            )}
            <SwatchNameField palette={name} index={i} name={s.name} />
            {/* A copy of this color, both halves, landing right after it. The
                copy claims its own free name HERE — leaving that to the door's
                positional dedupe would hand the new swatch the plain "<name>
                copy" and rename the EXISTING one out from under its refs. */}
            <button
              className="btn-mini icon"
              aria-label={`Duplicate ${name} ${s.name}`}
              title="Duplicate color"
              onClick={() =>
                withSwatches([
                  ...swatches.slice(0, i + 1),
                  {
                    ...s,
                    // Same first-unused rule the palette names use.
                    name: freshPaletteName(new Set(swatches.map((x) => x.name)), `${s.name} copy`),
                  },
                  ...swatches.slice(i + 1),
                ])
              }
            >
              <CopyIcon />
            </button>
            {/* A palette carries at least one color wherever it comes to rest,
                so the last row's delete stands DISABLED rather than emptying
                it — the same floor the editor's list holds. */}
            <button
              className="btn-mini danger"
              aria-label={`Delete ${name} ${s.name}`}
              title={
                swatches.length === 1
                  ? 'A palette keeps at least one color'
                  : 'Delete color (anything linked to it keeps its paint)'
              }
              disabled={swatches.length === 1}
              onClick={() => withSwatches(swatches.filter((_, j) => j !== i))}
            >
              <Cross2Icon />
            </button>
          </div>
        ))}
    </>
  );
}

/** The two kinds, each its own section — the heading is what says which, so a
 *  palette needs no badge of its own here. `stem` is what a mint counts from,
 *  matching the manager's own New… names. */
const KIND_SECTIONS = [
  {
    design: false,
    label: 'Line color palettes',
    empty: 'No line color palettes in this map.',
    stem: 'New palette',
  },
  {
    design: true,
    label: 'Design palettes',
    empty: 'No design palettes in this map.',
    stem: 'New design palette',
  },
] as const;

/**
 * The Styles tab's palette sections: the doc's palettes filed by KIND — the
 * heading says which, so nothing here wears a badge — one collapsible group
 * each, and one row per swatch: day (+ night, on design palettes) ColorFields,
 * a click-to-rename name, duplicate, delete.
 *
 * This is where a palette is LIVED IN: the assign-once-then-adjust loop, plus
 * everything that shapes a palette from the inside — mint one of either kind,
 * rename it, add / duplicate / delete its colors. Each edit carries the map
 * with it, since they all land through the doc's palette transforms: a recolor
 * sweeps every linked field and line live, a rename follows the refs, a delete
 * drops them and leaves the paint exactly as it was.
 *
 * What stays in the palette manager dialog is what reaches OUTSIDE this map —
 * the library and the two columns' transfer arrows, palette files, reordering
 * the map's list — and the one field with no room here, a description.
 */
export function PalettesSection() {
  const palettes = useDoc((s) => s.palettes);
  const addPaletteToMap = useDoc((s) => s.addPaletteToMap);
  // Per-section + per-palette collapse, ephemeral like StylesPanel's.
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(new Set());
  const [collapsedPalettes, setCollapsedPalettes] = useState<ReadonlySet<string>>(new Set());

  /**
   * Mint a palette of `kind` into the MAP — the library is reached by the
   * manager's transfer arrow, which stays the only crossing. It arrives
   * carrying ONE color, unlike the manager's New…: an empty palette is
   * licensed only while that editor is up to fill it, and the persist merge
   * hook drops any stored without one, so an empty mint here would not
   * survive the next reload.
   */
  const mint = (design: boolean, stem: string) =>
    addPaletteToMap({
      name: freshPaletteName(new Set(palettes.map((p) => p.name)), stem),
      swatches: [{ name: '1', color: FALLBACK_LINE_COLOR }],
      ...(design && { kind: 'design' }),
    });

  const toggle =
    (set: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void) => (key: string) =>
      set((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      });
  const toggleSection = toggle(setCollapsedSections);
  const togglePalette = toggle(setCollapsedPalettes);

  return (
    <>
      {KIND_SECTIONS.map(({ design, label, empty, stem }) => {
        const mine = palettes.filter((p) => isLinePalette(p) !== design);
        const collapsed = collapsedSections.has(label);
        return (
          <Fragment key={label}>
            <div className="list-header">
              <button
                type="button"
                className="section-toggle grow"
                aria-expanded={!collapsed}
                title={collapsed ? 'Expand section' : 'Collapse section'}
                onClick={() => toggleSection(label)}
              >
                {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                {label}
              </button>
              <button
                className="btn-mini icon"
                aria-label={`New ${design ? 'design' : 'line color'} palette`}
                title={`New ${design ? 'design' : 'line color'} palette`}
                onClick={() => mint(design, stem)}
              >
                <PlusIcon />
              </button>
            </div>
            {!collapsed && mine.length === 0 && (
              <div className="palettes-section-empty">{empty}</div>
            )}
            {!collapsed &&
              mine.map((p) => (
                <PaletteGroup
                  key={p.name}
                  palette={p}
                  design={design}
                  collapsed={collapsedPalettes.has(p.name)}
                  onToggle={() => togglePalette(p.name)}
                />
              ))}
          </Fragment>
        );
      })}
    </>
  );
}
