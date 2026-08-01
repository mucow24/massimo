import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import { buildBandGeometry } from '../geometry/interlining';
import { makeDoc, makeStation, makeStop, makeLine } from '../test/fixtures';
import type { LineId, MapDoc, StationId } from './types';

// WHERE a new stop lands inside the station a line is being extended INTO.
//
// The corridor S1–S2 renders as one band, and interlining only fuses two lines
// into it when their stops sit the same tangent step apart, on the same side,
// at BOTH ends (forEachPackedRun). But `col` is a station-LOCAL axis, so "one
// step east" is a different WORLD direction at each end whenever the two
// stations carry different rotations — the ordinary case, since autoOrient
// flips 180° to keep a label upright and stations get hand-rotated. Stepping
// east at both ends then drops the new line on opposite sides of the band, the
// merge gate misses by twice the tangent step, and two lines that should read
// as one band cross over instead.
//
// So placement reproduces the arrangement the line already has at the station
// it is coming FROM: for each line L is beside at S1, the same signed offset
// carried into S2's frame.

const stopOn = (doc: MapDoc, stationId: StationId, lineId: LineId) =>
  doc.stations[stationId].stops.find((c) => c.lineId === lineId)!;

const bands = (doc: MapDoc) => buildBandGeometry(doc.stations, doc.lines, doc.lineCircles);

// The band carrying `lineId` on the b–c corridor.
const bandWith = (doc: MapDoc, lineId: LineId) =>
  bands(doc).find((b) => b.lines.some((l) => l.id === lineId))!;

describe('spawning a stop into a station the corridor already serves', () => {
  // b and c both carry L1 and are wired b–c. L2 already stops at b, one cell
  // in local +col from L1 there. Connecting L2 across to c must land it on the
  // same WORLD side of L1 at c.
  const seed = (cRotation: 0 | 4) =>
    makeDoc({
      stations: [
        makeStation({
          id: 'b',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
        }),
        makeStation({ id: 'c', x: 0, y: 100, rotation: cRotation, stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['b', 'c'] }),
        makeLine({ id: 'L2', stations: ['b'] }),
      ],
    });

  it('mirrors the local step when the far station is rotated 180°', () => {
    const doc = T.connectStationsOnLine(seed(4), 'L2', 'b', 'c');
    // At b (rotation 0) local +col points world EAST. c is rotated 180°, so
    // the same world side is local −col there.
    expect(stopOn(doc, 'c', 'L2')).toMatchObject({ row: 0, col: -1 });
  });

  it('interlines into ONE band instead of two that cross', () => {
    const doc = T.connectStationsOnLine(seed(4), 'L2', 'b', 'c');
    const all = bands(doc);
    expect(all).toHaveLength(1);
    expect(all[0].lines.map((l) => l.id).sort()).toEqual(['L1', 'L2']);
  });

  it('keeps the plain +col step when both stations agree on rotation', () => {
    const doc = T.connectStationsOnLine(seed(0), 'L2', 'b', 'c');
    expect(stopOn(doc, 'c', 'L2')).toMatchObject({ row: 0, col: 1 });
    expect(bands(doc)).toHaveLength(1);
  });
});

describe('spawning a stop where nothing shares the corridor', () => {
  it('keeps the historical step east of the rightmost stop', () => {
    // c carries L3, but L3 does not run b–c: there is no arrangement at b to
    // reproduce, so the fallback stands.
    const doc = T.connectStationsOnLine(
      makeDoc({
        stations: [
          makeStation({ id: 'b', x: 0, y: 0, rotation: 0, stops: [makeStop('L2')] }),
          makeStation({ id: 'c', x: 0, y: 100, rotation: 0, stops: [makeStop('L3')] }),
        ],
        lines: [makeLine({ id: 'L2', stations: ['b'] }), makeLine({ id: 'L3', stations: ['c'] })],
      }),
      'L2',
      'b',
      'c',
    );
    expect(stopOn(doc, 'c', 'L2')).toMatchObject({ row: 0, col: 1 });
  });

  it('still matches the travel direction — there is no peer, but the frame is the frame', () => {
    // longping is framed east–west and serves only a line that does not run
    // this corridor, so nothing proposes a spot. The arriving line still runs
    // north–south, and at rotation 6 that axis is named 'auto-horizontal'.
    const doc = T.connectStationsOnLine(
      makeDoc({
        stations: [
          makeStation({ id: 'latimer', x: 0, y: 0, rotation: 0, stops: [makeStop('RD')] }),
          makeStation({ id: 'longping', x: 0, y: 200, rotation: 6, stops: [makeStop('YL')] }),
        ],
        lines: [
          makeLine({ id: 'RD', stations: ['latimer'] }),
          makeLine({ id: 'YL', stations: ['longping'] }),
        ],
      }),
      'RD',
      'latimer',
      'longping',
    );
    expect(stopOn(doc, 'longping', 'RD').orientation).toBe('auto-horizontal');
  });

  it('lands at the station origin when the target has no stops at all', () => {
    const doc = T.connectStationsOnLine(
      makeDoc({
        stations: [
          makeStation({ id: 'b', x: 0, y: 0, rotation: 0, stops: [makeStop('L2')] }),
          makeStation({ id: 'c', x: 0, y: 100, rotation: 0, stops: [] }),
        ],
        lines: [makeLine({ id: 'L2', stations: ['b'] })],
      }),
      'L2',
      'b',
      'c',
    );
    expect(stopOn(doc, 'c', 'L2')).toMatchObject({ row: 0, col: 0 });
  });
});

