import type {
  Line,
  MapDoc,
  Rotation,
  Station,
  StopCell,
  StopOrientation,
  TextLabel,
  Transfer,
} from '../model/types';
import { DEFAULT_DOC, makeStation } from '../model/transforms';
import { edgesFromStations } from '../model/lineTopology';
import { DIRS_8 } from '../geometry/router';
import type { Vec2 } from '../geometry/vec';

/**
 * The wand-placement gallery: one station per magic-wand (autoAlign) label
 * case, arranged in headed corridor rows and scene grids so every case can be
 * eyeballed. The doc is serialized into docs/wand-gallery.massimo.json (kept
 * in sync by wandGalleryDoc.test.ts — run with UPDATE_WAND_GALLERY=1 to
 * regenerate) and the same test asserts each case's expected placement, so the
 * gallery doubles as an integration test of the octant model.
 *
 * The case space is the full product the placement model reasons over:
 *  - mid-line: label rotation (the 5 readable rotations — the complement of
 *    autoOrient's LABEL_UPSIDE_DOWN band) × stripe axis (4) × reading-frame
 *    octant (8) = 160;
 *  - terminals: every exit ray (8) × octant (8) = 64, horizontal labels;
 *  - crossings: H×V (all four octant × side combos), H×diagonal and
 *    diagonal×diagonal representatives = 12;
 *  - corner parks: the label in a cross's quadrant, both beside-sides × both
 *    host sides, plus the thick transfer that closes the corner = 5;
 *  - plus multi-line stacking (3), the detached-label fallback, and the
 *    stop-less phantom station.
 *
 * Every station keeps station rotation 0, encoding line direction purely in
 * stop orientation — a case's world picture then depends only on its own
 * parameters, which is what makes the map scannable. The label's READING
 * frame rotates with label.rotation; a case's octant is the octant in that
 * frame, so its label cell sits at the world octant (octant + rotation) % 8.
 *
 * Spacing is deliberately tight (the map is meant to be seen whole): each
 * corridor's interstation pitch is derived from how its labels read relative
 * to the corridor axis — see corridorPitch.
 */

export type WandGalleryFamily =
  | 'mid' // mid-line station: rotation × axis corridors, one octant each
  | 'terminal' // line terminus: exit ray × octant scenes
  | 'cross' // centering octant with a crossing stop re-anchoring the reading axis
  | 'corner' // label in a cross's quadrant: the stop BESIDE it takes the anchor
  | 'multiline' // two-line names pinning the stacking direction per family
  | 'fallback' // label dragged beyond the adjacency gate: centered on its cell
  | 'phantom'; // station with no stops: aligns against the phantom dot

/** Stripe axis of the labeled stop. */
export type WandGalleryAxis = 'H' | 'V' | 'NE' | 'NW';

export interface WandGalleryCase {
  stationId: string;
  family: WandGalleryFamily;
  /** Octant of the label cell relative to its stop IN THE READING FRAME
   *  (0=E … 7=NE), null for the fallback case (no adjacent stop). */
  octant: number | null;
  labelRotation: Rotation;
  /** Stripe axis of the labeled stop; null when there is no stop (phantom). */
  axis: WandGalleryAxis | null;
  /** Exit direction of a terminus' single edge, world frame; null otherwise. */
  ray: string | null;
  /** Whether the station is a terminus of its primary line; null when the
   *  label has nothing line-hosted to be a terminus of. */
  terminal: boolean | null;
  expect: {
    textAnchor: 'start' | 'middle' | 'end';
    /** Where the anchor must land relative to the STOP cell's center (the
     *  label cell for fallback), measured on the READING frame's
     *  perpendicular: above/below clears the marker half-extent, level stays
     *  within a line-height. */
    anchorSide: 'above' | 'below' | 'level';
  };
}

// Label cell relative to a stop at (0,0), per WORLD octant (y-down, 0=E … 7=NE).
const OCTANT_CELL: [row: number, col: number][] = [
  [0, 1], // 0 E
  [1, 1], // 1 SE
  [1, 0], // 2 S
  [1, -1], // 3 SW
  [0, -1], // 4 W
  [-1, -1], // 5 NW
  [-1, 0], // 6 N
  [-1, 1], // 7 NE
];

