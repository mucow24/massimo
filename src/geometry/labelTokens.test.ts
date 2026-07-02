import { describe, it, expect } from 'vitest';
import { hasBulletToken, parseLabelLine } from './labelTokens';

const bullet = (code: string, shape = 'circle', filled = true) => ({
  kind: 'bullet',
  code,
  shape,
  filled,
});

describe('parseLabelLine', () => {
  it('returns a single text segment for plain text', () => {
    expect(parseLabelLine('Hello')).toEqual([{ kind: 'text', value: 'Hello' }]);
  });

  it('treats <CODE> as a filled circle bullet token', () => {
    expect(parseLabelLine('<A1>')).toEqual([bullet('A1')]);
  });

  it('treats [CODE] as a filled square bullet token', () => {
    expect(parseLabelLine('[A1]')).toEqual([bullet('A1', 'square')]);
  });

  it('treats {CODE} as a filled diamond bullet token', () => {
    expect(parseLabelLine('{A1}')).toEqual([bullet('A1', 'diamond')]);
  });

  it('treats doubled delimiters as unfilled bullets', () => {
    expect(parseLabelLine('<<A1>>')).toEqual([bullet('A1', 'circle', false)]);
    expect(parseLabelLine('[[A1]]')).toEqual([bullet('A1', 'square', false)]);
    expect(parseLabelLine('{{A1}}')).toEqual([bullet('A1', 'diamond', false)]);
  });

  it('splits text + bullet + text', () => {
    expect(parseLabelLine('Take <A1> uptown')).toEqual([
      { kind: 'text', value: 'Take ' },
      bullet('A1'),
      { kind: 'text', value: ' uptown' },
    ]);
  });

  it('handles back-to-back bullets of mixed shapes', () => {
    expect(parseLabelLine('<A1>[B2]{{C3}}')).toEqual([
      bullet('A1'),
      bullet('B2', 'square'),
      bullet('C3', 'diamond', false),
    ]);
  });

  it('leaves an unclosed bracket as text', () => {
    expect(parseLabelLine('<A1 nope')).toEqual([{ kind: 'text', value: '<A1 nope' }]);
    expect(parseLabelLine('[A1 nope')).toEqual([{ kind: 'text', value: '[A1 nope' }]);
    expect(parseLabelLine('{A1 nope')).toEqual([{ kind: 'text', value: '{A1 nope' }]);
  });

  it('leaves a stray closing bracket as text', () => {
    expect(parseLabelLine('A1> nope')).toEqual([{ kind: 'text', value: 'A1> nope' }]);
    expect(parseLabelLine('A1] nope')).toEqual([{ kind: 'text', value: 'A1] nope' }]);
  });

  it('treats empty delimiters as text', () => {
    expect(parseLabelLine('hi <> there')).toEqual([{ kind: 'text', value: 'hi <> there' }]);
    expect(parseLabelLine('hi [] there')).toEqual([{ kind: 'text', value: 'hi [] there' }]);
    expect(parseLabelLine('hi {} there')).toEqual([{ kind: 'text', value: 'hi {} there' }]);
  });

  it('parses an odd doubled opener as a literal plus a filled bullet', () => {
    expect(parseLabelLine('<<A1>')).toEqual([{ kind: 'text', value: '<' }, bullet('A1')]);
    expect(parseLabelLine('[[A1]')).toEqual([{ kind: 'text', value: '[' }, bullet('A1', 'square')]);
  });

  it('treats mismatched delimiters as text', () => {
    expect(parseLabelLine('<A1] nope')).toEqual([{ kind: 'text', value: '<A1] nope' }]);
  });

  it('does not allow delimiter characters inside a code', () => {
    expect(parseLabelLine('<a[b>')).toEqual([{ kind: 'text', value: '<a[b>' }]);
    expect(parseLabelLine('{a<b}')).toEqual([{ kind: 'text', value: '{a<b}' }]);
  });

  it('returns an empty array for an empty line', () => {
    expect(parseLabelLine('')).toEqual([]);
  });

  it('preserves spaces and unicode inside text segments', () => {
    expect(parseLabelLine('  café  ')).toEqual([{ kind: 'text', value: '  café  ' }]);
  });

  it('preserves service codes with spaces or punctuation inside brackets', () => {
    // Service code is whatever the user typed in `service` — strict parsing
    // would forbid invalid resolutions but never modify the token itself.
    expect(parseLabelLine('<X-Y>')).toEqual([bullet('X-Y')]);
    expect(parseLabelLine('[X-Y]')).toEqual([bullet('X-Y', 'square')]);
  });
});

describe('hasBulletToken', () => {
  it('detects each bullet form anywhere in a multi-line text', () => {
    expect(hasBulletToken('take the <A>')).toBe(true);
    expect(hasBulletToken('take the [A]')).toBe(true);
    expect(hasBulletToken('take the {A}')).toBe(true);
    expect(hasBulletToken('first\nthen <<A>> home')).toBe(true);
  });

  it('is false for plain text and non-token brackets', () => {
    expect(hasBulletToken('no bullets here')).toBe(false);
    expect(hasBulletToken('empty <> [] {}')).toBe(false);
    expect(hasBulletToken('unclosed <A and [B')).toBe(false);
    expect(hasBulletToken('a code cannot span <a\nb> lines')).toBe(false);
  });
});