// A station is rotated to suit ONE corridor, so the station a line arrives at
// may be framed for a corridor running the other way: at Long Ping the yellow /
// blue / orange lines run east–west, so its local axes are a quarter turn off
// Latimer Road's, where the brown and red lines run north–south. Placement has
// to be done in WORLD terms and converted back to cells at the end, or "one
// step across the corridor" comes out as one step ALONG it.
describe('the far station is framed for a different corridor', () => {
  // Latimer Road (rotation 0, north–south): red sits one cell east of brown.
  // Long Ping (rotation 6, east–west): brown continues through it travelling
  // north–south, so brown's stop there is 'auto-horizontal' — local +x is
  // world north at that rotation. Local +col points world NORTH there, so
  // stepping a column would stack red ABOVE brown instead of beside it.
  const seed = () =>
    makeDoc({
      stations: [
        makeStation({
          id: 'latimer',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('BR'), makeStop('RD', { col: 1 })],
        }),
        makeStation({
          id: 'longping',
          x: 0,
          y: 200,
          rotation: 6,
          stops: [
            makeStop('BR', { orientation: 'auto-horizontal' }),
            makeStop('YL', { col: -1 }),
            makeStop('BL', { col: -2 }),
          ],
        }),
      ],
      lines: [
        makeLine({ id: 'BR', stations: ['latimer', 'longping'] }),
        makeLine({ id: 'RD', stations: ['latimer'] }),
        makeLine({ id: 'YL', stations: ['longping'] }),
        makeLine({ id: 'BL', stations: ['longping'] }),
      ],
    });

  it('places the new stop beside its neighbour in WORLD terms, not one column over', () => {
    const doc = T.connectStationsOnLine(seed(), 'RD', 'latimer', 'longping');
    // World east of brown. At rotation 6 that is local +y — a ROW step.
    expect(stopOn(doc, 'longping', 'RD')).toMatchObject({ row: 1, col: 0 });
  });

  it('gives the new stop the travel direction it has at the station it came from', () => {
    const doc = T.connectStationsOnLine(seed(), 'RD', 'latimer', 'longping');
    // Red runs north–south at Latimer Road; the orientation naming that axis
    // at rotation 6 is 'auto-horizontal', not the 'auto-vertical' default.
    expect(stopOn(doc, 'longping', 'RD').orientation).toBe('auto-horizontal');
  });

  it('routes without the "can\'t route" warning', () => {
    const doc = T.connectStationsOnLine(seed(), 'RD', 'latimer', 'longping');
    expect(bandWith(doc, 'RD').warning).toBe(false);
  });

  it('interlines with brown rather than crossing it', () => {
    const doc = T.connectStationsOnLine(seed(), 'RD', 'latimer', 'longping');
    const corridor = bands(doc).filter((b) => b.pairKey === 'latimer|longping');
    expect(corridor).toHaveLength(1);
    expect(corridor[0].lines.map((l) => l.id).sort()).toEqual(['BR', 'RD']);
  });
});

// Two neighbours at S1 can disagree about where L belongs at S2 — they are
// packed differently at the two ends. Each votes for a cell; when the votes
// differ, the ROUTER breaks the tie: whichever candidate does not leave the
// band flagged "can't route" wins. Only when that says nothing (both fine, or
// both bad) does the nearer neighbour's vote carry.
describe('two neighbours voting for different cells', () => {
  // At b: LA, L2, LB across the band with L2 two cells off LA and one off LB.
  // At c the same two lines sit far apart, so reproducing L2's offset from LB
  // flings it clear across the station while reproducing its offset from LA
  // leaves it straight above where it already is.
  const seed = (bAtC: number) =>
    makeDoc({
      stations: [
        makeStation({
          id: 'b',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('LA'), makeStop('L2', { col: 2 }), makeStop('LB', { col: 3 })],
        }),
        makeStation({
          id: 'c',
          x: 0,
          y: 60,
          rotation: 0,
          stops: [makeStop('LA'), makeStop('LB', { col: bAtC })],
        }),
      ],
      lines: [
        makeLine({ id: 'LA', stations: ['b', 'c'] }),
        makeLine({ id: 'LB', stations: ['b', 'c'] }),
        makeLine({ id: 'L2', stations: ['b'] }),
      ],
    });

  it('takes the routable vote over the nearer neighbour', () => {
    // LB is the nearer neighbour at b (one cell vs two), so it would win by
    // default — but its vote (col 19) drags L2 238 units sideways over a
    // 60-unit corridor and the router gives up. LA's vote (col 2) is straight.
    const doc = T.connectStationsOnLine(seed(20), 'L2', 'b', 'c');
    expect(stopOn(doc, 'c', 'L2')).toMatchObject({ row: 0, col: 2 });
    expect(bandWith(doc, 'L2').warning).toBe(false);
  });

  it('falls back to the nearer neighbour when both votes route', () => {
    // With LB five cells off LA at c, both votes are free cells and both are
    // ordinary short steps the router handles, so neither is disqualified:
    // LA votes col 2, LB votes col 4, and LB — one cell from L2 at b against
    // LA's two — decides.
    const doc = T.connectStationsOnLine(seed(5), 'L2', 'b', 'c');
    expect(stopOn(doc, 'c', 'L2')).toMatchObject({ row: 0, col: 4 });
    expect(bandWith(doc, 'L2').warning).toBe(false);
  });
});
