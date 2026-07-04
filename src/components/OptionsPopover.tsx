import { Fragment, useId, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Cross2Icon,
  FontItalicIcon,
  MixerHorizontalIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import {
  FONT_SIZE_STEP,
  LABEL_FONT_SIZE_MAX,
  LABEL_FONT_SIZE_MIN,
  LABEL_LEADING_DEFAULT,
  LABEL_LEADING_MAX,
  LABEL_LEADING_MIN,
  LABEL_LEADING_STEP,
  LABEL_TRACKING_DEFAULT,
  LABEL_TRACKING_MAX,
  LABEL_TRACKING_MIN,
  LABEL_TRACKING_STEP,
  LABEL_WEIGHT_NAMES,
  TRANSFER_STROKE_WIDTH_MAX,
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_THICKNESS_MAX,
  TRANSFER_THICKNESS_MIN,
} from '../model/transforms';
import type { TextLabelWeight } from '../model/types';
import { PALETTES } from '../model/palettes';
import { parseCustomPalette } from '../model/customPalette';
import { useCustomPalettes } from '../state/customPalettes';
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
  const labelLeading = useDoc((s) => s.labelLeading);
  const setLabelLeading = useDoc((s) => s.setLabelLeading);
  const labelTracking = useDoc((s) => s.labelTracking);
  const setLabelTracking = useDoc((s) => s.setLabelTracking);
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
            step={FONT_SIZE_STEP}
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
              <FontItalicIcon />
            </button>
          </div>

          {/* Line-spacing multiplier for every station label (1 = normal); the
              tick marks the neutral 1. */}
          <NumericFieldRow
            id={`${panelId}-leading`}
            label="Leading"
            min={LABEL_LEADING_MIN}
            max={LABEL_LEADING_MAX}
            step={LABEL_LEADING_STEP}
            value={labelLeading}
            onChange={setLabelLeading}
            getCurrent={() => useDoc.getState().labelLeading}
            detent={LABEL_LEADING_DEFAULT}
            textboxAllowAboveMax
          />

          {/* Letter-spacing in em for every station label (0 = normal); the
              tick marks the neutral 0. */}
          <NumericFieldRow
            id={`${panelId}-tracking`}
            label="Tracking"
            min={LABEL_TRACKING_MIN}
            max={LABEL_TRACKING_MAX}
            step={LABEL_TRACKING_STEP}
            value={labelTracking}
            onChange={setLabelTracking}
            getCurrent={() => useDoc.getState().labelTracking}
            detent={LABEL_TRACKING_DEFAULT}
            textboxAllowAboveMax
          />

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
                        <input
                          type="checkbox"
                          aria-label={palette.name}
                          checked={checked}
                          disabled={isLone}
                          onChange={() => togglePalette(palette.id)}
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
