import { describe, expect, it } from 'vitest';
import { makeDoc, makeLineCircle, makeStation, makeStop } from '../test/fixtures';
import { parse, sanitizeLineCircles, serialize } from './serialize';
import { LINE_CIRCLE_RADIUS_MIN } from './lineCircle';
import type { MapDoc } from './types';

function roundTrip(doc: MapDoc): MapDoc {
  const parsed = parse(serialize(doc));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.doc;
}

describe('line circles on the load path', () => {
  it('round-trips circles, bindings and via flags', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 170,
          y: 100,
          circleId: 'c1',
          stops: [makeStop('l1', { viaCircle: true })],
        }),
      ],
      lineCircles: [makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70, locked: true })],
    });
    const out = roundTrip(doc);
    expect(out.lineCircles).toEqual(doc.lineCircles);
    expect(out.stations.s1.circleId).toBe('c1');
    expect(out.stations.s1.stops[0].viaCircle).toBe(true);
  });

  it('backfills lineCircles to {} for saves that predate the field', () => {
    const doc = makeDoc({});
    const file = JSON.parse(serialize(doc));
    delete file.doc.lineCircles;
    const parsed = parse(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.lineCircles).toEqual({});
  });

  it('strips a dangling circleId and the orphaned via flags', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 170,
          y: 100,
          circleId: 'gone',
          stops: [makeStop('l1', { viaCircle: true })],
        }),
      ],
    });
    const out = roundTrip(doc);
    expect('circleId' in out.stations.s1).toBe(false);
    expect('viaCircle' in out.stations.s1.stops[0]).toBe(false);
  });

  it('strips viaCircle from stops of unbound stations', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', stops: [makeStop('l1', { viaCircle: true })] })],
      lineCircles: [makeLineCircle({ id: 'c1' })],
    });
    const out = roundTrip(doc);
    expect('viaCircle' in out.stations.s1.stops[0]).toBe(false);
  });

  it('drops malformed circles and clamps a sub-minimum radius', () => {
    const { lineCircles, changed } = sanitizeLineCircles(
      {
        bad: { id: 'bad', x: NaN, y: 0, radius: 70 },
        tiny: { id: 'tiny', x: 0, y: 0, radius: 1 },
      },
      {},
    );
    expect(changed).toBe(true);
    expect(lineCircles.bad).toBeUndefined();
    expect(lineCircles.tiny.radius).toBe(LINE_CIRCLE_RADIUS_MIN);
  });

  it('reprojects a bound station that drifted off its circle', () => {
    const drifted = sanitizeLineCircles(
      { c1: { id: 'c1', x: 100, y: 100, radius: 70 } },
      { s1: makeStation({ id: 's1', x: 250, y: 100, circleId: 'c1' }) },
    );
    expect(drifted.changed).toBe(true);
    expect(drifted.stations.s1.x).toBeCloseTo(170, 9);
    expect(drifted.stations.s1.y).toBeCloseTo(100, 9);
  });

  it('is an identity (same references) on a well-formed doc', () => {
    const stations = { s1: makeStation({ id: 's1', x: 170, y: 100, circleId: 'c1' }) };
    const lineCircles = { c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70 }) };
    const out = sanitizeLineCircles(lineCircles, stations);
    expect(out.changed).toBe(false);
    expect(out.lineCircles).toBe(lineCircles);
    expect(out.stations).toBe(stations);
  });
});
