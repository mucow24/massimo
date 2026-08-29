import { describe, it, expect, beforeEach } from 'vitest';
import { pickDocSnapshot, useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { parse, serialize, SCHEMA_FORMAT } from '../model/serialize';
import { PALETTES } from '../model/palettes';
import { makeDoc, makeLine, makeStation, makeStop, makeTransfer } from './fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

// A persisted file's canonical envelope wrapping a *sparse* doc (the shape an
// older save had before a given field existed). `docOverrides` fills in the
// non-empty parts a specific legacy case needs (e.g. some `lines`). Centralized
// so adding a persisted field is a one-place change, not a sweep over every
// legacy-parse test's hand-copied object.
function legacyEnvelope(docOverrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: SCHEMA_FORMAT,
    doc: {
      stations: {},
      lines: {},
      lineOrder: [],
      lineCounter: 0,
      lineTags: {},
      routeBullets: {},
      transfers: {},
      ...docOverrides,
    },
  });
}

describe('save/load round-trip', () => {
  it('serialized doc parses back to the same data', () => {
    const fixture = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          name: 'Foo',
          x: 1,
          y: 2,
          stops: [makeStop('L1')],
        }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          service: 'A',
          color: '#0039A6',
          stations: ['s1'],
          // Dot sizes are always stored — parse materializes absent ones, so a
          // lossless comparison needs them in the fixture.
          singletonDotSize: 8,
          multiDotSize: 8,
        }),
      ],
      lineOrder: ['L1'],
      palettes: [], // no palettes, or the fixture line's hex gains a colorRef
    });
    useDoc.setState({ ...useDoc.getState(), ...fixture });
    // Serialize the same way Toolbar onSave does — via the DOC_FIELDS-driven
    // pickDocSnapshot — so this can't drift from the real save path or omit a
    // newly-added persisted field.
    const json = serialize(pickDocSnapshot(useDoc.getState()));
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.stations).toEqual(fixture.stations);
      expect(result.doc.lines).toEqual(fixture.lines);
    }
  });

  it('save path (pickDocSnapshot) round-trips the map name', () => {
    // Mirror Toolbar.tsx onSave exactly: serialize(pickDocSnapshot(state)). If
    // `name` isn't part of DOC_FIELDS, pickDocSnapshot drops it, the serialized
    // doc has no name, and parse() fills the 'Untitled map' default instead of
    // the custom name — so this guards the DOC_FIELDS wiring.
    useDoc.setState({ ...useDoc.getState(), name: 'North Shore Line' });
    const json = serialize(pickDocSnapshot(useDoc.getState()));
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.name).toBe('North Shore Line');
    }
  });

  it('legacy files (no name field) parse with the "Untitled map" default', () => {
    const legacy = legacyEnvelope();
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.name).toBe('Untitled map');
    }
  });

  it('rejects malformed JSON without throwing', () => {
    expect(() => parse('garbage{')).not.toThrow();
    const r = parse('garbage{');
    expect(r.ok).toBe(false);
  });

  // The envelope shape rides the round-trip test at the top of this describe;
  // asserting `obj.format === SCHEMA_FORMAT` on output that serialize() stamped
  // from that same constant compared the constant against itself.

  it('round-trips per-station typography', () => {
    const fixture = makeDoc({
      stations: [
        {
          ...makeStation({ id: 's1' }),
          fontSize: 18,
          weight: 700,
          italic: true,
          leading: 1.4,
          tracking: 0.08,
        },
      ],
    });
    const json = serialize(fixture);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.stations.s1).toMatchObject({
        fontSize: 18,
        weight: 700,
        italic: true,
        leading: 1.4,
        tracking: 0.08,
      });
    }
  });

  it('parses legacy files (without label settings) by filling in the factory station style', () => {
    // A file saved before per-station typography existed: only the canonical
    // envelope and a sparse doc. The retired global settings' map-wide role now
    // lives on the default station style, which falls back to the factory props.
    const legacy = legacyEnvelope();
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const stationDefault = result.doc.styles[result.doc.styleDefaults.station];
      expect(stationDefault.props).toEqual({
        fontSize: 12,
        weight: 400,
        italic: false,
        leading: 1,
        tracking: 0,
      });
      // Pre-textLabels saves default to empty.
      expect(result.doc.textLabels).toEqual({});
    }
  });

  it('round-trips textLabels with all properties intact', () => {
    const fixture = makeDoc({
      textLabels: [
        {
          id: 'g1',
          x: 12,
          y: 34,
          rotation: 3,
          text: 'Riverdale\nNorth',
          fontSize: 28,
          weight: 700,
          italic: true,
          align: 'center',
          color: '#ff0000',
          darkColor: '#00ff00',
        },
      ],
    });
    const json = serialize(fixture);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.textLabels.g1).toEqual(fixture.textLabels.g1);
    }
  });

  it('Toolbar onSave path round-trips per-station typography via the DOC_FIELDS snapshot', () => {
    // Mirror Toolbar.tsx onSave exactly: serialize(pickDocSnapshot(state)).
    // Per-station typography rides in `stations` (a DOC_FIELD), so a snapshot
    // regression that dropped stations would surface here as lost values.
    const sid = useDoc.getState().addStation(0, 0, 'S');
    // Non-default leading/tracking (defaults are 1 / 0) so a regression that
    // dropped either surfaces as a lost value rather than passing at the detent.
    useDoc
      .getState()
      .updateStationLabelStyle(sid, { fontSize: 20, weight: 700, leading: 1.4, tracking: 0.08 });
    const json = serialize(pickDocSnapshot(useDoc.getState()));
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.stations[sid]).toMatchObject({
        fontSize: 20,
        weight: 700,
        leading: 1.4,
        tracking: 0.08,
      });
    }
  });

  it('round-trips the palettes the map carries', () => {
    const palettes = [
      { name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] },
      { name: 'MTA', swatches: [{ name: 'Blue (A·C·E)', color: '#0039A6' }] },
    ];
    const result = parse(serialize(makeDoc({ palettes })));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.palettes).toEqual(palettes);
    }
  });

  it('round-trips per-transfer style overrides', () => {
    const fixture = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [
        makeTransfer({
          id: 'x1',
          thickness: 7,
          color: { day: '#abcdef', night: '#334455' },
          strokeWidth: 3,
          strokeColor: { day: '#123456', night: '#654321' },
        }),
      ],
    });
    const json = serialize(fixture);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.transfers.x1).toMatchObject({
        thickness: 7,
        color: { day: '#abcdef', night: '#334455' },
        strokeWidth: 3,
        strokeColor: { day: '#123456', night: '#654321' },
      });
    }
  });

  it('legacy files (neither palettes nor activePalettes) parse with the DEFAULT_DOC seed', () => {
    const legacy = legacyEnvelope();
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.palettes).toEqual(DEFAULT_DOC.palettes);
    }
  });

  it('backfills line.name for legacy files (no name field) with "${service} line"', () => {
    const legacy = legacyEnvelope({
      lines: {
        L1: { id: 'L1', service: 'A', color: '#0039A6', stations: [] },
        L2: { id: 'L2', service: 'M15', color: '#FF6319', stations: [] },
      },
      lineOrder: ['L1', 'L2'],
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.name).toBe('A line');
      expect(result.doc.lines.L2.name).toBe('M15 line');
    }
  });

  it('preserves a custom line.name on load (does not overwrite)', () => {
    const fixture = legacyEnvelope({
      lines: {
        L1: {
          id: 'L1',
          service: 'A',
          name: 'Eighth Avenue Express',
          color: '#0039A6',
          stations: [],
        },
      },
      lineOrder: ['L1'],
    });
    const result = parse(fixture);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.name).toBe('Eighth Avenue Express');
    }
  });

  it('parse drops malformed palette entries', () => {
    const malformed = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: { ...makeDoc({}), palettes: ['nope', { swatches: [] }] },
    });
    const result = parse(malformed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.palettes).toEqual([]);
    }
  });

  // The retired-segmentLayers strip is pinned by serialize.test.ts's
  // 'parse — retired segmentLayers strip'.
});

