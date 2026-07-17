import { describe, it, expect, beforeEach } from 'vitest';
import { useToasts } from './toastStore';

beforeEach(() => {
  useToasts.setState({ toasts: [] });
});

describe('toastStore', () => {
  it('stacks pushes instead of replacing — one failure never hides another', () => {
    const { push } = useToasts.getState();
    push('error', 'first');
    push('error', 'second');
    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual(['first', 'second']);
  });

  it('gives each toast a distinct id so dismiss targets exactly one', () => {
    const { push } = useToasts.getState();
    push('info', 'a');
    push('info', 'b');
    const [t0, t1] = useToasts.getState().toasts;
    expect(t0.id).not.toBe(t1.id);
  });

  it('dismiss removes only the targeted toast, leaving the others up', () => {
    const { push, dismiss } = useToasts.getState();
    push('error', 'keep-me');
    push('error', 'dismiss-me');
    push('error', 'keep-me-too');
    const [, target] = useToasts.getState().toasts;
    dismiss(target.id);
    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual(['keep-me', 'keep-me-too']);
  });
});
