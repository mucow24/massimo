import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import type { MapDoc, RegionAssignment } from '../model/types';
import { buildBands } from '../geometry/interlining';
import {
  armCoverId,
  armOfLinePairKey,
  buildOverlapRegions,
  edgeCoverId,
  regionPaintPlan,
  resolveRegionWinners,
} from '../geometry/lineRegions';
import { regionExcludeClipId } from './canvas/RegionExcludeClips';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import { stubCanvasHostSize } from '../test/interaction';

// The clip-SELECTION wiring: every renderable resolves exactly ONE clipPath,
// preferring its finest def — its band's edge def, then its arm's def, then
// the line's — while markers always take the line def (they are the line's
// shared paint, never one slice's). This is render logic with no geometry of
// its own, so it gets its own JSDOM pin: the wrapper's `data-region-excluded`
// carries the resolved key and the clipPath url carries its sanitized id.

stubCanvasHostSize();

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
  useSelection.setState({
    selectedLineId: null,
    selectedStationIds: [],
    selectedStopLineId: null,
    labelSelected: false,
    uiMode: { kind: 'idle' },
  });
});

const hStop = (id: string, row: number) => makeStop(id, { row, orientation: 'auto-horizontal' });

/** Paint one face of `doc` and return the stored assignment. */
function paintFace(
  doc: MapDoc,
  lineOrder: string[],
  pick: (f: { lineIds: string[] }) => boolean,
  assignments: Record<string, RegionAssignment> = {},
): RegionAssignment {
  const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
  const faces = buildOverlapRegions(bands, []);
  const idx = faces.findIndex(pick);
  expect(idx).toBeGreaterThanOrEqual(0);
  const set = regionPaintPlan({
    faces,
    winners: resolveRegionWinners(faces, assignments, bands, lineOrder),
    assignments,
    faceIndex: idx,
    dir: -1,
    flood: false,
    lineOrder,
    bands,
  })[0].assignment!;
  expect(set).toBeTruthy();
  return set;
}

const clipKeysByStripe = (container: HTMLElement): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const g of container.querySelectorAll('[data-region-excluded]')) {
    const key = g.getAttribute('data-region-excluded')!;
    // The wrapper's clipPath must reference that key's sanitized def id.
    expect(g.getAttribute('clip-path')).toBe(`url(#${regionExcludeClipId(key)})`);
    for (const el of g.querySelectorAll('[data-pair-key], [data-marker-casing]')) {
      const tag = el.hasAttribute('data-marker-casing')
        ? `marker:${el.getAttribute('data-line-id')}`
        : el.getAttribute('data-pair-key')!;
      let set = out.get(tag);
      if (!set) out.set(tag, (set = new Set()));
      set.add(key);
    }
  }
  return out;
};

