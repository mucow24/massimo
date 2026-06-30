import { describe, it, expect } from 'vitest';
import type { Line, LineId } from './types';
import { nameForIndex, pickNextLineName } from './lineNaming';

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
