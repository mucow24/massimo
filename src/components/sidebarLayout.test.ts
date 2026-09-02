import { describe, it, expect } from 'vitest';
import { sidebarVisible } from './sidebarLayout';

// `sidebarVisible` is the gate four canvas-side consumers give way to (the
// label box, the popover dock, the pinned popover, the warning toasts), and
// they read it rather than re-deriving it precisely because it is not just
// `sidebarOpen`: two modes hand the top-right corner to a pinned editor
// popover, and the panel steps aside for them while staying "open".
const state = (over: { sidebarOpen?: boolean; kind?: string } = {}) => ({
  sidebarOpen: over.sidebarOpen ?? true,
  uiMode: { kind: over.kind ?? 'idle' },
});

describe('sidebarVisible', () => {
  it('is open-and-idle', () => {
    expect(sidebarVisible(state())).toBe(true);
    expect(sidebarVisible(state({ sidebarOpen: false }))).toBe(false);
  });

  it('cedes the corner to the two pinned top-right editors', () => {
    expect(sidebarVisible(state({ kind: 'editing-station-layout' }))).toBe(false);
    expect(sidebarVisible(state({ kind: 'appending-to-line' }))).toBe(false);
  });

  it('stays showing under the modes that do NOT take the corner', () => {
    for (const kind of ['placing-station', 'creating-transfer', 'placing-label']) {
      expect(sidebarVisible(state({ kind }))).toBe(true);
    }
  });

  it('a closed sidebar is closed whatever the mode', () => {
    expect(sidebarVisible(state({ sidebarOpen: false, kind: 'appending-to-line' }))).toBe(false);
  });
});
