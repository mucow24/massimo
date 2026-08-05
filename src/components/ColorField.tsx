import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HexAlphaColorPicker } from 'react-colorful';
import { clamp } from '../util/grid';
import { beginHistoryGroup } from '../state/store';
import { normalizeHex } from '../util/color';

interface Props {
  value: string;
  onChange: (c: string) => void;
  disabled?: boolean;
  /** Accessible name — replaces the native input's aria-label. */
  ariaLabel?: string;
  title?: string;
  id?: string;
  /** Extra classes appended to the swatch button (e.g. a `selected` ring). */
  className?: string;
  /**
   * Render the swatch as an "add a new color" affordance — a rainbow chip with a
   * `+` — instead of mirroring `value`. The picker still opens seeded at
   * `value`. Used by the color palette's always-present "Custom" slot so the
   * add-a-color button never looks like a line-color swatch.
   */
  addNew?: boolean;
}

// Width/height of the floating picker popover (kept in sync with the CSS so the
// edge-flip math can decide whether it fits below the swatch).
const POPOVER_W = 212;
const POPOVER_H = 240;
const GAP = 6;

// Valid hex digit counts (sans '#'): 3/4-digit short forms + 6/8-digit full.
const HEX_LENGTHS = new Set([3, 4, 6, 8]);

/**
 * A buffered hex text field. react-colorful's own `HexColorInput` re-derives its
 * text from the `color` prop on every change with no focus guard, so a
 * normalizing, live-bound parent (which feeds the edited value straight back)
 * resets the field mid-type — and a 3-digit short form like `505` expands to
 * `#550055` and hijacks it. This owns its text while focused, applies only a
 * COMPLETE 6/8-digit hex live, and accepts short forms on blur / Enter.
 */
function HexField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (c: string) => void;
  ariaLabel: string;
}) {
  // Buffer holds the hex digits WITHOUT the '#'; the field always renders one.
  const [digits, setDigits] = useState(() => value.replace(/^#/, ''));
  const focused = useRef(false);
  // Sync from the square-driven / external color — but never while typing, so
  // the round-trip of a live-applied value can't reset the field under the user.
  useEffect(() => {
    if (!focused.current) setDigits(value.replace(/^#/, ''));
  }, [value]);
  const apply = (d: string): string => {
    const norm = normalizeHex('#' + d);
    onChange(norm);
    return norm.replace(/^#/, '');
  };
  return (
    <input
      aria-label={ariaLabel}
      value={'#' + digits}
      spellCheck={false}
      autoComplete="off"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        // Strip the '#' and any junk; the buffer is bare hex digits.
        const d = e.target.value.replace(/[^0-9a-fA-F]/g, '');
        setDigits(d);
        // Apply only a full 6/8-digit hex live; a 3/4-digit short form would
        // expand (505 → #550055) and, fed back, hijack the in-progress entry.
        if (d.length >= 6 && HEX_LENGTHS.has(d.length)) setDigits(apply(d));
      }}
      onBlur={() => {
        focused.current = false;
        // Accept short forms on blur; revert an invalid/partial buffer.
        setDigits(HEX_LENGTHS.has(digits.length) ? apply(digits) : value.replace(/^#/, ''));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * A color swatch that opens a react-colorful RGBA picker in a portalled
 * popover. Replaces the native `<input type="color">` everywhere — it supports
 * an alpha channel (stored as `#rrggbbaa`), and, unlike the native picker on
 * Windows, never invokes the OS eyedropper that wedges the browser.
 *
 * Owns its own undo grouping (open → begin, close → commit), so the whole
 * drag-a-hue-around session collapses to one history entry — matching how
 * ColorPalette wraps the old native input. Picker output is normalized
 * (opaque `#rrggbbff` → `#rrggbb`) so stored values and palette-swatch matching
 * stay 6-digit unless a real alpha is chosen.
 */
export function ColorField({
  value,
  onChange,
  disabled,
  ariaLabel,
  title,
  id,
  className,
  addNew,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The portalled popover mounts here — the swatch's nearest `.dialog`/`.app`
  // ancestor (see the effect below for why the dialog case matters); both own
  // the design tokens (--control-bg etc.) + dark mode. Resolved in the effect
  // (refs can't be read during render), fallback <body> only if there's neither.
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<ReturnType<typeof beginHistoryGroup> | null>(null);

  const emit = (c: string) => onChange(normalizeHex(c));

  const commitGroup = () => {
    groupRef.current?.commit();
    groupRef.current = null;
  };
  const openPicker = () => {
    if (disabled) return;
    groupRef.current = beginHistoryGroup();
    setOpen(true);
  };
  const closePicker = () => {
    commitGroup();
    setOpen(false);
  };

  // Position the portalled popover under the swatch, flipping above / clamping
  // to the viewport so it never opens off-screen inside a scrolled inspector.
  useLayoutEffect(() => {
    if (!open) return;
    const r = swatchRef.current?.getBoundingClientRect();
    if (!r) return;
    // Nearest chrome root that owns both the design tokens and FOCUS: inside a
    // modal Radix dialog (`.dialog` = Dialog.Content) the popover must mount
    // within the content subtree, or the dialog's focus trap yanks focus off
    // the hex field and it can't be typed into. Everywhere else, `.app`.
    setPortalTarget(swatchRef.current?.closest('.dialog, .app') ?? document.body);
    const below = r.bottom + GAP;
    const top =
      below + POPOVER_H <= window.innerHeight ? below : Math.max(GAP, r.top - GAP - POPOVER_H);
    const left = clamp(r.left, GAP, window.innerWidth - POPOVER_W - GAP);
    setPos({ left, top });
  }, [open]);

  // Close on outside pointerdown or Escape. Capture phase so it fires before a
  // click inside a parent popover can act on the stray press.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || swatchRef.current?.contains(t)) return;
      closePicker();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePicker();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
    // closePicker is stable enough for this effect's lifetime (recreated each
    // render, but only `open` gates attach/detach).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // If the field unmounts mid-edit (e.g. the inspector collapses on a selection
  // change while the picker is open), commit the open group so edits aren't lost.
  useEffect(() => () => commitGroup(), []);

  return (
    <>
      <button
        ref={swatchRef}
        type="button"
        id={id}
        className={
          'color-field-swatch' +
          (open ? ' open' : '') +
          (addNew ? ' add-new' : '') +
          (className ? ' ' + className : '')
        }
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => (open ? closePicker() : openPicker())}
      >
        {addNew ? (
          // A rainbow "+" chip: an unmistakable "pick a new custom color"
          // affordance that never mirrors the current line color.
          <span className="color-field-add" aria-hidden="true">
            +
          </span>
        ) : (
          // Checkerboard shows through a translucent color so alpha is visible.
          <span className="color-field-chip" style={{ '--chip': value } as CSSProperties} />
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="color-field-popover"
            role="dialog"
            aria-label={ariaLabel ? `${ariaLabel} picker` : 'Color picker'}
            style={{ left: pos.left, top: pos.top }}
          >
            <HexAlphaColorPicker color={value} onChange={emit} />
            <div className="color-field-hexrow">
              <HexField
                value={value}
                onChange={onChange}
                ariaLabel={ariaLabel ? `${ariaLabel} hex value` : 'Hex value'}
              />
            </div>
          </div>,
          portalTarget ?? document.body,
        )}
    </>
  );
}
