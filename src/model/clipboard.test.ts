import { describe, it, expect } from 'vitest';
import { readClipboard, writeClipboard, type ClipPayload } from './clipboard';
import { ROUTE_BULLET_SHAPES, TEXT_LABEL_ALIGNS } from './transforms';
import { LABEL_WEIGHT_NAMES } from '../util/fonts';

const FORMAT = 'massimo-clipboard';

const bulletItem: ClipPayload = {
  kind: 'route-bullet',
  data: {
    x: 5,
    y: 10,
    rotation: 2,
    lineId: 'L1',
    shape: 'square',
    size: 20,
  },
};

const labelItem: ClipPayload = {
  kind: 'text-label',
  data: {
    x: 1,
    y: 2,
    rotation: 3,
    text: 'Hello\nWorld',
    fontSize: 24,
    weight: 700,
    italic: true,
    align: 'center',
    color: '#ff0000',
    darkColor: '#00ff00',
  },
};

const polygonItem: ClipPayload = {
  kind: 'polygon',
  data: {
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    // Translucent (#rrggbbaa) fill exercises the widened HEX_COLOR gate + round-trip.
    fill: '#aabbcc80',
    stroke: '#112233',
    darkFill: '#445566',
    darkStroke: '#778899',
    strokeWidth: 2,
    locked: true,
    curveRadius: 12,
    closed: false,
  },
};

// Build a raw envelope with arbitrary (possibly malformed) items, bypassing the
// typed writeClipboard so we can exercise the validators directly.
function envelope(items: unknown[], version = 2): string {
  return JSON.stringify({ format: FORMAT, version, items });
}

describe('styleId rides the clipboard', () => {
  it('round-trips an optional styleId on bullets, labels and polygons', () => {
    const tagged: ClipPayload[] = [
      { kind: 'route-bullet', data: { ...bulletItem.data, styleId: 'y1' } },
      { kind: 'text-label', data: { ...labelItem.data, styleId: 'y2' } },
      { kind: 'polygon', data: { ...polygonItem.data, styleId: 'y3' } },
    ];
    const out = readClipboard(writeClipboard(tagged));
    expect(out?.map((p) => (p.data as { styleId?: string }).styleId)).toEqual(['y1', 'y2', 'y3']);
  });

  it('rejects an item whose styleId is present but not a string', () => {
    const out = readClipboard(
      envelope([{ kind: 'route-bullet', data: { ...bulletItem.data, styleId: 42 } }, labelItem]),
    );
    expect(out).toHaveLength(1);
    expect(out?.[0].kind).toBe('text-label');
  });
});

