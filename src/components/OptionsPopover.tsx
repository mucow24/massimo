import { Fragment, useEffect, useId, useRef, useState } from 'react';
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

  const curveField = useFieldHistory();
  const fontSizeField = useFieldHistory();
  const transferThicknessField = useFieldHistory();
  const transferColorField = useFieldHistory();
  const transferStrokeWidthField = useFieldHistory();
  const transferStrokeColorField = useFieldHistory();

  // Local mirror of the spinbutton's text — lets the user clear the field
  // without immediately writing NaN to the store. Re-syncs to the store on
  // blur (so out-of-range or empty values snap back to the clamped value).
  const [fontSizeText, setFontSizeText] = useState(String(labelFontSize));
  const fontSizeFocusedRef = useRef(false);
  useEffect(() => {
    if (!fontSizeFocusedRef.current) setFontSizeText(String(labelFontSize));
  }, [labelFontSize]);

  const [transferThicknessText, setTransferThicknessText] = useState(String(transferThickness));
  const transferThicknessFocusedRef = useRef(false);
  useEffect(() => {
    if (!transferThicknessFocusedRef.current) setTransferThicknessText(String(transferThickness));
  }, [transferThickness]);

  const [transferStrokeWidthText, setTransferStrokeWidthText] = useState(
    String(transferStrokeWidth),
  );
  const transferStrokeWidthFocusedRef = useRef(false);
  useEffect(() => {
    if (!transferStrokeWidthFocusedRef.current)
      setTransferStrokeWidthText(String(transferStrokeWidth));
  }, [transferStrokeWidth]);

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
                fontSizeFocusedRef.current = true;
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
                fontSizeFocusedRef.current = false;
                setFontSizeText(String(useDoc.getState().labelFontSize));
                fontSizeField.onBlur();
              }}
            />
          </div>

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

          <div className="options-popover-row">
            <label htmlFor={`${panelId}-transferThickness`} className="options-popover-label">
              Transfer thickness
            </label>
            <input
              id={`${panelId}-transferThickness`}
              type="range"
              min={TRANSFER_THICKNESS_MIN}
              max={TRANSFER_THICKNESS_MAX}
              step={1}
              value={transferThickness}
              onChange={(e) => setTransferThickness(Number(e.target.value))}
              {...transferThicknessField}
            />
            <input
              type="number"
              aria-label="Transfer thickness"
              min={TRANSFER_THICKNESS_MIN}
              step={1}
              className="options-popover-spin"
              value={transferThicknessText}
              onFocus={() => {
                transferThicknessFocusedRef.current = true;
                transferThicknessField.onFocus();
              }}
              onChange={(e) => {
                const raw = e.target.value;
                setTransferThicknessText(raw);
                if (raw === '') return;
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                setTransferThickness(n);
              }}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 1 : -1;
                setTransferThickness(useDoc.getState().transferThickness + delta);
              }}
              onBlur={() => {
                transferThicknessFocusedRef.current = false;
                setTransferThicknessText(String(useDoc.getState().transferThickness));
                transferThicknessField.onBlur();
              }}
            />
          </div>

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

          <div className="options-popover-row">
            <label htmlFor={`${panelId}-transferStrokeWidth`} className="options-popover-label">
              Transfer stroke
            </label>
            <input
              id={`${panelId}-transferStrokeWidth`}
              type="range"
              min={TRANSFER_STROKE_WIDTH_MIN}
              max={TRANSFER_STROKE_WIDTH_MAX}
              step={1}
              value={transferStrokeWidth}
              onChange={(e) => setTransferStrokeWidth(Number(e.target.value))}
              {...transferStrokeWidthField}
            />
            <input
              type="number"
              aria-label="Transfer stroke"
              min={TRANSFER_STROKE_WIDTH_MIN}
              max={TRANSFER_STROKE_WIDTH_MAX}
              step={1}
              className="options-popover-spin"
              value={transferStrokeWidthText}
              onFocus={() => {
                transferStrokeWidthFocusedRef.current = true;
                transferStrokeWidthField.onFocus();
              }}
              onChange={(e) => {
                const raw = e.target.value;
                setTransferStrokeWidthText(raw);
                if (raw === '') return;
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                setTransferStrokeWidth(n);
              }}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 1 : -1;
                setTransferStrokeWidth(useDoc.getState().transferStrokeWidth + delta);
              }}
              onBlur={() => {
                transferStrokeWidthFocusedRef.current = false;
                setTransferStrokeWidthText(String(useDoc.getState().transferStrokeWidth));
                transferStrokeWidthField.onBlur();
              }}
            />
          </div>

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
