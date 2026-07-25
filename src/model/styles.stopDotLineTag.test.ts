import { describe, it, expect } from 'vitest';
import * as T from '../model/transforms';
import {
  applyDefaultStyle,
  captureStyleProps,
  stylePropsEqual,
  updateStyleProps,
} from '../model/styles';
import { DEFAULT_STOP_DOT_STYLE_ID } from '../model/dotStyle';
import { lineSingletonDotSizeOf } from '../model/dotSize';
import { parse, serialize } from '../model/serialize';
import type { LineId, LineStyleProps, MapDoc } from '../model/types';

// The store's addLine composition, verbatim (state/store.ts ~779): seed the ⭐
// stopDot default onto the fresh line, then stamp + tag it with the designated
// default LINE style.
const addStyledLine = (doc: MapDoc, id: LineId, service: string): MapDoc =>
  applyDefaultStyle(
    T.applyDefaultStopDotToLine(T.addLine(doc, id, service, '#0039a6'), id),
    'line',
    id,
  );

const lineDef = (doc: MapDoc): LineStyleProps => doc.styles['default-line'].props as LineStyleProps;

describe('editing a stopDot style vs. the tagged ⇒ matches invariant on LINE styles', () => {
  it('keeps a tagged line matching its line style after its stopDot style gains a service code', () => {
    let doc = addStyledLine(T.DEFAULT_DOC, 'L1', 'A');
    // Preconditions: the line wears "Default" and its dot size is fully
    // tracking (nothing stored), so its captured size is style-derived.
    expect(doc.lines.L1.styleId).toBe('default-line');
    expect(doc.lines.L1.singletonDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
    expect('singletonDotSize' in doc.lines.L1).toBe(false);
    expect(captureStyleProps(doc, 'line', 'L1')!.singletonDotSize).toBe(
      lineDef(doc).singletonDotSize,
    );

    // Styles panel → Stop dots → "Filled black" → tick "Service code".
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, { showServiceCode: true });

    // The line is still tagged, so its covered values MUST still equal the def.
    expect(doc.lines.L1.styleId).toBe('default-line');
    expect(captureStyleProps(doc, 'line', 'L1')!.singletonDotSize).toBe(
      lineDef(doc).singletonDotSize,
    );
    expect(stylePropsEqual('line', captureStyleProps(doc, 'line', 'L1')!, lineDef(doc))).toBe(true);
  });

  it('draws the same dot size on two lines that both wear "Default"', () => {
    let doc = addStyledLine(T.DEFAULT_DOC, 'L1', 'A');
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, { showServiceCode: true });
    doc = addStyledLine(doc, 'L2', 'B');

    expect(doc.lines.L1.styleId).toBe('default-line');
    expect(doc.lines.L2.styleId).toBe('default-line');
    expect(lineSingletonDotSizeOf(doc.lines.L1)).toBe(lineSingletonDotSizeOf(doc.lines.L2));
  });

  it('keeps the tag across a save/load round-trip', () => {
    let doc = addStyledLine(T.DEFAULT_DOC, 'L1', 'A');
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, { showServiceCode: true });
    doc = addStyledLine(doc, 'L2', 'B');

    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // L2 (stamped AFTER the stopDot edit, so it stored an explicit 8) survives
    // the prune; L1 is the one whose tag is silently stripped.
    expect(r.doc.lines.L2.styleId).toBe('default-line');
    expect(r.doc.lines.L1.styleId).toBe('default-line');
  });
});
