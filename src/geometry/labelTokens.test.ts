import { describe, it, expect } from 'vitest';
import { parseLabelLine } from './labelTokens';

describe('parseLabelLine', () => {
  it('returns a single text segment for plain text', () => {
    expect(parseLabelLine('Hello')).toEqual([{ kind: 'text', value: 'Hello' }]);
  });

  it('treats <CODE> as a bullet token', () => {
    expect(parseLabelLine('<A1>')).toEqual([{ kind: 'bullet', code: 'A1' }]);
  });

  it('splits text + bullet + text', () => {
    expect(parseLabelLine('Take <A1> uptown')).toEqual([
      { kind: 'text', value: 'Take ' },
      { kind: 'bullet', code: 'A1' },
      { kind: 'text', value: ' uptown' },
    ]);
  });

  it('handles back-to-back bullets', () => {
    expect(parseLabelLine('<A1><B2>')).toEqual([
      { kind: 'bullet', code: 'A1' },
      { kind: 'bullet', code: 'B2' },
    ]);
  });

  it('leaves an unclosed angle bracket as text', () => {
    expect(parseLabelLine('<A1 nope')).toEqual([{ kind: 'text', value: '<A1 nope' }]);
  });

  it('leaves a stray closing bracket as text', () => {
    expect(parseLabelLine('A1> nope')).toEqual([{ kind: 'text', value: 'A1> nope' }]);
  });

  it('treats an empty code <> as text', () => {
    expect(parseLabelLine('hi <> there')).toEqual([{ kind: 'text', value: 'hi <> there' }]);
  });

  it('returns an empty array for an empty line', () => {
    expect(parseLabelLine('')).toEqual([]);
  });

  it('preserves spaces and unicode inside text segments', () => {
    expect(parseLabelLine('  café  ')).toEqual([{ kind: 'text', value: '  café  ' }]);
  });

  it('preserves service codes with spaces or punctuation inside angle brackets', () => {
    // Service code is whatever the user typed in `service` — strict parsing
    // would forbid invalid resolutions but never modify the token itself.
    expect(parseLabelLine('<X-Y>')).toEqual([{ kind: 'bullet', code: 'X-Y' }]);
  });
});
