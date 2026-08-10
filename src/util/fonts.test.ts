import { describe, it, expect } from 'vitest';
import {
  bolderWeight,
  stepWeight,
  parseWeightToken,
  parseSizeToken,
  normalizeWeight,
  LABEL_WEIGHT_NAMES,
} from './fonts';

describe('bolderWeight', () => {
  it('steps bold-ward up the shipped ladder (Roman -> Bold)', () => {
    // Three rungs, not two: the ladder carries a SemiBold at 600, and <b> has
    // always meant Roman -> Bold. See BOLD_WEIGHT_STEPS.
    expect(bolderWeight(200)).toBe(500);
    expect(bolderWeight(300)).toBe(600);
    expect(bolderWeight(400)).toBe(700);
    expect(bolderWeight(500)).toBe(800);
    expect(bolderWeight(600)).toBe(900);
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

  it('steps up and down the shipped ladder', () => {
    expect(stepWeight(400, 2)).toBe(600);
    expect(stepWeight(400, -1)).toBe(300);
    expect(stepWeight(500, 1)).toBe(600);
    expect(stepWeight(700, -1)).toBe(600);
  });

  it('clamps at both ends of the ladder', () => {
    expect(stepWeight(900, 3)).toBe(900);
    expect(stepWeight(200, -3)).toBe(200);
  });

  it('normalizes an off-ladder weight before stepping', () => {
    // 600 has no face → nearest shipped is 500, then +1 → 700.
    expect(stepWeight(650, 1)).toBe(700);
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

describe('parseWeightToken — retired UltraLight', () => {
  it('still answers to <w=UltraLight>, resolving to Thin', () => {
    // The rung retired with the move to Söhne. Dropping the name outright would
    // make every label written against it render the tag as literal text.
    expect(parseWeightToken('UltraLight')).toEqual({ abs: 200 });
    expect(parseWeightToken('ultralight')).toEqual({ abs: 200 });
  });

  it('still rejects names that were never rungs', () => {
    expect(parseWeightToken('Ultralightish')).toBeNull();
    expect(parseWeightToken('Fett')).toBeNull(); // the UI speaks English
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
    for (const { value } of LABEL_WEIGHT_NAMES) {
      expect(normalizeWeight(String(value))).toBe(value);
    }
  });

  it('rounds off-table weights to the nearest available weight', () => {
    expect(normalizeWeight('650')).toBe(600); // tie -> lower (600 vs 700 both 50 away)
    expect(normalizeWeight('600')).toBe(600); // on the ladder since Söhne
    expect(normalizeWeight('1000')).toBe(900);
    expect(normalizeWeight('50')).toBe(200); // below the ladder -> Thin
  });
});

// The ±1 case at EVERY rung, plus both clamps — the spot checks above cover a
// handful by hand. Driven off LABEL_WEIGHT_NAMES because that list is what the
// dropdowns and the `<w=Name>` tag offer: a weight the user can pick that the
// stepper cannot step from is the failure this rules out.
describe('stepWeight walks the whole named ladder', () => {
  it('steps from each rung to its neighbour, and clamps at both ends', () => {
    const ladder = LABEL_WEIGHT_NAMES.map((w) => w.value);
    for (let i = 0; i < ladder.length; i++) {
      expect(stepWeight(ladder[i], 1), `${ladder[i]} +1`).toBe(
        ladder[Math.min(i + 1, ladder.length - 1)],
      );
      expect(stepWeight(ladder[i], -1), `${ladder[i]} -1`).toBe(ladder[Math.max(i - 1, 0)]);
    }
  });
});
