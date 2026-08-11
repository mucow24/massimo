import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import { applyDefaultStyle, captureStyleProps, clearStyleTag, updateStyleProps } from './styles';
import { DEFAULT_STOP_DOT_STYLE_ID, STOP_DOT_FACTORY_STYLES } from './dotStyle';
import { parse, serialize } from './serialize';
import { migrateDoc } from '../state/store';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { LineId, LineStyleProps, MapDoc } from './types';

// The service-code disc (natural diameter 12) vs. the plain filled-black
// default (natural 8) — the pair every "sizes are concrete now" rule is
// exercised against.
const DISC_ID = 'stop-filled-black-service-code';
const DISC = STOP_DOT_FACTORY_STYLES[DISC_ID].props;

// The store's addLine composition (state/store.ts): seed the ⭐ stopDot default
// onto the fresh line, then stamp + tag it with the designated default LINE
// style — after which every covered field, dot sizes included, is stored.
const addStyledLine = (doc: MapDoc, id: LineId, service: string): MapDoc =>
  applyDefaultStyle(
    T.applyDefaultStopDotToLine(T.addLine(doc, id, service, '#0039a6'), id),
    'line',
    id,
  );

const lineDef = (doc: MapDoc): LineStyleProps => doc.styles['default-line'].props as LineStyleProps;

describe('line dot sizes are stored concretely (absent no longer means "my type\'s natural")', () => {
  it('setLineSingletonDotSize stores the natural size instead of collapsing to absent', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineSingletonDotSize(doc, 'L1', 8);
    expect(next.lines.L1.singletonDotSize).toBe(8);
    // The stored natural is canonical: re-setting it is a reference-equal no-op.
    expect(T.setLineSingletonDotSize(next, 'L1', 8)).toBe(next);
  });

  it('setLineMultiDotSize stores the natural size instead of collapsing to absent', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineMultiDotSize(doc, 'L1', 8);
    expect(next.lines.L1.multiDotSize).toBe(8);
  });

  it("a fresh styled line stores its def's sizes explicitly", () => {
    const doc = addStyledLine(T.DEFAULT_DOC, 'L1', 'A');
    expect(doc.lines.L1.singletonDotSize).toBe(lineDef(doc).singletonDotSize);
    expect(doc.lines.L1.multiDotSize).toBe(lineDef(doc).multiDotSize);
  });
});

describe("per-stop dot sizes collapse at the LINE size, not at the stop type's natural", () => {
  it("pins a value equal to the stop's own natural when it differs from the line size", () => {
    // Disc-overridden stop on a plain-8 line: 12 is a real pin now (absent
    // means "track the line", which renders 8), not the collapse point.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: DISC, dotStyleId: DISC_ID })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotSize(doc, 'a', 'L1', 12);
    expect(next.stations.a.stops[0].dotSize).toBe(12);
  });
});

describe('dot-type picks write the size they used to imply (edit-time courtesy)', () => {
  it('line pick at the old natural jumps to the new natural', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineSingletonDotStyle(doc, 'L1', DISC_ID);
    expect(next.lines.L1.singletonDotSize).toBe(12);
    // Only the picked case moves.
    expect('multiDotSize' in next.lines.L1).toBe(false);
  });

  it('line pick keeps a user-chosen size', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', singletonDotSize: 20 })] });
    const next = T.setLineSingletonDotStyle(doc, 'L1', DISC_ID);
    expect(next.lines.L1.singletonDotSize).toBe(20);
  });

  it('line pick back to a smaller natural follows back down', () => {
    const doc = makeDoc({
      lines: [
        makeLine({
          id: 'L1',
          singletonDotStyle: DISC,
          singletonDotStyleId: DISC_ID,
          singletonDotSize: 12,
        }),
      ],
    });
    const next = T.setLineSingletonDotStyle(doc, 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    expect(next.lines.L1.singletonDotSize).toBe(8);
  });

  it('line pick prunes per-stop size pins that now equal the line size', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: 12 })] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setLineSingletonDotStyle(doc, 'L1', DISC_ID);
    expect(next.lines.L1.singletonDotSize).toBe(12);
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
  });

  it('stop pick at the old natural pins the new natural on the stop', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DISC_ID);
    expect(next.stations.a.stops[0].dotSize).toBe(12);
    // The line is untouched — the pick was per-stop.
    expect('singletonDotSize' in next.lines.L1).toBe(false);
  });

  it('stop pick keeps a user-chosen size', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: 20 })] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DISC_ID);
    expect(next.stations.a.stops[0].dotSize).toBe(20);
  });

  it('clearing a stop back to the line default also drops a size that tracked the old type', () => {
    // The stored 12 came with the disc (bake or courtesy); leaving the disc
    // takes it along, so the stop tracks the line again — exactly what the
    // old absent-size stop did.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: DISC, dotStyleId: DISC_ID, dotSize: 12 })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    expect('dotStyle' in next.stations.a.stops[0]).toBe(false);
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
  });

  it('clearing a stop keeps a size that did NOT track the old type', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: DISC, dotStyleId: DISC_ID, dotSize: 20 })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    expect('dotStyle' in next.stations.a.stops[0]).toBe(false);
    expect(next.stations.a.stops[0].dotSize).toBe(20);
  });
});

