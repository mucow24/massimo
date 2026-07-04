import { describe, it, expect } from 'vitest';
import {
  emptyStyleState,
  hasInlineToken,
  migrateLegacyInlineTokens,
  parseFormattedLine,
  parseLabelLine,
  type SegmentStyle,
} from './labelTokens';

const bullet = (code: string, shape = 'circle', filled = true) => ({
  kind: 'bullet',
  code,
  shape,
  filled,
});

// Style helper: full SegmentStyle with the named flags on.
const style = (...on: (keyof SegmentStyle)[]): SegmentStyle => ({
  bold: on.includes('bold'),
  italic: on.includes('italic'),
  underline: on.includes('underline'),
  strike: on.includes('strike'),
});

describe('parseLabelLine (bullets + escapes, no tags)', () => {
  it('returns a single text segment for plain text', () => {
    expect(parseLabelLine('Hello')).toEqual([{ kind: 'text', value: 'Hello' }]);
  });

  it('treats |CODE| as a filled circle bullet token', () => {
    expect(parseLabelLine('|A1|')).toEqual([bullet('A1')]);
  });

  it('treats [CODE] as a filled square bullet token', () => {
    expect(parseLabelLine('[A1]')).toEqual([bullet('A1', 'square')]);
  });

  it('treats {CODE} as a filled diamond bullet token', () => {
    expect(parseLabelLine('{A1}')).toEqual([bullet('A1', 'diamond')]);
  });

  it('treats doubled delimiters as unfilled bullets', () => {
    expect(parseLabelLine('||A1||')).toEqual([bullet('A1', 'circle', false)]);
    expect(parseLabelLine('[[A1]]')).toEqual([bullet('A1', 'square', false)]);
    expect(parseLabelLine('{{A1}}')).toEqual([bullet('A1', 'diamond', false)]);
  });

  it('no longer treats <CODE> or (CODE) as bullet tokens', () => {
    expect(parseLabelLine('<A1>')).toEqual([{ kind: 'text', value: '<A1>' }]);
    expect(parseLabelLine('<<A1>>')).toEqual([{ kind: 'text', value: '<<A1>>' }]);
    expect(parseLabelLine('(A1)')).toEqual([{ kind: 'text', value: '(A1)' }]);
  });

  it('splits text + bullet + text', () => {
    expect(parseLabelLine('Take |A1| uptown')).toEqual([
      { kind: 'text', value: 'Take ' },
      bullet('A1'),
      { kind: 'text', value: ' uptown' },
    ]);
  });

  it('handles back-to-back bullets of mixed shapes', () => {
    expect(parseLabelLine('|A1|[B2]{{C3}}')).toEqual([
      bullet('A1'),
      bullet('B2', 'square'),
      bullet('C3', 'diamond', false),
    ]);
  });

  it('handles back-to-back circle bullets', () => {
    expect(parseLabelLine('|C||S||T||X|')).toEqual([
      bullet('C'),
      bullet('S'),
      bullet('T'),
      bullet('X'),
    ]);
  });

  it('leaves an unclosed delimiter as text', () => {
    expect(parseLabelLine('|A1 nope')).toEqual([{ kind: 'text', value: '|A1 nope' }]);
    expect(parseLabelLine('[A1 nope')).toEqual([{ kind: 'text', value: '[A1 nope' }]);
    expect(parseLabelLine('{A1 nope')).toEqual([{ kind: 'text', value: '{A1 nope' }]);
  });

  it('leaves a stray closing bracket as text', () => {
    expect(parseLabelLine('A1] nope')).toEqual([{ kind: 'text', value: 'A1] nope' }]);
    expect(parseLabelLine('A1} nope')).toEqual([{ kind: 'text', value: 'A1} nope' }]);
  });

  it('treats empty delimiters as text', () => {
    expect(parseLabelLine('hi || there')).toEqual([{ kind: 'text', value: 'hi || there' }]);
    expect(parseLabelLine('hi [] there')).toEqual([{ kind: 'text', value: 'hi [] there' }]);
    expect(parseLabelLine('hi {} there')).toEqual([{ kind: 'text', value: 'hi {} there' }]);
  });

  it('parses an odd doubled opener as a literal plus a filled bullet', () => {
    expect(parseLabelLine('||A1|')).toEqual([{ kind: 'text', value: '|' }, bullet('A1')]);
    expect(parseLabelLine('[[A1]')).toEqual([{ kind: 'text', value: '[' }, bullet('A1', 'square')]);
  });

  it('treats mismatched delimiters as text', () => {
    expect(parseLabelLine('|A1] nope')).toEqual([{ kind: 'text', value: '|A1] nope' }]);
  });

  it('does not allow delimiter characters inside a code', () => {
    expect(parseLabelLine('|a[b|')).toEqual([{ kind: 'text', value: '|a[b|' }]);
    expect(parseLabelLine('{a|b}')).toEqual([{ kind: 'text', value: '{a|b}' }]);
    expect(parseLabelLine('|a<b|')).toEqual([{ kind: 'text', value: '|a<b|' }]);
  });

  it('allows parens inside a code (they are no longer delimiters)', () => {
    expect(parseLabelLine('|A(1)|')).toEqual([bullet('A(1)')]);
  });

  it('returns an empty array for an empty line', () => {
    expect(parseLabelLine('')).toEqual([]);
  });

  it('preserves spaces and unicode inside text segments', () => {
    expect(parseLabelLine('  café  ')).toEqual([{ kind: 'text', value: '  café  ' }]);
  });

  it('preserves service codes with spaces or punctuation inside delimiters', () => {
    expect(parseLabelLine('|X-Y|')).toEqual([bullet('X-Y')]);
    expect(parseLabelLine('[X-Y]')).toEqual([bullet('X-Y', 'square')]);
  });

  describe('escaping', () => {
    it('renders an escaped token as its literal text, dropping the backslash', () => {
      expect(parseLabelLine('\\|a|')).toEqual([{ kind: 'text', value: '|a|' }]);
      expect(parseLabelLine('\\[a]')).toEqual([{ kind: 'text', value: '[a]' }]);
      expect(parseLabelLine('\\{a}')).toEqual([{ kind: 'text', value: '{a}' }]);
    });

    it('escapes a doubled token as a whole', () => {
      expect(parseLabelLine('\\||a||')).toEqual([{ kind: 'text', value: '||a||' }]);
    });

    it('merges escaped literals with surrounding text into one segment', () => {
      expect(parseLabelLine('go \\|west| now')).toEqual([{ kind: 'text', value: 'go |west| now' }]);
    });

    it('leaves a backslash not preceding a token as a literal backslash', () => {
      expect(parseLabelLine('a\\b')).toEqual([{ kind: 'text', value: 'a\\b' }]);
      expect(parseLabelLine('end\\')).toEqual([{ kind: 'text', value: 'end\\' }]);
    });

    it('escape applies only to the immediately following token', () => {
      expect(parseLabelLine('\\|a||b|')).toEqual([{ kind: 'text', value: '|a|' }, bullet('b')]);
    });
  });
});

