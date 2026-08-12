import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';

/**
 * True when a keyboard event's target is a form field that should swallow
 * the key (Escape closing a popover, etc.) — shared by the popovers' key
 * handlers so the denylist can't drift between them.
 */
export function isInFormField(target: unknown): boolean {
  const t = target as HTMLElement | null;
  const tag = t?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(t?.isContentEditable);
}

/**
 * Shared dismissal effect for floating panels. While `active`, an outside
 * mousedown — registered on the next tick so the click that opened the panel
 * doesn't immediately fire it — or an Escape keypress calls `onDismiss`. Clicks
 * inside any `ignore` element are not treated as "outside".
 */
export function useDismiss(
  active: boolean,
  onDismiss: () => void,
  ignore: ReadonlyArray<RefObject<Node | null>>,
  opts?: {
    // Set false when another component owns Escape for this state (e.g. the
    // station popover's step-out ladder) — two independent Escape listeners
    // over the same state race on document-listener attachment order.
    escape?: boolean;
  },
): void {
  const escape = opts?.escape ?? true;
  useEffect(() => {
    if (!active) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      // A ColorField opens its RGBA picker, and a field-select its option panel,
      // in portals under `.app` — outside every popover's own subtree. Interacting
      // with either must not dismiss the popover (inspector, options panel) that
      // owns the control.
      if (target instanceof Element && target.closest('.color-field-popover, .field-select-panel'))
        return;
      for (const r of ignore) {
        if (r.current && r.current.contains(target)) return;
      }
      onDismiss();
    };
    // Escape steps out of ONE thing, and while this panel is open that thing is
    // the panel. App owns the global step-out ladder on a BUBBLE-phase window
    // listener, so this one runs in the CAPTURE phase on `document` and stops
    // propagation: it is reached first and the ladder never sees the press.
    // Without both halves, dismissing a panel also cancelled the active mode
    // and wiped the selection behind it. App's own inForm/inOverlay guard is no
    // substitute — after clicking the trigger, focus sits on the trigger
    // <button>, a SIBLING of the portaled panel, so its
    // closest('[role="dialog"]') misses.
    //
    // The phases also order the nesting: ColorField's picker binds WINDOW
    // capture, which is upstream of this, so an open picker inside one of these
    // panels still takes Escape first and the panel stays put. Radix's
    // DismissableLayer binds document-capture keydown too — SAME phase, same
    // target — so against a Radix select/dialog the winner is whichever
    // listener registered first. No useDismiss panel hosts one today; the
    // first that grows one must revisit this.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape inside a field belongs to the field, and running first must not
      // take that away: fall through so App's two-step (blur, then close) still
      // works for any panel that grows an input.
      if (isInFormField(e.target)) return;
      e.stopPropagation();
      onDismiss();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    if (escape) document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      if (escape) document.removeEventListener('keydown', onKey, true);
    };
    // `ignore` is a fresh array literal each render; depend on its members.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onDismiss, escape, ...ignore]);
}

/** Air between the trigger's bottom edge and the panel's top. */
const PANEL_GAP = 4;

/**
 * Open/close state + outside-click and Escape handling for a small floating
 * panel anchored to a trigger element. Spread `wrapRef` onto the wrapping
 * element that contains both trigger and panel; clicks anywhere outside that
 * element (or Escape) close the popover.
 *
 * Pass `anchored` when the panel opens inside a scrolling ancestor, and spread
 * the returned `panelStyle` on it: that pins it in WINDOW coordinates — fixed,
 * just under the wrap, right edges flush. A panel free to stay in flow (the
 * inspector's shape picker, which is left-aligned rather than right-flush
 * anyway) leaves it off and keeps its CSS placement, and then pays for none of
 * the measurement below.
 *
 * Fixed rather than the `absolute; top: 100%; right: 0` this used to leave to
 * CSS, because `absolute` is clipped by any scrolling ancestor and the toolbar
 * strip is one: it carries `overflow-x: auto` so its tail scrolls instead of
 * the page, and CSS forces the other axis to `auto` alongside it. The View and
 * Perf panels landed inside the strip's scroll area, 40px of chrome swallowing
 * a 287px panel, unreachable by the pointer. Their siblings never noticed —
 * the Radix menus ride a fixed popper, Help portals to `.app` — so the escape
 * belongs here, in the one place the un-portaled panels share.
 *
 * `position: fixed` is in `panelStyle` unconditionally, offsets or no offsets,
 * and that is what makes the first pass safe: React writes the style attribute
 * during the commit's mutation phase, BEFORE layout effects, so the panel is
 * already out of flow when `measure()` reads the wrap. Were it to appear only
 * alongside the offsets, the mounting pass would measure a wrap still holding
 * an in-flow panel — 15× too wide — and place it off-screen.
 *
 * The panel stays a DOM CHILD of the wrap, which is what keeps `useDismiss`
 * whole: fixed positioning moves the box, not the tree, so an inside click is
 * still inside `wrapRef`.
 *
 * There is no viewport clamp and no flip: the panel goes exactly where its
 * trigger says, and a short window or a trigger near an edge pushes it partly
 * off-screen with no recovery — fixed positioning takes away even scrolling to
 * it. Every trigger today sits in a toolbar whose panels fit; a caller that
 * cannot promise that needs a real flip, not a nudge here.
 */
export function usePopover(opts?: { anchored?: boolean }) {
  const anchored = opts?.anchored ?? false;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [wrapRef]);

  // Layout effect so the measurement lands before paint — a panel that mounted
  // unplaced and snapped into position a frame later would visibly jump. That
  // timing is also why a CLOSE need not clear the anchor: reopening re-measures
  // here, still before paint, so the rect left over from last time is never on
  // screen even for a frame.
  useLayoutEffect(() => {
    if (!open || !anchored) return;
    const measure = () =>
      setAnchor((prev) => {
        const el = wrapRef.current;
        if (!el) return prev;
        const r = el.getBoundingClientRect();
        const next = { top: r.bottom + PANEL_GAP, right: window.innerWidth - r.right };
        // Value-equal bailout, as useDock does: a scroll that doesn't move the
        // trigger must not cost a render.
        return prev && prev.top === next.top && prev.right === next.right ? prev : next;
      });
    measure();
    window.addEventListener('resize', measure);
    // Capture, so the strip scrolling its own tail counts — that scroll never
    // reaches window in the bubble phase, and a fixed panel does not ride along
    // with its trigger on its own.
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchored]);

  const panelStyle: CSSProperties | undefined = anchored
    ? { position: 'fixed', top: anchor?.top, right: anchor?.right }
    : undefined;

  return { open, setOpen, wrapRef, panelStyle };
}
