import { describe, it, expect } from 'vitest';
import { polygonPathData } from './polygon';
import type { Vec2 } from './vec';

const square = (half: number): Vec2[] => [
  { x: -half, y: -half },
  { x: half, y: -half },
  { x: half, y: half },
  { x: -half, y: half },
];

const count = (s: string, ch: string) => s.split(ch).length - 1;

describe('polygonPathData', () => {
  it('renders straight edges (no Q) when radius is 0', () => {
    const d = polygonPathData(square(30), 0);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    expect(count(d, 'Q')).toBe(0);
    // A 4-vertex polygon draws 3 explicit line segments after the initial move.
    expect(count(d, 'L')).toBe(3);
  });

  it('treats a negative radius as straight (no Q)', () => {
    expect(count(polygonPathData(square(30), -5), 'Q')).toBe(0);
  });

  it('rounds every corner with a quadratic when radius > 0', () => {
    const verts = square(30);
    const d = polygonPathData(verts, 10);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    // One quadratic curve per vertex.
    expect(count(d, 'Q')).toBe(verts.length);
  });

  it('clamps an oversized radius per corner without producing NaN', () => {
    const verts = square(30); // 60×60 — radius far exceeds half-edge (30)
    const d = polygonPathData(verts, 1000);
    expect(d).not.toContain('NaN');
    expect(count(d, 'Q')).toBe(verts.length);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });
});

describe('polygonPathData (open, closed = false)', () => {
  it('renders the vertex chain with no closing Z and n-1 line segments', () => {
    const d = polygonPathData(square(30), 0, false);
    expect(d.startsWith('M')).toBe(true);
    expect(d).not.toContain('Z');
    expect(count(d, 'L')).toBe(3);
  });

  it('rounds only the interior vertices when radius > 0 — endpoints stay exact', () => {
    const verts = square(30);
    const d = polygonPathData(verts, 10, false);
    expect(d).not.toContain('Z');
    // 4 vertices → 2 interior corners get a quadratic; the two ends don't.
    expect(count(d, 'Q')).toBe(verts.length - 2);
    // The chain starts ON vertex 0 and ends ON the last vertex, untrimmed.
    expect(d.startsWith('M -30.000 -30.000')).toBe(true);
    expect(d.endsWith('L -30.000 30.000')).toBe(true);
  });

  it('clamps an oversized radius on the open chain without producing NaN', () => {
    const d = polygonPathData(square(30), 1000, false);
    expect(d).not.toContain('NaN');
    expect(count(d, 'Q')).toBe(2);
    expect(d).not.toContain('Z');
  });
});
