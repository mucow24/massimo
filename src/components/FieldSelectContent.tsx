import { useState, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';

/**
 * The open panel for every `field-select` dropdown (Style, Weight, Line …).
 *
 * Two jobs, both so a long list stays fully reachable no matter where the host
 * popover sits:
 *
 * 1. **Bounded + scrollable.** `collisionBoundary` is the `.canvas-host` rect
 *    (the canvas area, below the toolbar and clear of the sidebar), so Radix
 *    keeps the panel inside it and reports `--radix-select-content-available-
 *    height` for THAT box. `.field-select-panel` caps its height to that var
 *    and the `Viewport` scrolls (with the scroll buttons below) — so a list too
 *    tall for the space scrolls in place instead of running off the top of the
 *    screen or hiding under the toolbar. Without this the panel grew to its full
 *    content height and a long one overflowed the viewport.
 *
 * 2. **Portaled to `.app`.** The item popovers live inside `.canvas-host`, whose
 *    `isolation: isolate` seals its descendants into one layer that paints
 *    BENEATH the toolbar/sidebar (root z-index 1); a non-portaled panel would be
 *    trapped there. Portaling lifts it into the root stacking context (where
 *    `.field-select-panel`'s z-index clears the chrome) while the `.app`
 *    container — NOT `document.body` — keeps it under the design-token custom
 *    properties and the dark-mode reassignment.
 *
 * Both `.app` and `.canvas-host` are resolved once, lazily, in a state
 * initializer — not inline in the JSX like MapLibraryDialog's `Dialog.Portal`.
 * This panel mounts (closed) with its host popover and never re-renders just
 * because the select opens, so an inline `document.querySelector` would run once
 * pre-commit and capture the wrong (null → `document.body`) target permanently;
 * a `[]` mount-effect `setState` instead trips `react-hooks/set-state-in-effect`.
 * The initializer is safe because both are app-root singletons, always committed
 * long before any popover mounts. (A Dialog dodges this — it mounts content only
 * on open, post-commit.)
 *
 * Mirrors the shared `field-select-panel` / `position="popper"` chrome the four
 * sites used inline; the caller supplies only the option items (the `Viewport`
 * is common). MapLibraryDialog keeps its own inline Content — it already lives
 * in a portaled Dialog, so it isn't in the canvas-host trap and needs a
 * different `align`.
 */
export function FieldSelectContent({ children }: { children: ReactNode }) {
  const [{ app, host }] = useState(() => ({
    app: document.querySelector<HTMLElement>('.app'),
    host: document.querySelector<HTMLElement>('.canvas-host'),
  }));
  return (
    <Select.Portal container={app ?? undefined}>
      <Select.Content
        className="field-select-panel"
        position="popper"
        sideOffset={4}
        collisionBoundary={host ?? undefined}
        collisionPadding={8}
      >
        <Select.ScrollUpButton className="field-select-scroll" aria-hidden="true">
          <ChevronUpIcon />
        </Select.ScrollUpButton>
        <Select.Viewport>{children}</Select.Viewport>
        <Select.ScrollDownButton className="field-select-scroll" aria-hidden="true">
          <ChevronDownIcon />
        </Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  );
}
