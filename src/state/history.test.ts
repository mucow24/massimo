import { describe, it, expect, beforeEach } from 'vitest';
import { pushHistory, historyDepth, redoDepth } from './history';
import { useDoc, pickDocSnapshot, HISTORY_LIMIT } from './store';
import type { DocSnapshot } from './store';

describe('pushHistory — undo-stack cap', () => {
  let snap: DocSnapshot;

  beforeEach(() => {
    useDoc.temporal.getState().clear();
    snap = pickDocSnapshot(useDoc.getState());
  });

  it('caps the grouped-edit undo stack at HISTORY_LIMIT, discarding the oldest', () => {
    // zundo only enforces `limit` inside its own set-handler; the grouped path
    // goes through pushHistory's manual `.slice`, so this cap is the ONLY thing
    // bounding it. Push well past the limit and confirm it stops growing.
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) pushHistory(snap);
    expect(historyDepth()).toBe(HISTORY_LIMIT);
  });

  it('wipes the redo stack on a fresh push', () => {
    // Seed a redo entry, then push: the new action must clear the redo future,
    // mirroring zundo's default handler.
    useDoc.temporal.setState({ futureStates: [snap] });
    expect(redoDepth()).toBe(1);
    pushHistory(snap);
    expect(redoDepth()).toBe(0);
  });
});
