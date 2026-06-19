import { describe, it, expect } from 'vitest';
import { itemCursor } from './itemCursor';

describe('itemCursor', () => {
  it('shows the four-arrow move cursor over an unlocked, movable item', () => {
    expect(itemCursor(false, false)).toBe('move');
    expect(itemCursor(false, undefined)).toBe('move');
  });

  it('shows the pointing-hand cursor over a locked item', () => {
    expect(itemCursor(false, true)).toBe('pointer');
  });

  it('shows the open hand in hand mode regardless of lock state', () => {
    expect(itemCursor(true, false)).toBe('grab');
    expect(itemCursor(true, true)).toBe('grab');
  });
});
