import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetHeldLocks, acquireMapLock, releaseMapLock, whenMapLockFree } from './mapLock';

/**
 * A small in-memory Web Locks: exclusive, first-come, `ifAvailable` answers
 * at once with null when taken, and a plain request queues until the holder's
 * callback settles. jsdom has no navigator.locks, so this stands in for the
 * browser's.
 */
type Cb = (lock: { name: string } | null) => unknown;
function fakeLocks() {
  const holders = new Map<string, Promise<unknown>>();
  const queues = new Map<string, Array<() => void>>();
  const run = (name: string, cb: Cb): Promise<unknown> => {
    const done = Promise.resolve().then(() => cb({ name }));
    holders.set(name, done);
    void done.finally(() => {
      holders.delete(name);
      queues.get(name)?.shift()?.();
    });
    return done;
  };
  const request = (name: string, a: unknown, b?: unknown): Promise<unknown> => {
    const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean };
    const cb = (typeof a === 'function' ? a : b) as Cb;
    if (!holders.has(name)) return run(name, cb);
    if (opts.ifAvailable) return Promise.resolve().then(() => cb(null));
    return new Promise((resolve) => {
      const q = queues.get(name) ?? [];
      q.push(() => resolve(run(name, cb)));
      queues.set(name, q);
    });
  };
  return { request, isHeld: (name: string) => holders.has(name) };
}

let fake: ReturnType<typeof fakeLocks>;
const NAME = 'massimo-map:m1';

beforeEach(() => {
  fake = fakeLocks();
  Object.defineProperty(navigator, 'locks', { value: fake, configurable: true });
  _resetHeldLocks();
});
afterEach(() => {
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
});

describe('mapLock — one editing window per map', () => {
  it('takes a free lock and holds it', async () => {
    expect(await acquireMapLock('m1')).toBe(true);
    expect(fake.isHeld(NAME)).toBe(true);
  });

  it('refuses a lock another window holds', async () => {
    void fake.request(NAME, () => new Promise(() => {})); // the other window, forever
    await Promise.resolve();
    expect(await acquireMapLock('m1')).toBe(false);
  });

  it('holds until released, then another window can take it', async () => {
    await acquireMapLock('m1');
    releaseMapLock('m1');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.isHeld(NAME)).toBe(false);
    expect(await acquireMapLock('m1')).toBe(true);
  });

  it('is idempotent for a map this tab already holds', async () => {
    await acquireMapLock('m1');
    expect(await acquireMapLock('m1')).toBe(true);
  });

  it('different maps take different locks', async () => {
    void fake.request(NAME, () => new Promise(() => {}));
    await Promise.resolve();
    expect(await acquireMapLock('m2')).toBe(true);
  });

  it('whenMapLockFree resolves once the holder lets go', async () => {
    let releaseOther: () => void = () => {};
    void fake.request(NAME, () => new Promise<void>((r) => (releaseOther = r)));
    await Promise.resolve();
    let freed = false;
    void whenMapLockFree('m1').then(() => (freed = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(freed).toBe(false);
    releaseOther();
    await new Promise((r) => setTimeout(r, 0));
    expect(freed).toBe(true);
  });

  it('runs unlocked where the API is missing', async () => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    expect(await acquireMapLock('m1')).toBe(true);
    await expect(whenMapLockFree('m1')).resolves.toBeUndefined();
  });
});