export const OCTANT_NAME = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

// The octant model's textAnchor table (labelLayout.AUTO_TEXT_ANCHOR), by
// reading-frame octant: the end of the text facing the stop aligns to it,
// N/S center on it.
const OCTANT_TEXT_ANCHOR: WandGalleryCase['expect']['textAnchor'][] = [
  'start',
  'start',
  'middle',
  'end',
  'end',
  'end',
  'middle',
  'start',
];

const OCTANT_ANCHOR_SIDE: WandGalleryCase['expect']['anchorSide'][] = [
  'level',
  'below',
  'below',
  'below',
  'level',
  'above',
  'above',
  'above',
];

// The 5 readable label rotations — the complement of autoOrient's
// LABEL_UPSIDE_DOWN band {3, 4, 5}.
export const READABLE_ROTATIONS: Rotation[] = [0, 1, 2, 6, 7];
const ROTATION_LABEL: Record<number, string> = {
  0: 'E-reading (horizontal)',
  1: 'SE-reading (down diagonal)',
  2: 'S-reading (vertical down)',
  6: 'N-reading (vertical up)',
  7: 'NE-reading (up diagonal)',
};

export const AXES: WandGalleryAxis[] = ['H', 'V', 'NE', 'NW'];
const AXIS_ORIENT: Record<WandGalleryAxis, StopOrientation> = {
  H: 'auto-horizontal',
  V: 'auto-vertical',
  NE: 'auto-ne-sw',
  NW: 'auto-nw-se',
};
const AXIS_LABEL: Record<WandGalleryAxis, string> = {
  H: 'horizontal line',
  V: 'vertical line',
  NE: 'NE–SW line',
  NW: 'NW–SE line',
};
// Direction each corridor RUNS along its axis, as a DIRS_8 index (H corridors
// run east, V south, NE up-right, NW down-right).
const AXIS_DIR_IDX: Record<WandGalleryAxis, number> = { H: 0, V: 2, NE: 7, NW: 1 };
const AXIS_DIR: Record<WandGalleryAxis, Vec2> = {
  H: DIRS_8[AXIS_DIR_IDX.H],
  V: DIRS_8[AXIS_DIR_IDX.V],
  NE: DIRS_8[AXIS_DIR_IDX.NE],
  NW: DIRS_8[AXIS_DIR_IDX.NW],
};
// Stripe axis of a stop whose line departs along world ray index r.
const RAY_AXIS: WandGalleryAxis[] = ['H', 'NW', 'V', 'NE', 'H', 'NW', 'V', 'NE'];

/**
 * Interstation pitch of a mid corridor, from how its rotation-r labels read
 * relative to the corridor axis. Reading ALONG the corridor needs text room —
 * the corner-octant labels of adjacent stations share a row at ~115px —
 * while reading ACROSS it packs to ~65px (a label is only a line-height
 * tall); 45° readers separate on both coordinates and sit between.
 */
const corridorPitch = (axis: WandGalleryAxis, r: Rotation): number => {
  const rel = (((AXIS_DIR_IDX[axis] - r) % 4) + 4) % 4;
  return rel === 0 ? 120 : rel === 2 ? 65 : 75;
};

// Worst-case reach of a rotation's rendered labels PERPENDICULAR to an H
// corridor (world px): horizontal readers stay within a couple of cells,
// vertical readers hang a whole name above/below, diagonals ~70% of one.
const READ_EXT: Record<number, number> = { 0: 50, 1: 75, 2: 95, 6: 95, 7: 75 };

const S2 = Math.SQRT1_2;

const COLORS = [
  '#EE352E',
  '#0039A6',
  '#00933C',
  '#FF6319',
  '#B933AD',
  '#996633',
  '#A7A9AC',
  '#FCCC0A',
  '#00A1DE',
  '#6CBE45',
];

function stop(lineId: string, orientation: StopOrientation, row = 0, col = 0): StopCell {
  return { lineId, row, col, orientation };
}

function station(
  id: string,
  name: string,
  x: number,
  y: number,
  stops: StopCell[],
  labelCell: [row: number, col: number],
  labelRotation: Rotation = 0,
): Station {
  const base = makeStation(id, x, y, name);
  return {
    ...base,
    stops,
    label: { ...base.label, row: labelCell[0], col: labelCell[1], rotation: labelRotation },
  };
}