describe('editing a stopDot style resizes exactly what tracked its natural size', () => {
  it("a tagged line stays at its LINE style's size (the def rules, unchanged)", () => {
    let doc = addStyledLine(T.DEFAULT_DOC, 'L1', 'A');
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, { showServiceCode: true });
    expect(doc.lines.L1.styleId).toBe('default-line');
    expect(lineDef(doc).singletonDotSize).toBe(8);
    expect(doc.lines.L1.singletonDotSize).toBe(8);
    expect(captureStyleProps(doc, 'line', 'L1')!.singletonDotSize).toBe(8);
  });

  it('a custom line that sat at the old natural follows to the new natural', () => {
    let doc = addStyledLine(T.DEFAULT_DOC, 'L1', 'A');
    doc = clearStyleTag(doc, 'line', 'L1');
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, { showServiceCode: true });
    expect(doc.lines.L1.singletonDotSize).toBe(12);
    expect(doc.lines.L1.multiDotSize).toBe(12);
  });

  it('a custom line with a chosen size keeps it', () => {
    let doc = addStyledLine(T.DEFAULT_DOC, 'L1', 'A');
    doc = clearStyleTag(doc, 'line', 'L1');
    doc = T.setLineSingletonDotSize(doc, 'L1', 20);
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, { showServiceCode: true });
    expect(doc.lines.L1.singletonDotSize).toBe(20);
    // The multi case still tracked the old natural, so it follows.
    expect(doc.lines.L1.multiDotSize).toBe(12);
  });

  it('a stop pinned at the old natural follows (and re-collapses onto the line)', () => {
    const doc0 = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: DISC, dotStyleId: DISC_ID, dotSize: 12 })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    // Disc loses its code → natural 12 → 8. The stop tracked 12, so it follows
    // to 8 — which equals the line size, so the pin collapses entirely.
    const doc = updateStyleProps(doc0, DISC_ID, { showServiceCode: false });
    expect('dotSize' in doc.stations.a.stops[0]).toBe(false);
  });

  it('a size-neutral style edit moves no sizes', () => {
    const doc0 = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: DISC, dotStyleId: DISC_ID, dotSize: 12 })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const doc = updateStyleProps(doc0, DISC_ID, { strokeWidth: 2 });
    expect(doc.stations.a.stops[0].dotSize).toBe(12);
  });
});

describe('migration + parse materialize the sizes that used to be implied', () => {
  it('migrateDoc v<27 materializes line sizes at their old effective values', () => {
    const out = migrateDoc({ lines: { L1: makeLine({ id: 'L1', singletonDotStyle: DISC }) } }, 26);
    expect(out.lines!.L1.singletonDotSize).toBe(12);
    expect(out.lines!.L1.multiDotSize).toBe(8);
  });

  it('migrateDoc v<27 pins a stop whose own natural differed from the line', () => {
    const out = migrateDoc(
      {
        lines: { L1: makeLine({ id: 'L1' }) },
        stations: {
          a: makeStation({
            id: 'a',
            stops: [makeStop('L1', { dotStyle: DISC, dotStyleId: DISC_ID })],
          }),
        },
      },
      26,
    );
    expect(out.stations!.a.stops[0].dotSize).toBe(12);
    expect(out.lines!.L1.singletonDotSize).toBe(8);
  });

  it('the bake is non-version-gated — a straggler doc self-heals at any version', () => {
    const out = migrateDoc({ lines: { L1: makeLine({ id: 'L1' }) } }, 27);
    expect(out.lines!.L1.singletonDotSize).toBe(8);
    expect(out.lines!.L1.multiDotSize).toBe(8);
  });

  it('parse keeps an explicit size equal to the natural (no drop-at-natural)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', singletonDotSize: 8 })] });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.lines.L1.singletonDotSize).toBe(8);
  });

  it('parse materializes absent sizes from the dot type', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', singletonDotStyle: DISC, singletonDotStyleId: DISC_ID })],
    });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.lines.L1.singletonDotSize).toBe(12);
    expect(r.doc.lines.L1.multiDotSize).toBe(8);
  });
});
