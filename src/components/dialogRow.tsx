import { useEffect, useState } from 'react';

/**
 * A dialog-row command button — shared by the palette manager's rows and the
 * palette editor's. Rows spend a fixed set of these slots whether or not they
 * can use them all, so the content beside them ends at one edge instead of
 * stepping in and out with the buttons.
 */
export function IconButton({
  label,
  title,
  danger,
  armed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  danger?: boolean;
  /** Primed by a first click: the same glyph, washed red, awaiting the second. */
  armed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={'icon-btn' + (danger || armed ? ' danger' : '') + (armed ? ' armed' : '')}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      // How the speed bump's stand-down listener recognises its own button.
      data-armed={armed || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The in-place two-click confirmation the palette windows use for anything
 * that destroys or displaces: the first click arms (same glyph, washed red,
 * tooltip naming what the second click will cost), the second runs. One armed
 * key per hook — arming one bump stands the previous one down — and running
 * disarms. `disarm` is for the caller whose rows shift under an armed key
 * (a reorder, an insert), where the primed button would otherwise jump rows.
 */
export function useSpeedBump(): {
  speedBump: (
    key: string,
    label: string,
    armedLabel: string,
    armedTitle: string,
    icon: React.ReactNode,
    run: () => void,
  ) => React.ReactNode;
  disarm: () => void;
} {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // An armed bump can always stand down: a press anywhere but the armed button
  // itself, or Escape, un-arms it without running anything. Window capture so
  // the press still does its own job afterwards — except Escape, which is
  // consumed: standing the bump down IS that keypress's meaning (the dialog
  // must not also read it as "close").
  useEffect(() => {
    if (confirmKey === null) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.('button[data-armed]')) setConfirmKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setConfirmKey(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [confirmKey]);
  const speedBump = (
    key: string,
    label: string,
    armedLabel: string,
    armedTitle: string,
    icon: React.ReactNode,
    run: () => void,
  ) =>
    confirmKey === key ? (
      <IconButton
        label={armedLabel}
        title={armedTitle}
        armed
        onClick={() => {
          setConfirmKey(null);
          run();
        }}
      >
        {icon}
      </IconButton>
    ) : (
      <IconButton label={label} onClick={() => setConfirmKey(key)}>
        {icon}
      </IconButton>
    );
  return { speedBump, disarm: () => setConfirmKey(null) };
}
