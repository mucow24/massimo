import { useLayoutEffect, useState } from 'react';
import { useThemeColors } from '../state/theme';
import { LINE_HEIGHT } from '../geometry/textMeasure';
import { useRenameEditor } from './useRenameEditor';
export function StationNameEditor({
  x,
  y,
  width,
  minHeight,
  transform,
  fontSize,
  fontWeight,
  italic,
  textAlign,
  value,
  onChange,
  onCommit,
}: {
  x: number;
  y: number;
  width: number;
  // Label hit-rect height — the floor for the textarea so it opens covering
  // the painted label and only grows past it when extra lines are added.
  minHeight: number;
  // Rotation transform shared with the label hit rect, so the editor pivots
  // about the label anchor exactly like the rendered text does.
  transform: string;
  // Font metrics mirrored from the rendered label so the editor glyphs match
  // it 1:1 (no forced bold, no fixed size).
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  textAlign: 'left' | 'center' | 'right';
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  // History group + focus/select + Enter/Escape/Ctrl+Z protocol — shared
  // with the station popover's title editor.
  const { ref, onKeyDown, onBlur } = useRenameEditor(onCommit);
  const theme = useThemeColors();
  const [editorHeight, setEditorHeight] = useState(minHeight);

  // Reset to 'auto' before reading scrollHeight so the textarea can shrink
  // when lines are removed, then snap to content height (floored at the label
  // box so a single-line edit stays the same height as the label it covers).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.max(minHeight, el.scrollHeight);
    el.style.height = h + 'px';
    setEditorHeight((prev) => (prev === h ? prev : h));
  }, [ref, value, minHeight, fontSize]);

  return (
    <foreignObject
      x={x}
      y={y}
      width={width}
      height={editorHeight}
      transform={transform}
      style={{ overflow: 'visible' }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          fontSize,
          fontWeight,
          fontStyle: italic ? 'italic' : undefined,
          // 1px border + 1px padding (with border-box) insets the text 2px on
          // every side — the same HIT_PAD the label hit rect adds around the
          // glyphs — so the editable text lands exactly where the label paints.
          padding: 1,
          border: `1px solid ${theme.accent}`,
          borderRadius: 2,
          background: theme.editorBg,
          color: theme.editorText,
          textAlign,
          fontFamily: 'inherit',
          lineHeight: LINE_HEIGHT,
          boxSizing: 'border-box',
          resize: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre',
        }}
      />
    </foreignObject>
  );
}
