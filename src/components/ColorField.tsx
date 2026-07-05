import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HexAlphaColorPicker, HexColorInput } from 'react-colorful';
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
}

// Width/height of the floating picker popover (kept in sync with the CSS so the
// edge-flip math can decide whether it fits below the swatch).
const POPOVER_W = 212;
const POPOVER_H = 240;
const GAP = 6;

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
export function ColorField({ value, onChange, disabled, ariaLabel, title, id, className }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The portalled popover mounts here — the swatch's `.app` ancestor, which owns
  // the design tokens (--control-bg etc.) + dark mode. Resolved in the effect
  // (refs can't be read during render), fallback <body> only if there's no .app.
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
    setPortalTarget(swatchRef.current?.closest('.app') ?? document.body);
    const below = r.bottom + GAP;
    const top =
      below + POPOVER_H <= window.innerHeight ? below : Math.max(GAP, r.top - GAP - POPOVER_H);
    const left = Math.min(Math.max(GAP, r.left), window.innerWidth - POPOVER_W - GAP);
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
          'color-field-swatch' + (open ? ' open' : '') + (className ? ' ' + className : '')
        }
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => (open ? closePicker() : openPicker())}
      >
        {/* Checkerboard shows through a translucent color so alpha is visible. */}
        <span className="color-field-chip" style={{ '--chip': value } as CSSProperties} />
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
              <HexColorInput
                color={value}
                onChange={emit}
                alpha
                prefixed
                aria-label={ariaLabel ? `${ariaLabel} hex value` : 'Hex value'}
              />
            </div>
          </div>,
          portalTarget ?? document.body,
        )}
    </>
  );
}
