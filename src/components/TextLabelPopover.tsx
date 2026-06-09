import { useEffect, useRef, useState } from 'react';
import { useDoc } from '../state/store';
import {
  projectToScreen,
  screenDeltaToWorld,
  type ViewportProjection,
} from './canvas/screenAnchor';
import { TEXT_LABEL_FONT_SIZE_MAX, TEXT_LABEL_FONT_SIZE_MIN } from '../model/transforms';
import { useFieldHistory } from './useFieldHistory';
import { useNumericField } from './useNumericField';
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

const WEIGHTS: { value: TextLabelWeight; name: string }[] = [
  { value: 100, name: 'UltraLight' },
  { value: 200, name: 'Thin' },
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

export function TextLabelPopover({ label, world, view, onClose }: Props) {
  const updateTextLabel = useDoc((s) => s.updateTextLabel);
  const deleteTextLabel = useDoc((s) => s.deleteTextLabel);

  // Freeze the label's *world* position at mount. Subsequent changes to the
  // label's position (resize, edit) are ignored — the popover must stay put so
  // controls don't slide out from under the cursor, and so the fontSize slider
  // can't move the popover and feed back into itself (see the test). But we
  // still project the frozen world point through the *live* viewport every
  // render, so the popover tracks canvas pan/zoom. User drags add dragOffset.
  const [frozenWorld, setFrozenWorld] = useState(world);

  // Drag offset (added to the frozen anchor). Persists while the popover stays
  // open so the popover stays where the user put it. Stored in *world* space
  // (not screen pixels) so the moved offset tracks zoom exactly like the
  // projected anchor; a screen-pixel offset would slide the popover relative to
  // the canvas when zooming after a move.
  const [dragWorld, setDragWorld] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // MapCanvas renders a single <TextLabelPopover> with no per-label key, so
  // selecting a *different* label reuses this instance — useState alone would
  // keep the previous label's frozen world and the popover would anchor at the
  // old label. Re-freeze (and drop any drag) when the selected label changes.
  const [prevId, setPrevId] = useState(label.id);
  if (prevId !== label.id) {
    setPrevId(label.id);
    setFrozenWorld(world);
    setDragWorld({ x: 0, y: 0 });
  }
  // Project the frozen anchor *plus* the world-space drag through the live
  // viewport, so both pan/zoom and the user's move stay pinned to the canvas.
  const anchor = projectToScreen(
    { x: frozenWorld.x + dragWorld.x, y: frozenWorld.y + dragWorld.y },
    view,
  );
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
      offX: dragWorld.x,
      offY: dragWorld.y,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s) return;
    // Convert the screen-pixel pointer delta to world units before storing, so
    // the offset scales with zoom like the anchor.
    const dw = screenDeltaToWorld({ x: e.clientX - s.mouseX, y: e.clientY - s.mouseY }, view);
    setDragWorld({ x: s.offX + dw.x, y: s.offY + dw.y });
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

        <div className="row" onWheel={size.onNumberWheel}>
          <label>Size</label>
          <input
            type="range"
            min={TEXT_LABEL_FONT_SIZE_MIN}
            max={TEXT_LABEL_FONT_SIZE_MAX}
            step={1}
            value={label.fontSize}
            onChange={onSizeRange}
            onMouseDown={size.history.onFocus}
            onMouseUp={size.history.onBlur}
          />
          <input
            type="number"
            className="size-spin"
            min={TEXT_LABEL_FONT_SIZE_MIN}
            max={TEXT_LABEL_FONT_SIZE_MAX}
            step={1}
            value={size.text}
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

        <div className="row">
          <label htmlFor={`label-color-${label.id}`}>Color</label>
          <span aria-hidden="true">☀️</span>
          <input
            id={`label-color-${label.id}`}
            type="color"
            aria-label="Label color"
            title="Light mode color"
            value={label.color}
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
            onChange={(e) => setDarkColor(e.target.value)}
            {...darkColorField}
          />
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