describe('parseFormattedLine (bullets + escapes + tags)', () => {
  const parse = (line: string) => parseFormattedLine(line, emptyStyleState()).segments;

  it('parses plain text and bullets like parseLabelLine', () => {
    expect(parse('Take |A1| uptown')).toEqual([
      { kind: 'text', value: 'Take ' },
      bullet('A1'),
      { kind: 'text', value: ' uptown' },
    ]);
  });

  it('applies <b>, <i>, <u>, <s> to the enclosed text', () => {
    expect(parse('a <b>b</b> c')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'text', value: 'b', style: style('bold') },
      { kind: 'text', value: ' c' },
    ]);
    expect(parse('<i>x</i>')).toEqual([{ kind: 'text', value: 'x', style: style('italic') }]);
    expect(parse('<u>x</u>')).toEqual([{ kind: 'text', value: 'x', style: style('underline') }]);
    expect(parse('<s>x</s>')).toEqual([{ kind: 'text', value: 'x', style: style('strike') }]);
  });

  it('combines nested styles', () => {
    expect(parse('<b><i>x</i>y</b>')).toEqual([
      { kind: 'text', value: 'x', style: style('bold', 'italic') },
      { kind: 'text', value: 'y', style: style('bold') },
    ]);
  });

  it('tracks nested repeats of the same tag', () => {
    expect(parse('<b><b>x</b>y</b>z')).toEqual([
      { kind: 'text', value: 'x', style: style('bold') },
      { kind: 'text', value: 'y', style: style('bold') },
      { kind: 'text', value: 'z' },
    ]);
  });

  it('ignores a closing tag with no matching opener', () => {
    expect(parse('a</b>b')).toEqual([{ kind: 'text', value: 'ab' }]);
  });

  it('leaves unknown or malformed tags as literal text', () => {
    expect(parse('<q>x</q>')).toEqual([{ kind: 'text', value: '<q>x</q>' }]);
    expect(parse('a < b')).toEqual([{ kind: 'text', value: 'a < b' }]);
    expect(parse('<3')).toEqual([{ kind: 'text', value: '<3' }]);
    expect(parse('<B>x</B>')).toEqual([{ kind: 'text', value: '<B>x</B>' }]);
  });

  it('parses <color=...> in named, #hex, and 0xhex forms', () => {
    expect(parse('<color=red>x</color>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), color: 'red' } },
    ]);
    expect(parse('<color=#AB12CD>x</color>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), color: '#AB12CD' } },
    ]);
    expect(parse('<color=0xFF0000>x</color>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), color: '#FF0000' } },
    ]);
  });

  it('restores the outer color when a nested color closes', () => {
    expect(parse('<color=red>a<color=blue>b</color>c</color>d')).toEqual([
      { kind: 'text', value: 'a', style: { ...style(), color: 'red' } },
      { kind: 'text', value: 'b', style: { ...style(), color: 'blue' } },
      { kind: 'text', value: 'c', style: { ...style(), color: 'red' } },
      { kind: 'text', value: 'd' },
    ]);
  });

  it('leaves a color tag with an invalid value as literal text', () => {
    expect(parse('<color=not a color>x')).toEqual([
      { kind: 'text', value: '<color=not a color>x' },
    ]);
    expect(parse('<color=#12>x')).toEqual([{ kind: 'text', value: '<color=#12>x' }]);
  });

  it('substitutes <air> and <xfer> inline, merged into the text run', () => {
    expect(parse('Fly <air> now')).toEqual([{ kind: 'text', value: 'Fly ✈ now' }]);
    expect(parse('<xfer>')).toEqual([{ kind: 'text', value: '↔' }]);
    expect(parse('<b><air></b>')).toEqual([{ kind: 'text', value: '✈', style: style('bold') }]);
  });

  it('escapes tags with a backslash', () => {
    expect(parse('\\<b>x')).toEqual([{ kind: 'text', value: '<b>x' }]);
    expect(parse('\\<air>')).toEqual([{ kind: 'text', value: '<air>' }]);
  });

  it('styles do not attach to bullets', () => {
    expect(parse('<b>|A1|</b>')).toEqual([bullet('A1')]);
    expect(parse('x<i>y|A|z</i>')).toEqual([
      { kind: 'text', value: 'x' },
      { kind: 'text', value: 'y', style: style('italic') },
      bullet('A'),
      { kind: 'text', value: 'z', style: style('italic') },
    ]);
  });

  describe('style state threading across lines', () => {
    it('returns the open style state for an unclosed tag', () => {
      const r = parseFormattedLine('a <b>x', emptyStyleState());
      expect(r.segments).toEqual([
        { kind: 'text', value: 'a ' },
        { kind: 'text', value: 'x', style: style('bold') },
      ]);
      const next = parseFormattedLine('y</b> z', r.state);
      expect(next.segments).toEqual([
        { kind: 'text', value: 'y', style: style('bold') },
        { kind: 'text', value: ' z' },
      ]);
    });

    it('carries color state across lines', () => {
      const r = parseFormattedLine('<color=red>a', emptyStyleState());
      const next = parseFormattedLine('b</color>c', r.state);
      expect(next.segments).toEqual([
        { kind: 'text', value: 'b', style: { ...style(), color: 'red' } },
        { kind: 'text', value: 'c' },
      ]);
    });

    it('does not mutate the incoming state', () => {
      const entry = emptyStyleState();
      parseFormattedLine('<b><color=red>x', entry);
      expect(entry).toEqual(emptyStyleState());
    });
  });
});

