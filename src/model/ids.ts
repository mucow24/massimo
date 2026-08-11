import type { LineId, StationId } from './types';

export interface IdFactory {
  stationId(): StationId;
  lineId(): LineId;
  lineTagId(): string;
  routeBulletId(): string;
  // One factory for BOTH anchor homes (free and station-hosted), so an anchor id
  // is unique across the doc and a transfer end never has to say which home it
  // means beyond what its own shape already says.
  anchorId(): string;
  transferId(): string;
  textLabelId(): string;
  polygonId(): string;
  svgImageId(): string;
  lineCircleId(): string;
  guideId(): string;
  styleId(): string;
  regionAssignmentId(): string;
}

/**
 * Default factory: `crypto.randomUUID()`. Collision-free for an interactive
 * editor and fixed-width; not stable across runs. Used by the live store.
 */
export function defaultIdFactory(): IdFactory {
  const uid = () => globalThis.crypto.randomUUID();
  return {
    stationId: uid,
    lineId: uid,
    lineTagId: uid,
    routeBulletId: uid,
    anchorId: uid,
    transferId: uid,
    textLabelId: uid,
    polygonId: uid,
    svgImageId: uid,
    lineCircleId: uid,
    guideId: uid,
    styleId: uid,
    regionAssignmentId: uid,
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
  let i = seed;
  let y = seed;
  let r = seed;
  let a = seed;
  let c = seed;
  let gd = seed;
  return {
    stationId: () => `s${s++}`,
    lineId: () => `l${l++}`,
    lineTagId: () => `t${t++}`,
    routeBulletId: () => `b${b++}`,
    anchorId: () => `a${a++}`,
    transferId: () => `x${x++}`,
    textLabelId: () => `g${g++}`,
    polygonId: () => `p${p++}`,
    svgImageId: () => `i${i++}`,
    lineCircleId: () => `c${c++}`,
    guideId: () => `gd${gd++}`,
    styleId: () => `y${y++}`,
    regionAssignmentId: () => `r${r++}`,
  };
}
