// Store-level Styles actions: upsert-by-name resolution, single-undo-entry
// semantics, and styleId behavior through duplicate/paste. The pure transform
// logic lives in model/styles.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';
import { undo } from './history';
import { DEFAULT_DOC } from '../model/transforms';
import type { TextLabelStyleProps } from '../model/types';
import { makeRouteBullet, makeStation, makeStyle, makeTextLabel } from '../test/fixtures';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('saveStyle', () => {
  it('mints an id, creates the def, and tags the source item', () => {
    useDoc.setState({ textLabels: { g1: makeTextLabel({ id: 'g1', fontSize: 24 }) } });
    const id = useDoc.getState().saveStyle('textLabel', 'Heading', 'g1');
    const s = useDoc.getState();
    expect(s.styles[id]).toMatchObject({ id, name: 'Heading', kind: 'textLabel' });
    expect((s.styles[id].props as TextLabelStyleProps).fontSize).toBe(24);
    expect(s.textLabels.g1.styleId).toBe(id);
  });

  it('re-saving the same name+kind reuses the id (upsert) and re-stamps users', () => {
    useDoc.setState({
      textLabels: {
        g1: makeTextLabel({ id: 'g1', fontSize: 24 }),
        g2: makeTextLabel({ id: 'g2', fontSize: 30 }),
      },
    });
    const first = useDoc.getState().saveStyle('textLabel', 'Heading', 'g1');
    useDoc.getState().applyStyle(first, 'g2');
    expect(useDoc.getState().textLabels.g2.fontSize).toBe(24);
    // Redefine "Heading" from g2 after tweaking it.
    useDoc.getState().updateTextLabel('g2', { fontSize: 36 }); // detaches g2
    const second = useDoc.getState().saveStyle('textLabel', 'Heading', 'g2');
    expect(second).toBe(first);
    const s = useDoc.getState();
    expect((s.styles[first].props as TextLabelStyleProps).fontSize).toBe(36);
    expect(s.textLabels.g1.fontSize).toBe(36); // re-stamped user
    expect(s.textLabels.g1.styleId).toBe(first);
  });

  it('a save (def + tag + re-stamp) is exactly one undo step', () => {
    useDoc.setState({
      textLabels: {
        g1: makeTextLabel({ id: 'g1', fontSize: 24 }),
        g2: makeTextLabel({ id: 'g2', fontSize: 30, styleId: 'y1' }),
      },
      styles: { y1: makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 30 } }) },
    });
    useDoc.temporal.getState().clear();
    useDoc.getState().saveStyle('textLabel', 'Heading', 'g1'); // overwrites y1, re-stamps g2
    expect((useDoc.getState().styles.y1.props as TextLabelStyleProps).fontSize).toBe(24);
    expect(useDoc.getState().textLabels.g2.fontSize).toBe(24);
    undo();
    const s = useDoc.getState();
    expect((s.styles.y1.props as TextLabelStyleProps).fontSize).toBe(30);
    expect(s.textLabels.g2.fontSize).toBe(30);
    expect(s.textLabels.g1.styleId).toBeUndefined();
  });
});

describe('applyStyle / clearStyleTag / renameStyle / deleteStyle', () => {
  beforeEach(() => {
    useDoc.setState({
      textLabels: { g1: makeTextLabel({ id: 'g1', fontSize: 12 }) },
      styles: {
        y1: makeStyle('textLabel', 'y1', {
          name: 'Heading',
          props: { fontSize: 24, weight: 700, italic: true },
        }),
        // A second textLabel style so deleting y1 isn't a last-of-kind refusal.
        y0: makeStyle('textLabel', 'y0', { name: 'Body' }),
      },
      styleDefaults: { ...DEFAULT_DOC.styleDefaults, textLabel: 'y0' },
    });
    useDoc.temporal.getState().clear();
  });

  it('applyStyle stamps all covered fields and is one undo step', () => {
    useDoc.getState().applyStyle('y1', 'g1');
    const label = useDoc.getState().textLabels.g1;
    expect(label.fontSize).toBe(24);
    expect(label.weight).toBe(700);
    expect(label.italic).toBe(true);
    expect(label.styleId).toBe('y1');
    undo();
    const back = useDoc.getState().textLabels.g1;
    expect(back.fontSize).toBe(12);
    expect(back.weight).toBe(400);
    expect(back.styleId).toBeUndefined();
  });

  it('clearStyleTag detaches without touching values', () => {
    useDoc.getState().applyStyle('y1', 'g1');
    useDoc.getState().clearStyleTag('textLabel', 'g1');
    const label = useDoc.getState().textLabels.g1;
    expect(label.styleId).toBeUndefined();
    expect(label.fontSize).toBe(24);
  });

  it('renameStyle renames; deleteStyle untags users and is one undo step', () => {
    useDoc.getState().applyStyle('y1', 'g1');
    useDoc.getState().renameStyle('y1', 'Header');
    expect(useDoc.getState().styles.y1.name).toBe('Header');
    useDoc.temporal.getState().clear();
    useDoc.getState().deleteStyle('y1');
    expect(useDoc.getState().styles.y1).toBeUndefined();
    expect(useDoc.getState().textLabels.g1.styleId).toBeUndefined();
    expect(useDoc.getState().textLabels.g1.fontSize).toBe(24); // values kept
    undo();
    expect(useDoc.getState().styles.y1).toBeDefined();
    expect(useDoc.getState().textLabels.g1.styleId).toBe('y1');
  });
});

