import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import {
  makeDoc,
  makeLabel,
  makeLine,
  makeLineCircle,
  makeStation,
  makeStop,
} from '../test/fixtures';
import { STOP_SIZE, rotRad, stationFrameRad } from '../geometry/orientation';
import type { Rotation } from '../model/types';

/**
 * A ring-bound station's NAME lands on the same lattice its dots do.
 *
 * Stop cells resolve through the ring frame (`stationFrameRad`) — radial and
 * continuous — while `rotation` is the tangent octant, up to 22.5° away. The
 * label cell is a cell of that same lattice, so painting it through `rotation`
 * swings the name off its own dot by `2·d·sin(Δ/2)` (≈ 0.39·d at the worst
 * seat, where d is the cell's distance from the station origin) AND leaves the
 * text reading up to 22.5° off the arc it labels.
 *
 * The seat below is deliberately the WORST one: θ = 22.5°, exactly between two
 * octants. `divergentSeat` asserts that, so a fixture that drifted onto an
 * octant angle (where both frames agree and everything here passes for free)
 * fails loudly instead of going quietly green.
 */

const CX = 100;
const CY = 100;
const R = 70;
// Halfway between the E and SE cardinals: the maximal octant/ring divergence.
const THETA = Math.PI / 8;
// The tangent octant at THETA, label kept upright (uprightTangentRotation).
const SEAT_ROTATION: Rotation = 1;
// The label cell, two cells radially out from the lane-0 stop.
const LABEL_COL = 2;

const ringStation = (labelRotation: Rotation = 0) =>
  makeStation({
    id: 's1',
    name: 'Southfields',
    x: CX + R * Math.cos(THETA),
    y: CY + R * Math.sin(THETA),
    rotation: SEAT_ROTATION,
    circleId: 'c1',
    stops: [makeStop('l1', { viaCircle: true })],
    // Explicit 'middle' keeps the anchor ON the label cell centre, so the
    // assertions below are about the FRAME and not about autoAlign's pin.
    label: makeLabel({ row: 0, col: LABEL_COL, rotation: labelRotation, align: 'middle' }),
  });

function seedDoc(labelRotation: Rotation = 0) {
  const st = ringStation(labelRotation);
  const doc = makeDoc({
    stations: [st],
    lines: [makeLine({ id: 'l1', stations: ['s1'] })],
    lineCircles: [makeLineCircle({ id: 'c1', x: CX, y: CY, radius: R })],
  });
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, ...doc });
  return { st, doc };
}

/** The fixture really does sit off the octants — see the file comment. */
function divergentSeat(st: ReturnType<typeof ringStation>) {
  const frame = stationFrameRad(st, { x: CX, y: CY });
  expect(Math.abs(frame - rotRad(st.rotation))).toBeGreaterThan(0.3); // ~22.5° = 0.3927
  return frame;
}

/** `translate(tx ty) rotate(deg)` — the station-local group every pass opens. */
function stationGroup(container: HTMLElement) {
  const g = Array.from(container.querySelectorAll('g')).find((el) =>
    (el.getAttribute('transform') ?? '').startsWith('translate('),
  );
  if (!g) throw new Error('expected a station-local <g>');
  const m = /translate\(([-\d.]+)[\s,]+([-\d.]+)\)\s*rotate\(([-\d.]+)\)/.exec(
    g.getAttribute('transform') ?? '',
  );
  if (!m) throw new Error(`unparsable station transform: ${g.getAttribute('transform')}`);
  return { tx: Number(m[1]), ty: Number(m[2]), deg: Number(m[3]) };
}

/** A station-local point pushed through the group transform the DOM carries. */
function toWorld(g: { tx: number; ty: number; deg: number }, x: number, y: number) {
  const a = (g.deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: g.tx + x * c - y * s, y: g.ty + x * s + y * c };
}

function renderLayer(layer: 'label' | 'hit', labelRotation: Rotation = 0) {
  const { st } = seedDoc(labelRotation);
  const { container } = render(
    <svg>
      <StationView
        station={st}
        lines={useDoc.getState().lines}
        zoom={1}
        onStartDrag={vi.fn()}
        layer={layer}
      />
    </svg>,
  );
  return { st, container };
}

beforeEach(() => {
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
});

describe('a ring-bound station label resolves through the ring frame', () => {
  it('paints the name on its own radial lane, not the octant one', () => {
    const { st, container } = renderLayer('label');
    divergentSeat(st);

    const g = stationGroup(container);
    const text = container.querySelector('text');
    if (!text) throw new Error('expected <text> for the station label');
    const p = toWorld(g, Number(text.getAttribute('x')), 0);

    // The whole point of the ring frame: cell k sits at exactly R + k·pitch
    // from the centre, at every angle around the ring. Through the octant it
    // lands at R + k·pitch·cos(22.5°) — and off the radius entirely.
    expect(Math.hypot(p.x - CX, p.y - CY)).toBeCloseTo(R + LABEL_COL * STOP_SIZE, 6);
  });

  it('reads at the arc tangent, so the name stays parallel to the band it labels', () => {
    const { st, container } = renderLayer('label', 2);
    const frame = divergentSeat(st);

    const g = stationGroup(container);
    const spun = Array.from(container.querySelectorAll('g')).find((el) =>
      (el.getAttribute('transform') ?? '').startsWith('rotate('),
    );
    const labelDeg = Number(
      /rotate\(([-\d.]+)/.exec(spun?.getAttribute('transform') ?? '')?.[1] ?? NaN,
    );
    // World reading angle = the station's FRAME + the label's own rotation.
    expect(g.deg + labelDeg).toBeCloseTo((frame * 180) / Math.PI + 2 * 45, 6);
  });

  it('puts the label hit rect where the name is painted', () => {
    const painted = stationGroup(renderLayer('label').container);
    const hit = stationGroup(renderLayer('hit').container);
    // Same frame, or the user grabs air where the name is and the name where
    // there is nothing.
    expect(hit.deg).toBeCloseTo(painted.deg, 9);
  });
});
