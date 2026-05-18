import { useEffect, useRef, useState } from 'react';
import { useDoc } from '../state/store';
import { TEXT_LABEL_FONT_SIZE_MAX, TEXT_LABEL_FONT_SIZE_MIN } from '../model/transforms';
import { useFieldHistory } from './useFieldHistory';
import type { TextLabel, TextLabelAlign, TextLabelWeight } from '../model/types';

interface Props {
  label: TextLabel;
  // Anchor in screen pixels — only the value at mount is used. The popover
  // captures it once and stays put after that, even if the underlying
  // label's screen position changes (drag, resize, zoom). User-initiated
  // moves happen via the header drag.
  anchor: { x: number; y: number };
  onClose: () => void;
}

const WEIGHTS: { value: TextLabelWeight; name: string }[] = [
  { value: 100, name: 'Thin' },
  { value: 200, name: 'UltraLight' },
  { value: 300, name: 'Light' },
  { value: 400, name: 'Roman' },
  { value: 500, name: 'Medium' },
  { value: 700, name: 'Bold' },
  { value: 800, name: 'Heavy' },
  { value: 900, name: 'Black' },
];

const ALIGNS: { value: TextLabelAlign; icon: string; title: string }[] = [
  { value: 'left', icon: '⇤', title: 'Align left' },
  { value: 'center', icon: '↔', title: 'Align center' },
  { value: 'right', icon: '⇥', title: 'Align right' },
];

export function TextLabelPopover({ label, anchor, onClose }: Props) {
  const updateTextLabel = useDoc((s) => s.updateTextLabel);
  const deleteTextLabel = useDoc((s) => s.deleteTextLabel);

  // Freeze the anchor at mount. Subsequent changes to `anchor` (which
  // tracks the label's screen position) are ignored — the popover must
  // stay where it opened so resizes/edits don't slide controls out from
  // under the user's cursor. User drags still move it via dragOffset.
  const [frozenAnchor] = useState(anchor);

  // Drag offset (added to the frozen anchor). Persists while the popover
  // stays open so the popover stays where the user put it.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStart = useRef<{
    mouseX: number;
    mouseY: number;
    offX: number;
    offY: number;
  } | null>(null);
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offX: dragOffset.x,
      offY: dragOffset.y,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s) return;
    setDragOffset({ x: s.offX + (e.clientX - s.mouseX), y: s.offY + (e.clientY - s.mouseY) });
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const textField = useFieldHistory();
  const sizeField = useFieldHistory();
  const [sizeText, setSizeText] = useState<string>(String(label.fontSize));
  // While the spin/slider field is focused locally, hold off on overwriting
  // the user's in-progress text from the store. Mirrors OptionsPopover.
  const sizeFocused = useRef(false);
  useEffect(() => {
    if (!sizeFocused.current) setSizeText(String(label.fontSize));
  }, [label.fontSize]);

  const setText = (text: string) => updateTextLabel(label.id, { text });
  const setFontSize = (n: number) => updateTextLabel(label.id, { fontSize: n });
  const setAlign = (align: TextLabelAlign) => updateTextLabel(label.id, { align });
  const setItalic = (italic: boolean) => updateTextLabel(label.id, { italic });
  const setWeight = (weight: TextLabelWeight) => updateTextLabel(label.id, { weight });
  const onDelete = () => {
    deleteTextLabel(label.id);
    onClose();
  };

  const onSizeRange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n)) setFontSize(n);
  };
  const onSizeNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setSizeText(raw);
    if (raw === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) setFontSize(n);
  };
  const onSizeNumberWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    setFontSize(label.fontSize + delta);
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
        left: frozenAnchor.x + 14 + dragOffset.x,
        top: frozenAnchor.y + 14 + dragOffset.y,
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
      <div
        className="header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      />
      <div className="body">
        <div className="row-block">
          <label htmlFor={`label-text-${label.id}`}>
            <span style={{ fontWeight: 700 }}>Text</span>
          </label>
          <textarea
            id={`label-text-${label.id}`}
            value={label.text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(2, label.text.split('\n').length)}
            wrap="off"
            {...textField}
          />
        </div>

        <div className="row" onWheel={onSizeNumberWheel}>
          <label>Size</label>
          <input
            type="range"
            min={TEXT_LABEL_FONT_SIZE_MIN}
            max={TEXT_LABEL_FONT_SIZE_MAX}
            step={1}
            value={label.fontSize}
            onChange={onSizeRange}
            onMouseDown={sizeField.onFocus}
            onMouseUp={sizeField.onBlur}
          />
          <input
            type="number"
            className="size-spin"
            min={TEXT_LABEL_FONT_SIZE_MIN}
            max={TEXT_LABEL_FONT_SIZE_MAX}
            step={1}
            value={sizeText}
            onChange={onSizeNumberChange}
            onWheel={onSizeNumberWheel}
            onFocus={() => {
              sizeFocused.current = true;
              sizeField.onFocus();
            }}
            onBlur={() => {
              sizeFocused.current = false;
              setSizeText(String(label.fontSize));
              sizeField.onBlur();
            }}
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
            onChange={(e) => {
              const n = Number(e.target.value);
              if (
                n === 100 ||
                n === 200 ||
                n === 300 ||
                n === 400 ||
                n === 500 ||
                n === 700 ||
                n === 800 ||
                n === 900
              ) {
                setWeight(n);
              }
            }}
          >
            {WEIGHTS.map((w) => (
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

        <div className="footer">
          <button className="delete-btn" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
