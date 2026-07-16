import { Fragment, useId, useRef, useState } from 'react';
import { Cross2Icon, MixerHorizontalIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import type { SeamEdges } from '../model/types';
import { PALETTES } from '../model/palettes';
import { parseCustomPalette } from '../model/customPalette';
import { useCustomPalettes } from '../state/customPalettes';
import { usePopover } from './usePopover';
import { FieldCheckbox } from './FieldCheckbox';

/**
 * Toolbar "Options" button. The panel holds the global branch-seam inner-edge
 * mode selector (`seamEdges`) and the color-palette picker. Per-line curve
 * radius moved to the line style (line inspector / line style presets) and
 * station-label typography lives on per-station styles, so neither appears
 * here. Mirrors `Menu`'s open/close via `usePopover`.
 */
export function OptionsPopover() {
  const { open, setOpen, wrapRef } = usePopover();
  const panelId = useId();

  const activePalettes = useDoc((s) => s.activePalettes);
  const togglePalette = useDoc((s) => s.togglePalette);
  const seamEdges = useDoc((s) => s.seamEdges);
  const setSeamEdges = useDoc((s) => s.setSeamEdges);
  const seamEdgesId = useId();

  const customPalettes = useCustomPalettes((s) => s.palettes);
  const addPalette = useCustomPalettes((s) => s.addPalette);
  const deleteCustomPalette = useDoc((s) => s.deleteCustomPalette);
  const paletteFileRef = useRef<HTMLInputElement>(null);
  const [paletteError, setPaletteError] = useState<string | null>(null);

  const onLoadPalette = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    const result = parseCustomPalette(await f.text());
    if (!result.ok) {
      setPaletteError(result.error);
      return;
    }
    setPaletteError(null);
    addPalette({ name: result.name, swatches: result.swatches });
  };

  return (
    <div className="options-popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'tool-btn' + (open ? ' active' : '')}
        title="Options"
        aria-label="Options"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <MixerHorizontalIcon />
      </button>
      {open && (
        <div className="options-popover" id={panelId} role="dialog" aria-label="Options">
          <div className="options-popover-row options-popover-row-block">
            <label htmlFor={seamEdgesId} className="options-popover-block-label">
              Branch inner edges
            </label>
            <select
              id={seamEdgesId}
              className="options-popover-select"
              value={seamEdges}
              onChange={(e) => setSeamEdges(e.target.value as SeamEdges)}
            >
              <option value="both">Both</option>
              <option value="straight">Straight only</option>
              <option value="curved">Curved only</option>
            </select>
          </div>
          <hr className="options-popover-divider" aria-hidden="true" />
          <div className="options-popover-row options-popover-row-block">
            <div className="options-palettes">
              <button
                type="button"
                className="btn-mini options-palette-load"
                onClick={() => paletteFileRef.current?.click()}
              >
                Load palette…
              </button>
              <input
                ref={paletteFileRef}
                type="file"
                accept=".json,application/json"
                aria-label="Load palette file"
                style={{ display: 'none' }}
                onChange={onLoadPalette}
              />
              {paletteError && (
                <div className="options-palette-error" role="alert">
                  {paletteError}
                </div>
              )}
              {customPalettes.map((palette) => {
                const checked = activePalettes.includes(palette.id);
                const isLone = checked && activePalettes.length === 1;
                return (
                  <label key={palette.id} className="options-palette-card" aria-disabled={isLone}>
                    <div className="options-palette-card-row">
                      <FieldCheckbox
                        ariaLabel={palette.name}
                        checked={checked}
                        disabled={isLone}
                        onCheckedChange={() => togglePalette(palette.id)}
                      />
                      <span>{palette.name}</span>
                      <button
                        type="button"
                        className="btn-mini danger options-palette-delete"
                        aria-label={`Delete ${palette.name}`}
                        title={`Delete ${palette.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          deleteCustomPalette(palette.id);
                        }}
                      >
                        <Cross2Icon />
                      </button>
                    </div>
                    <div className="options-palette-strip" aria-hidden="true">
                      {palette.swatches.map((s, si) => (
                        <span key={si} style={{ background: s.color }} />
                      ))}
                    </div>
                  </label>
                );
              })}
              {customPalettes.length > 0 && (
                <hr className="options-palette-separator" aria-hidden="true" />
              )}
              {PALETTES.map((palette, i) => {
                const checked = activePalettes.includes(palette.id);
                const isLone = checked && activePalettes.length === 1;
                const prev = i > 0 ? PALETTES[i - 1] : null;
                const showSeparator = prev !== null && prev.continent !== palette.continent;
                return (
                  <Fragment key={palette.id}>
                    {showSeparator && (
                      <hr className="options-palette-separator" aria-hidden="true" />
                    )}
                    <label className="options-palette-card" aria-disabled={isLone}>
                      <div className="options-palette-card-row">
                        <FieldCheckbox
                          ariaLabel={palette.name}
                          checked={checked}
                          disabled={isLone}
                          onCheckedChange={() => togglePalette(palette.id)}
                        />
                        <span>{palette.name}</span>
                      </div>
                      <div className="options-palette-strip" aria-hidden="true">
                        {palette.swatches.map((s) => (
                          <span key={s.color} style={{ background: s.color }} />
                        ))}
                      </div>
                    </label>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
