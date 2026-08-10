import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import { ChevronDownIcon, DotsHorizontalIcon } from '@radix-ui/react-icons';
import { useDismissOnOutside } from './useDismissOnOutside';

/**
 * The sort picker a library dialog puts above its column — the map library's
 * and the palette manager's are the same control over different ladders.
 *
 * Order comes from `sorts` (the union's ONE ladder, e.g. `MAP_SORTS`) and the
 * wording from `labels`, a `Record<Sort, string>` whose exhaustiveness is what
 * makes a rung added to the union fail to compile until it is named. `onChange`
 * only ever sees a value the ladder's own guard accepted, so a dialog never
 * re-spells its members.
 *
 * Unlike `FieldSelectContent` this Content is neither portaled nor collision-
 * bounded: a dialog already renders inside its own portal, clear of the
 * canvas-host stacking trap that panel exists to escape.
 */
export function DialogSortSelect<Sort extends string>({
  value,
  sorts,
  labels,
  isSort,
  onChange,
  ariaLabel,
  className,
}: {
  value: Sort;
  sorts: readonly Sort[];
  labels: Record<Sort, string>;
  isSort: (v: string) => v is Sort;
  onChange: (sort: Sort) => void;
  ariaLabel: string;
  /** Extra class on the trigger — the two dialogs size theirs differently. */
  className: string;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => {
        if (isSort(v)) onChange(v);
      }}
    >
      <Select.Trigger className={`field-select ${className}`} aria-label={ariaLabel}>
        <Select.Value />
        <Select.Icon className="field-select-caret" aria-hidden="true">
          <ChevronDownIcon />
        </Select.Icon>
      </Select.Trigger>
      <Select.Content className="field-select-panel" position="popper" sideOffset={4} align="end">
        <Select.Viewport>
          {sorts.map((s) => (
            <Select.Item key={s} value={s} className="field-select-item">
              <Select.ItemText>{labels[s]}</Select.ItemText>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Root>
  );
}

/**
 * A dialog-row command button — one square glyph, shared by the palette
 * manager's rows, the palette editor's, and the `…` panel that holds whatever
 * a row has no slot for. Fixed width wherever it stands, so a column of rows
 * ends at one edge instead of stepping in and out with the buttons.
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
 * A row's overflow toolbar: the `…` slot and, behind it, every command that
 * didn't earn a permanent one. A palette row keeps only two — the star or
 * transfer arrow, and the map's drag handle — because those carry STATE (in
 * the map already; built-in, so unsaveable) or are grab targets, and neither
 * survives being folded away. The rest live here.
 *
 * A POPOVER of buttons, not a dropdown menu, and that is the whole point: the
 * commands stay the same `IconButton`s, so anything speed-bumped keeps arming
 * in place exactly as it did in the row. A menu item would have closed the
 * panel out from under the first click and needed its own confirmation.
 *
 * The panel is the row's action grid continued — same square buttons at the
 * same pitch — so a command reads the same wherever it is standing.
 *
 * `children` is handed a `close`: commands call it when they RUN, which is why
 * a speed bump's arming click leaves the panel open and its second click does
 * not. `onClose` fires whenever the panel shuts — by that `close`, or by Radix
 * dismissing it — so the caller can stand any bump primed inside it back down;
 * a panel reopening on a red glyph would be offering a confirmation for a
 * question nobody asked. Both routes go through one `close` deliberately:
 * `open` is a controlled prop, and Radix calls `onOpenChange` only for
 * dismissals it initiates, so a bare `setOpen(false)` would shut the panel
 * without ever telling the caller.
 */
export function RowCommands({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The panel mounts inside the DIALOG, not `.app`: Radix traps focus in
  // Dialog.Content, and a panel portalled outside it would have the focus
  // yanked off its buttons (the same reason ColorField picks `.dialog` first).
  // Resolved off the trigger, which is committed long before the panel opens.
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const close = () => {
    setOpen(false);
    onClose();
  };
  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <Popover.Trigger ref={setTrigger} className="icon-btn" aria-label={label} title={label}>
        <DotsHorizontalIcon />
      </Popover.Trigger>
      <Popover.Portal container={trigger?.closest<HTMLElement>('.dialog, .app') ?? undefined}>
        <Popover.Content
          className="row-commands"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
        >
          {children(close)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
  // itself, or Escape, un-arms it without running anything. "Inside" is the
  // armed button rather than a ref, because the bump has no element of its own
  // — the armed `IconButton` marks itself with `data-armed`.
  useDismissOnOutside(
    confirmKey !== null,
    (t) => !!(t as HTMLElement | null)?.closest?.('button[data-armed]'),
    () => setConfirmKey(null),
  );
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
