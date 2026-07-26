import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  translateSiblings,
} from './groupDrag';
import { rotateItemOnContextMenu } from './groupRotate';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeStation } from '../../test/fixtures';

// Transfer anchors as a full sixth kind in both group protocols. The invariant
// both files exist to protect is "a co-selected item is never silently left
// behind" — and for an anchor that is not cosmetic: a transfer bound to it
// moves with it, so an anchor skipped by a group drag or rotate visibly tears
// the elbow apart.

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations: { s0: makeStation({ id: 's0', x: 10, y: 20 }) },
    transferAnchors: { a0: { id: 'a0', x: 100, y: 0 }, a1: { id: 'a1', x: 140, y: 0 } },
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: ['s0'],
    selectedAnchorIds: ['a0'],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
  });
});

describe('group drag with transfer anchors', () => {
  it('tows a co-selected anchor when a station is grabbed', () => {
    const siblings = collectGroupSiblings('station', 's0');
    expect(hasGroupSiblings(siblings)).toBe(true);
    expect(siblings.anchors).toEqual([{ id: 'a0', startX: 100, startY: 0 }]);
    translateSiblings(siblings, 5, -3);
    expect(useDoc.getState().transferAnchors.a0).toEqual({ id: 'a0', x: 105, y: -3 });
  });

  it('tows the rest of the selection when the ANCHOR is the grabbed item', () => {
    const siblings = collectGroupSiblings('anchor', 'a0');
    // The grabbed anchor is excluded from its own sibling list.
    expect(siblings.anchors).toEqual([]);
    expect(siblings.stations).toEqual([{ id: 's0', startX: 10, startY: 20 }]);
  });

  it('tows nothing when the grabbed anchor is not itself selected', () => {
    // a1 exists but is unselected: dragging it must not drag the selection.
    expect(hasGroupSiblings(collectGroupSiblings('anchor', 'a1'))).toBe(false);
  });

  it('excludes the grabbed anchor from the snap pool, not the svgImage set', () => {
    // The tail of this dispatch used to be a catch-all `else` that filed any
    // new kind's id under svgImageIds — leaving the dragged item IN the pool
    // and excluding an innocent image from it.
    const ex = groupAlignExclude('anchor', 'a1', collectGroupSiblings('anchor', 'a1'));
    expect([...(ex.anchorIds ?? [])]).toEqual(['a1']);
    expect([...(ex.svgImageIds ?? [])]).toEqual([]);
  });
});

describe('group rotate with transfer anchors', () => {
  it('orbits a co-selected anchor about the pivot and gives it no rotation field', () => {
    // Pivot is the station at (10, 20); the anchor at (100, 0) orbits 45° CW.
    rotateItemOnContextMenu({ type: 'station', id: 's0' }, () => {
      throw new Error('should have taken the GROUP path, not rotateSingle');
    });
    const a = useDoc.getState().transferAnchors.a0;
    expect(a.x).not.toBeCloseTo(100);
    // An anchor is the polygon case reduced to a point: orbiting IS its
    // rotation, so it must not sprout a rotation field of its own.
    expect('rotation' in a).toBe(false);
    // Distance from the pivot is preserved by a rigid rotation.
    const before = Math.hypot(100 - 10, 0 - 20);
    expect(Math.hypot(a.x - 10, a.y - 20)).toBeCloseTo(before);
  });

  it('counts an anchor toward the group total, so {station + anchor} rotates as a group', () => {
    // Without `an.length` in the total, this selection reads as 1 item and
    // falls through to rotateSingle — leaving the anchor behind.
    let single = false;
    rotateItemOnContextMenu({ type: 'station', id: 's0' }, () => {
      single = true;
    });
    expect(single).toBe(false);
  });

  it('holds an anchor still when it IS the pivot, and orbits the rest around it', () => {
    rotateItemOnContextMenu({ type: 'anchor', id: 'a0' }, () => {
      throw new Error('should have taken the GROUP path');
    });
    const doc = useDoc.getState();
    expect(doc.transferAnchors.a0).toEqual({ id: 'a0', x: 100, y: 0 });
    expect(doc.stations.s0.x).not.toBeCloseTo(10);
  });

  it('rotates a lone anchor via rotateSingle (which is a no-op for anchors)', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: [] });
    let single = false;
    rotateItemOnContextMenu({ type: 'anchor', id: 'a0' }, () => {
      single = true;
    });
    expect(single).toBe(true);
    expect(useDoc.getState().transferAnchors.a0).toEqual({ id: 'a0', x: 100, y: 0 });
  });
});
