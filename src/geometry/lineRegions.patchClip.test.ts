import { describe, it, expect } from 'vitest';
import { buildOverlapRegions, buildPatchClip } from './lineRegions';
import { pointInFace, splitIntoFaces } from './clip';
import { makeBandSpec } from '../test/fixtures';
import type { Vec2 } from './vec';

/** Horizontal l1 (0,0)→(100,0) crossed by vertical l2 at x=50; width 14. */
const bands = () => [
  makeBandSpec(['l1'], {
    pairKey: 's1|s2',
    bandKey: 's1|s2#l1',
    fromId: 's1',
    toId: 's2',
    centerline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  }),
  makeBandSpec(['l2'], {
    pairKey: 's3|s4',
    bandKey: 's3|s4#l2',
    fromId: 's3',
    toId: 's4',
    centerline: [
      { x: 50, y: -50 },
      { x: 50, y: 50 },
    ],
  }),
];

const contains = (rings: Vec2[][], p: Vec2): boolean =>
  splitIntoFaces(rings).some((f) => pointInFace(p, f));

describe('buildPatchClip', () => {
  it('is exactly the face when no covering line is cased', () => {
    const b = bands();
    const [face] = buildOverlapRegions(b, []);
    const clip = buildPatchClip(face, 'l2', b, [], () => 0);
    expect(clip).toBe(face.face);
  });

  it('extends a cased winner’s rail over its cover-mates and repairs theirs', () => {
    const b = bands();
    const [face] = buildOverlapRegions(b, []);
    // Both lines cased at railW = 2: rails run 1 unit outside each body edge.
    const clip = buildPatchClip(face, 'l2', b, [], () => 2);
    // Term 1 — winner l2's rail cuts into l1's body just outside the face
    // (x ∈ [57, 58] over l1's body): the "l2 bridges over" separator.
    expect(contains(clip, { x: 57.5, y: 0 })).toBe(true);
    // Term 2 — loser l1's rail over l2's body outside the face (y ∈ [7, 8])
    // gets repainted by l2's body: no leftover white notch.
    expect(contains(clip, { x: 50, y: 7.5 })).toBe(true);
    // No bare body spill: l2's body well beyond l1's silhouette stays out.
    expect(contains(clip, { x: 50, y: 12 })).toBe(false);
    // The winner's rail far from the face (outside l1's body) stays out.
    expect(contains(clip, { x: 57.5, y: 30 })).toBe(false);
    // And the face itself is still fully included.
    expect(contains(clip, { x: 50, y: 0 })).toBe(true);
    expect(contains(clip, { x: 44, y: -6 })).toBe(true);
  });

  it('repairs a cased loser even when the winner is uncased', () => {
    const b = bands();
    const [face] = buildOverlapRegions(b, []);
    const railW = (id: string) => (id === 'l1' ? 2 : 0);
    const clip = buildPatchClip(face, 'l2', b, [], railW);
    // l1's rail over l2's body outside the face is repainted…
    expect(contains(clip, { x: 50, y: 7.5 })).toBe(true);
    // …but the uncased winner adds no rail of its own outside the face.
    expect(contains(clip, { x: 57.5, y: 0 })).toBe(false);
  });
});
