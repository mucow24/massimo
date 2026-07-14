import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RegionPatchLayer } from './RegionPatchLayer';
import {
  buildOverlapRegions,
  resolveRegionWinners,
  mintAnchors,
  type RegionFace,
} from '../../geometry/lineRegions';
import {
  assignLinePriorities,
  buildOrderedRenderables,
  type SegmentBandSpec,
} from '../../geometry/interlining';
import { makeBandSpec, makeLine } from '../../test/fixtures';
import type { Line, LineId, RegionAssignment } from '../../model/types';

const hBand = (lineId: string, pairKey: string, x0: number, x1: number, y = 0) => {
  const [fromId, toId] = pairKey.split('|');
  return makeBandSpec([lineId], {
    pairKey,
    bandKey: `${pairKey}#${lineId}`,
    fromId,
    toId,
    centerline: [
      { x: x0, y },
      { x: x1, y },
    ],
    paths: [`M${x0},${y} L${x1},${y}`],
  });
};
const vBand = (lineId: string, pairKey: string, y0: number, y1: number, x: number) => {
  const [fromId, toId] = pairKey.split('|');
  return makeBandSpec([lineId], {
    pairKey,
    bandKey: `${pairKey}#${lineId}`,
    fromId,
    toId,
    centerline: [
      { x, y: y0 },
      { x, y: y1 },
    ],
    paths: [`M${x},${y0} L${x},${y1}`],
  });
};

function setup(assignmentLine: 'l1' | 'l2', lineOrder: LineId[] = ['l1', 'l2']) {
  const bands = [hBand('l1', 's1|s2', 0, 100), vBand('l2', 's3|s4', -50, 50, 50)];
  const lines: Record<LineId, Line> = {
    l1: makeLine({ id: 'l1', stations: ['s1', 's2'] }),
    l2: makeLine({ id: 'l2', stations: ['s3', 's4'] }),
  };
  const faces = buildOverlapRegions(bands, []);
  const asg: RegionAssignment = {
    id: 'r1',
    lineId: assignmentLine,
    lines: faces[0].lineIds,
    anchors: mintAnchors(faces[0], bands),
  };
  const winners = resolveRegionWinners(faces, { r1: asg }, bands, lineOrder);
  assignLinePriorities(bands, lines, lineOrder);
  const renderables = buildOrderedRenderables(bands, []);
  return { bands, lines, faces, winners, renderables, lineOrder };
}

const renderLayer = (p: {
  faces: RegionFace[];
  winners: { winner: LineId; assignmentId: string | null }[];
  renderables: ReturnType<typeof buildOrderedRenderables>;
  lines: Record<LineId, Line>;
  lineOrder: LineId[];
  onLineSelect?: (id: LineId, e: React.MouseEvent<SVGPathElement>) => void;
}) =>
  render(
    <svg>
      <RegionPatchLayer
        faces={p.faces}
        winners={p.winners}
        renderables={p.renderables}
        lines={p.lines}
        lineOrder={p.lineOrder}
        underlayColor="#fafafa"
        onLineSelect={p.onLineSelect}
      />
    </svg>,
  );

describe('<RegionPatchLayer>', () => {
  it('renders a clipped patch re-emitting the winner for a non-default choice', () => {
    const s = setup('l2'); // default is l1 (order first) — l2 is an override
    const { container } = renderLayer({ ...s, onLineSelect: () => {} });
    const patch = container.querySelector('[data-region-patch]');
    expect(patch).not.toBeNull();
    expect(patch!.getAttribute('data-line-id')).toBe('l2');
    // clipPath id is XML-safe and referenced by the patch group.
    const clip = container.querySelector('clipPath');
    expect(clip).not.toBeNull();
    expect(clip!.id).toMatch(/^region-clip-[A-Za-z0-9_-]+$/);
    expect(patch!.getAttribute('clip-path')).toBe(`url(#${clip!.id})`);
    // The re-emitted band paths are decorative (no identity tags) …
    const paths = patch!.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(1);
    expect(patch!.querySelectorAll('[data-band-key]')).toHaveLength(0);
    // … except the invisible hit path carrying the WINNER's identity.
    const hit = patch!.querySelector('[data-region-hit]');
    expect(hit).not.toBeNull();
    expect(hit!.getAttribute('data-line-id')).toBe('l2');
    expect(hit!.getAttribute('data-band-stripe')).toBe('1');
  });

  it('renders nothing when the bound choice equals the lineOrder default', () => {
    const s = setup('l2', ['l2', 'l1']); // l2 IS the default here
    const { container } = renderLayer(s);
    expect(container.querySelector('[data-region-patch]')).toBeNull();
  });

  it('renders nothing with no assignments', () => {
    const s = setup('l2');
    const { container } = renderLayer({
      ...s,
      winners: s.faces.map((f) => ({ winner: f.lineIds[0], assignmentId: null })),
    });
    expect(container.querySelector('[data-region-patch]')).toBeNull();
  });

  it('omits the hit path (inert patches) when no onLineSelect is wired', () => {
    const s = setup('l2');
    const { container } = renderLayer({ ...s, onLineSelect: undefined });
    expect(container.querySelector('[data-region-patch]')).not.toBeNull();
    expect(container.querySelector('[data-region-hit]')).toBeNull();
  });

  it('paints the patch whose winner is higher in lineOrder LAST', () => {
    // Two independent crossings: l1×l2 at x=50 painted l2; l1×l3 at x=300
    // painted l3.
    const bands: SegmentBandSpec[] = [
      hBand('l1', 's1|s2', 0, 400),
      vBand('l2', 's3|s4', -50, 50, 50),
      vBand('l3', 's5|s6', -50, 50, 300),
    ];
    const lines: Record<LineId, Line> = {
      l1: makeLine({ id: 'l1', stations: ['s1', 's2'] }),
      l2: makeLine({ id: 'l2', stations: ['s3', 's4'] }),
      l3: makeLine({ id: 'l3', stations: ['s5', 's6'] }),
    };
    const faces = buildOverlapRegions(bands, []);
    expect(faces).toHaveLength(2);
    const near = faces.findIndex((f) => f.lineIds.includes('l2'));
    const far = faces.findIndex((f) => f.lineIds.includes('l3'));
    // Default winner of each face is its vertical line (top of order) — so
    // paint the HORIZONTAL line on top instead to force both overrides.
    const assignments: Record<string, RegionAssignment> = {
      r1: {
        id: 'r1',
        lineId: 'l2',
        lines: faces[near].lineIds,
        anchors: mintAnchors(faces[near], bands),
      },
      r2: {
        id: 'r2',
        lineId: 'l3',
        lines: faces[far].lineIds,
        anchors: mintAnchors(faces[far], bands),
      },
    };
    // With l2/l3 as defaults these would be no-ops — flip the order so l1 is
    // top and the vertical winners are genuine overrides.
    const order2: LineId[] = ['l1', 'l2', 'l3'];
    const winners = resolveRegionWinners(faces, assignments, bands, order2);
    assignLinePriorities(bands, lines, order2);
    const renderables = buildOrderedRenderables(bands, []);
    const { container } = renderLayer({
      faces,
      winners,
      renderables,
      lines,
      lineOrder: order2,
    });
    const patches = [...container.querySelectorAll('[data-region-patch]')];
    expect(patches).toHaveLength(2);
    // order2 ranks l2 above l3, so l2's patch must be LAST in the DOM.
    expect(patches[patches.length - 1].getAttribute('data-line-id')).toBe('l2');
  });
});
