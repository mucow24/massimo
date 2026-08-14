import { Fragment, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { ColorField } from './ColorField';
import { useInlineRename } from './useInlineRename';
import { isLinePalette } from '../model/palettes';

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
 * The Styles tab's "Palettes" section: the doc's palettes, one collapsible
 * group each, one row per swatch — day (+ night, on design palettes)
 * ColorFields and a click-to-rename name. This is the TWEAK surface for the
 * assign-once-then-adjust workflow: a recolor sweeps every linked field/line
 * live, a rename follows the refs. Structural work — adding, deleting,
 * reordering, importing palettes or colors — stays in the palette manager
 * dialog.
 */
export function PalettesSection() {
  const palettes = useDoc((s) => s.palettes);
  const recolorMapPaletteColor = useDoc((s) => s.recolorMapPaletteColor);
  // Whole-section + per-palette collapse, ephemeral like StylesPanel's.
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedPalettes, setCollapsedPalettes] = useState<ReadonlySet<string>>(new Set());

  const togglePalette = (name: string) => {
    setCollapsedPalettes((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  };

  return (
    <>
      <div className="list-header">
        <button
          type="button"
          className="section-toggle grow"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand section' : 'Collapse section'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          Palettes
        </button>
      </div>
      {!collapsed && palettes.length === 0 && (
        <div className="palettes-section-empty">
          This map carries no palettes — add one in Manage palettes.
        </div>
      )}
      {!collapsed &&
        palettes.map((p) => {
          const design = !isLinePalette(p);
          const paletteCollapsed = collapsedPalettes.has(p.name);
          return (
            <Fragment key={p.name}>
              <div className="list-header palettes-section-palette">
                <button
                  type="button"
                  className="section-toggle grow"
                  aria-expanded={!paletteCollapsed}
                  title={paletteCollapsed ? 'Expand palette' : 'Collapse palette'}
                  onClick={() => togglePalette(p.name)}
                >
                  {paletteCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  {p.name}
                  {design && <span className="palette-kind-badge">design</span>}
                </button>
              </div>
              {!paletteCollapsed &&
                p.swatches.map((s, i) => (
                  <div key={s.name} className="list-row palettes-section-row">
                    <ColorField
                      value={s.color}
                      onChange={(c) => recolorMapPaletteColor(p.name, i, c)}
                      ariaLabel={`${p.name} ${s.name}`}
                      title={design ? 'Light mode color' : 'Edit color'}
                    />
                    {design && (
                      <ColorField
                        value={s.night ?? s.color}
                        onChange={(c) => recolorMapPaletteColor(p.name, i, c, 'night')}
                        ariaLabel={`${p.name} ${s.name} dark`}
                        title="Dark mode color"
                      />
                    )}
                    <SwatchNameField palette={p.name} index={i} name={s.name} />
                  </div>
                ))}
            </Fragment>
          );
        })}
    </>
  );
}
