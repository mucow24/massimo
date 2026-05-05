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
});
