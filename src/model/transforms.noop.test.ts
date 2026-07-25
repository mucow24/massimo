import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from '../state/store';
import { undo } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import * as T from '../model/transforms';
import { makeDoc, makeLine } from '../test/fixtures';

// Probe: updateLine must honour the repo-wide "same reference on no-op"
// transform invariant (ARCHITECTURE.md §2), the thing zundo's
// `equality: docSnapshotsEqual` guard relies on. ColorPalette fires
// onChange unconditionally on EVERY swatch — including the one already
// marked `selected` — and LineInspector wires that to
// updateLine(line.id, { color: c }), so a value-identical patch is a
// one-click-reachable user action.

const RED = '#ee352e';

function seedLine(): void {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    lines: { l1: makeLine({ id: 'l1', service: 'A', name: 'A line', color: RED }) },
    lineOrder: ['l1'],
  });
  useDoc.temporal.getState().clear();
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('updateLine with a value-identical patch', () => {
  it('returns the same doc reference (transform no-op invariant)', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', service: 'A', name: 'A line', color: RED })],
    });
    expect(T.updateLine(doc, 'L1', { color: RED })).toBe(doc);
  });

  it('re-clicking the already-selected color swatch records no history entry', () => {
    seedLine();
    // The swatch already flagged `selected` in ColorPalette hands back the
    // exact same color string.
    useDoc.getState().updateLine('l1', { color: RED });
    expect(useDoc.temporal.getState().pastStates.length).toBe(0);
  });

  it('re-clicking the already-selected color swatch does not wipe the redo stack', () => {
    seedLine();
    // A real edit, then undo it — there is now a pending redo.
    useDoc.getState().updateLine('l1', { name: 'Red line' });
    undo();
    expect(useDoc.getState().lines.l1.name).toBe('A line');
    expect(useDoc.temporal.getState().futureStates.length).toBe(1);

    // Click the already-selected red swatch: nothing about the doc changes,
    // so the redo must survive.
    useDoc.getState().updateLine('l1', { color: RED });
    expect(useDoc.temporal.getState().futureStates.length).toBe(1);
  });
});