describe('createStyle / updateStyleProps (the panel editor)', () => {
  it('createStyle mints unique "New style N" names within the kind', () => {
    useDoc.setState({ styles: {} });
    const a = useDoc.getState().createStyle('routeBullet');
    const b = useDoc.getState().createStyle('routeBullet');
    const c = useDoc.getState().createStyle('polygon');
    expect(useDoc.getState().styles[a].name).toBe('New style');
    expect(useDoc.getState().styles[b].name).toBe('New style 2');
    // Names are per-kind, so the polygon one starts over.
    expect(useDoc.getState().styles[c].name).toBe('New style');
    expect(useDoc.getState().styles[a].props).toEqual({ shape: 'circle', size: 14 });
  });

  it('updateStyleProps edits the def and re-stamps tagged users in ONE undo entry', () => {
    useDoc.setState({
      textLabels: {
        g1: makeTextLabel({ id: 'g1', fontSize: 24, styleId: 'y1' }),
        g2: makeTextLabel({ id: 'g2', fontSize: 11 }),
      },
      styles: { y1: makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 24 } }) },
    });
    useDoc.temporal.getState().clear();
    useDoc.getState().updateStyleProps('y1', { fontSize: 30 });
    const s = useDoc.getState();
    expect((s.styles.y1.props as TextLabelStyleProps).fontSize).toBe(30);
    expect(s.textLabels.g1.fontSize).toBe(30); // live re-stamp
    expect(s.textLabels.g1.styleId).toBe('y1');
    expect(s.textLabels.g2.fontSize).toBe(11); // bystander untouched
    undo();
    expect((useDoc.getState().styles.y1.props as TextLabelStyleProps).fontSize).toBe(24);
    expect(useDoc.getState().textLabels.g1.fontSize).toBe(24);
  });
});

describe('new items wear the Default style on creation', () => {
  it('addTextLabel stamps the CURRENT (redefined) default in one undo entry', () => {
    useDoc.setState({
      styles: {
        y1: makeStyle('textLabel', 'y1', {
          name: 'Default',
          props: { fontSize: 24, weight: 700 },
        }),
      },
      styleDefaults: { ...DEFAULT_DOC.styleDefaults, textLabel: 'y1' },
    });
    useDoc.temporal.getState().clear();
    const id = useDoc.getState().addTextLabel(0, 0);
    const label = useDoc.getState().textLabels[id];
    expect(label.fontSize).toBe(24);
    expect(label.weight).toBe(700);
    expect(label.styleId).toBe('y1');
    undo();
    expect(useDoc.getState().textLabels[id]).toBeUndefined();
  });

  it('addRouteBullet / addPolygon / addTransfer tag their Defaults too', () => {
    useDoc.setState({
      stations: { s1: makeStation({ id: 's1' }), s2: makeStation({ id: 's2', x: 200 }) },
      styles: {
        y1: makeStyle('routeBullet', 'y1', { name: 'Default', props: { size: 20 } }),
        y2: makeStyle('polygon', 'y2', { name: 'Default', props: { fill: '#00ff00' } }),
        y3: makeStyle('transfer', 'y3', { name: 'Default', props: { thickness: 6 } }),
      },
      styleDefaults: {
        ...DEFAULT_DOC.styleDefaults,
        routeBullet: 'y1',
        polygon: 'y2',
        transfer: 'y3',
      },
    });
    const b = useDoc.getState().addRouteBullet(0, 0, null);
    expect(useDoc.getState().routeBullets[b]).toMatchObject({ size: 20, styleId: 'y1' });
    const p = useDoc.getState().addPolygon(0, 0);
    expect(useDoc.getState().polygons[p]).toMatchObject({ fill: '#00ff00', styleId: 'y2' });
    const x = useDoc
      .getState()
      .addTransfer({ stationId: 's1', lineId: null }, { stationId: 's2', lineId: null });
    expect(useDoc.getState().transfers[x]).toMatchObject({ thickness: 6, styleId: 'y3' });
  });

  it('addLine keeps its cycled color but wears the default line style', () => {
    useDoc.setState({
      styles: { y1: makeStyle('line', 'y1', { name: 'Default', props: { width: 12 } }) },
      styleDefaults: { ...DEFAULT_DOC.styleDefaults, line: 'y1' },
    });
    const id = useDoc.getState().addLine();
    expect(useDoc.getState().lines[id].width).toBe(12);
    expect(useDoc.getState().lines[id].styleId).toBe('y1');
    expect(useDoc.getState().lines[id].color).toBeTruthy(); // identity untouched
  });

  it('a fresh doc starts with the six factory Defaults and tags new items with them', () => {
    // beforeEach seeds DEFAULT_DOC, whose styles are the factory Defaults.
    const names = Object.values(useDoc.getState().styles).map((d) => d.name);
    expect(names).toEqual(['Default', 'Default', 'Default', 'Default', 'Default', 'Default']);
    const id = useDoc.getState().addTextLabel(0, 0);
    expect(useDoc.getState().textLabels[id].styleId).toBe('default-textLabel');
    // A new station is stamped + tagged with the default 'station' style too.
    const sid = useDoc.getState().addStation(0, 0, 'S');
    expect(useDoc.getState().stations[sid].styleId).toBe('default-station');
  });

  it('setDefaultStyle re-routes creation, and the designation is undoable', () => {
    useDoc.setState({
      styles: {
        y1: makeStyle('textLabel', 'y1', { name: 'Base' }),
        y2: makeStyle('textLabel', 'y2', { name: 'Heading', props: { fontSize: 24 } }),
      },
      styleDefaults: { ...DEFAULT_DOC.styleDefaults, textLabel: 'y1' },
    });
    useDoc.temporal.getState().clear();
    useDoc.getState().setDefaultStyle('y2');
    expect(useDoc.getState().styleDefaults.textLabel).toBe('y2');
    const id = useDoc.getState().addTextLabel(0, 0);
    expect(useDoc.getState().textLabels[id]).toMatchObject({ fontSize: 24, styleId: 'y2' });
    undo(); // drop the label
    undo(); // revert the designation — styleDefaults is a tracked DOC_FIELD
    expect(useDoc.getState().styleDefaults.textLabel).toBe('y1');
  });
});

