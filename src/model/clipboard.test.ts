import { describe, it, expect } from 'vitest';
import { readClipboard, writeClipboard, type ClipPayload } from './clipboard';

const validBulletPayload: ClipPayload = {
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

describe('writeClipboard / readClipboard roundtrip', () => {
  it('preserves all fields of a route-bullet payload', () => {
    const text = writeClipboard(validBulletPayload);
    const parsed = readClipboard(text);
    expect(parsed).toEqual(validBulletPayload);
  });

  it('preserves null lineId (unset bullet)', () => {
    const payload: ClipPayload = {
      kind: 'route-bullet',
      data: { ...validBulletPayload.data, lineId: null },
    };
    expect(readClipboard(writeClipboard(payload))).toEqual(payload);
  });
});

describe('readClipboard rejects malformed input', () => {
  it('returns null for non-JSON', () => {
    expect(readClipboard('not json')).toBeNull();
  });

  it('returns null for JSON without our format tag', () => {
    expect(readClipboard(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });

  it('returns null for the wrong format string', () => {
    expect(
      readClipboard(
        JSON.stringify({
          format: 'something-else',
          version: 1,
          payload: validBulletPayload,
        }),
      ),
    ).toBeNull();
  });

  it('returns null for a newer schema version than this code understands', () => {
    expect(
      readClipboard(
        JSON.stringify({
          format: 'massimo-clipboard',
          version: 999,
          payload: validBulletPayload,
        }),
      ),
    ).toBeNull();
  });

  it('returns null for unknown kind', () => {
    expect(
      readClipboard(
        JSON.stringify({
          format: 'massimo-clipboard',
          version: 1,
          payload: { kind: 'mystery', data: {} },
        }),
      ),
    ).toBeNull();
  });

  it('returns null for incomplete bullet data', () => {
    expect(
      readClipboard(
        JSON.stringify({
          format: 'massimo-clipboard',
          version: 1,
          payload: { kind: 'route-bullet', data: { x: 1 } },
        }),
      ),
    ).toBeNull();
  });

  it('returns null for invalid shape value', () => {
    expect(
      readClipboard(
        writeClipboard({
          kind: 'route-bullet',
          data: { ...validBulletPayload.data, shape: 'pentagon' as never },
        }),
      ),
    ).toBeNull();
  });

  it('returns null for non-numeric size', () => {
    expect(
      readClipboard(
        JSON.stringify({
          format: 'massimo-clipboard',
          version: 1,
          payload: {
            kind: 'route-bullet',
            data: { ...validBulletPayload.data, size: 'big' },
          },
        }),
      ),
    ).toBeNull();
  });
});
