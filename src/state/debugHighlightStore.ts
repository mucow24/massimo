import { create } from 'zustand';

export interface DebugHighlightState {
  dimColor: string;
  dimAlpha: number;
  // 1 = full color, 0 = greyscale.
  desaturate: number;
  set: <K extends keyof Omit<DebugHighlightState, 'set'>>(
    key: K,
    value: DebugHighlightState[K],
  ) => void;
}

export const useDebugHighlight = create<DebugHighlightState>((set) => ({
  dimColor: '#000000',
  dimAlpha: 0.65,
  desaturate: 0.5,
  set: (key, value) => set({ [key]: value } as Partial<DebugHighlightState>),
}));
