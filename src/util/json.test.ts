import { describe, it, expect } from 'vitest';
import { parseJsonObject } from './json';
import { parse } from '../model/serialize';
import { parseCustomPalette } from '../model/customPalette';
import { readClipboard } from '../model/clipboard';

describe('parseJsonObject', () => {
  it('hands back the parsed object', () => {
    const r = parseJsonObject('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.obj).toEqual({ a: 1 });
  });

  it('refuses unparseable text, quoting the engine', () => {
    const r = parseJsonObject('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Not valid JSON: ./);
  });

  it('refuses a scalar or null at the top level', () => {
    for (const text of ['3', '"hi"', 'true', 'null']) {
      const r = parseJsonObject(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('File is not a JSON object');
    }
  });

  it('lets an ARRAY through — the doors’ own format gate rejects it next', () => {
    // Not an oversight: `typeof [] === 'object'`, and each door answers a
    // top-level array with its own format message. Tightening here would
    // change which message the user sees.
    const r = parseJsonObject('[1,2]');
    expect(r.ok).toBe(true);
  });
});

// The three doors that share the preamble. What is worth pinning is that they
// still ANSWER ALIKE: two of them show the user this text when a file won't
// open, and before the shared helper nothing stopped the two copies drifting.
describe('the JSON doors answer alike', () => {
  it('the map file and the palette file give the same refusals', () => {
    for (const bad of ['{not json', '3', 'null']) {
      const map = parse(bad);
      const palette = parseCustomPalette(bad);
      expect(map.ok).toBe(false);
      expect(palette.ok).toBe(false);
      if (!map.ok && !palette.ok) expect(map.error).toBe(palette.error);
    }
  });

  it('the clipboard drops the message and just declines', () => {
    // Paste-anything has to stay safe, so it answers `null` rather than
    // surfacing a parse error at the user.
    expect(readClipboard('{not json')).toBeNull();
    expect(readClipboard('3')).toBeNull();
    expect(readClipboard('null')).toBeNull();
  });
});
