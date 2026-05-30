import { describe, it, expect } from 'vitest';
import {
  LAYER_WEIGHT,
  segmentPriority,
  stationLayerFor,
  stripeEndpointFate,
} from './layerPriority';
import { makeLine } from '../test/fixtures';

describe('segmentPriority', () => {
  it('returns lineIdx when the line has no segmentLayers map', () => {
    const line = makeLine({ id: 'L1' });
    expect(segmentPriority(line, 's1|s2', 3)).toBe(3);
  });

  it('returns lineIdx when the pair-key has no override', () => {
    const line = makeLine({ id: 'L1', segmentLayers: { 'sX|sY': 2 } });
    expect(segmentPriority(line, 's1|s2', 3)).toBe(3);
  });

  it('subtracts layer * LAYER_WEIGHT for positive layers (frontwards)', () => {
    const line = makeLine({ id: 'L1', segmentLayers: { 's1|s2': 1 } });
    expect(segmentPriority(line, 's1|s2', 3)).toBe(3 - LAYER_WEIGHT);
  });

  it('adds |layer| * LAYER_WEIGHT for negative layers (backwards)', () => {
    const line = makeLine({ id: 'L1', segmentLayers: { 's1|s2': -2 } });
    expect(segmentPriority(line, 's1|s2', 3)).toBe(3 + 2 * LAYER_WEIGHT);
  });

  it('treats an undefined line as layer 0', () => {
    expect(segmentPriority(undefined, 's1|s2', 7)).toBe(7);
  });
});

describe('stationLayerFor', () => {
  it('returns 0 when the line has no segmentLayers map', () => {
    const line = makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] });
    expect(stationLayerFor(line, 's2')).toBe(0);
  });

  it('returns 0 when no incident segments have an override', () => {
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      segmentLayers: { 'sX|sY': 2 },
    });
    expect(stationLayerFor(line, 's2')).toBe(0);
  });

  it('takes the MAX over a mid-station with two incident segments', () => {
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      segmentLayers: { 's1|s2': -1, 's2|s3': 2 },
    });
    expect(stationLayerFor(line, 's2')).toBe(2);
  });

  it('returns a NEGATIVE max when ALL incidents are negative — seeding bug regression', () => {
    // Before the fix, the running max seeded at 0 clamped any wholly-negative
    // line back up to 0, so a layer-(-1) line's marker would float on top of
    // a layer-0 crossing — the screenshot bug from the prototype iteration.
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      segmentLayers: { 's1|s2': -1, 's2|s3': -1 },
    });
    expect(stationLayerFor(line, 's2')).toBe(-1);
  });

  it('handles a terminus with one incident segment', () => {
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2'],
      segmentLayers: { 's1|s2': -2 },
    });
    expect(stationLayerFor(line, 's1')).toBe(-2);
    expect(stationLayerFor(line, 's2')).toBe(-2);
  });

  it('prefers a non-zero adjacency over a layer-0 adjacency at the same station', () => {
    // New rule: a layer-0 segment meeting a layered (-1) segment at the same
    // station defers the dot to the layered side, so the dot stays behind
    // any layer-0 crossing band. Old MAX-from-0 would have returned 0,
    // floating the dot up onto a crossing.
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      segmentLayers: { 's1|s2': -1 }, // s2|s3 missing → layer 0
    });
    expect(stationLayerFor(line, 's2')).toBe(-1);
  });
});

describe('stripeEndpointFate', () => {
  it("returns 'win' at a terminus — the segment is the sole owner of the dot", () => {
    const line = makeLine({ id: 'L1', stations: ['s1', 's2'] });
    expect(stripeEndpointFate(line, 's1|s2', 's1')).toBe('win');
    expect(stripeEndpointFate(line, 's1|s2', 's2')).toBe('win');
  });

  it("returns 'tie' when both adjacencies share a layer (including default 0)", () => {
    const line = makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] });
    expect(stripeEndpointFate(line, 's1|s2', 's2')).toBe('tie');
    expect(stripeEndpointFate(line, 's2|s3', 's2')).toBe('tie');
    const layered = makeLine({
      id: 'L2',
      stations: ['s1', 's2', 's3'],
      segmentLayers: { 's1|s2': 2, 's2|s3': 2 },
    });
    expect(stripeEndpointFate(layered, 's1|s2', 's2')).toBe('tie');
  });

  it("returns 'win' for the non-zero segment when the other is layer 0", () => {
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      segmentLayers: { 's1|s2': -1 }, // s2|s3 is implicit 0
    });
    expect(stripeEndpointFate(line, 's1|s2', 's2')).toBe('win');
    expect(stripeEndpointFate(line, 's2|s3', 's2')).toBe('lose');
  });

  it("returns 'win' for the MAX-layer segment when both adjacencies are non-zero", () => {
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      segmentLayers: { 's1|s2': -1, 's2|s3': 2 },
    });
    expect(stripeEndpointFate(line, 's1|s2', 's2')).toBe('lose');
    expect(stripeEndpointFate(line, 's2|s3', 's2')).toBe('win');
  });
});