// The repairs a doc stamped at the CURRENT persist version still needs. zustand
// runs `migrate` only when the stored version DIFFERS from the configured one,
// so every blob this build writes reaches the store through `merge` alone —
// which is why each non-version-gated invariant has to be reachable from there.
describe('localStorage rehydrate — the repairs a same-version doc still needs', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  });

  /** Seed a same-version blob carrying `state`, then rehydrate through it. */
  const rehydrateAtCurrentVersion = async (state: Record<string, unknown>): Promise<void> => {
    localStorage.setItem(
      'vignelli-map-doc-v1',
      JSON.stringify({ version: useDoc.persist.getOptions().version, state }),
    );
    await useDoc.persist.rehydrate();
  };

  it('backfills edges when rehydrating a doc stranded at the current version with edge-less lines', async () => {
    // The exact shape an intermediate build persisted: stamped at the CURRENT
    // persist version (so zustand SKIPS `migrate`) with lines that predate the
    // `edges` field. Without a rehydrate-time backfill the renderer reads
    // `ln.edges.join(...)` on undefined and the whole app white-screens.
    //
    // Read the version off the live config — the original literal 14 was the
    // current version when this was written, and once it bumped the test
    // quietly started exercising `migrate` instead of the `merge` hook it
    // exists to guard.
    localStorage.setItem(
      'vignelli-map-doc-v1',
      JSON.stringify({
        version: useDoc.persist.getOptions().version,
        state: {
          lines: {
            L1: {
              id: 'L1',
              service: 'A',
              name: 'A line',
              color: '#0039A6',
              stations: ['s1', 's2'],
            },
          },
        },
      }),
    );

    await useDoc.persist.rehydrate();

    const l1 = useDoc.getState().lines.L1;
    expect(Array.isArray(l1.edges)).toBe(true);
    // Derived from the legacy linear `stations` order.
    expect(l1.edges).toEqual(['s1|s2']);
  });

  it('materializes dot sizes when rehydrating a current-version doc with a size-less line', async () => {
    // A size-less line CAN be written at the current version (a legacy
    // clipboard payload pasted verbatim), and same-version docs skip
    // `migrate` entirely — so the merge hook must run bakeConcreteDotSizes,
    // same reasoning as the edges backfill above.
    localStorage.setItem(
      'vignelli-map-doc-v1',
      JSON.stringify({
        version: useDoc.persist.getOptions().version,
        state: {
          lines: {
            L1: {
              id: 'L1',
              service: 'A',
              name: 'A line',
              color: '#0039A6',
              stations: [],
              edges: [],
            },
          },
        },
      }),
    );

    await useDoc.persist.rehydrate();

    const l1 = useDoc.getState().lines.L1;
    expect(l1.singletonDotSize).toBe(8);
    expect(l1.multiDotSize).toBe(8);
  });

  // Swatch refs live on the decoration side too — polygons, labels, transfers,
  // dot shadows, style defs — so the hook's reconcile must walk the WHOLE doc,
  // not just the lines. Same reasoning as the two above: a doc at the current
  // version never reaches `migrate`, so this is the only door left. What it
  // drops is a ref that no longer resolves; a ref that DOES resolve keeps
  // whatever color it was painting, divergent or not (that is the pickers'
  // dirty state, not damage).
  it('drops a dangling DESIGN ref on rehydrate, and keeps a divergent one', async () => {
    localStorage.setItem(
      'vignelli-map-doc-v1',
      JSON.stringify({
        version: useDoc.persist.getOptions().version,
        state: {
          palettes: [
            {
              name: 'grays',
              kind: 'design',
              swatches: [{ name: 'Border', color: '#333333', night: '#bbbbbb' }],
            },
          ],
          polygons: {
            P1: {
              id: 'P1',
              vertices: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
              ],
              // Painting a color of its own while still linked — kept as found.
              fill: '#000000',
              darkFill: '#000000',
              stroke: '#000000',
              darkStroke: '#000000',
              strokeWidth: 1,
              fillRef: { palette: 'grays', swatch: 'Border' },
            },
            // A ref into a palette the doc doesn't carry: unlinked, and what
            // it paints is left exactly as found.
            P2: {
              id: 'P2',
              vertices: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
              ],
              fill: '#123456',
              darkFill: '#123456',
              stroke: '#000000',
              darkStroke: '#000000',
              strokeWidth: 1,
              fillRef: { palette: 'gone', swatch: 'Border' },
            },
          },
          backgroundOrder: ['P1', 'P2'],
        },
      }),
    );

    await useDoc.persist.rehydrate();

    const { P1, P2 } = useDoc.getState().polygons;
    // Resolvable: both the local color and the link survive the trip.
    expect(P1.fill).toBe('#000000');
    expect(P1.fillRef).toEqual({ palette: 'grays', swatch: 'Border' });
    // Dangling: the link goes, the paint stays — and the hook reached a
    // POLYGON to do it, which is the doc-wide half of this test.
    expect(P2.fill).toBe('#123456');
    expect('fillRef' in P2).toBe(false);
  });

  // The three below are the same argument as the three above, for the
  // invariants `migrateDoc` declares NON-version-gated. Nothing bumps a version
  // when a stored union goes bad, a binding dangles or a style def turns to
  // junk, so the docs most likely to carry one are exactly the docs `migrate`
  // never sees.
  it('heals an off-ladder label valign when rehydrating a same-version doc', async () => {
    await rehydrateAtCurrentVersion({
      stations: {
        s1: {
          id: 's1',
          name: 'Foo',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [],
          // `labelLayout` resolves valign through a ladder of `===` arms, so a
          // stray string lays the label out under an alignment nobody picked
          // while the inspector's cluster shows no segment selected.
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'sideways' },
        },
      },
    });

    expect(useDoc.getState().stations.s1.label.valign).toBe('auto-down');
  });

  it('drops an off-ladder stopType when rehydrating a same-version doc', async () => {
    await rehydrateAtCurrentVersion({
      stations: {
        s1: {
          id: 's1',
          name: 'Foo',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
          // Neither declaration, so the inspector's picker would show no
          // choice selected while the dots style themselves off the count.
          stopType: 'Interchange',
        },
      },
    });

    expect('stopType' in useDoc.getState().stations.s1).toBe(false);
  });

  it('heals an off-ladder stop orientation when rehydrating a same-version doc', async () => {
    await rehydrateAtCurrentVersion({
      stations: {
        s1: {
          id: 's1',
          name: 'Foo',
          x: 0,
          y: 0,
          rotation: 0,
          // The stored union with the sharpest edge of the lot: every reader
          // goes through `travelDirLocal`, a switch over the four axes with no
          // default arm, so a non-member returns `undefined` and the first
          // `.x` on it white-screens the canvas. Reachable at ANY version —
          // membership is not something a schema bump tracks — but `migrateDoc`
          // only heals it under the `v<4` legacy-cardinals gate.
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'sideways' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
        },
      },
    });

    expect(useDoc.getState().stations.s1.stops[0].orientation).toBe('auto-vertical');
  });

  it('drops a malformed guide when rehydrating a same-version doc', async () => {
    await rehydrateAtCurrentVersion({
      guides: {
        // Same shape of failure as the stop orientation above, one collection
        // over: `guideAxis` and its `guide*` siblings switch over the four
        // orientations with no default, so a non-member reaches the snapper as
        // an `undefined` axis and throws out of the drag. It is INVISIBLE while
        // it does it — `guideSegmentInBox` returns nothing to draw — so the
        // crash has no on-screen cause.
        g1: { id: 'g1', orientation: 'sideways', offset: 40 },
        // The offset is a stored number with the same standing: a non-finite
        // one poisons every distance the snapper ranks candidates by, and
        // `null` is exactly how JSON spells the one a save wrote.
        g2: { id: 'g2', orientation: 'horizontal', offset: null },
        g3: { id: 'g3', orientation: 'vertical', offset: 20 },
      },
    });

    const { guides } = useDoc.getState();
    expect(Object.keys(guides)).toEqual(['g3']);
  });

  it('drops a dangling circle binding when rehydrating a same-version doc', async () => {
    await rehydrateAtCurrentVersion({
      stations: {
        s1: {
          id: 's1',
          name: 'Foo',
          x: 0,
          y: 0,
          rotation: 0,
          // A `viaCircle` flag only ever lives on a BOUND station, and this
          // one's binding names a circle the doc does not carry.
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical', viaCircle: true }],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
          circleId: 'gone',
        },
      },
      lineCircles: {},
    });

    const s1 = useDoc.getState().stations.s1;
    expect('circleId' in s1).toBe(false);
    expect('viaCircle' in s1.stops[0]).toBe(false);
  });

  it('drops an unusable style def when rehydrating a same-version doc', async () => {
    await rehydrateAtCurrentVersion({
      // `props` is a primitive: every reader downstream indexes into it, and
      // `in` on a primitive throws — a white screen with no shell to catch it.
      styles: { junk: { id: 'junk', kind: 'line', name: 'Junk', props: 5 } },
      styleDefaults: { line: 'junk' },
    });

    const { styles, styleDefaults } = useDoc.getState();
    expect(styles.junk).toBeUndefined();
    // Every kind keeps a style, and its designated default resolves to one.
    expect(styles[styleDefaults.line]?.kind).toBe('line');
  });
});

describe('addLine auto-cycle across palettes', () => {
  it('cycles through every palette the map carries, in the map’s order, then wraps', () => {
    const named = (name: string) => PALETTES.filter((p) => p.name === name);
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      palettes: [...named('BART'), ...named('MTA')],
    });
    const expected = [
      // BART, in order:
      '#FFE800',
      '#00AEEF',
      '#4DB848',
      '#ED1C24',
      '#FAA61A',
      // MTA, in order:
      '#0039A6',
      '#FF6319',
      '#6CBE45',
      '#A7A9AC',
      '#996633',
      '#FCCC0A',
      '#EE352E',
      '#00933C',
      '#B933AD',
      '#00ADD0',
      '#808183',
    ];
    const colors: string[] = [];
    for (let i = 0; i < 17; i++) {
      const id = useDoc.getState().addLine();
      colors.push(useDoc.getState().lines[id].color);
    }
    expect(colors.slice(0, 16)).toEqual(expected);
    // 17th wraps back to BART[0].
    expect(colors[16]).toBe(expected[0]);
  });
});