describe('styleId through duplicate and paste', () => {
  it('duplicating a tagged item carries the tag (same doc, style resolves)', () => {
    useDoc.setState({
      textLabels: { g1: makeTextLabel({ id: 'g1', fontSize: 24, styleId: 'y1' }) },
      routeBullets: { b1: makeRouteBullet({ id: 'b1', styleId: 'y2' }) },
      styles: {
        y1: makeStyle('textLabel', 'y1', { props: { fontSize: 24 } }),
        y2: makeStyle('routeBullet', 'y2', { props: { size: 12 } }),
      },
    });
    const labelCopy = useDoc.getState().duplicateTextLabel('g1');
    const bulletCopy = useDoc.getState().duplicateRouteBullet('b1');
    expect(labelCopy && useDoc.getState().textLabels[labelCopy].styleId).toBe('y1');
    expect(bulletCopy && useDoc.getState().routeBullets[bulletCopy].styleId).toBe('y2');
  });

  it('pasting into a doc that lacks the style drops the tag, keeps the values', () => {
    const { id: _gone, ...data } = makeTextLabel({ id: 'tmp', fontSize: 24, styleId: 'foreign' });
    const pasted = useDoc.getState().pasteTextLabel(data);
    expect(useDoc.getState().textLabels[pasted].styleId).toBeUndefined();
    expect(useDoc.getState().textLabels[pasted].fontSize).toBe(24);
  });

  it('pasting a stale tagged payload re-stamps it to the CURRENT style values', () => {
    // The clipboard froze the values before the style was redefined; the
    // pasted item must come in matching its tag (tagged ⇒ matches), i.e.
    // wearing the style's current props, not the stale snapshot.
    useDoc.setState({
      styles: {
        y1: makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 36 } }),
        y2: makeStyle('routeBullet', 'y2', { name: 'Big', props: { size: 20 } }),
      },
    });
    const { id: _g, ...label } = makeTextLabel({ id: 'tmp', fontSize: 24, styleId: 'y1' });
    const pastedLabel = useDoc.getState().pasteTextLabel(label);
    expect(useDoc.getState().textLabels[pastedLabel].fontSize).toBe(36);
    expect(useDoc.getState().textLabels[pastedLabel].styleId).toBe('y1');

    const { id: _b, ...bullet } = makeRouteBullet({ id: 'tmp', size: 12, styleId: 'y2' });
    const pastedBullet = useDoc.getState().pasteRouteBullet(bullet);
    expect(useDoc.getState().routeBullets[pastedBullet].size).toBe(20);
    expect(useDoc.getState().routeBullets[pastedBullet].styleId).toBe('y2');
  });
});
