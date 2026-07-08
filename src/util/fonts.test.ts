import { describe, it, expect } from 'vitest';
import {
  bolderWeight,
  stepWeight,
  parseWeightToken,
  parseSizeToken,
  normalizeWeight,
} from './fonts';

describe('bolderWeight', () => {
  it('steps two weights up the shipped ladder (which has no 600)', () => {
    expect(bolderWeight(100)).toBe(300);
    expect(bolderWeight(200)).toBe(400);
    expect(bolderWeight(300)).toBe(500);
    expect(bolderWeight(400)).toBe(700);
    expect(bolderWeight(500)).toBe(800);
    expect(bolderWeight(700)).toBe(900);
  });

  it('clamps at the heaviest shipped weight', () => {
    expect(bolderWeight(800)).toBe(900);
    expect(bolderWeight(900)).toBe(900);
  });
});

describe('stepWeight', () => {
  it('returns the weight unchanged at zero steps', () => {
    expect(stepWeight(400, 0)).toBe(400);
    expect(stepWeight(300, 0)).toBe(300);
  });

  it('steps up and down the shipped ladder (skipping the absent 600)', () => {
    expect(stepWeight(400, 2)).toBe(700);
    expect(stepWeight(400, -1)).toBe(300);
    expect(stepWeight(500, 1)).toBe(700);
    expect(stepWeight(700, -1)).toBe(500);
  });

  it('clamps at both ends of the ladder', () => {
    expect(stepWeight(900, 3)).toBe(900);
    expect(stepWeight(100, -3)).toBe(100);
  });

  it('normalizes an off-ladder weight before stepping', () => {
    // 600 has no face → nearest shipped is 500, then +1 → 700.
    expect(stepWeight(600, 1)).toBe(700);
  });
});

describe('parseWeightToken', () => {
  it('resolves a shipped weight name (case-insensitive) to an absolute weight', () => {
    expect(parseWeightToken('Light')).toEqual({ abs: 300 });
    expect(parseWeightToken('light')).toEqual({ abs: 300 });
    expect(parseWeightToken('BLACK')).toEqual({ abs: 900 });
    expect(parseWeightToken('Roman')).toEqual({ abs: 400 });
  });

  it('reads a signed number as a relative ladder step', () => {
    expect(parseWeightToken('+2')).toEqual({ rel: 2 });
    expect(parseWeightToken('-1')).toEqual({ rel: -1 });
  });

  it('rejects unknown names and bare/unsigned numbers', () => {
    expect(parseWeightToken('Chunky')).toBeNull();
    expect(parseWeightToken('700')).toBeNull();
    expect(parseWeightToken('2')).toBeNull();
    expect(parseWeightToken('')).toBeNull();
  });
});

describe('parseSizeToken', () => {
  it('reads an unsigned positive number as an absolute size', () => {
    expect(parseSizeToken('6')).toEqual({ abs: 6 });
    expect(parseSizeToken('24')).toEqual({ abs: 24 });
    expect(parseSizeToken('6.5')).toEqual({ abs: 6.5 });
  });

  it('reads a signed number as a relative delta from the base size', () => {
    expect(parseSizeToken('+1')).toEqual({ rel: 1 });
    expect(parseSizeToken('-2')).toEqual({ rel: -2 });
    expect(parseSizeToken('+0.5')).toEqual({ rel: 0.5 });
  });

  it('rejects zero, non-numeric, unit-suffixed, and empty values', () => {
    expect(parseSizeToken('0')).toBeNull();
    expect(parseSizeToken('0.0')).toBeNull();
    expect(parseSizeToken('abc')).toBeNull();
    expect(parseSizeToken('6px')).toBeNull();
    expect(parseSizeToken('+')).toBeNull();
    expect(parseSizeToken('')).toBeNull();
  });
});

describe('normalizeWeight', () => {
  it('maps keywords', () => {
    expect(normalizeWeight('normal')).toBe(400);
    expect(normalizeWeight('bold')).toBe(700);
    expect(normalizeWeight(null)).toBe(400);
    expect(normalizeWeight('')).toBe(400);
  });

  it('passes through exact table weights', () => {
    for (const w of [100, 200, 300, 400, 500, 700, 800, 900]) {
      expect(normalizeWeight(String(w))).toBe(w);
    }
  });

  it('rounds off-table weights to the nearest available weight', () => {
    expect(normalizeWeight('650')).toBe(700); // 600 not in table
    expect(normalizeWeight('600')).toBe(500); // tie -> lower (500 vs 700 both 100 away)
    expect(normalizeWeight('1000')).toBe(900);
    expect(normalizeWeight('50')).toBe(100);
  });
});
