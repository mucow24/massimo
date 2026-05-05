import type { LineId, StationId } from './types';

export interface IdFactory {
  stationId(): StationId;
  lineId(): LineId;
}

/**
 * Default factory: Math.random + Date.now suffix. Unique enough for an
 * interactive editor; not stable across runs. Used by the live store.
 */
export function defaultIdFactory(): IdFactory {
  const uid = () =>
    Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  return {
    stationId: uid,
    lineId: uid,
  };
}

/**
 * Deterministic counter factory: ids of the form `s0`, `s1`, … and `l0`,
 * `l1`, …. Useful for tests and any code that needs reproducible ids.
 */
export function counterIdFactory(seed = 0): IdFactory {
  let s = seed;
  let l = seed;
  return {
    stationId: () => `s${s++}`,
    lineId: () => `l${l++}`,
  };
}
