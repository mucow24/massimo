import { useEffect } from 'react';
import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import {
  isLabelWeight,
  LABEL_WEIGHT_NAMES,
  TEXT_LABEL_FONT_SIZE_MAX,
  TEXT_LABEL_FONT_SIZE_MIN,
} from '../model/transforms';
import { useFieldHistory } from './useFieldHistory';
import { useNumericField } from './useNumericField';
import { PopoverFooter } from './PopoverFooter';
import type { TextLabel, TextLabelAlign, TextLabelWeight } from '../model/types';

interface Props {
  label: TextLabel;
  // The label's world position at the moment of selection. Frozen at mount
  // (see frozenWorld below) but projected through the *live* viewport, so the
  // popover tracks canvas pan/zoom while ignoring the label's own moves.
  world: { x: number; y: number };
  view: ViewportProjection;
  onClose: () => void;
}

const ALIGNS: { value: TextLabelAlign; icon: string; title: string }[] = [
  { value: 'left', icon: '⇤', title: 'Align left' },
  { value: 'center', icon: '↔', title: 'Align center' },
  { value: 'right', icon: '⇥', title: 'Align right' },
];

export function TextLabelPopover({ label, world, view, onClose }: Props) {
  const updateTextLabel = useDoc((s) => s.updateTextLabel);
  const deleteTextLabel = useDoc((s) => s.deleteTextLabel);

  // Frozen-anchor + header-drag mechanism (freeze world at mount so the size
  // slider can't move the popover and feed back into itself; re-freeze when the
  // selected label changes; project live for pan/zoom). Shared with the polygon
  // popover.
  const { anchor, headerHandlers } = useDraggablePopover(label.id, world, view);

  const textField = useFieldHistory();
  // Group each color picker's continuous edits into one undo entry, mirroring
  // the polygon popover's day/night fill controls.
  const colorField = useFieldHistory();
  const darkColorField = useFieldHistory();

  const setText = (text: string) => updateTextLabel(label.id, { text });
  const setFontSize = (n: number) => updateTextLabel(label.id, { fontSize: n });
  const setAlign = (align: TextLabelAlign) => updateTextLabel(label.id, { align });
  const setItalic = (italic: boolean) => updateTextLabel(label.id, { italic });
  const setWeight = (weight: TextLabelWeight) => updateTextLabel(label.id, { weight });
  const setColor = (color: string) => updateTextLabel(label.id, { color });
  const setDarkColor = (darkColor: string) => updateTextLabel(label.id, { darkColor });
  const locked = label.locked ?? false;
  const onToggleLock = () => updateTextLabel(label.id, { locked: !locked });
  const size = useNumericField(
    label.fontSize,
    setFontSize,
    () => useDoc.getState().textLabels[label.id]?.fontSize ?? label.fontSize,
  );
  const onDelete = () => {
    deleteTextLabel(label.id);
    onClose();
  };

  const onSizeRange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n)) setFontSize(n);
  };

  // Escape closes; outside click does NOT (the canvas's onCanvasClick handles
  // that by deselecting the label, which unmounts the popover).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        const inField =
          tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable;
        if (inField) {
          // Let the field swallow the Esc (textarea unfocus, etc.) — don't
          // close the popover out from under an in-progress edit.
          return;
        }
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="text-label-popover"
      style={{
        position: 'absolute',
        left: anchor.x + 14,
        top: anchor.y + 14,
        zIndex: 1100,
      }}
      // Stop pointer events from reaching the canvas so clicks inside the
      // popover don't deselect the label.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="header" {...headerHandlers} />
      <div className="body">
        <div className="row-block">
          <label htmlFor={`label-text-${label.id}`}>
            <span style={{ fontWeight: 700 }}>Text</span>
          </label>
          <textarea
            id={`label-text-${label.id}`}
            value={label.text}
            disabled={locked}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(2, label.text.split('\n').length)}
            wrap="off"
            {...textField}
          />
        </div>

        <div className="row" onWheel={size.onNumberWheel}>
          <label>Size</label>
          <input
            type="range"
            min={TEXT_LABEL_FONT_SIZE_MIN}
            max={TEXT_LABEL_FONT_SIZE_MAX}
            step={1}
            value={label.fontSize}
            disabled={locked}
            onChange={onSizeRange}
            onMouseDown={size.history.onFocus}
            onMouseUp={size.history.onBlur}
          />
          <input
            type="number"
            className="size-spin"
            // No `max` — the spinbutton (typing and step buttons) accepts sizes
            // beyond the slider's range; the transform clamps at MIN only.
            min={TEXT_LABEL_FONT_SIZE_MIN}
            step={1}
            value={size.text}
            disabled={locked}
            onChange={size.onNumberChange}
            onWheel={size.onNumberWheel}
            onFocus={size.onNumberFocus}
            onBlur={size.onNumberBlur}
          />
        </div>

        <div className="row">
          <label>Align</label>
          <div className="shape-group">
            {ALIGNS.map((a) => (
              <button
                key={a.value}
                type="button"
                className={'align-btn' + (label.align === a.value ? ' active' : '')}
                disabled={locked}
                onClick={() => setAlign(a.value)}
                title={a.title}
                aria-label={a.title}
                aria-pressed={label.align === a.value}
              >
                {a.icon}
              </button>
            ))}
            <button
              type="button"
              className={'italic-btn' + (label.italic ? ' active' : '')}
              disabled={locked}
              onClick={() => setItalic(!label.italic)}
              title="Italic"
              aria-label="Italic"
              aria-pressed={label.italic}
            >
              I
            </button>
          </div>
        </div>

        <div className="row">
          <label>Weight</label>
          <select
            className="weight-select"
            value={label.weight}
            disabled={locked}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (isLabelWeight(n)) setWeight(n);
            }}
          >
            {LABEL_WEIGHT_NAMES.map((w) => (
              <option
                key={w.value}
                value={w.value}
                style={{
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  fontWeight: w.value,
                  fontStyle: label.italic ? 'italic' : 'normal',
                }}
              >
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <label htmlFor={`label-color-${label.id}`}>Color</label>
          <span aria-hidden="true">☀️</span>
          <input
            id={`label-color-${label.id}`}
            type="color"
            aria-label="Label color"
            title="Light mode color"
            value={label.color}
            disabled={locked}
            onChange={(e) => setColor(e.target.value)}
            {...colorField}
          />
          <span aria-hidden="true">🌙</span>
          <input
            id={`label-dark-color-${label.id}`}
            type="color"
            aria-label="Dark mode label color"
            title="Dark mode color"
            value={label.darkColor}
            disabled={locked}
            onChange={(e) => setDarkColor(e.target.value)}
            {...darkColorField}
          />
        </div>

        <PopoverFooter
          noun="label"
          locked={locked}
          onToggleLock={onToggleLock}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
