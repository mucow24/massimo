import { describe, it, expect } from 'vitest';
import { setItemsLocked } from './transforms';
import {
  makeDoc,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeSvgImage,
  makeTextLabel,
} from '../test/fixtures';

// A doc with one item of every lockable kind, locked per the flags.
function mixedDoc(locked: {
  station?: boolean;
  bullet?: boolean;
  label?: boolean;
  polygon?: boolean;
  svgImage?: boolean;
}) {
  return makeDoc({
    stations: [makeStation({ id: 's1', ...(locked.station ? { locked: true } : {}) })],
    routeBullets: [makeRouteBullet({ id: 'b1', ...(locked.bullet ? { locked: true } : {}) })],
    textLabels: [makeTextLabel({ id: 't1', ...(locked.label ? { locked: true } : {}) })],
    polygons: [makePolygon({ id: 'p1', ...(locked.polygon ? { locked: true } : {}) })],
    svgImages: [makeSvgImage({ id: 'i1', ...(locked.svgImage ? { locked: true } : {}) })],
  });
}

const ALL_IDS = {
  stations: ['s1'],
  bullets: ['b1'],
  labels: ['t1'],
  polygons: ['p1'],
  svgImages: ['i1'],
};

describe('setItemsLocked', () => {
  it('locks every kind in one doc write', () => {
    const doc = mixedDoc({});
    const next = setItemsLocked(doc, ALL_IDS, true);
    expect(next.stations['s1'].locked).toBe(true);
    expect(next.routeBullets['b1'].locked).toBe(true);
    expect(next.textLabels['t1'].locked).toBe(true);
    expect(next.polygons['p1'].locked).toBe(true);
    expect(next.svgImages['i1'].locked).toBe(true);
    // Pure: the input doc is untouched.
    expect(doc.stations['s1'].locked).toBeUndefined();
  });

  it('unlock DROPS the locked key (never stores false)', () => {
    const doc = mixedDoc({
      station: true,
      bullet: true,
      label: true,
      polygon: true,
      svgImage: true,
    });
    const next = setItemsLocked(doc, ALL_IDS, false);
    expect(next.stations['s1']).not.toHaveProperty('locked');
    expect(next.routeBullets['b1']).not.toHaveProperty('locked');
    expect(next.textLabels['t1']).not.toHaveProperty('locked');
    expect(next.polygons['p1']).not.toHaveProperty('locked');
    expect(next.svgImages['i1']).not.toHaveProperty('locked');
  });

  it('returns the same doc reference when nothing changes', () => {
    const allLocked = mixedDoc({
      station: true,
      bullet: true,
      label: true,
      polygon: true,
      svgImage: true,
    });
    expect(setItemsLocked(allLocked, ALL_IDS, true)).toBe(allLocked);
    const noneLocked = mixedDoc({});
    expect(setItemsLocked(noneLocked, ALL_IDS, false)).toBe(noneLocked);
    expect(setItemsLocked(noneLocked, {}, true)).toBe(noneLocked);
  });

  it('skips unknown ids without touching their collection', () => {
    const doc = mixedDoc({});
    expect(setItemsLocked(doc, { stations: ['ghost'], polygons: ['ghost'] }, true)).toBe(doc);
  });

  it('leaves collections without ids reference-identical', () => {
    const doc = mixedDoc({});
    const next = setItemsLocked(doc, { stations: ['s1'] }, true);
    expect(next.stations['s1'].locked).toBe(true);
    expect(next.routeBullets).toBe(doc.routeBullets);
    expect(next.textLabels).toBe(doc.textLabels);
    expect(next.polygons).toBe(doc.polygons);
    expect(next.svgImages).toBe(doc.svgImages);
  });

  it('rewrites only the members whose state actually flips', () => {
    const doc = mixedDoc({ station: true });
    const next = setItemsLocked(doc, { stations: ['s1'], bullets: ['b1'] }, true);
    // Already-locked station keeps its object reference; the bullet is new.
    expect(next.stations['s1']).toBe(doc.stations['s1']);
    expect(next.routeBullets['b1'].locked).toBe(true);
  });
});
