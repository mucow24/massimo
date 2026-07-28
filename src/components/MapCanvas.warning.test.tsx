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
  // band, both warn. The drag sweep then pulls S2 away and back, taking the
  // pair through 2 → 1 → 0 warnings and back, so the reconciler sees the
  // duplicate-key siblings mount, update, unmount, and remount.
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

    // S2 at rotation=1 (45°cw): each band leaves S1 on the vertical axis and
    // arrives at S2 turned 45°, so the router must fit a fillet into that
    // corner. Rotating also keeps the two ends' perp-adjacency checks from
    // agreeing, so the bands stay separate rather than interlining into one.
    //
    // 45° (not the 90° a perpendicular station would give) is what makes the
    // sweep below meaningful: at 90° the corner is too tight for R=80 at ANY
    // separation, so both bands warn at every y and the sweep never leaves
    // the warning state. At 45° the fillet fits once the stations are far
    // enough apart, so pulling S2 away actually resolves the warnings.
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
      rotation: 1,
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

    // Sweep S2's y in steps — the drag pattern that previously orphaned one
    // fiber per frame for each duplicate-key sibling. CRUCIAL: each
    // moveStation runs in its own act() so React commits between every step.
    // Batching the whole loop into one act() would let React reconcile only
    // once at the end and miss the per-frame fiber leak this test guards
    // against.
    const sweep = (yStart: number, yEnd: number, steps: number) => {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const ny = yStart + (yEnd - yStart) * t;
        act(() => {
          useDoc.getState().moveStation('s2', 0, ny);
        });
        // Every frame must agree, not just the last one: a leak that
        // self-corrected by the end of the sweep would still be a leak.
        expect(countWarningGlyphs()).toBe(expectedWarningCount());
      }
    };

    // One round trip over [20, 250] — the range that actually spans the
    // transition (2 warnings while close, 1 mid-way, 0 past ~195), so the
    // duplicate-key siblings mount, update, unmount and remount together.
    //
    // Deliberately a SHORT sweep. Past covering the transition, extra frames
    // buy nothing: React re-emits the dup-key console.error on EVERY commit
    // that renders colliding keys, so the spy below trips on the first
    // offending render whether that is frame 1 or frame 300. The original
    // 4×80-step sweeps cost ~600ms of the test's ~1.3s runtime and put it
    // close enough to vitest's 5s default that it timed out under the CPU
    // contention of a full parallel suite run while passing in isolation.
    // Worse, they ran at rotation=2, where the warnings never resolve — so
    // all 324 frames re-rendered one unchanging two-band configuration.
    //
    // We deliberately do NOT assert a DOM-glyph "drift" count here: jsdom's
    // reconciler cleans up orphaned dup-key fibers at commit, so the count
    // never diverges in this environment regardless of the bug — the
    // console.error spy below is the SOLE real regression catch. (A drift
    // assertion would masquerade as a guard while being unable to fail on the
    // bug this test exists for.)
    sweep(20, 250, 12);
    sweep(250, 20, 12);

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
    const s2: Station = { id: 's2', name: 'S2', x: 0, y: 20, rotation: 1, stops, label };
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

    // The load-bearing claim is a PER-BAND pairing (dark band → white glyph,
    // light band → black glyph). Bind each glyph to ITS band by x: the glyph
    // sits at the band's centerline midpoint (see BandWarning), so its `x`
    // attribute is that world x. A Set of the two fills would pass even if the
    // colors were swapped between bands; matching each glyph to its own band's
    // expected color does not.
    const docLines = useDoc.getState().lines;
    const expectedFillAtX = new Map<number, string>();
    for (const b of warnBands) {
      const cl = b.centerline;
      const midX = Math.round((cl[0].x + cl[cl.length - 1].x) / 2);
      expectedFillAtX.set(midX, legibleTextOn(docLines[b.lines[0].id].color));
    }
    // Sanity: the two bands really do want contrasting glyphs.
    expect(legibleTextOn('#0039A6')).toBe('#fff');
    expect(legibleTextOn('#FFD700')).toBe('#000');
    expect(new Set(expectedFillAtX.values())).toEqual(new Set(['#fff', '#000']));

    const glyphs = Array.from(document.querySelectorAll('svg text')).filter(
      (t) => t.textContent === '⚠',
    );
    expect(glyphs).toHaveLength(2);
    for (const g of glyphs) {
      const gx = Math.round(Number(g.getAttribute('x')));
      expect(g.getAttribute('fill')).toBe(expectedFillAtX.get(gx));
    }
  });
});
