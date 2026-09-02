/**
 * The sidebar's LAYOUT facts — its width, and whether it is actually showing.
 *
 * Its own module rather than an export on [Sidebar.tsx](Sidebar.tsx), because
 * the consumers are canvas-side chrome that has to give way to the strip
 * (`MapCanvas`'s label box, `ItemPopovers`' dock width, `usePinnedPopover`,
 * `WarningToasts`) — none of which renders the panel or wants the panel's
 * module graph. Reaching through the component pulled the whole Styles/Lines
 * panel tree in behind two numbers, and closed a cycle: Sidebar → StylesPanel →
 * StyleEditor → RouteBulletPopover → PopoverShell → usePinnedPopover → Sidebar.
 * A leaf module both sides import has no such loop to close.
 */

// Panel width — matches `.sidebar` in styles.css. The sidebar floats OVER the
// canvas host's right edge and stacks ABOVE the item popovers (.canvas-host
// isolation), so the popovers' top-right dock subtracts this strip while the
// panel shows.
export const SIDEBAR_WIDTH = 320;

/** Whether the sidebar panel is actually showing (mirrors Sidebar's render
 * gate): open, and not ceded to a pinned top-right editor popover — the
 * station layout editor's, or the line editor's (Edit Stops). */
export const sidebarVisible = (s: { sidebarOpen: boolean; uiMode: { kind: string } }): boolean =>
  s.sidebarOpen &&
  s.uiMode.kind !== 'editing-station-layout' &&
  s.uiMode.kind !== 'appending-to-line';
