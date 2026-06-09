import { Fragment, useId, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, MixerHorizontalIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import {
  LABEL_FONT_SIZE_MAX,
  LABEL_FONT_SIZE_MIN,
  LABEL_WEIGHT_NAMES,
  TRANSFER_STROKE_WIDTH_MAX,
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_THICKNESS_MAX,
  TRANSFER_THICKNESS_MIN,
} from '../model/transforms';
import type { TextLabelWeight } from '../model/types';
import { PALETTES } from '../model/palettes';
import { NumericFieldRow } from './NumericFieldRow';
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
  const labelWeight = useDoc((s) => s.labelWeight);
  const setLabelWeight = useDoc((s) => s.setLabelWeight);
  const labelItalic = useDoc((s) => s.labelItalic);
  const setLabelItalic = useDoc((s) => s.setLabelItalic);
  const activePalettes = useDoc((s) => s.activePalettes);
  const togglePalette = useDoc((s) => s.togglePalette);
  const transferThickness = useDoc((s) => s.transferThickness);
  const setTransferThickness = useDoc((s) => s.setTransferThickness);
  const transferColor = useDoc((s) => s.transferColor);
  const setTransferColor = useDoc((s) => s.setTransferColor);
  const transferStrokeWidth = useDoc((s) => s.transferStrokeWidth);
  const setTransferStrokeWidth = useDoc((s) => s.setTransferStrokeWidth);
  const transferStrokeColor = useDoc((s) => s.transferStrokeColor);
  const setTransferStrokeColor = useDoc((s) => s.setTransferStrokeColor);

  const [palettesExpanded, setPalettesExpanded] = useState(false);

  // Curve radius is slider-only (no spinbutton), so it stays inline with its
  // own useFieldHistory. The slider+spinbutton fields all go through
  // <NumericFieldRow />, which manages its own field history internally.
  const curveField = useFieldHistory();
  const transferColorField = useFieldHistory();
  const transferStrokeColorField = useFieldHistory();

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

          <NumericFieldRow
            id={`${panelId}-fontSize`}
            label="Font size"
            min={LABEL_FONT_SIZE_MIN}
            max={LABEL_FONT_SIZE_MAX}
            step={1}
            value={labelFontSize}
            onChange={setLabelFontSize}
            getCurrent={() => useDoc.getState().labelFontSize}
            textboxAllowAboveMax
          />

          <div className="options-popover-row">
            <label htmlFor={`${panelId}-weight`} className="options-popover-label">
              Weight
            </label>
            <select
              id={`${panelId}-weight`}
              aria-label="Weight"
              className="weight-select"
              value={labelWeight}
              onChange={(e) => {
                const n = Number(e.target.value) as TextLabelWeight;
                setLabelWeight(n);
              }}
            >
              {LABEL_WEIGHT_NAMES.map((w) => (
                <option
                  key={w.value}
                  value={w.value}
                  style={{
                    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                    fontWeight: w.value,
                    fontStyle: labelItalic ? 'italic' : 'normal',
                  }}
                >
                  {w.name}
                </option>
              ))}
            </select>
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

          <NumericFieldRow
            id={`${panelId}-transferThickness`}
            label="Transfer thickness"
            min={TRANSFER_THICKNESS_MIN}
            max={TRANSFER_THICKNESS_MAX}
            step={1}
            value={transferThickness}
            onChange={setTransferThickness}
            getCurrent={() => useDoc.getState().transferThickness}
            textboxAllowAboveMax
          />

          <div className="options-popover-row">
            <label htmlFor={`${panelId}-transferColor`} className="options-popover-label">
              Transfer color
            </label>
            <input
              id={`${panelId}-transferColor`}
              type="color"
              aria-label="Transfer color"
              value={transferColor}
              onChange={(e) => setTransferColor(e.target.value)}
              {...transferColorField}
            />
          </div>

          <NumericFieldRow
            id={`${panelId}-transferStrokeWidth`}
            label="Transfer stroke"
            min={TRANSFER_STROKE_WIDTH_MIN}
            max={TRANSFER_STROKE_WIDTH_MAX}
            step={1}
            value={transferStrokeWidth}
            onChange={setTransferStrokeWidth}
            getCurrent={() => useDoc.getState().transferStrokeWidth}
            textboxAllowAboveMax
          />

          <div className="options-popover-row">
            <label htmlFor={`${panelId}-transferStrokeColor`} className="options-popover-label">
              Transfer stroke color
            </label>
            <input
              id={`${panelId}-transferStrokeColor`}
              type="color"
              aria-label="Transfer stroke color"
              value={transferStrokeColor}
              onChange={(e) => setTransferStrokeColor(e.target.value)}
              {...transferStrokeColorField}
            />
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
