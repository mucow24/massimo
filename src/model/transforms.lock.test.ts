import { describe, it, expect } from 'vitest';
import {
  LOCKABLE_COLLECTIONS,
  lockedItemCount,
  setItemsLocked,
  type LockableDoc,
  type LockableItemIds,
  type LockableKind,
} from './transforms';
import {
  makeDoc,
  makeGuide,
  makeLineCircle,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeSvgImage,
  makeTextLabel,
} from '../test/fixtures';
import type { MapDoc } from './types';

// The seeded item per lockable kind. A `Record<LockableKind, …>` on purpose:
// a kind added to LOCKABLE_COLLECTIONS fails to compile here until it is
// seeded below, so this file can never end up testing fewer kinds than
// setItemsLocked writes — which is exactly how it drifted two kinds short
// before the registry existed.
const ITEM_ID: Record<LockableKind, string> = {
  stations: 's1',
  bullets: 'b1',
  labels: 't1',
  polygons: 'p1',
  svgImages: 'i1',
  lineCircles: 'c1',
  guides: 'gd1',
};

const KINDS = Object.keys(ITEM_ID) as LockableKind[];

// A doc with one item of every lockable kind, locked per the flags.
function mixedDoc(locked: Partial<Record<LockableKind, boolean>> = {}): MapDoc {
  const on = (k: LockableKind) => (locked[k] ? ({ locked: true } as const) : {});
  return makeDoc({
    stations: [makeStation({ id: ITEM_ID.stations, ...on('stations') })],
    routeBullets: [makeRouteBullet({ id: ITEM_ID.bullets, ...on('bullets') })],
    textLabels: [makeTextLabel({ id: ITEM_ID.labels, ...on('labels') })],
    polygons: [makePolygon({ id: ITEM_ID.polygons, ...on('polygons') })],
    svgImages: [makeSvgImage({ id: ITEM_ID.svgImages, ...on('svgImages') })],
    lineCircles: [makeLineCircle({ id: ITEM_ID.lineCircles, ...on('lineCircles') })],
    guides: [makeGuide({ id: ITEM_ID.guides, ...on('guides') })],
  });
}

const ALL_IDS: LockableItemIds = Object.fromEntries(KINDS.map((k) => [k, [ITEM_ID[k]]]));
const ALL_LOCKED = Object.fromEntries(KINDS.map((k) => [k, true]));

/** The seeded record of one kind, addressed the way the registry does. */
const itemOf = (doc: MapDoc, kind: LockableKind) =>
  (doc as LockableDoc)[LOCKABLE_COLLECTIONS[kind]][ITEM_ID[kind]];

describe('setItemsLocked', () => {
  it('locks every kind the registry names, in one doc write', () => {
    const doc = mixedDoc();
    const next = setItemsLocked(doc, ALL_IDS, true);
    for (const kind of KINDS) expect(itemOf(next, kind).locked).toBe(true);
    // Pure: the input doc is untouched.
    for (const kind of KINDS) expect(itemOf(doc, kind).locked).toBeUndefined();
  });

  it('unlock DROPS the locked key (never stores false)', () => {
    const next = setItemsLocked(mixedDoc(ALL_LOCKED), ALL_IDS, false);
    for (const kind of KINDS) expect(itemOf(next, kind)).not.toHaveProperty('locked');
  });

  it('returns the same doc reference when nothing changes', () => {
    const allLocked = mixedDoc(ALL_LOCKED);
    expect(setItemsLocked(allLocked, ALL_IDS, true)).toBe(allLocked);
    const noneLocked = mixedDoc();
    expect(setItemsLocked(noneLocked, ALL_IDS, false)).toBe(noneLocked);
    expect(setItemsLocked(noneLocked, {}, true)).toBe(noneLocked);
  });

  it('skips unknown ids without touching their collection', () => {
    const doc = mixedDoc();
    expect(setItemsLocked(doc, { stations: ['ghost'], polygons: ['ghost'] }, true)).toBe(doc);
  });

  it('leaves collections without ids reference-identical', () => {
    const doc = mixedDoc();
    const next = setItemsLocked(doc, { stations: ['s1'] }, true);
    expect(next.stations['s1'].locked).toBe(true);
    for (const kind of KINDS) {
      if (kind === 'stations') continue;
      const collection = LOCKABLE_COLLECTIONS[kind];
      expect((next as LockableDoc)[collection]).toBe((doc as LockableDoc)[collection]);
    }
  });

  it('rewrites only the members whose state actually flips', () => {
    const doc = mixedDoc({ stations: true });
    const next = setItemsLocked(doc, { stations: ['s1'], bullets: ['b1'] }, true);
    // Already-locked station keeps its object reference; the bullet is new.
    expect(next.stations['s1']).toBe(doc.stations['s1']);
    expect(next.routeBullets['b1'].locked).toBe(true);
  });
});

describe('lockedItemCount', () => {
  it('counts a locked member of every kind the registry names', () => {
    expect(lockedItemCount(mixedDoc(ALL_LOCKED), ALL_IDS)).toBe(KINDS.length);
    expect(lockedItemCount(mixedDoc(), ALL_IDS)).toBe(0);
  });

  it('counts each kind on its own, so no kind can go silently uncounted', () => {
    for (const kind of KINDS) {
      expect(lockedItemCount(mixedDoc({ [kind]: true }), ALL_IDS)).toBe(1);
    }
  });

  it('counts only the listed ids, and scores an unresolvable one as unlocked', () => {
    const doc = mixedDoc(ALL_LOCKED);
    expect(lockedItemCount(doc, { stations: ['s1'] })).toBe(1);
    expect(lockedItemCount(doc, { stations: ['ghost'] })).toBe(0);
    expect(lockedItemCount(doc, {})).toBe(0);
  });
});
