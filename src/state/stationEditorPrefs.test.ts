import { describe, it, expect } from 'vitest';
import { useStationEditorPrefs } from './stationEditorPrefs';

// Vitest isolates modules per test file, so this store is a pristine instance
// with empty localStorage — its state here IS the factory default (the
// StationInspector tests force the flag in beforeEach, which would mask a
// changed default, so it's protected here instead).
describe('useStationEditorPrefs', () => {
  it('defaults the Style detail to collapsed', () => {
    expect(useStationEditorPrefs.getState().styleExpanded).toBe(false);
  });

  it('setStyleExpanded flips the remembered flag', () => {
    useStationEditorPrefs.getState().setStyleExpanded(true);
    expect(useStationEditorPrefs.getState().styleExpanded).toBe(true);
    useStationEditorPrefs.getState().setStyleExpanded(false);
    expect(useStationEditorPrefs.getState().styleExpanded).toBe(false);
  });
});
