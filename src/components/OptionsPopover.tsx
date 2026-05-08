import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, MixerHorizontalIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { LABEL_FONT_SIZE_MAX, LABEL_FONT_SIZE_MIN } from '../model/transforms';
import { PALETTES } from '../model/palettes';
import { useFieldHistory } from './useFieldHistory';
import { usePopover } from './usePopover';

/**
 * Toolbar button that opens a small floating panel of map-styling options:
 * curve radius, station-label font size, and bold/italic toggles for station
 * labels. Mirrors `Menu`'s open/close behaviour via `usePopover`.
 */
export function OptionsPopover() {
  const { open, setOpen, wrapRef } = usePopover();
  const panelId = useId();

  const curveRadius = useDoc((s) => s.curveRadius);
  const setCurveRadius = useDoc((s) => s.setCurveRadius);
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const setLabelFontSize = useDoc((s) => s.setLabelFontSize);
  const labelBold = useDoc((s) => s.labelBold);
  const setLabelBold = useDoc((s) => s.setLabelBold);
  const labelItalic = useDoc((s) => s.labelItalic);
  const setLabelItalic = useDoc((s) => s.setLabelItalic);
  const activePalettes = useDoc((s) => s.activePalettes);
  const togglePalette = useDoc((s) => s.togglePalette);

  const [palettesExpanded, setPalettesExpanded] = useState(false);

  const curveField = useFieldHistory();
  const fontSizeField = useFieldHistory();

  // Local mirror of the spinbutton's text — lets the user clear the field
  // without immediately writing NaN to the store. Re-syncs to the store on
  // blur (so out-of-range or empty values snap back to the clamped value).
  const [fontSizeText, setFontSizeText] = useState(String(labelFontSize));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setFontSizeText(String(labelFontSize));
  }, [labelFontSize]);

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
          <div className="options-popover-row">
            <label htmlFor={`${panelId}-curve`} className="options-popover-label">
              Curve radius
            </label>
            <input
              id={`${panelId}-curve`}
              type="range"
              min={4}
              max={80}
              step={1}
              value={curveRadius}
              onChange={(e) => setCurveRadius(Number(e.target.value))}
              {...curveField}
            />
            <span className="options-popover-value">{curveRadius}</span>
          </div>

          <div className="options-popover-row">
            <label htmlFor={`${panelId}-fontSize`} className="options-popover-label">
              Font size
            </label>
            <input
              id={`${panelId}-fontSize`}
              type="range"
              min={LABEL_FONT_SIZE_MIN}
              max={LABEL_FONT_SIZE_MAX}
              step={1}
              value={labelFontSize}
              onChange={(e) => setLabelFontSize(Number(e.target.value))}
              {...fontSizeField}
            />
            <input
              type="number"
              aria-label="Font size"
              min={LABEL_FONT_SIZE_MIN}
              max={LABEL_FONT_SIZE_MAX}
              step={1}
              className="options-popover-spin"
              value={fontSizeText}
              onFocus={() => {
                focusedRef.current = true;
                fontSizeField.onFocus();
              }}
              onChange={(e) => {
                const raw = e.target.value;
                setFontSizeText(raw);
                if (raw === '') return; // ignore empty mid-edit
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                setLabelFontSize(n);
              }}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 1 : -1;
                setLabelFontSize(useDoc.getState().labelFontSize + delta);
              }}
              onBlur={() => {
                focusedRef.current = false;
                setFontSizeText(String(useDoc.getState().labelFontSize));
                fontSizeField.onBlur();
              }}
            />
          </div>

          <div className="options-popover-row">
            <span className="options-popover-label">Style</span>
            <button
              type="button"
              className={'tool-btn' + (labelBold ? ' active' : '')}
              aria-pressed={labelBold}
              aria-label="Bold"
              title="Bold station labels"
              onClick={() => setLabelBold(!labelBold)}
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className={'tool-btn' + (labelItalic ? ' active' : '')}
              aria-pressed={labelItalic}
              aria-label="Italic"
              title="Italic station labels"
              onClick={() => setLabelItalic(!labelItalic)}
            >
              <em>I</em>
            </button>
          </div>

          <div className="options-popover-row options-popover-row-block">
            <button
              type="button"
              className="options-palette-disclosure"
              aria-expanded={palettesExpanded}
              onClick={() => setPalettesExpanded((v) => !v)}
            >
              {palettesExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
              <span>Color palettes</span>
            </button>
            {palettesExpanded && (
              <div className="options-palettes">
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
                          <input
                            type="checkbox"
                            aria-label={palette.name}
                            checked={checked}
                            disabled={isLone}
                            onChange={() => togglePalette(palette.id)}
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
