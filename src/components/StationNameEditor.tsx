import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { beginHistoryGroup } from '../state/store';
import { redo, undo } from '../state/history';
import { useThemeColors } from '../state/theme';
import { LINE_HEIGHT } from '../geometry/textMeasure';
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
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const theme = useThemeColors();
  const [editorHeight, setEditorHeight] = useState(minHeight);
  // Open a history group on mount. Doing this in useEffect (rather than via
  // an onFocus handler) sidesteps any uncertainty about whether the synthetic
  // focus event fires for an input inside a foreignObject when el.focus() is
  // called programmatically. Group is committed on blur, Enter, or unmount.
  const groupRef = useRef<ReturnType<typeof beginHistoryGroup> | null>(null);
  useEffect(() => {
    groupRef.current = beginHistoryGroup();
    const el = ref.current;
    el?.focus();
    el?.select();
    return () => {
      groupRef.current?.commit();
      groupRef.current = null;
    };
  }, []);

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
  }, [value, minHeight, fontSize]);

  const closeEditor = () => {
    groupRef.current?.commit();
    groupRef.current = null;
    onCommit();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter commits (preserves single-line muscle memory). Shift+Enter
    // inserts a newline so labels can be multiline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      closeEditor();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
      e.stopPropagation();
      return;
    }
    // Intercept Cmd/Ctrl+Z and friends. The browser's native input undo
    // would only revert one keystroke at a time AND fire onChange, creeping
    // the doc back one char per Ctrl-Z. Commit the rename group, run our
    // doc-level undo/redo, then close — one Ctrl-Z reverts the whole rename.
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      closeEditor();
      if (e.shiftKey) redo();
      else undo();
      e.stopPropagation();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      closeEditor();
      redo();
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
  };

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
        onBlur={closeEditor}
        onKeyDown={onKey}
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
          border: '1px solid #1a4ea8',
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
