import { describe, expect, it } from 'vitest';
import { dashSpec } from './stationDash';
import type { Station, StopCell } from '../model/types';
import type { Rotation } from './orientation';

// Minimal station factory: one stop cell per line id, a label cell, rotation.
function makeStation(opts: {
  x?: number;
  y?: number;
  rotation?: Rotation;
  stops: Partial<StopCell>[];
  label?: Partial<Station['label']>;
}): Station {
  return {
    id: 's1',
    name: 'Test',
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    rotation: opts.rotation ?? 0,
    stops: opts.stops.map((s, i) => ({
      lineId: s.lineId ?? `L${i}`,
      row: s.row ?? 0,
      col: s.col ?? 0,
      orientation: s.orientation ?? 'auto-vertical',
      ...(s.dotStyle ? { dotStyle: s.dotStyle } : {}),
    })),
    label: {
      row: 0,
      col: 2,
      rotation: 0,
      offset: 0,
      align: 'auto',
      valign: 'auto-down',
      ...opts.label,
    },
  };
}

const stopOf = (st: Station, lineId = 'L0'): StopCell => st.stops.find((c) => c.lineId === lineId)!;

describe('dashSpec — side pick', () => {
  it('vertical line, label east ⇒ tick points east from the stripe edge', () => {
    const st = makeStation({ x: 100, y: 50, stops: [{}], label: { row: 0, col: 2 } });
    const spec = dashSpec(st, stopOf(st), undefined);
    // Default width 14: anchor sits half a width east of the stop center.
    expect(spec.ax).toBeCloseTo(107);
    expect(spec.ay).toBeCloseTo(50);
    expect(spec.angleDeg).toBeCloseTo(0);
    expect(spec.length).toBeCloseTo(14);
    expect(spec.width).toBeCloseTo(7);
  });

  it('vertical line, label west ⇒ tick points west', () => {
    const st = makeStation({ stops: [{}], label: { row: 0, col: -2 } });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.ax).toBeCloseTo(-7);
    expect(Math.abs(spec.angleDeg)).toBeCloseTo(180);
  });

  it('horizontal line, label north ⇒ tick points north', () => {
    const st = makeStation({
      stops: [{ orientation: 'auto-horizontal' }],
      label: { row: -1, col: 0 },
    });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.ay).toBeCloseTo(-7);
    expect(spec.angleDeg).toBeCloseTo(-90);
  });

  it('diagonal (ne-sw) line, label northwest ⇒ tick points northwest', () => {
    const st = makeStation({
      stops: [{ orientation: 'auto-ne-sw' }],
      label: { row: -1, col: -1 },
    });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.angleDeg).toBeCloseTo(-135);
  });
});

describe('dashSpec — offset-aware side tracking (Option B)', () => {
  it('a reading-direction offset that carries the label across the line flips the tick', () => {
    // Label CELL is east (col 1), but offset −30 along the E reading axis
    // drags the painted anchor 16px west of the line ⇒ tick points west.
    const st = makeStation({ stops: [{}], label: { row: 0, col: 1, offset: -30 } });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.ax).toBeCloseTo(-7);
  });

  it('offsetPerp axes follow the label rotation (reading frame), not the station frame', () => {
    // South-reading label (rotation 2): offsetPerp moves along (−sin90, cos90)
    // = west. Cell 28px east + offsetPerp 40 ⇒ anchor 12px west ⇒ tick west.
    const st = makeStation({
      stops: [{}],
      label: { row: 0, col: 2, rotation: 2, offsetPerp: 40 },
    });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.ax).toBeCloseTo(-7);
  });
});

describe('dashSpec — tie fallback (label on the travel axis)', () => {
  it('vertical line, label dead south ⇒ deterministic west tick', () => {
    const st = makeStation({ stops: [{}], label: { row: 2, col: 0 } });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.ax).toBeCloseTo(-7);
    expect(Math.abs(spec.angleDeg)).toBeCloseTo(180);
  });

  it('horizontal line, label dead east ⇒ deterministic north tick (label-above default)', () => {
    const st = makeStation({
      stops: [{ orientation: 'auto-horizontal' }],
      label: { row: 0, col: 2 },
    });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.ay).toBeCloseTo(-7);
    expect(spec.angleDeg).toBeCloseTo(-90);
  });
});

describe('dashSpec — tie fallback is evaluated in world space', () => {
  it('a 180°-flipped station keeps the on-axis tie tick on the world-west side', () => {
    // Label dead-south (on the vertical travel axis) ⇒ a tie. The fallback side
    // is chosen in WORLD space ("label above / to the west"), so flipping the
    // station 180° must NOT flip the tick to world-east: it stays world-west,
    // exactly like the rotation-0 tie above. A local-space fallback (dropping
    // the rotateBy) would flip it to +7 here while passing every rotation-0 test.
    const st = makeStation({ rotation: 4, stops: [{}], label: { row: 2, col: 0 } });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.ax).toBeCloseTo(-7);
    expect(Math.abs(spec.angleDeg)).toBeCloseTo(180);
  });
});

describe('dashSpec — station rotation', () => {
  it('rotates the whole construction with the station', () => {
    // Rotation 2 = 90° CW: the local-east tick becomes world-south.
    const st = makeStation({
      x: 10,
      y: 20,
      rotation: 2,
      stops: [{}],
      label: { row: 0, col: 2 },
    });
    const spec = dashSpec(st, stopOf(st), undefined);
    expect(spec.ax).toBeCloseTo(10);
    expect(spec.ay).toBeCloseTo(27);
    expect(spec.angleDeg).toBeCloseTo(90);
  });
});

describe('dashSpec — dimensions', () => {
  it('derives from the line width; explicit dash dims win', () => {
    const st = makeStation({ stops: [{}], label: { row: 0, col: 2 } });
    const wide = dashSpec(st, stopOf(st), { width: 20 });
    expect(wide.ax).toBeCloseTo(10); // anchored at the wider stripe's edge
    expect(wide.length).toBeCloseTo(20);
    expect(wide.width).toBeCloseTo(10);
    const custom = dashSpec(st, stopOf(st), { width: 20, dashLength: 5, dashWidth: 3 });
    expect(custom.length).toBeCloseTo(5);
    expect(custom.width).toBeCloseTo(3);
  });
});

describe('dashSpec — interlined tiling + paint order', () => {
  it('tangent same-width stops produce exactly abutting ticks, and labelDist orders them', () => {
    // Two vertical lines interlined side by side (cells 14 apart), label east.
    const st = makeStation({
      stops: [
        { lineId: 'A', col: 0 },
        { lineId: 'B', col: 1 },
      ],
      label: { row: 0, col: 3 },
    });
    const inner = dashSpec(st, stopOf(st, 'A'), undefined);
    const outer = dashSpec(st, stopOf(st, 'B'), undefined);
    // Inner tick spans [7, 21] — exactly covering the outer stripe — and the
    // outer tick takes over at its own edge, x = 21.
    expect(inner.ax).toBeCloseTo(7);
    expect(inner.ax + inner.length).toBeCloseTo(21);
    expect(outer.ax).toBeCloseTo(21);
    // The outer stop is nearer the label ⇒ smaller labelDist ⇒ paints last.
    expect(outer.labelDist).toBeLessThan(inner.labelDist);
  });
});
