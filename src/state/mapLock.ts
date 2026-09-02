/**
 * One editing window per map.
 *
 * A map's working copy is one localStorage slot (mapKeys.ts), so two tabs on
 * the SAME map would write over each other exactly as two tabs on the one
 * app-wide slot used to. The Web Locks API is built for this: a tab takes the
 * map's lock when it opens the map and holds it until it lets go or closes,
 * and a second tab on that map finds the lock taken — it shows a "busy"
 * screen (main.tsx) and reloads into the editor when the first tab is gone.
 * Different maps take different locks, so side by side just works.
 *
 * A browser without the API (none this app supports — jsdom is the one that
 * matters) is treated as holding every lock: the app runs as it always has.
 */
const lockName = (mapId: string): string => `massimo-map:${mapId}`;

/** The locks this tab holds, by map — and the release that lets each go. */
const held = new Map<string, () => void>();

const locks = (): typeof navigator.locks | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.locks;

/**
 * Take the map's lock, or report that another window holds it. Idempotent
 * per map: a tab that already holds it keeps holding it.
 */
export function acquireMapLock(mapId: string): Promise<boolean> {
  if (held.has(mapId)) return Promise.resolve(true);
  const manager = locks();
  if (!manager) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    void manager.request(lockName(mapId), { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(false);
        return;
      }
      // Hold it until released: the API keeps the lock for as long as the
      // callback's promise is pending, and drops it when the tab goes away.
      return new Promise<void>((release) => {
        held.set(mapId, release);
        resolve(true);
      });
    });
  });
}

/** Let a map's lock go — this tab is no longer on that map. */
export function releaseMapLock(mapId: string): void {
  held.get(mapId)?.();
  held.delete(mapId);
}

/** Resolves once nobody holds the map's lock — when the other window is gone. */
export function whenMapLockFree(mapId: string): Promise<void> {
  const manager = locks();
  if (!manager) return Promise.resolve();
  return manager.request(lockName(mapId), () => undefined);
}

/** For tests: forget every held lock without releasing (a fresh "tab"). */
export function _resetHeldLocks(): void {
  held.clear();
}