describe('writeClipboard / readClipboard roundtrip', () => {
  it('preserves a route-bullet item', () => {
    expect(readClipboard(writeClipboard([bulletItem]))).toEqual([bulletItem]);
  });

  it('preserves null lineId (unset bullet)', () => {
    const item: ClipPayload = {
      kind: 'route-bullet',
      data: { ...bulletItem.data, lineId: null },
    };
    expect(readClipboard(writeClipboard([item]))).toEqual([item]);
  });

  it('preserves all fields of a text-label item', () => {
    expect(readClipboard(writeClipboard([labelItem]))).toEqual([labelItem]);
  });

  it('preserves all fields of a polygon item', () => {
    expect(readClipboard(writeClipboard([polygonItem]))).toEqual([polygonItem]);
  });

  it('preserves the locked flag on a route-bullet item', () => {
    const item: ClipPayload = {
      kind: 'route-bullet',
      data: { ...bulletItem.data, locked: true },
    };
    expect(readClipboard(writeClipboard([item]))).toEqual([item]);
  });

  it('preserves the locked flag on a text-label item', () => {
    const item: ClipPayload = {
      kind: 'text-label',
      data: { ...labelItem.data, locked: true },
    };
    expect(readClipboard(writeClipboard([item]))).toEqual([item]);
  });

  it('leaves an absent locked flag absent on bullet / label items', () => {
    const parsed = readClipboard(writeClipboard([bulletItem, labelItem]));
    expect(parsed).toEqual([bulletItem, labelItem]);
    expect(parsed![0].data).not.toHaveProperty('locked');
    expect(parsed![1].data).not.toHaveProperty('locked');
  });

  it('preserves order across a mixed multi-item payload', () => {
    const items = [bulletItem, labelItem, polygonItem];
    expect(readClipboard(writeClipboard(items))).toEqual(items);
  });

  it('leaves absent optional polygon fields absent (does not materialize them)', () => {
    const item: ClipPayload = {
      kind: 'polygon',
      data: {
        vertices: polygonItem.data.vertices,
        fill: '#aabbcc',
        stroke: '#112233',
        darkFill: '#445566',
        darkStroke: '#778899',
        strokeWidth: 2,
      },
    };
    const parsed = readClipboard(writeClipboard([item]));
    expect(parsed).toEqual([item]);
    expect(parsed![0].data).not.toHaveProperty('locked');
    expect(parsed![0].data).not.toHaveProperty('curveRadius');
    expect(parsed![0].data).not.toHaveProperty('closed');
  });

  it('preserves closed:false so an open polygon does not paste as closed', () => {
    // Regression: `closed` is optional (missing ⇒ closed). A parser that drops
    // it turns a copied OPEN polygon into a CLOSED one on paste — data loss.
    const item: ClipPayload = {
      kind: 'polygon',
      data: { ...polygonItem.data, closed: false },
    };
    const parsed = readClipboard(writeClipboard([item]));
    expect(parsed).toEqual([item]);
    expect((parsed![0].data as { closed?: boolean }).closed).toBe(false);
  });

  it('rejects a polygon whose closed flag is present but not a boolean', () => {
    const bad = { ...polygonItem.data, closed: 'nope' };
    expect(readClipboard(envelope([{ kind: 'polygon', data: bad }]))).toBeNull();
  });
});

