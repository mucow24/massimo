import type { StationId } from './types';

// Canonical key for an unordered station-pair: sorted alphabetically and
// joined with a pipe. Used as a stable bucket key wherever data is anchored
// to a station-pair *adjacency* (e.g. line tags, segment style overrides).
//
// `pairKeyOf(a, b) === pairKeyOf(b, a)` always.
export function pairKeyOf(a: StationId, b: StationId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