describe('parseFormattedLine — <w=...> weight tags', () => {
  const parse = (line: string) => parseFormattedLine(line, emptyStyleState()).segments;

  it('applies an absolute <w=Name> as a weight override on the run', () => {
    expect(parse('<w=Light>x</w>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), weight: 300 } },
    ]);
    expect(parse('<w=Black>x</w>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), weight: 900 } },
    ]);
  });

  it('matches weight names case-insensitively', () => {
    expect(parse('<w=light>x</w>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), weight: 300 } },
    ]);
    expect(parse('<w=MEDIUM>x</w>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), weight: 500 } },
    ]);
  });

  it('applies a relative <w=+N>/<w=-N> as a step from the base weight', () => {
    expect(parse('<w=+2>x</w>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), weightStep: 2 } },
    ]);
    expect(parse('<w=-1>x</w>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style(), weightStep: -1 } },
    ]);
  });

  it('restores the outer weight when a nested <w> closes (innermost wins)', () => {
    expect(parse('<w=Light>a<w=+2>b</w>c</w>d')).toEqual([
      { kind: 'text', value: 'a', style: { ...style(), weight: 300 } },
      { kind: 'text', value: 'b', style: { ...style(), weightStep: 2 } },
      { kind: 'text', value: 'c', style: { ...style(), weight: 300 } },
      { kind: 'text', value: 'd' },
    ]);
  });

  it('combines a weight tag with <b>/<i> on the same run', () => {
    expect(parse('<b><w=+1>x</w></b>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style('bold'), weightStep: 1 } },
    ]);
    expect(parse('<i><w=Medium>x</w></i>')).toEqual([
      { kind: 'text', value: 'x', style: { ...style('italic'), weight: 500 } },
    ]);
  });

  it('leaves an unknown weight name or a bare/unsigned number as literal text', () => {
    expect(parse('<w=Chunky>x')).toEqual([{ kind: 'text', value: '<w=Chunky>x' }]);
    expect(parse('<w=700>x')).toEqual([{ kind: 'text', value: '<w=700>x' }]);
    expect(parse('<w=2>x')).toEqual([{ kind: 'text', value: '<w=2>x' }]);
    expect(parse('<w=>x')).toEqual([{ kind: 'text', value: '<w=>x' }]);
  });

  it('ignores a </w> with no matching opener', () => {
    expect(parse('a</w>b')).toEqual([{ kind: 'text', value: 'ab' }]);
  });

  it('does not attach a weight to a bullet', () => {
    expect(parse('<w=Light>|A1|</w>')).toEqual([bullet('A1')]);
  });

  it('escapes a weight tag with a backslash', () => {
    expect(parse('\\<w=Light>x')).toEqual([{ kind: 'text', value: '<w=Light>x' }]);
  });

  it('carries an open weight across lines and closes on the next', () => {
    const r = parseFormattedLine('<w=Light>a', emptyStyleState());
    expect(r.segments).toEqual([{ kind: 'text', value: 'a', style: { ...style(), weight: 300 } }]);
    const next = parseFormattedLine('b</w>c', r.state);
    expect(next.segments).toEqual([
      { kind: 'text', value: 'b', style: { ...style(), weight: 300 } },
      { kind: 'text', value: 'c' },
    ]);
  });

  it('does not mutate the incoming state', () => {
    const entry = emptyStyleState();
    parseFormattedLine('<w=Light><w=+1>x', entry);
    expect(entry).toEqual(emptyStyleState());
  });
});