function waypoint(id: string, x: number, y: number, stops: StopCell[]): Station {
  return { ...station(id, 'WP', x, y, stops, [0, -1]), isWaypoint: true };
}

export interface WandGallery {
  doc: MapDoc;
  cases: WandGalleryCase[];
}

export function wandGalleryDoc(): WandGallery {
  const stations: Station[] = [];
  const lines: Line[] = [];
  const transfers: Transfer[] = [];
  const cases: WandGalleryCase[] = [];
  const textLabels: TextLabel[] = [];
  let colorIdx = 0;
  const nextColor = () => COLORS[colorIdx++ % COLORS.length];

  const line = (id: string, name: string, stationIds: string[]): void => {
    lines.push({
      id,
      service: `${lines.length + 1}`,
      name,
      color: nextColor(),
      stations: stationIds,
      edges: edgesFromStations(stationIds),
    });
  };
  const header = (id: string, x: number, y: number, text: string, fontSize = 20): void => {
    textLabels.push({
      id,
      x,
      y,
      rotation: 0,
      text,
      fontSize,
      weight: 700,
      italic: false,
      align: 'left',
      color: '#111111',
      darkColor: '#ffffff',
    });
  };

  header(
    'title',
    0,
    -130,
    'Wand label gallery — corridor stations left to right: reading-frame octant ' +
      'E SE S SW W NW N NE',
    32,
  );

  // ── Mid-line corridors: label rotation × stripe axis, 8 octant stations
  // each (plus waypoint end caps so every labeled station is genuinely
  // mid-line). One corridor per combination; the reading-frame octant o puts
  // the label cell at world octant (o + rotation) % 8. Layout per rotation
  // block: the H corridor runs across the top, then the V column and the two
  // diagonals sit side by side beneath it.
  let y = 0;
  for (const r of READABLE_ROTATIONS) {
    const pad = READ_EXT[r];
    const neExt = 9 * corridorPitch('NE', r) * S2;
    const nwExt = 9 * corridorPitch('NW', r) * S2;
    const vLen = 9 * corridorPitch('V', r);
    const hY = y + pad + 40;
    const yB = hY + pad + 55; // sub-band below the H corridor + header room
    header(`mid-r${r}-hdr`, 0, hY - pad - 38, `${ROTATION_LABEL[r]} labels`, 26);
    const origins: Record<WandGalleryAxis, Vec2> = {
      H: { x: 0, y: hY },
      V: { x: 90, y: yB },
      NE: { x: 300, y: yB + neExt }, // runs up-right
      NW: { x: 300 + neExt + 190, y: yB }, // runs down-right
    };
    for (const axis of AXES) {
      const d = AXIS_DIR[axis];
      const pitch = corridorPitch(axis, r);
      const origin = origins[axis];
      const cid = `mid-r${r}${axis}`;
      if (axis !== 'H')
        header(`${cid}-hdr`, origin.x, origin.y + (axis === 'NE' ? 40 : -40), AXIS_LABEL[axis]);
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const x = origin.x + i * pitch * d.x;
        const sy = origin.y + i * pitch * d.y;
        if (i === 0 || i === 9) {
          const id = `${cid}-cap${i === 0 ? 'A' : 'B'}`;
          stations.push(waypoint(id, x, sy, [stop(cid, AXIS_ORIENT[axis])]));
          ids.push(id);
          continue;
        }
        const o = i - 1;
        const id = `${cid}-${OCTANT_NAME[o]}`;
        stations.push(
          station(
            id,
            `Midway ${OCTANT_NAME[o]}`,
            x,
            sy,
            [stop(cid, AXIS_ORIENT[axis])],
            OCTANT_CELL[(o + r) % 8],
            r,
          ),
        );
        ids.push(id);
        cases.push({
          stationId: id,
          family: 'mid',
          octant: o,
          labelRotation: r,
          axis,
          ray: null,
          terminal: false,
          expect: { textAnchor: OCTANT_TEXT_ANCHOR[o], anchorSide: OCTANT_ANCHOR_SIDE[o] },
        });
      }
      line(cid, `Mid r${r} ${axis}`, ids);
    }
    y = yB + Math.max(vLen, neExt, nwExt) + pad + 40;
  }

  // ── Terminals: 2-station scenes, one per octant column; each scene's line
  // runs along one axis, so its two ends exit in opposite rays — 4 rows cover
  // all 8 exit directions × 8 octants. Horizontal labels (rotation 0).
  // [exit ray, opposite ray, interstation, scene pitch, content height]:
  // the along-reading pair needs text room between its stations, the others
  // pack close.
  const rayPairs: [number, number, number, number, number][] = [
    [0, 4, 130, 320, 100], // exits E / W (horizontal scene)
    [2, 6, 65, 200, 160], // exits S / N (vertical scene)
    [7, 3, 90, 240, 160], // exits NE / SW
    [1, 5, 90, 240, 160], // exits SE / NW
  ];
  y += 20;
  for (const [ray, backRay, inter, sceneW, rowH] of rayPairs) {
    const d = DIRS_8[ray];
    header(
      `term-${OCTANT_NAME[ray]}-hdr`,
      0,
      y,
      `Terminals · exits ${OCTANT_NAME[ray]} and ${OCTANT_NAME[backRay]} · label octants →`,
    );
    const rowY = y + 35 + rowH / 2;
    for (let o = 0; o < 8; o++) {
      const cx = 130 + o * sceneW;
      const orient = AXIS_ORIENT[RAY_AXIS[ray]];
      const lid = `term-${OCTANT_NAME[ray]}-${OCTANT_NAME[o]}`;
      // The station at center − (inter/2)·d has its only neighbor at +d: it
      // exits along `ray`. Its partner exits the opposite way.
      const aId = `term-${OCTANT_NAME[ray]}-${OCTANT_NAME[o]}-a`;
      const bId = `term-${OCTANT_NAME[backRay]}-${OCTANT_NAME[o]}-b`;
      stations.push(
        station(
          aId,
          `Endpoint ${OCTANT_NAME[o]}`,
          cx - (inter / 2) * d.x,
          rowY - (inter / 2) * d.y,
          [stop(lid, orient)],
          OCTANT_CELL[o],
        ),
        station(
          bId,
          `Endpoint ${OCTANT_NAME[o]}`,
          cx + (inter / 2) * d.x,
          rowY + (inter / 2) * d.y,
          [stop(lid, orient)],
          OCTANT_CELL[o],
        ),
      );
      line(lid, `Term ${OCTANT_NAME[ray]}/${OCTANT_NAME[backRay]} ${OCTANT_NAME[o]}`, [aId, bId]);
      for (const [id, exitRay] of [
        [aId, ray],
        [bId, backRay],
      ] as const) {
        cases.push({
          stationId: id,
          family: 'terminal',
          octant: o,
          labelRotation: 0,
          axis: RAY_AXIS[ray],
          ray: OCTANT_NAME[exitRay],
          terminal: true,
          expect: { textAnchor: OCTANT_TEXT_ANCHOR[o], anchorSide: OCTANT_ANCHOR_SIDE[o] },
        });
      }
    }
    y = rowY + rowH / 2 + 25;
  }

  // ── Crossings: a centering-octant label (N/S of its own stop) with a
  // crossing line's stop packed one cell along the reading axis — the text
  // butts against the crossing stripe. H×V in all four octant × side combos,
  // plus diagonal crossing stripes and diagonal×diagonal hosts (a known
  // model blind spot worth seeing).
  y += 20;
  header('cross-hdr', 0, y, 'Crossings · host × crossing stripe');
  const crossConfigs: [host: WandGalleryAxis, cross: WandGalleryAxis, o: 2 | 6, col: 1 | -1][] = [
    ['H', 'V', 2, 1],
    ['H', 'V', 6, -1],
    ['H', 'V', 6, 1],
    ['H', 'V', 2, -1],
    ['H', 'NE', 2, 1],
    ['H', 'NE', 6, -1],
    ['H', 'NW', 2, 1],
    ['H', 'NW', 6, -1],
    ['NE', 'NW', 6, 1],
    ['NE', 'NW', 2, -1],
    ['NW', 'NE', 6, 1],
    ['NW', 'NE', 2, -1],
  ];
  const ARM = 70;
  crossConfigs.forEach(([host, cross, o, col], i) => {
    const cx = 160 + (i % 6) * 280;
    const cy = y + 160 + Math.floor(i / 6) * 270;
    const id = `cross-${host}x${cross}-${o === 2 ? 'S' : 'N'}${col === 1 ? 'E' : 'W'}`;
    const dh = AXIS_DIR[host];
    const dc = AXIS_DIR[cross];
    const sx = cx + 14 * col; // crossing stop's world position
    stations.push(
      waypoint(`${id}-h1`, cx - ARM * dh.x, cy - ARM * dh.y, [
        stop(`${id}-host`, AXIS_ORIENT[host]),
      ]),
      station(
        id,
        `Crossing ${o === 2 ? 'S' : 'N'} ${col === 1 ? 'east' : 'west'}`,
        cx,
        cy,
        [stop(`${id}-host`, AXIS_ORIENT[host]), stop(`${id}-cross`, AXIS_ORIENT[cross], 0, col)],
        OCTANT_CELL[o],
      ),
      waypoint(`${id}-h2`, cx + ARM * dh.x, cy + ARM * dh.y, [
        stop(`${id}-host`, AXIS_ORIENT[host]),
      ]),
      waypoint(`${id}-c1`, sx - ARM * dc.x, cy - ARM * dc.y, [
        stop(`${id}-cross`, AXIS_ORIENT[cross]),
      ]),
      waypoint(`${id}-c2`, sx + ARM * dc.x, cy + ARM * dc.y, [
        stop(`${id}-cross`, AXIS_ORIENT[cross]),
      ]),
    );
    line(`${id}-host`, `Cross host ${i + 1}`, [`${id}-h1`, id, `${id}-h2`]);
    line(`${id}-cross`, `Cross line ${i + 1}`, [`${id}-c1`, id, `${id}-c2`]);
    cases.push({
      stationId: id,
      family: 'cross',
      octant: o,
      labelRotation: 0,
      axis: host,
      ray: null,
      terminal: false,
      expect: {
        // The text butts up against the crossing stripe: stripe ahead along
        // reading ⇒ the text's END faces it, behind ⇒ its START does.
        textAnchor: col === 1 ? 'end' : 'start',
        anchorSide: OCTANT_ANCHOR_SIDE[o],
      },
    });
  });
  y += 160 + 270 + 130;

  // ── Corner parks: the label sits in a QUADRANT of a cross — its own line's
  // stop straight below (or above) it, the crossing line's stop BESIDE it, in
  // the label's own row. Centering on the near stop would run the text through
  // that beside marker, so the beside stop takes the anchor and the text reads
  // away from it. The last scene adds the thick transfer that closes the corner
  // off diagonally, which the pin has to clear along its straight side.
  y += 20;
  header('corner-hdr', 0, y, 'Corner parks · the beside stop takes the anchor');
  const cornerConfigs: [side: 1 | -1, down: 1 | -1, transfer: boolean][] = [
    [-1, 1, false],
    [1, 1, false],
    [-1, -1, false],
    [1, -1, false],
    [-1, 1, true],
  ];
  cornerConfigs.forEach(([side, down, withTransfer], i) => {
    const cx = 200 + i * 280;
    const cy = y + 170;
    const dirName = side === -1 ? 'east' : 'west';
    const id = `corner-${down === 1 ? 'N' : 'S'}${side === -1 ? 'E' : 'W'}${withTransfer ? '-xfer' : ''}`;
    // Beside stop (the crossing line's) at cell (0,0), the label one cell
    // toward −side, and the host line's stop straight below/above the label —
    // so the two stops sit DIAGONAL to each other and the label fills the
    // quadrant between them.
    const hx = cx - 14 * side;
    const hy = cy + 14 * down;
    stations.push(
      waypoint(`${id}-v1`, cx, cy - ARM, [stop(`${id}-v`, 'auto-vertical')]),
      station(
        id,
        withTransfer ? 'Corner transfer' : `Corner ${down === 1 ? 'N' : 'S'} ${dirName}`,
        cx,
        cy,
        [stop(`${id}-v`, 'auto-vertical'), stop(`${id}-h`, 'auto-horizontal', down, -side)],
        [0, -side],
      ),
      waypoint(`${id}-v2`, cx, cy + ARM, [stop(`${id}-v`, 'auto-vertical')]),
      waypoint(`${id}-h1`, hx - ARM, hy, [stop(`${id}-h`, 'auto-horizontal')]),
      waypoint(`${id}-h2`, hx + ARM, hy, [stop(`${id}-h`, 'auto-horizontal')]),
    );
    line(`${id}-v`, `Corner cross ${i + 1}`, [`${id}-v1`, id, `${id}-v2`]);
    line(`${id}-h`, `Corner host ${i + 1}`, [`${id}-h1`, id, `${id}-h2`]);
    if (withTransfer)
      transfers.push({
        id: `${id}-t`,
        a: { stationId: id, lineId: `${id}-v` },
        b: { stationId: id, lineId: `${id}-h` },
        thickness: 20,
      });
    cases.push({
      stationId: id,
      family: 'corner',
      // The label's octant against the stop that WON it — the beside one,
      // which is this station's first stop.
      octant: side === -1 ? 0 : 4,
      labelRotation: 0,
      axis: 'V',
      ray: null,
      terminal: false,
      expect: { textAnchor: side === -1 ? 'start' : 'end', anchorSide: 'level' },
    });
  });
  y += 170 + 130;

  // ── Multi-line stacking, the detached-label fallback, and the stop-less
  // phantom station.
  header('misc-hdr', 0, y, 'Multi-line stacking · detached-label fallback · stop-less station');
  {
    const my = y + 90;
    const ids = ['misc-capA'];
    stations.push(waypoint('misc-capA', 0, my, [stop('M1', 'auto-horizontal')]));
    const multis: [octant: number, id: string, name: string][] = [
      [6, 'multiN', 'Upper Gallery\nNorth Stack'],
      [2, 'multiS', 'Lower Gallery\nSouth Stack'],
      [0, 'multiE', 'Side Gallery\nEast Stack'],
    ];
    multis.forEach(([o, id, name], i) => {
      stations.push(
        station(id, name, 160 + 180 * i, my, [stop('M1', 'auto-horizontal')], OCTANT_CELL[o]),
      );
      ids.push(id);
      cases.push({
        stationId: id,
        family: 'multiline',
        octant: o,
        labelRotation: 0,
        axis: 'H',
        ray: null,
        terminal: false,
        expect: { textAnchor: OCTANT_TEXT_ANCHOR[o], anchorSide: OCTANT_ANCHOR_SIDE[o] },
      });
    });
    // Label three cells east of the stop: beyond the adjacency gate, so the
    // wand has nothing to align against and centers on the label's own cell.
    stations.push(station('faraway', 'Faraway', 780, my, [stop('M1', 'auto-horizontal')], [0, 3]));
    ids.push('faraway', 'misc-capB');
    cases.push({
      stationId: 'faraway',
      family: 'fallback',
      octant: null,
      labelRotation: 0,
      axis: 'H',
      ray: null,
      terminal: null,
      expect: { textAnchor: 'middle', anchorSide: 'level' },
    });
    stations.push(waypoint('misc-capB', 950, my, [stop('M1', 'auto-horizontal')]));
    line('M1', 'Misc line', ids);

    // A station with no stops at all: the wand aligns against the phantom dot
    // one cell east of the label, so a W-of-phantom label reads beside it.
    stations.push(station('phantom', 'Phantom Stop', 1150, my, [], [0, -1]));
    cases.push({
      stationId: 'phantom',
      family: 'phantom',
      octant: 4,
      labelRotation: 0,
      axis: null,
      ray: null,
      terminal: null,
      expect: { textAnchor: 'end', anchorSide: 'level' },
    });
  }

  const doc: MapDoc = {
    ...DEFAULT_DOC,
    name: 'Wand label gallery',
    stations: Object.fromEntries(stations.map((s) => [s.id, s])),
    lines: Object.fromEntries(lines.map((l) => [l.id, l])),
    lineOrder: lines.map((l) => l.id),
    lineCounter: lines.length,
    transfers: Object.fromEntries(transfers.map((t) => [t.id, t])),
    textLabels: Object.fromEntries(textLabels.map((t) => [t.id, t])),
  };
  return { doc, cases };
}
