import { beforeEach, describe, expect, it } from 'vitest';
import { snapPlacement } from './usePlacementDispatch';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES } from '../../geometry/snap';
import { makeLineCircle } from '../../test/fixtures';

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    lineCircles: { c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70 }) },
  });
});

describe('snapPlacement — line-circle rim capture', () => {
  it('projects a placing-station drop within tolerance onto the rim', () => {
    const r = snapPlacement(
      { kind: 'placing-station' },
      { x: 175, y: 100 }, // 5 world units outside the rim
      false,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    expect(r.x).toBeCloseTo(170, 9);
    expect(r.y).toBeCloseTo(100, 9);
  });

  it('leaves a drop outside tolerance to the normal engine', () => {
    const r = snapPlacement(
      { kind: 'placing-station' },
      { x: 200, y: 100 }, // 30 outside — well past capture
      false,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    expect(Math.hypot(r.x - 100, r.y - 100)).toBeGreaterThan(70 + 10);
  });

  it('Shift bypasses the rim capture like every other snap', () => {
    const r = snapPlacement(
      { kind: 'placing-station' },
      { x: 175, y: 100 },
      true,
      DEFAULT_SNAP_MODES,
      25,
      1,
    );
    expect(r.x).toBe(175);
    expect(r.y).toBe(100);
  });
});