describe('MapCanvas — region clip selection (edge → arm → line)', () => {
  it('a losing ARM clips its stripes with the arm def; a line-level loser and its markers take the line def', () => {
    // The interlined tangent mouth: orange above grey, grey branches. The
    // mouth AND the oa∩curve crossing are painted for grey ⇒ grey's trunk
    // arm loses (arm def) and orange loses its crossing as a whole line
    // (line def) — its stripes AND markers wrap in the 'oa' clip.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: -400, y: 0, stops: [hStop('oa', 0), hStop('gr', 1)] }),
        makeStation({ id: 'j', x: 0, y: 0, stops: [hStop('oa', 0), hStop('gr', 1)] }),
        makeStation({ id: 'c', x: 400, y: 0, stops: [hStop('oa', 0), hStop('gr', 1)] }),
        makeStation({
          id: 'd',
          x: 500,
          y: -500,
          stops: [makeStop('gr', { orientation: 'auto-vertical' })],
        }),
      ],
      lines: [
        makeLine({ id: 'oa', color: '#f60', edges: ['a|j', 'c|j'], strokeWidth: 2 }),
        makeLine({
          id: 'gr',
          color: '#999',
          edges: ['a|j', 'c|j', 'd|j'],
          strokeWidth: 2,
          curveRadius: 200,
        }),
      ],
    });
    const lineOrder = ['oa', 'gr'];
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const trunkArm = armOfLinePairKey(bands, 'gr', 'a|j')!;
    const branchArm = armOfLinePairKey(bands, 'gr', 'd|j')!;
    const set = paintFace(
      doc,
      lineOrder,
      (f) =>
        f.lineIds.includes(armCoverId('gr', trunkArm)) &&
        f.lineIds.includes(armCoverId('gr', branchArm)),
    );
    // The crossing lives in its own component, so both covers are merged
    // line ids there; painting it makes orange a LINE-level loser.
    const set2 = paintFace(
      doc,
      lineOrder,
      (f) => f.lineIds.includes('oa') && f.lineIds.includes('gr'),
      { r1: { ...set, id: 'r1' } },
    );
    expect(set2.lineId).toBe('gr');
    const { container } = render(<App />);
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: doc.stations,
        lines: doc.lines,
        lineOrder,
        regionAssignments: { r1: { ...set, id: 'r1' }, r2: { ...set2, id: 'r2' } },
      });
    });
    const byStripe = clipKeysByStripe(container);
    const armKey = armCoverId('gr', trunkArm);
    // Grey's trunk stripes reference the ARM def…
    expect(byStripe.get('a|j')).toEqual(new Set([armKey, 'oa']));
    expect(byStripe.get('c|j')).toEqual(new Set([armKey, 'oa']));
    // …the winning curve stripe is not clipped at all…
    expect(byStripe.has('d|j')).toBe(false);
    // …and orange's markers wrap in the LINE def (markers never take
    // slices), while grey's markers — grey has no line-level holes — stay
    // unclipped entirely.
    expect(byStripe.get('marker:oa')).toEqual(new Set(['oa']));
    expect(byStripe.has('marker:gr')).toBe(false);
  });

  it('a losing BAND prefers its edge def over its arm and line defs', () => {
    // The P-with-branch shape: stem g—a—b (through) + branch a—f, and the
    // loop d|e back across a|b. Paint the crossing so band a|b loses as an
    // EDGE — its stripe must wrap in the edge def, not a line def.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'g', x: 0, y: 400, stops: [makeStop('l1')] }),
        makeStation({ id: 'a', x: 0, y: 200, stops: [makeStop('l1')] }),
        makeStation({ id: 'b', x: 0, y: -200, stops: [makeStop('l1')] }),
        makeStation({
          id: 'c',
          x: 200,
          y: -200,
          stops: [makeStop('l1', { orientation: 'auto-horizontal' })],
        }),
        makeStation({ id: 'd', x: 200, y: 0, stops: [makeStop('l1')] }),
        makeStation({
          id: 'e',
          x: -200,
          y: 0,
          stops: [makeStop('l1', { orientation: 'auto-horizontal' })],
        }),
        makeStation({
          id: 'f',
          x: 200,
          y: 200,
          stops: [makeStop('l1', { orientation: 'auto-horizontal' })],
        }),
      ],
      lines: [
        makeLine({ id: 'l1', color: '#c00', edges: ['g|a', 'a|b', 'b|c', 'c|d', 'd|e', 'a|f'] }),
      ],
    });
    const lineOrder = ['l1'];
    const set = paintFace(doc, lineOrder, (f) => f.lineIds.includes(edgeCoverId('l1', 'a|b')));
    expect(set.winnerPairKey).toBe('d|e');
    const { container } = render(<App />);
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: doc.stations,
        lines: doc.lines,
        lineOrder,
        regionAssignments: { r1: { ...set, id: 'r1' } },
      });
    });
    const byStripe = clipKeysByStripe(container);
    // The losing band's stripe wraps in ITS edge def; the winner band and
    // the stem's other bands stay unclipped.
    expect(byStripe.get('a|b')).toEqual(new Set([edgeCoverId('l1', 'a|b')]));
    expect(byStripe.has('d|e')).toBe(false);
    expect(byStripe.has('g|a')).toBe(false);
  });
});
