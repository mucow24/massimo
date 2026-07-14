import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { buildBands } from '../geometry/interlining';
import { DEFAULT_DOC } from '../model/transforms';
import { legibleTextOn } from '../util/color';
import type { Line, Station } from '../model/types';
import { makeLine } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const countWarningGlyphs = () =>
  Array.from(document.querySelectorAll('svg text')).filter((t) => t.textContent === '⚠').length;

const expectedWarningCount = () => {
  const s = useDoc.getState();
  return buildBands(s.stations, s.lines, s.lineOrder).filter((b) => b.warning).length;
};

describe('MapCanvas — warning glyph reconciliation', () => {
  // Regression: a station-pair can produce multiple SegmentBands (different
  // axis buckets, or non-contiguous perpendicular groups within a bucket).
  // Keying <BandWarning> by pairKey alone collided sibling bands on the same
  // React key. The reconciler's existingChildren map keeps only ONE fiber
  // per key; orphaned siblings were never unmounted and accumulated as
  // stale ⚠ glyphs across drag frames until the page was refreshed.
  //
  // The setup intentionally puts L1 at col=0 and L2 at col=5 on both
  // stations. The perpendicular gap exceeds STOP_SIZE so interlining
  // doesn't merge them — two bands, same pairKey. With S1 and S2 close
  // enough vertically that the router can't fit a clean fillet for either
  // band, both warn. The drag sweep reduces the y distance through the
  // warning band and out the other side, exercising the fire/resolve
  // transition many times in tight succession.
  it('keeps the on-canvas ⚠ count in sync with the actual warning count, even after many drag frames', () => {
    // React surfaces duplicate-key collisions via console.error in dev. The
    // bug we're guarding against is precisely that condition, so spy on
    // it: any dup-key warning that mentions "w:" (our warning key prefix)
    // is treated as a regression. jsdom's reconciler happens to clean up
    // orphaned dup-key fibers at commit, so the DOM count alone doesn't
    // diverge in tests — only the React dev warning fires. In production
    // browsers, the same condition leaks fibers across re-renders.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<App />);

    // S2 at rotation=2 (90°cw): its stops, defined in local frame at col 0
    // and col 1, end up vertically stacked in world coords with the lines
    // flowing horizontally — perpendicular to S1. The rotation also flips
    // the perp-adjacency check across the two ends, so both bands stay
    // separate even with adjacent local cols.
    const s1: Station = {
      id: 's1',
      name: 'S1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
        { lineId: 'L2', row: 0, col: 5, orientation: 'auto-vertical' },
      ],
      label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
    };
    const s2: Station = {
      id: 's2',
      name: 'S2',
      x: 0,
      y: 20, // very close → both bands route through tight corners → both warn
      rotation: 2,
      stops: [
        { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
        { lineId: 'L2', row: 0, col: 5, orientation: 'auto-vertical' },
      ],
      label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
    };
    // Large curveRadius makes even moderate-angle bends fail the
    // "r < R * 0.5" threshold so both bands warn at close range.
    const l1: Line = makeLine({
      id: 'L1',
      service: 'L1',
      name: 'L1 line',
      color: '#0039A6',
      stations: ['s1', 's2'],
      curveRadius: 80,
    });
    const l2: Line = makeLine({
      id: 'L2',
      service: 'L2',
      name: 'L2 line',
      color: '#EE352E',
      stations: ['s1', 's2'],
      curveRadius: 80,
    });

    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: { s1, s2 },
        lines: { L1: l1, L2: l2 },
        lineOrder: ['L1', 'L2'],
      });
    });

    // Sanity: this configuration produces two distinct bands sharing the
    // same pairKey, both warning. Without that, the test isn't
    // exercising the bug class (duplicate-key BandWarning siblings).
    const initialBands = buildBands(
      useDoc.getState().stations,
      useDoc.getState().lines,
      useDoc.getState().lineOrder,
    );
    expect(initialBands).toHaveLength(2);
    expect(initialBands[0].pairKey).toBe(initialBands[1].pairKey);
    expect(initialBands.every((b) => b.warning)).toBe(true);

    expect(countWarningGlyphs()).toBe(expectedWarningCount());

    // Sweep S2's y in many tight steps — exactly the drag pattern that
    // previously orphaned one fiber per frame for each duplicate-key
    // sibling. CRUCIAL: each moveStation runs in its own act() so React
    // commits between every step. Batching the whole loop into one act()
    // would let React reconcile only once at the end and miss the
    // per-frame fiber leak this test guards against.
    const sweep = (yStart: number, yEnd: number, steps: number) => {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const ny = yStart + (yEnd - yStart) * t;
        act(() => {
          useDoc.getState().moveStation('s2', 0, ny);
        });
      }
    };

    // Drive the same many-frame drag sweeps that previously orphaned a fiber
    // per frame for each duplicate-key sibling. We deliberately do NOT assert a
    // DOM-glyph "drift" count here: jsdom's reconciler cleans up orphaned
    // dup-key fibers at commit, so the count never diverges in this environment
    // regardless of the bug — the console.error spy below is the SOLE real
    // regression catch. (A drift assertion would masquerade as a guard while
    // being unable to fail on the bug this test exists for.)
    sweep(20, 400, 80);
    sweep(400, 20, 80);
    sweep(20, 400, 80);
    sweep(400, 20, 80);
    expect(countWarningGlyphs()).toBe(expectedWarningCount());

    // No duplicate-key warning was logged anywhere during setup or any
    // drag frame. If someone reverts <BandWarning>'s key to use only
    // pairKey (or any other non-unique discriminator), this fires.
    const dupKeyCall = errorSpy.mock.calls.find(
      (args) =>
        args.some(
          (a) =>
            typeof a === 'string' &&
            a.includes('two children with the same key') &&
            a.includes('%s'),
        ) || args.some((a) => typeof a === 'string' && a.startsWith('w:')),
    );
    expect(dupKeyCall, `unexpected dup-key warning: ${JSON.stringify(dupKeyCall)}`).toBeUndefined();
  });

  // The ⚠ glyph is painted in whichever of black/white is legible against the
  // stripe under its center (the band's center line, resolved live). Two
  // separate single-line warning bands with contrasting colors should get
  // contrasting glyphs.
  it('paints each ⚠ in the legible color for its band’s center stripe', () => {
    render(<App />);

    // Same geometry as the reconciliation test: L1 @ col 0 and L2 @ col 5 on
    // both stations, S2 rotated + very close, so the pair yields two distinct
    // single-line bands that both warn.
    const stops: Station['stops'] = [
      { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
      { lineId: 'L2', row: 0, col: 5, orientation: 'auto-vertical' },
    ];
    const label: Station['label'] = {
      row: 0,
      col: -1,
      rotation: 0,
      offset: 0,
      align: 'auto',
      valign: 'middle',
    };
    const s1: Station = { id: 's1', name: 'S1', x: 0, y: 0, rotation: 0, stops, label };
    const s2: Station = { id: 's2', name: 'S2', x: 0, y: 20, rotation: 2, stops, label };
    // L1 dark → white glyph; L2 light → black glyph. Large curveRadius on
    // both lines forces the tight-corner warning at close range.
    const l1: Line = makeLine({
      id: 'L1',
      service: 'L1',
      name: 'L1',
      color: '#0039A6',
      stations: ['s1', 's2'],
      curveRadius: 80,
    });
    const l2: Line = makeLine({
      id: 'L2',
      service: 'L2',
      name: 'L2',
      color: '#FFD700',
      stations: ['s1', 's2'],
      curveRadius: 80,
    });

    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: { s1, s2 },
        lines: { L1: l1, L2: l2 },
        lineOrder: ['L1', 'L2'],
      });
    });

    // Sanity: exactly two warning bands, each carrying a single line.
    const warnBands = buildBands(
      useDoc.getState().stations,
      useDoc.getState().lines,
      useDoc.getState().lineOrder,
    ).filter((b) => b.warning);
    expect(warnBands).toHaveLength(2);
    expect(warnBands.every((b) => b.lines.length === 1)).toBe(true);

    const fills = Array.from(document.querySelectorAll('svg text'))
      .filter((t) => t.textContent === '⚠')
      .map((t) => t.getAttribute('fill'));
    expect(fills).toHaveLength(2);
    // One glyph legible on the dark line (white), one on the light line (black).
    expect(legibleTextOn('#0039A6')).toBe('#fff');
    expect(legibleTextOn('#FFD700')).toBe('#000');
    expect(new Set(fills)).toEqual(new Set(['#fff', '#000']));
  });
});
