import { describe, it, expect } from 'vitest';
import { groupLinesForList } from './lineListOrder';
import { makeLine, makeStyle } from '../test/fixtures';
import type { Line, StyleDef } from '../model/types';

// The lines list's ordering, as a pure function of the lines, the style
// library, and the two view controls (sort column, group-by-style). The panel
// itself only renders what this returns.

const styles = (...defs: StyleDef[]): Record<string, StyleDef> =>
  Object.fromEntries(defs.map((d) => [d.id, d]));

// Group keys/labels and the ids inside each, which is exactly what the panel
// walks — one string per group so an ordering mistake reads at a glance.
const shape = (groups: { label: string | null; lines: Line[] }[]) =>
  groups.map((g) => `${g.label ?? '—'}: ${g.lines.map((l) => l.id).join(',')}`);

describe('groupLinesForList — ungrouped', () => {
  const lines = [
    makeLine({ id: 'c', name: 'Crosstown', stations: ['s1', 's2'] }),
    makeLine({ id: 'a', name: 'Airport', stations: ['s1', 's2', 's3', 's4'] }),
    makeLine({ id: 'b', name: 'Bay', stations: ['s1'] }),
  ];
  const opts = { groupByStyle: false } as const;

  it('returns one unlabelled group holding every line', () => {
    const out = groupLinesForList(lines, {}, { ...opts, sortBy: 'name' });
    expect(out).toHaveLength(1);
    expect(out[0].label).toBeNull();
    expect(out[0].lines).toHaveLength(3);
  });

  it('sorts by display name', () => {
    expect(shape(groupLinesForList(lines, {}, { ...opts, sortBy: 'name' }))).toEqual(['—: a,b,c']);
  });

  it('sorts by stop count numerically, not as text', () => {
    // Ten stops must land BELOW two, which a lexicographic compare ("10" < "2")
    // would invert.
    const withTen = [
      ...lines,
      makeLine({ id: 'x', name: 'Express', stations: Array(10).fill('s') }),
    ];
    expect(shape(groupLinesForList(withTen, {}, { ...opts, sortBy: 'stops' }))).toEqual([
      '—: b,c,a,x',
    ]);
  });

  it('breaks stop-count ties by name', () => {
    const tied = [
      makeLine({ id: 'z', name: 'Zoo', stations: ['s1'] }),
      makeLine({ id: 'm', name: 'Metro', stations: ['s1'] }),
      makeLine({ id: 'big', name: 'Big', stations: ['s1', 's2'] }),
    ];
    // Equal-sized lines fall back to A→Z rather than to whatever order the doc
    // happens to hold them in.
    expect(shape(groupLinesForList(tied, {}, { ...opts, sortBy: 'stops' }))).toEqual([
      '—: m,z,big',
    ]);
  });

  it('names an unnamed line the way the rest of the app does', () => {
    // lineDisplayName falls back to "<service> line", so an unnamed Q sorts
    // under Q — not to the top as an empty string would.
    const unnamed = [
      makeLine({ id: 'q', service: 'Q', name: '' }),
      makeLine({ id: 'a', name: 'Ashland' }),
      makeLine({ id: 'z', name: 'Zed' }),
    ];
    expect(shape(groupLinesForList(unnamed, {}, { ...opts, sortBy: 'name' }))).toEqual([
      '—: a,q,z',
    ]);
  });
});

describe('groupLinesForList — grouped by style', () => {
  const bold = makeStyle('line', 'st-bold', { name: 'Bold' });
  const thin = makeStyle('line', 'st-thin', { name: 'Thin' });
  const air = makeStyle('line', 'st-air', { name: 'Airy' });
  const lib = styles(bold, thin, air);
  const opts = { groupByStyle: true, sortBy: 'name' } as const;

  it('groups by assigned style, alphabetically, with Custom last', () => {
    const lines = [
      makeLine({ id: 'untagged', name: 'Nomad' }),
      makeLine({ id: 'thin1', name: 'Wire', styleId: 'st-thin' }),
      makeLine({ id: 'bold1', name: 'Heavy', styleId: 'st-bold' }),
      makeLine({ id: 'air1', name: 'Breeze', styleId: 'st-air' }),
    ];
    expect(shape(groupLinesForList(lines, lib, opts))).toEqual([
      'Airy: air1',
      'Bold: bold1',
      'Thin: thin1',
      'Custom: untagged',
    ]);
  });

  it('sorts WITHIN each group, not across the whole list', () => {
    const lines = [
      makeLine({ id: 'b2', name: 'Yarrow', styleId: 'st-bold' }),
      makeLine({ id: 'b1', name: 'Alder', styleId: 'st-bold' }),
      makeLine({ id: 'c2', name: 'Willow' }),
      makeLine({ id: 'c1', name: 'Beech' }),
    ];
    // Alder…Yarrow and Beech…Willow interleave alphabetically across the list;
    // grouped, each pair sorts only against its own bucket.
    expect(shape(groupLinesForList(lines, lib, opts))).toEqual(['Bold: b1,b2', 'Custom: c1,c2']);
  });

  it('sorts within a group by stop count too', () => {
    const lines = [
      makeLine({ id: 'long', name: 'Long', styleId: 'st-bold', stations: ['s1', 's2', 's3'] }),
      makeLine({ id: 'short', name: 'Short', styleId: 'st-bold', stations: ['s1'] }),
    ];
    expect(shape(groupLinesForList(lines, lib, { ...opts, sortBy: 'stops' }))).toEqual([
      'Bold: short,long',
    ]);
  });

  it('emits no group for a style nothing wears, and none for Custom when every line is tagged', () => {
    const lines = [makeLine({ id: 'b1', name: 'Heavy', styleId: 'st-bold' })];
    // 'Thin' and 'Airy' exist in the library but dress nobody — an empty
    // subheader is noise, and an empty Custom row would imply untagged lines.
    expect(shape(groupLinesForList(lines, lib, opts))).toEqual(['Bold: b1']);
  });

  it('files a line whose style tag does not resolve under Custom', () => {
    // Dangling tags are pruned on load, so this is a totality guard: the line
    // must still appear somewhere rather than vanish from the list.
    const lines = [makeLine({ id: 'ghost', name: 'Ghost', styleId: 'st-deleted' })];
    expect(shape(groupLinesForList(lines, lib, opts))).toEqual(['Custom: ghost']);
  });

  it('carries the style id as the group key, and the empty string for Custom', () => {
    const lines = [
      makeLine({ id: 'b1', name: 'Heavy', styleId: 'st-bold' }),
      makeLine({ id: 'c1', name: 'Plain' }),
    ];
    expect(groupLinesForList(lines, lib, opts).map((g) => g.key)).toEqual(['st-bold', '']);
  });
});