describe('readClipboard rejects bad envelopes', () => {
  it('returns null for non-JSON', () => {
    expect(readClipboard('not json')).toBeNull();
  });

  it('returns null for JSON without our format tag', () => {
    expect(readClipboard(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });

  it('returns null for the wrong format string', () => {
    expect(
      readClipboard(JSON.stringify({ format: 'other', version: 2, items: [bulletItem] })),
    ).toBeNull();
  });

  it('returns null for a newer schema version than this code understands', () => {
    expect(readClipboard(envelope([bulletItem], 999))).toBeNull();
  });

  it('returns null when items is missing or not an array (e.g. legacy v1 payload)', () => {
    expect(
      readClipboard(JSON.stringify({ format: FORMAT, version: 1, payload: bulletItem })),
    ).toBeNull();
    expect(readClipboard(JSON.stringify({ format: FORMAT, version: 2, items: {} }))).toBeNull();
  });

  it('returns null for an empty items array', () => {
    expect(readClipboard(envelope([]))).toBeNull();
  });
});

describe('readClipboard drops malformed items, keeps valid ones', () => {
  it('drops an unknown kind, keeps the rest', () => {
    expect(readClipboard(envelope([{ kind: 'mystery', data: {} }, bulletItem]))).toEqual([
      bulletItem,
    ]);
  });

  it('returns null when every item is invalid', () => {
    expect(readClipboard(envelope([{ kind: 'mystery', data: {} }]))).toBeNull();
  });

  it('drops a bullet with incomplete data', () => {
    expect(readClipboard(envelope([{ kind: 'route-bullet', data: { x: 1 } }, labelItem]))).toEqual([
      labelItem,
    ]);
  });

  it('drops a bullet with an invalid shape', () => {
    const bad = { kind: 'route-bullet', data: { ...bulletItem.data, shape: 'pentagon' } };
    expect(readClipboard(envelope([bad, labelItem]))).toEqual([labelItem]);
  });

  it('drops a text-label with an out-of-set weight (no 600)', () => {
    const bad = { kind: 'text-label', data: { ...labelItem.data, weight: 600 } };
    expect(readClipboard(envelope([bad, bulletItem]))).toEqual([bulletItem]);
  });

  it('drops a text-label with a bad align', () => {
    const bad = { kind: 'text-label', data: { ...labelItem.data, align: 'block' } };
    expect(readClipboard(envelope([bad]))).toBeNull();
  });

  // Paste is a THIRD gate on these small unions, behind the file-import
  // sanitizers and the pickers that offer the values. Walk the model's own
  // ladders so a value the app can produce but paste would silently drop
  // fails here rather than on a user's clipboard.
  describe('paste accepts every value the model ladders name', () => {
    it('accepts every route-bullet shape', () => {
      for (const shape of ROUTE_BULLET_SHAPES) {
        const item = { kind: 'route-bullet', data: { ...bulletItem.data, shape } };
        expect(readClipboard(envelope([item])), shape).toEqual([item]);
      }
    });

    it('accepts every text-label align', () => {
      for (const align of TEXT_LABEL_ALIGNS) {
        const item = { kind: 'text-label', data: { ...labelItem.data, align } };
        expect(readClipboard(envelope([item])), align).toEqual([item]);
      }
    });

    it('accepts every shipped label weight', () => {
      for (const { value } of LABEL_WEIGHT_NAMES) {
        const item = { kind: 'text-label', data: { ...labelItem.data, weight: value } };
        expect(readClipboard(envelope([item])), String(value)).toEqual([item]);
      }
    });
  });

  it('round-trips a justified, fixed-width text-label', () => {
    const item: ClipPayload = {
      kind: 'text-label',
      data: { ...labelItem.data, align: 'justify', width: 240 },
    };
    expect(readClipboard(writeClipboard([item]))).toEqual([item]);
  });

  it('leaves an absent width absent on a text-label (Auto mode)', () => {
    const parsed = readClipboard(writeClipboard([labelItem]));
    expect(parsed![0].data).not.toHaveProperty('width');
  });

  it('drops a text-label with a negative width', () => {
    const bad = { kind: 'text-label', data: { ...labelItem.data, width: -10 } };
    expect(readClipboard(envelope([bad]))).toBeNull();
  });

  it('round-trips leading and tracking on a text-label', () => {
    const item: ClipPayload = {
      kind: 'text-label',
      data: { ...labelItem.data, leading: 1.5, tracking: 0.2 },
    };
    expect(readClipboard(writeClipboard([item]))).toEqual([item]);
  });

  it('leaves absent leading/tracking absent on a text-label', () => {
    const parsed = readClipboard(writeClipboard([labelItem]));
    expect(parsed![0].data).not.toHaveProperty('leading');
    expect(parsed![0].data).not.toHaveProperty('tracking');
  });

  it('drops a text-label with non-numeric leading or tracking', () => {
    const badLeading = { kind: 'text-label', data: { ...labelItem.data, leading: 'loose' } };
    expect(readClipboard(envelope([badLeading]))).toBeNull();
    const badTracking = { kind: 'text-label', data: { ...labelItem.data, tracking: 'wide' } };
    expect(readClipboard(envelope([badTracking]))).toBeNull();
  });

  it('drops a text-label with a non-finite fontSize', () => {
    const bad = { kind: 'text-label', data: { ...labelItem.data, fontSize: 'big' } };
    expect(readClipboard(envelope([bad]))).toBeNull();
  });

  it('drops a polygon with fewer than 3 vertices', () => {
    const bad = {
      kind: 'polygon',
      data: {
        ...polygonItem.data,
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    };
    expect(readClipboard(envelope([bad]))).toBeNull();
  });

  it('drops a polygon with non-array vertices', () => {
    const bad = { kind: 'polygon', data: { ...polygonItem.data, vertices: 'nope' } };
    expect(readClipboard(envelope([bad]))).toBeNull();
  });

  it('drops a polygon with a bad hex color', () => {
    const bad = { kind: 'polygon', data: { ...polygonItem.data, fill: 'red' } };
    expect(readClipboard(envelope([bad]))).toBeNull();
  });
});
