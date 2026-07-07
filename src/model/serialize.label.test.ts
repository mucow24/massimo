import { describe, it, expect } from 'vitest';
import { serialize, parse, SCHEMA_FORMAT } from './serialize';
import { makeDoc, makeStation, makeTextLabel } from '../test/fixtures';

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

describe('station label autoAlign serialization', () => {
  it('round-trips the flag and H/V overrides (sanitizeStations must not strip them)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          label: {
            row: 0,
            col: -1,
            rotation: 0,
            offset: 0,
            align: 'auto',
            valign: 'middle',
            autoAlign: true,
            autoHAlign: 'end',
            autoVAlign: 'down',
          },
        }),
      ],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.stations['s1'].label.autoAlign).toBe(true);
    expect(result.doc.stations['s1'].label.autoHAlign).toBe('end');
    expect(result.doc.stations['s1'].label.autoVAlign).toBe('down');
  });

  it('legacy saves without the field load with it absent (off)', () => {
    const legacy = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: {
        stations: {
          s1: {
            id: 's1',
            name: 'Foo',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [],
            label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
          },
        },
        lines: {},
        lineOrder: [],
      },
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.stations['s1'].label.autoAlign).toBeUndefined();
  });
});