describe('hasInlineToken', () => {
  it('detects each bullet form anywhere in a multi-line text', () => {
    expect(hasInlineToken('take the |A|')).toBe(true);
    expect(hasInlineToken('take the [A]')).toBe(true);
    expect(hasInlineToken('take the {A}')).toBe(true);
    expect(hasInlineToken('first\nthen ||A|| home')).toBe(true);
  });

  it('detects escaped tokens (they need the segment path to drop the backslash)', () => {
    expect(hasInlineToken('go \\|west| now')).toBe(true);
  });

  it('is false for plain text, angle/paren brackets, and non-token pipes', () => {
    expect(hasInlineToken('no bullets here')).toBe(false);
    expect(hasInlineToken('take the <A>')).toBe(false);
    expect(hasInlineToken('take the (A)')).toBe(false);
    expect(hasInlineToken('empty || [] {}')).toBe(false);
    expect(hasInlineToken('unclosed |A and [B')).toBe(false);
    expect(hasInlineToken('a code cannot span |a\nb| lines')).toBe(false);
  });
});

describe('migrateLegacyInlineTokens', () => {
  it('rewrites legacy angle bullet tokens to pipe tokens', () => {
    expect(migrateLegacyInlineTokens('<A>')).toBe('|A|');
    expect(migrateLegacyInlineTokens('<<A>>')).toBe('||A||');
    expect(migrateLegacyInlineTokens('Take <A1> or [B]')).toBe('Take |A1| or [B]');
  });

  it('escapes pre-existing literal pipe text that would now parse as a bullet', () => {
    expect(migrateLegacyInlineTokens('a |b| c')).toBe('a \\|b| c');
    expect(migrateLegacyInlineTokens('||x||')).toBe('\\||x||');
    expect(migrateLegacyInlineTokens('|a b|')).toBe('\\|a b|');
  });

  it('handles both rewrites in one string', () => {
    expect(migrateLegacyInlineTokens('a |b| <c>')).toBe('a \\|b| |c|');
  });

  it('escapes a pre-existing backslash-pipe so it keeps rendering with the backslash', () => {
    // Old docs rendered '\|a|' literally; the new escape syntax would swallow
    // the backslash, so the migration doubles it: '\\|a|' renders '\' + '|a|'.
    expect(migrateLegacyInlineTokens('\\|a|')).toBe('\\\\|a|');
  });

  it('leaves non-token text, square/brace tokens, parens, and empty pipes unchanged', () => {
    expect(migrateLegacyInlineTokens('plain text')).toBe('plain text');
    expect(migrateLegacyInlineTokens('[A] {B}')).toBe('[A] {B}');
    expect(migrateLegacyInlineTokens('Museum (closed)')).toBe('Museum (closed)');
    expect(migrateLegacyInlineTokens('empty || here')).toBe('empty || here');
    expect(migrateLegacyInlineTokens('unclosed <b here')).toBe('unclosed <b here');
  });

  it('converts a legacy angle token whose code contains parens', () => {
    // Parens are ordinary code characters in the pipe grammar.
    expect(migrateLegacyInlineTokens('<A(1)>')).toBe('|A(1)|');
  });

  it('leaves a legacy angle token whose code contains a pipe as literal text', () => {
    // '|A|B|' would not re-parse as one bullet (codes exclude pipes), so the
    // token is left alone rather than half-migrated.
    expect(migrateLegacyInlineTokens('<A|B>')).toBe('<A|B>');
  });

  it('works across newlines', () => {
    expect(migrateLegacyInlineTokens('|a|\n<b>')).toBe('\\|a|\n|b|');
  });
});
