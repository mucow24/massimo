import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { labelLayoutLocal, type LabelLayout } from '../geometry/labelLayout';
import { STOP_SIZE } from '../geometry/orientation';
import { stopMetricsOf } from '../model/stopMetrics';
import { serialize, parse } from '../model/serialize';
import { isLineTerminus } from '../model/lineTopology';
import {
  AXES,
  OCTANT_NAME,
  READABLE_ROTATIONS,
  wandGalleryDoc,
  type WandGalleryCase,
} from './wandGalleryDoc';

// Vitest runs with cwd at the project root; import.meta.url is unusable here
// (jsdom rewrites it to an http scheme).
const GOLDEN_PATH = resolve(process.cwd(), 'docs/wand-gallery.massimo.json');

const { doc, cases } = wandGalleryDoc();
const metrics = stopMetricsOf({
  stations: doc.stations,
  lines: doc.lines,
  transfers: doc.transfers,
});

function layoutOf(c: WandGalleryCase): LabelLayout {
  const station = doc.stations[c.stationId];
  expect(station, c.stationId).toBeDefined();
  return labelLayoutLocal(station, undefined, undefined, metrics);
}

const ALL_OCTANTS = [0, 1, 2, 3, 4, 5, 6, 7];

describe('wand gallery', () => {
  it('covers the full case product', () => {
    // Mid-line: every readable label rotation × stripe axis × octant.
    for (const r of READABLE_ROTATIONS) {
      for (const axis of AXES) {
        const octants = cases
          .filter((c) => c.family === 'mid' && c.labelRotation === r && c.axis === axis)
          .map((c) => c.octant)
          .sort();
        expect(octants, `mid r${r} ${axis}`).toEqual(ALL_OCTANTS);
      }
    }
    // Terminals: every exit ray × octant.
    for (const ray of OCTANT_NAME) {
      const octants = cases
        .filter((c) => c.family === 'terminal' && c.ray === ray)
        .map((c) => c.octant)
        .sort();
      expect(octants, `terminal ray ${ray}`).toEqual(ALL_OCTANTS);
    }
    // Crossings: 12 distinct configs; the H×V core covers all four
    // octant × side combos.
    const cross = cases.filter((c) => c.family === 'cross');
    expect(new Set(cross.map((c) => c.stationId)).size).toBe(12);
    const hxv = cross.filter((c) => c.stationId.startsWith('cross-HxV'));
    expect(new Set(hxv.map((c) => `${c.octant}:${c.expect.textAnchor}`)).size).toBe(4);
    // Corner parks: the beside stop on either side × the host stop above or
    // below, plus the transfer scene.
    const corner = cases.filter((c) => c.family === 'corner');
    expect(new Set(corner.map((c) => c.stationId)).size).toBe(6);
    expect(new Set(corner.map((c) => `${c.octant}:${c.expect.textAnchor}`))).toEqual(
      new Set(['0:start', '4:end']),
    );
    for (const family of ['multiline', 'fallback', 'phantom'] as const) {
      expect(
        cases.some((c) => c.family === family),
        family,
      ).toBe(true);
    }
    expect(cases.length).toBe(160 + 64 + 12 + 6 + 3 + 1 + 1);
  });

  it('every case claiming a terminality has it in the line topology', () => {
    for (const c of cases) {
      if (c.terminal === null) continue;
      const station = doc.stations[c.stationId];
      const hosts = station.stops.map((s) => doc.lines[s.lineId]);
      expect(hosts.length, c.stationId).toBeGreaterThan(0);
      // The station's PRIMARY line (first stop) decides mid vs. terminus; the
      // cross stations' crossing lines run through, keeping them mid-line.
      expect(isLineTerminus(hosts[0], c.stationId), c.stationId).toBe(c.terminal);
    }
  });

  it('places every case as its octant predicts', () => {
    for (const c of cases) {
      const station = doc.stations[c.stationId];
      const layout = layoutOf(c);
      expect(layout.textAnchor, c.stationId).toBe(c.expect.textAnchor);

      // Anchor side relative to the stop cell (label cell for the detached
      // fallback), measured on the READING frame's perpendicular — the axis
      // text stacks along, positive = below the reading direction:
      // above/below clears the marker half-extent; level stays within a
      // line-height of the stop's row.
      const a = (station.label.rotation * Math.PI) / 4;
      const refCell =
        c.family === 'fallback' || station.stops.length === 0 ? station.label : station.stops[0];
      const dx = layout.anchorX - refCell.col * STOP_SIZE;
      const dy = layout.anchorY - refCell.row * STOP_SIZE;
      const perp = dx * -Math.sin(a) + dy * Math.cos(a);
      if (c.expect.anchorSide === 'above') expect(perp, c.stationId).toBeLessThan(-STOP_SIZE / 2);
      else if (c.expect.anchorSide === 'below')
        expect(perp, c.stationId).toBeGreaterThan(STOP_SIZE / 2);
      else expect(Math.abs(perp), c.stationId).toBeLessThan(STOP_SIZE);
    }
  });

  it('stacks multi-line blocks away from the marker', () => {
    const byId = (id: string) => layoutOf(cases.find((c) => c.stationId === id)!);
    // Above the line: the LAST line pins to the marker, earlier lines lift up.
    expect(byId('multiN').firstLineDyPx).toBeLessThan(0);
    // Below and beside: the FIRST line pins, the block grows down.
    expect(byId('multiS').firstLineDyPx).toBe(0);
    expect(byId('multiE').firstLineDyPx).toBe(0);
    // A corner park is beside too, but its block stacks UP: the stop it
    // re-anchored away from sits below, and growing into it would only trade
    // which marker the text lands on.
    expect(byId('corner-NE-2line').firstLineDyPx).toBeLessThan(0);
  });

  it('clears a diagonal stripe further than a parallel one beside it', () => {
    const anchorReach = (id: string) => {
      const c = cases.find((k) => k.stationId === id)!;
      const station = doc.stations[c.stationId];
      const layout = layoutOf(c);
      // Signed distance of the anchor from the STOP along reading (east).
      return (layout.anchorX - station.stops[0].col * STOP_SIZE) * (c.octant === 4 ? -1 : 1);
    };
    expect(anchorReach('mid-r0NE-E')).toBeGreaterThan(anchorReach('mid-r0H-E'));
    expect(anchorReach('mid-r0NE-W')).toBeGreaterThan(anchorReach('mid-r0H-W'));
  });

  it('golden map file stays in sync with the generator', () => {
    const json = serialize(doc);
    expect(parse(json).ok).toBe(true);
    if (process.env.UPDATE_WAND_GALLERY) {
      writeFileSync(GOLDEN_PATH, json + '\n');
      return;
    }
    expect(existsSync(GOLDEN_PATH), 'run with UPDATE_WAND_GALLERY=1 to generate').toBe(true);
    expect(readFileSync(GOLDEN_PATH, 'utf8')).toBe(json + '\n');
  });
});
