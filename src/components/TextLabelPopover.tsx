import { type ReactNode } from 'react';
import {
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
} from '@radix-ui/react-icons';
import { FieldCheckbox } from './FieldCheckbox';
import { useDoc } from '../state/store';
import { useLabelEditorPrefs } from '../state/labelEditorPrefs';
import { type ViewportProjection } from './canvas/screenAnchor';
import type { AABB } from '../geometry/rectPolygon';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { usePersistedTextareaHeight } from './usePersistedTextareaHeight';
import { StyleRow } from './StyleRow';
import { WeightSelect, ItalicButton } from './WeightItalicControls';
import {
  FONT_SIZE_STEP,
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
import { DayNightColorRow } from './DayNightColorRow';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import { SegmentedToggle } from './SegmentedToggle';
import type { TextLabel, TextLabelAlign, TextLabelWeight } from '../model/types';

interface Props {
  label: TextLabel;
  // The label's world AABB at the moment of selection — the spawn opens the
  // popover beside it. Placement is frozen at spawn but projected through the
  // *live* viewport, so the popover tracks canvas pan/zoom while ignoring the
  // label's own moves.
  worldRect: AABB;
  view: ViewportProjection;
  // Spawn-placement box (host minus the open sidebar strip); see ItemPopovers.
  spawnBox?: { w: number; h: number };
  onClose: () => void;
}

const ALIGNS: { value: TextLabelAlign; icon: ReactNode; title: string }[] = [
  { value: 'left', icon: <TextAlignLeftIcon />, title: 'Align left' },
  { value: 'center', icon: <TextAlignCenterIcon />, title: 'Align center' },
  { value: 'right', icon: <TextAlignRightIcon />, title: 'Align right' },
  { value: 'justify', icon: <TextAlignJustifyIcon />, title: 'Justify' },
];

export function TextLabelPopover({ label, worldRect, view, spawnBox, onClose }: Props) {
  const updateTextLabel = useDoc((s) => s.updateTextLabel);
  const deleteTextLabel = useDoc((s) => s.deleteTextLabel);

  // Remember the manually stretched height of the text box, per label, so it
  // reopens at the size the user left it (see usePersistedTextareaHeight).
  // MUST be called before useDraggablePopover: both apply layout effects, and
  // same-fiber layout effects run in hook-call order — the persisted height
  // has to be on the textarea before the spawn placement measures the shell,
  // or a stretched text box gets placed (and clamped) for its default height
  // and paints past the host bottom.
  const { attach: attachTextBox, onPointerUp: onTextBoxPointerUp } = usePersistedTextareaHeight(
    label.editorHeight,
    (h) => updateTextLabel(label.id, { editorHeight: h }),
  );

  // Frozen-anchor + header-drag mechanism (freeze the spawn at first display
  // so the size slider can't move the popover and feed back into itself;
  // re-freeze when the selected label changes; project live for pan/zoom).
  // Shared with the polygon popover.
  const { anchor, measuring, shellRef, headerHandlers } = useDraggablePopover(
    label.id,
    worldRect,
    view,
    false,
    spawnBox,
  );

  const textField = useFieldHistory();

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
      title="Label"
      left={anchor.x}
      top={anchor.y}
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <div className="row-block">
        <label htmlFor={`label-text-${label.id}`}>Text</label>
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
        <FieldCheckbox
          id={`label-wrap-${label.id}`}
          ariaLabel="Wrap"
          title="Wrap long lines in this editor (view only — doesn't change the label)"
          checked={wrapText}
          onCheckedChange={setWrapText}
        />
      </div>

      {/* Text + Wrap above are content/editor controls; the style row heads
          the FORMATTING block it applies to. */}
      <StyleRow
        key={label.id}
        kind="textLabel"
        itemId={label.id}
        styleId={label.styleId}
        disabled={locked}
      />
      <hr className="popover-divider" aria-hidden="true" />
      <DayNightColorRow
        label="Color"
        id={`label-color-${label.id}`}
        darkId={`label-dark-color-${label.id}`}
        lightAriaLabel="Label color"
        darkAriaLabel="Dark mode label color"
        titleNoun="color"
        value={label.color}
        darkValue={label.darkColor}
        disabled={locked}
        onChange={setColor}
        onDarkChange={setDarkColor}
      />

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
        <WeightSelect
          value={label.weight}
          italic={label.italic}
          disabled={locked}
          onChange={setWeight}
        />
      </div>

      <hr className="popover-divider" aria-hidden="true" />

      <div className="row">
        <label>Align</label>
        <div className="shape-group">
          <SegmentedToggle
            value={label.align}
            disabled={locked}
            onSelect={(v) => setAlign(v as TextLabelAlign)}
            options={ALIGNS.map((a) => ({
              value: a.value,
              label: a.title,
              title: a.title,
              content: a.icon,
            }))}
          />
          <ItalicButton
            active={label.italic}
            disabled={locked}
            onToggle={() => setItalic(!label.italic)}
          />
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
