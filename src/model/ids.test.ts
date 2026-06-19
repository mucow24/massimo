import { describe, it, expect } from 'vitest';
import { counterIdFactory, defaultIdFactory } from './ids';

describe('counterIdFactory', () => {
  it('produces strict-sequence station and line ids', () => {
    const f = counterIdFactory();
    expect(f.stationId()).toBe('s0');
    expect(f.stationId()).toBe('s1');
    expect(f.lineId()).toBe('l0');
    expect(f.lineId()).toBe('l1');
  });

  it('respects the seed', () => {
    const f = counterIdFactory(10);
    expect(f.stationId()).toBe('s10');
    expect(f.lineId()).toBe('l10');
  });

  it('two factories from one call advance independently', () => {
    const a = counterIdFactory();
    const b = counterIdFactory();
    a.stationId();
    a.stationId();
    expect(b.stationId()).toBe('s0'); // unaffected by a
  });
});

describe('defaultIdFactory', () => {
  it('produces unique ids', () => {
    const f = defaultIdFactory();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(f.stationId());
    expect(ids.size).toBe(100);
  });

  it('produces fixed-width ids that do not depend on the call millisecond', () => {
    // 1000 ids in a tight synchronous loop all share one Date.now ms; the old
    // Math.random+Date.now form leaned on the random part (which could be <6
    // chars on trailing-zero base-36 strings). UUIDs are fixed-width + unique.
    const f = defaultIdFactory();
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) ids.push(f.stationId());
    expect(new Set(ids).size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not collide across id kinds within a single millisecond', () => {
    // The old shared Date.now suffix meant cross-kind collision resistance
    // rested only on the random part; UUIDs are independent per call.
    const f = defaultIdFactory();
    const ids = [
      f.stationId(),
      f.lineId(),
      f.lineTagId(),
      f.routeBulletId(),
      f.transferId(),
      f.textLabelId(),
      f.polygonId(),
    ];
    expect(new Set(ids).size).toBe(7);
  });
});
