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
  it('overdraws past the face along the winner into SAME-winner territory only', () => {
    // Anti-seam rule: the clip edge at a loser's body edge would otherwise
    // sit exactly on the loser's antialiased edge in the base pass — two
    // coincident half-covered pixel rows that never sum to full coverage,
    // showing a hairline of the loser through continuous winner paint. The
    // clip therefore extends a couple units past the face wherever the area
    // beyond ALREADY shows the winner (invisible overdraw).
    const b = bands();
    const [face] = buildOverlapRegions(b, []);
    const clip = buildPatchClip(face, 'l2', b, [], () => 0);
    // Face interior still in.
    expect(contains(clip, { x: 50, y: 0 })).toBe(true);
    // Just beyond the face along l2's continuation (l2-only territory —
    // base shows l2 there): included, killing the seam.
    expect(contains(clip, { x: 50, y: 8 })).toBe(true);
    expect(contains(clip, { x: 50, y: -8 })).toBe(true);
    // Far beyond the overdraw margin: out.
    expect(contains(clip, { x: 50, y: 12 })).toBe(false);
    // Sideways past l2's own body edge: no winner paint there — out.
    expect(contains(clip, { x: 60, y: 0 })).toBe(false);
  });

  it('does NOT overdraw into an adjacent face whose effective winner differs', () => {
    // A third line l3 rides just below the crossing, ABOVE l2 in lineOrder:
    // the l2∩l3 face beyond the l1∩l2 face shows l3. Overdrawing l2 into it
    // would nick l3 — the safe-dilation must exclude it.
    const b = [
      ...bands(),
      makeBandSpec(['l3'], {
        pairKey: 's5|s6',
        bandKey: 's5|s6#l3',
        fromId: 's5',
        toId: 's6',
        centerline: [
          { x: 0, y: 10.5 },
          { x: 100, y: 10.5 },
        ],
      }),
    ];
    const faces = buildOverlapRegions(b, []);
    const target = faces.find((f) => f.lineIds.join(',') === 'l1,l2')!;
    const l2l3 = faces.find((f) => f.lineIds.join(',') === 'l2,l3')!;
    // l3 outranks l2 → the l2∩l3 face defaults to l3.
    const others = faces
      .filter((f) => f !== target)
      .map((f) => ({ face: f, winner: f === l2l3 ? 'l3' : f.lineIds[0] }));
    const clip = buildPatchClip(target, 'l2', b, [], () => 0, others);
    // A probe inside the l2∩l3 face (winner l3), just past the target face.
    const probe = { x: 50, y: (l2l3.bbox.y0 + l2l3.bbox.y1) / 2 };
    expect(contains(clip, probe)).toBe(false);
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
    // …but the uncased winner adds no rail of its own outside the face. The
    // clip is allowed to reach 0.5 past l2's body edge (the anti-seam margin
    // never crops the stroke's antialiased tail) — there is no paint there —
    // so probe clearly beyond that allowance.
    expect(contains(clip, { x: 58.5, y: 0 })).toBe(false);
  });
});
