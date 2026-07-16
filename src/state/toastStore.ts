import { create } from 'zustand';

/**
 * App-wide status toasts (rendered by StatusToasts in the lower-left corner).
 * Actions report outcomes here instead of rendering their own message: toasts
 * stack rather than replace each other, so one failure never hides another.
 * `error` stays until clicked; `info` expires on its own (StatusToasts owns
 * the timing).
 *
 * A store, not component state, so any module — not just the toolbar — can
 * report an outcome without threading a setter to the call site.
 */
export type ToastKind = 'error' | 'info';
export interface StatusToast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: StatusToast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, text) => set((s) => ({ toasts: [...s.toasts, { id: nextId++, kind, text }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Report an outcome. Usable from anywhere — no React context required. */
export const pushToast = (kind: ToastKind, text: string): void =>
  useToasts.getState().push(kind, text);
