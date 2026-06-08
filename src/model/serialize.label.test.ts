import { describe, it, expect } from 'vitest';
import { serialize, parse, SCHEMA_FORMAT } from './serialize';
import { makeDoc, makeTextLabel } from '../test/fixtures';

describe('text-label color serialization', () => {
  it('round-trips day/night colors distinct from each other', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', color: '#112233', darkColor: '#445566' })],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const g = result.doc.textLabels['g1'];
    expect(g.color).toBe('#112233');
    expect(g.darkColor).toBe('#445566');
  });

  it('backfills missing colors on load to the theme-matching defaults', () => {
    const legacy = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: {
        stations: {},
        lines: {},
        lineOrder: [],
        textLabels: {
          g1: {
            id: 'g1',
            x: 10,
            y: 20,
            rotation: 0,
            text: 'Old Label',
            fontSize: 16,
            weight: 400,
            italic: false,
            align: 'left',
            // no color / darkColor — saved before these fields existed
          },
        },
      },
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.textLabels['g1'].color).toBe('#111111');
    expect(result.doc.textLabels['g1'].darkColor).toBe('#ffffff');
  });
});
