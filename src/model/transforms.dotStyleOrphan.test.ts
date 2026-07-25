import { describe, it, expect } from 'vitest';
import * as T from '../model/transforms';
import { deleteStyle } from '../model/styles';
import {
  DEFAULT_DOT_STYLE,
  DEFAULT_STOP_DOT_STYLE_ID,
  DOT_SHAPE_PRESETS,
  resolveDotStyle,
} from '../model/dotStyle';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc } from '../model/types';

// A line whose split dot default is an ORPHANED raw shadow: it wears a
// non-factory-black dot with NO stopDot style tag. Produced by the real
// delete path — deleteStopDotStyle drops the tag and keeps the raw value, so
// the line keeps DRAWING the deleted style.
function docWithOrphanedSingletonDefault(): MapDoc {
  let doc = makeDoc({
    stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
    lines: [makeLine({ id: 'L1' })],
  });
  // Line inspector: pick the diamond style as L1's singleton default.
  doc = T.setLineSingletonDotStyle(doc, 'L1', 'stop-filled-black-diamond');
  // Styles panel: delete that style. Items keep their formatting.
  doc = deleteStyle(doc, 'stop-filled-black-diamond');
  return doc;
}

describe('setDotStyle vs. an orphaned line dot default', () => {
  it('the precondition really is reachable: raw shadow survives, tag is gone', () => {
    const doc = docWithOrphanedSingletonDefault();
    expect(doc.styles['stop-filled-black-diamond']).toBeUndefined();
    // The line still DRAWS a diamond...
    expect(doc.lines.L1.singletonDotStyle).toEqual(DOT_SHAPE_PRESETS['filled-black-diamond']);
    // ...but carries no id for it.
    expect(doc.lines.L1.singletonDotStyleId).toBeUndefined();
    // And the stop resolves to that diamond.
    expect(resolveDotStyle(doc.lines.L1, doc.stations.a.stops[0], true).shape).toBe('diamond');
  });

  it('picking "Filled black" on the stop actually makes the stop filled-black', () => {
    const doc = docWithOrphanedSingletonDefault();
    const next = T.setDotStyle(doc, 'a', 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    const resolved = resolveDotStyle(next.lines.L1, next.stations.a.stops[0], true);
    expect(resolved).toEqual(DEFAULT_DOT_STYLE);
  });

  it('picking "Filled black" over an existing override does not fall back to the orphan', () => {
    let doc = docWithOrphanedSingletonDefault();
    // Give the stop an explicit "Open white" pin first.
    doc = T.setDotStyle(doc, 'a', 'L1', 'stop-open-white');
    expect(resolveDotStyle(doc.lines.L1, doc.stations.a.stops[0], true)).toEqual(
      DOT_SHAPE_PRESETS['open-white'],
    );
    // Now pick Filled black.
    const next = T.setDotStyle(doc, 'a', 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    expect(resolveDotStyle(next.lines.L1, next.stations.a.stops[0], true).shape).toBe('circle');
  });
});
