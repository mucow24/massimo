import { type ReactNode } from 'react';
import {
  FontItalicIcon,
  MoonIcon,
  SunIcon,
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { useLabelEditorPrefs } from '../state/labelEditorPrefs';
import { type ViewportProjection } from './canvas/screenAnchor';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { usePersistedTextareaHeight } from './usePersistedTextareaHeight';
import {
  FONT_SIZE_STEP,
  isLabelWeight,
  LABEL_WEIGHT_NAMES,
  TEXT_LABEL_FONT_SIZE_MAX,
  TEXT_LABEL_FONT_SIZE_MIN,
  TEXT_LABEL_LEADING_DEFAULT,
  TEXT_LABEL_LEADING_MAX,
  TEXT_LABEL_LEADING_MIN,
  TEXT_LABEL_LEADING_STEP,
  TEXT_LABEL_TRACKING_DEFAULT,
  TEXT_LABEL_TRACKING_MAX,
  TEXT_LABEL_TRACKING_MIN,
  TEXT_LABEL_TRACKING_STEP,
  TEXT_LABEL_WIDTH_MAX,
} from '../model/transforms';
import { useFieldHistory } from './useFieldHistory';
import { ColorField } from './ColorField';
import { NumericFieldRow } from './NumericFieldRow';
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

const ALIGNS: { value: TextLabelAlign; icon: ReactNode; title: string }[] = [
  { value: 'left', icon: <TextAlignLeftIcon />, title: 'Align left' },
  { value: 'center', icon: <TextAlignCenterIcon />, title: 'Align center' },
  { value: 'right', icon: <TextAlignRightIcon />, title: 'Align right' },
  { value: 'justify', icon: <TextAlignJustifyIcon />, title: 'Justify' },
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

  // Remember the manually stretched height of the text box, per label, so it
  // reopens at the size the user left it (see usePersistedTextareaHeight).
  const { attach: attachTextBox, onPointerUp: onTextBoxPointerUp } = usePersistedTextareaHeight(
    label.editorHeight,
    (h) => updateTextLabel(label.id, { editorHeight: h }),
  );

  // Soft-wrap toggle for the textarea — a remembered editor preference (not
  // label data), so long justified paragraphs stay visible instead of scrolling
  // off the right edge, and the choice sticks across popover opens and reloads.
  const wrapText = useLabelEditorPrefs((s) => s.wrapText);
  const setWrapText = useLabelEditorPrefs((s) => s.setWrapText);

  const setText = (text: string) => updateTextLabel(label.id, { text });
  const setFontSize = (n: number) => updateTextLabel(label.id, { fontSize: n });
  const setAlign = (align: TextLabelAlign) => updateTextLabel(label.id, { align });
  const setItalic = (italic: boolean) => updateTextLabel(label.id, { italic });
  const setWeight = (weight: TextLabelWeight) => updateTextLabel(label.id, { weight });
  const setColor = (color: string) => updateTextLabel(label.id, { color });
  const setDarkColor = (darkColor: string) => updateTextLabel(label.id, { darkColor });
  const setWidth = (n: number) => updateTextLabel(label.id, { width: n });
  const setLeading = (n: number) => updateTextLabel(label.id, { leading: n });
  const setTracking = (n: number) => updateTextLabel(label.id, { tracking: n });
  const locked = label.locked ?? false;
  const onToggleLock = () => updateTextLabel(label.id, { locked: !locked });
  const onDelete = () => {
    deleteTextLabel(label.id);
    onClose();
  };

  // Escape closes via App's global handler (it deselects the label, which
  // unmounts the popover — guarded so Esc inside a field stays with the
  // field). Outside click likewise closes through canvas deselection.
  return (
    <DraggablePopoverShell
      className="text-label-popover"
      left={anchor.x}
      top={anchor.y}
      headerHandlers={headerHandlers}
    >
      <div className="row-block">
        <label htmlFor={`label-text-${label.id}`}>
          <span style={{ fontWeight: 700 }}>Text</span>
        </label>
        <textarea
          id={`label-text-${label.id}`}
          ref={attachTextBox}
          className={wrapText ? 'wrap' : undefined}
          value={label.text}
          disabled={locked}
          onChange={(e) => setText(e.target.value)}
          onPointerUp={onTextBoxPointerUp}
          rows={Math.max(2, label.text.split('\n').length)}
          {...textField}
        />
      </div>

      {/* View-only soft-wrap for the editor above — never touches the label, so
          it stays usable even when the label is locked. */}
      <div className="row">
        <label htmlFor={`label-wrap-${label.id}`}>Wrap</label>
        <input
          id={`label-wrap-${label.id}`}
          type="checkbox"
          aria-label="Wrap"
          title="Wrap long lines in this editor (view only — doesn't change the label)"
          checked={wrapText}
          onChange={(e) => setWrapText(e.target.checked)}
        />
      </div>

      <div className="row">
        <label htmlFor={`label-color-${label.id}`}>Color</label>
        <SunIcon aria-hidden="true" />
        <ColorField
          id={`label-color-${label.id}`}
          ariaLabel="Label color"
          title="Light mode color"
          value={label.color}
          disabled={locked}
          onChange={setColor}
        />
        <MoonIcon aria-hidden="true" />
        <ColorField
          id={`label-dark-color-${label.id}`}
          ariaLabel="Dark mode label color"
          title="Dark mode color"
          value={label.darkColor}
          disabled={locked}
          onChange={setDarkColor}
        />
      </div>

      {/* textboxAllowAboveMax: the spinbutton (typing and step buttons) accepts
          sizes beyond the slider's range; the transform clamps at MIN only. */}
      <NumericFieldRow
        id={`label-size-${label.id}`}
        label="Size"
        min={TEXT_LABEL_FONT_SIZE_MIN}
        max={TEXT_LABEL_FONT_SIZE_MAX}
        step={FONT_SIZE_STEP}
        value={label.fontSize}
        onChange={setFontSize}
        getCurrent={() => useDoc.getState().textLabels[label.id]?.fontSize ?? label.fontSize}
        textboxAllowAboveMax
        disabled={locked}
      />

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

      <hr className="popover-divider" aria-hidden="true" />

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
            <FontItalicIcon />
          </button>
        </div>
      </div>

      {/* Column width. 0 = Auto (size to content, honor manual '\n' breaks);
          >0 wraps text to a fixed-width column. The spinbutton accepts widths
          beyond the slider's range; the transform clamps only at 0. */}
      <NumericFieldRow
        id={`label-width-${label.id}`}
        label="Width"
        min={0}
        max={TEXT_LABEL_WIDTH_MAX}
        step={1}
        value={label.width ?? 0}
        onChange={setWidth}
        getCurrent={() => useDoc.getState().textLabels[label.id]?.width ?? 0}
        textboxAllowAboveMax
        disabled={locked}
      />

      <hr className="popover-divider" aria-hidden="true" />

      {/* Line-spacing multiplier (1 = normal); the tick marks the neutral 1. */}
      <NumericFieldRow
        id={`label-leading-${label.id}`}
        label="Leading"
        min={TEXT_LABEL_LEADING_MIN}
        max={TEXT_LABEL_LEADING_MAX}
        step={TEXT_LABEL_LEADING_STEP}
        value={label.leading ?? TEXT_LABEL_LEADING_DEFAULT}
        onChange={setLeading}
        getCurrent={() =>
          useDoc.getState().textLabels[label.id]?.leading ?? TEXT_LABEL_LEADING_DEFAULT
        }
        detent={TEXT_LABEL_LEADING_DEFAULT}
        textboxAllowAboveMax
        disabled={locked}
      />

      {/* Letter-spacing in em (0 = normal); the tick marks the neutral 0. */}
      <NumericFieldRow
        id={`label-tracking-${label.id}`}
        label="Tracking"
        min={TEXT_LABEL_TRACKING_MIN}
        max={TEXT_LABEL_TRACKING_MAX}
        step={TEXT_LABEL_TRACKING_STEP}
        value={label.tracking ?? TEXT_LABEL_TRACKING_DEFAULT}
        onChange={setTracking}
        getCurrent={() =>
          useDoc.getState().textLabels[label.id]?.tracking ?? TEXT_LABEL_TRACKING_DEFAULT
        }
        detent={TEXT_LABEL_TRACKING_DEFAULT}
        textboxAllowAboveMax
        disabled={locked}
      />

      <PopoverFooter noun="label" locked={locked} onToggleLock={onToggleLock} onDelete={onDelete} />
    </DraggablePopoverShell>
  );
}
