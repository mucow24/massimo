import { describe, it, expect, beforeEach } from 'vitest';
import { useViewportStore } from './viewportStore';

beforeEach(() => {
  localStorage.clear();
  useViewportStore.setState({
    x: 0,
    y: 0,
    zoom: 1,
    gridVisible: true,
    darkMode: false,
    gridSize: 10,
  });
});

describe('viewportStore — gridSize', () => {
  it('defaults to a 10px grid', () => {
    expect(useViewportStore.getState().gridSize).toBe(10);
  });

  it('setGridSize updates the value', () => {
    useViewportStore.getState().setGridSize(5);
    expect(useViewportStore.getState().gridSize).toBe(5);
    useViewportStore.getState().setGridSize(10);
    expect(useViewportStore.getState().gridSize).toBe(10);
  });

  it('persists gridSize to localStorage (partialize)', () => {
    useViewportStore.getState().setGridSize(5);
    const raw = localStorage.getItem('massimo-viewport');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.gridSize).toBe(5);
  });

  it('rehydrates a persisted blob without gridSize back to the default 10', async () => {
    // A viewport saved before gridSize existed: present keys must still apply,
    // but the missing gridSize must fall back to the initializer (not undefined
    // / NaN, which would poison every snap).
    localStorage.setItem(
      'massimo-viewport',
      JSON.stringify({
        state: { x: 1, y: 2, zoom: 3, gridVisible: false, darkMode: true },
        version: 0,
      }),
    );
    await useViewportStore.persist.rehydrate();
    const s = useViewportStore.getState();
    expect(s.gridSize).toBe(10);
    expect(Number.isNaN(s.gridSize)).toBe(false);
    expect(s.darkMode).toBe(true);
  });
});
