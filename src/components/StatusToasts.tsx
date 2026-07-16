import * as Toast from '@radix-ui/react-toast';
import { CheckCircledIcon, ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { useToasts } from '../state/toastStore';

/** How long an info toast stays up. Errors never expire — a failed save or
 *  export must outwait any glance away; they leave on a click. */
const INFO_DURATION_MS = 3000;

/**
 * The status-toast stack, lower-left corner of the app — sliding in over the
 * canvas, where the eye actually is (the toolbar's old inline span went
 * unread). The messages live in useToasts; Radix owns the expiry timing
 * (pause on hover/focus), swipe handling, and the screen-reader announcement.
 * The viewport is NOT portalled: it stays inside `.app` so the design tokens
 * and data-theme apply.
 *
 * The anchor div is load-bearing: Radix wraps the viewport <ol> in an
 * unstyled in-flow div, which left bare in `.app` becomes a stray grid item
 * whose boxes join the page's scroll geometry. Boxing the whole subtree in
 * one fixed, clipped anchor keeps every toast pixel — wrapper, list, or a
 * mid-slide transform — out of the page's scrollable overflow.
 *
 * `infoDurationMs` is a test seam: the auto-dismiss contract is asserted with
 * real timers, which must not wait out the real three seconds.
 */
export function StatusToasts({ infoDurationMs = INFO_DURATION_MS }: { infoDurationMs?: number }) {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="status-toast-anchor">
      <Toast.Provider swipeDirection="left">
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            className="status-toast"
            data-kind={t.kind}
            duration={t.kind === 'info' ? infoDurationMs : Infinity}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
            onClick={() => dismiss(t.id)}
            title="Click to dismiss"
          >
            <Toast.Description className="status-toast-text">
              {t.kind === 'info' ? (
                <CheckCircledIcon aria-hidden="true" />
              ) : (
                <ExclamationTriangleIcon aria-hidden="true" />
              )}
              {t.text}
            </Toast.Description>
          </Toast.Root>
        ))}
        <Toast.Viewport className="status-toast-viewport" />
      </Toast.Provider>
    </div>
  );
}
