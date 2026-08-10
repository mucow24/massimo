import { describe, it, expect } from 'vitest';
import type { Line, LineId } from './types';
import {
  SERVICE_CODE_MAX,
  lineDisplayName,
  nameForIndex,
  pickNextLineName,
  serviceCodeCommit,
  serviceCodeDraft,
} from './lineNaming';

// Build a lines record from a list of service codes. Only `.service` is read
// by the naming logic, so the rest of the Line shape is irrelevant here.
const linesWithServices = (services: string[]): Record<LineId, Line> =>
  Object.fromEntries(services.map((service, i) => [`L${i}` as LineId, { service } as Line]));

describe('nameForIndex', () => {
  it('maps the 36 single-character names: A–Z then 0–9', () => {
    expect(nameForIndex(0)).toBe('A');
    expect(nameForIndex(25)).toBe('Z');
    expect(nameForIndex(26)).toBe('0');
    expect(nameForIndex(35)).toBe('9');
  });

  it('rolls over to two-character names at index 36', () => {
    expect(nameForIndex(36)).toBe('AA');
    expect(nameForIndex(37)).toBe('AB');
    // last name with first char 'A': A0..A9 occupy 36+26 .. 36+35
    expect(nameForIndex(36 + 35)).toBe('A9');
    // next index advances the first character to 'B'
    expect(nameForIndex(36 + 36)).toBe('BA');
  });

  it('reaches the final two-character name Z9 at the end of the space', () => {
    // last valid index is 26*36 + 36 - 1 = 971
    expect(nameForIndex(971)).toBe('Z9');
  });

  it('returns "?" once a third character would be required', () => {
    expect(nameForIndex(972)).toBe('?');
    expect(nameForIndex(5000)).toBe('?');
  });
});

describe('pickNextLineName', () => {
  it('returns A for an empty map', () => {
    expect(pickNextLineName({})).toBe('A');
  });

  it('skips names already taken by an existing line', () => {
    expect(pickNextLineName(linesWithServices(['A', 'B']))).toBe('C');
  });

  it('skips gaps anywhere, not just a prefix', () => {
    // A and C are taken; B is the first free slot.
    expect(pickNextLineName(linesWithServices(['A', 'C']))).toBe('B');
  });

  it('rolls into two-character names once all 36 single names are taken', () => {
    const allSingles = Array.from({ length: 36 }, (_, i) => nameForIndex(i));
    expect(pickNextLineName(linesWithServices(allSingles))).toBe('AA');
  });
});

describe('serviceCodeDraft', () => {
  it('upper-cases as you type, the way the field always has', () => {
    expect(serviceCodeDraft('bd')).toBe('BD');
  });

  it('collapses a glyph shortcut the moment it closes', () => {
    expect(serviceCodeDraft('<air>')).toBe('✈');
    expect(serviceCodeDraft('<xfer>')).toBe('↔');
    expect(serviceCodeDraft('a<air>')).toBe('A✈');
  });

  it('leaves a shortcut still being typed alone — including its case', () => {
    // Upper-casing the fragment would stop the (lowercase) tag name from ever
    // matching, so `<air` could never become `<air>`.
    for (const partial of ['<', '<a', '<ai', '<air']) {
      expect(serviceCodeDraft(partial)).toBe(partial);
    }
    expect(serviceCodeDraft('a<ai')).toBe('A<ai');
  });

  it('exempts a pending shortcut from the length cap', () => {
    // `<air` is already 4 characters on the way to a code of 1.
    expect(SERVICE_CODE_MAX).toBe(3);
    expect(serviceCodeDraft('<air')).toBe('<air');
    expect(serviceCodeDraft('ab<a_ne')).toBe('AB<a_ne');
  });

  it('only exempts a fragment that is really a shortcut being typed', () => {
    // `<b`, `<q`, `<x1` are ordinary text that happens to hold a bracket — they
    // upper-case and count like anything else. Exempting everything after a `<`
    // let arbitrary mixed-case text past both rules and onto the document.
    expect(serviceCodeDraft('a<bbbbb')).toBeNull();
    expect(serviceCodeDraft('a<b')).toBe('A<B');
    expect(serviceCodeDraft('<x1>')).toBeNull();
    // `<x` IS a prefix of `<xfer>`, so it stays pending and keeps its case.
    expect(serviceCodeDraft('a<x')).toBe('A<x');
  });

  it('counts a pending shortcut as the one character it becomes', () => {
    // 'ABC' already fills the cap, so no shortcut can follow it — refused as it
    // is typed rather than at the `>`, where it would be a dead end.
    expect(serviceCodeDraft('ABC<x')).toBeNull();
    expect(serviceCodeDraft('ab<a_ne')).toBe('AB<a_ne');
  });

  it('refuses a keystroke that would exceed the cap', () => {
    expect(serviceCodeDraft('ABCD')).toBeNull();
    // Measured on the EXPANDED value: the arrow is one character, so this fits…
    expect(serviceCodeDraft('ab<a_ne>')).toBe('AB↗');
    // …and this does not.
    expect(serviceCodeDraft('abc<a_ne>')).toBeNull();
  });

  it('keeps an unknown or upper-case tag literal, like the label grammar does', () => {
    expect(serviceCodeDraft('<q>')).toBe('<Q>');
    expect(serviceCodeDraft('<AIR>')).toBeNull(); // literal, and 5 > the cap
  });

  it('allows an empty field (the deliberate clear)', () => {
    expect(serviceCodeDraft('')).toBe('');
  });
});

describe('serviceCodeCommit', () => {
  it('takes a finished draft verbatim', () => {
    expect(serviceCodeCommit('A✈')).toBe('A✈');
    expect(serviceCodeCommit('BD')).toBe('BD');
    // A closed unknown tag is ordinary text, not an unfinished shortcut.
    expect(serviceCodeCommit('<Q>')).toBe('<Q>');
    // The deliberate clear.
    expect(serviceCodeCommit('')).toBe('');
  });

  it('abandons an edit left mid-shortcut', () => {
    // `<a_ne` is five characters and not a legal bullet CODE, so committing it
    // would both break the cap and strand every bullet on the old code. An
    // unfinished shortcut is an unfinished edit: it writes nothing.
    for (const partial of ['<', '<a', '<air', '<a_ne', 'A<x']) {
      expect(serviceCodeCommit(partial)).toBeNull();
    }
  });
});

describe('lineDisplayName', () => {
  it('uses the line name when it has one', () => {
    expect(lineDisplayName({ name: 'Broadway Express', service: 'N' } as Line)).toBe(
      'Broadway Express',
    );
  });

  it('falls back to "<service> line" for an unnamed line', () => {
    expect(lineDisplayName({ name: '', service: 'N' } as Line)).toBe('N line');
  });

  it('names a missing line "Unknown line" (a stale stop can outlive its line)', () => {
    expect(lineDisplayName(undefined)).toBe('Unknown line');
    expect(lineDisplayName(null)).toBe('Unknown line');
  });
});
