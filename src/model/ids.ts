import type { LineId, StationId } from './types';

export interface IdFactory {
  stationId(): StationId;
  lineId(): LineId;
  lineTagId(): string;
  routeBulletId(): string;
  transferId(): string;
  textLabelId(): string;
  polygonId(): string;
}

/**
 * Default factory: Math.random + Date.now suffix. Unique enough for an
 * interactive editor; not stable across runs. Used by the live store.
 */
export function defaultIdFactory(): IdFactory {
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  return {
    stationId: uid,
    lineId: uid,
    lineTagId: uid,
    routeBulletId: uid,
    transferId: uid,
    textLabelId: uid,
    polygonId: uid,
  };
}

/**
 * Deterministic counter factory: ids of the form `s0`, `s1`, … and `l0`,
 * `l1`, …. Useful for tests and any code that needs reproducible ids.
 */
export function counterIdFactory(seed = 0): IdFactory {
  let s = seed;
  let l = seed;
  let t = seed;
  let b = seed;
  let x = seed;
  let g = seed;
  let p = seed;
  return {
    stationId: () => `s${s++}`,
    lineId: () => `l${l++}`,
    lineTagId: () => `t${t++}`,
    routeBulletId: () => `b${b++}`,
    transferId: () => `x${x++}`,
    textLabelId: () => `g${g++}`,
    polygonId: () => `p${p++}`,
  };
}
