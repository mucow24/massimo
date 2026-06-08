import type {
  LabelCell,
  Line,
  LineId,
  MapDoc,
  Rotation,
  Station,
  StationId,
  StopCell,
  StopOrientation,
  Polygon,
  TextLabel,
  TextLabelWeight,
} from '../model/types';

export function makeStation(overrides: Partial<Station> & { id: StationId }): Station {
  return {
    name: overrides.name ?? overrides.id,
    x: 0,
    y: 0,
    rotation: 0,
    stops: [],
    label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
    ...overrides,
  };
}

export function makeStop(
  lineId: LineId,
  overrides: Partial<Omit<StopCell, 'lineId'>> = {},
): StopCell {
  return {
    lineId,
    row: 0,
    col: 0,
    orientation: 'auto-vertical',
    ...overrides,
  };
}

export function makeLabel(overrides: Partial<LabelCell> = {}): LabelCell {
  return {
    row: 0,
    col: -1,
    rotation: 0,
    offset: 0,
    align: 'auto',
    valign: 'auto-down',
    ...overrides,
  };
}

export function makeLine(overrides: Partial<Line> & { id: LineId }): Line {
  const service = overrides.service ?? overrides.id.toUpperCase();
  return {
    service,
    name: `${service} line`,
    color: '#0039A6',
    stations: [],
    ...overrides,
  };
}

export function makeTextLabel(overrides: Partial<TextLabel> & { id: string }): TextLabel {
  return {
    x: 0,
    y: 0,
    rotation: 0,
    text: 'Label',
    fontSize: 16,
    weight: 400,
    italic: false,
    align: 'left',
    color: '#111111',
    darkColor: '#ffffff',
    ...overrides,
  };
}

export function makePolygon(overrides: Partial<Polygon> & { id: string }): Polygon {
  const base = {
    vertices: [
      { x: -30, y: -30 },
      { x: 30, y: -30 },
      { x: 30, y: 30 },
      { x: -30, y: 30 },
    ],
    fill: '#cfe3f2',
    stroke: '#000000',
    strokeWidth: 1,
    ...overrides,
  };
  // Dark colors default to the light colors (as at creation) unless overridden.
  return {
    ...base,
    darkFill: overrides.darkFill ?? base.fill,
    darkStroke: overrides.darkStroke ?? base.stroke,
  };
}

export function makeDoc(parts: {
  stations?: Station[];
  lines?: Line[];
  lineOrder?: LineId[];
  curveRadius?: number;
  lineTags?: import('../model/types').LineTag[];
  transfers?: import('../model/types').Transfer[];
  textLabels?: TextLabel[];
  polygons?: Polygon[];
  polygonOrder?: string[];
  labelFontSize?: number;
  labelWeight?: TextLabelWeight;
  labelItalic?: boolean;
  activePalettes?: import('../model/palettes').PaletteId[];
  transferThickness?: number;
  transferColor?: string;
  transferStrokeWidth?: number;
  transferStrokeColor?: string;
}): MapDoc {
  const stations: Record<StationId, Station> = {};
  for (const s of parts.stations ?? []) stations[s.id] = s;
  const lines: Record<LineId, Line> = {};
  for (const l of parts.lines ?? []) lines[l.id] = l;
  const lineTags: Record<string, import('../model/types').LineTag> = {};
  for (const t of parts.lineTags ?? []) lineTags[t.id] = t;
  const transfers: Record<string, import('../model/types').Transfer> = {};
  for (const x of parts.transfers ?? []) transfers[x.id] = x;
  const textLabels: Record<string, TextLabel> = {};
  for (const g of parts.textLabels ?? []) textLabels[g.id] = g;
  const polygons: Record<string, Polygon> = {};
  for (const pg of parts.polygons ?? []) polygons[pg.id] = pg;
  return {
    stations,
    lines,
    lineOrder: parts.lineOrder ?? Object.keys(lines),
    curveRadius: parts.curveRadius ?? 24,
    lineCounter: 0,
    lineTags,
    routeBullets: {},
    transfers,
    textLabels,
    polygons,
    polygonOrder: parts.polygonOrder ?? Object.keys(polygons),
    labelFontSize: parts.labelFontSize ?? 12,
    labelWeight: parts.labelWeight ?? 400,
    labelItalic: parts.labelItalic ?? false,
    activePalettes: parts.activePalettes ?? ['mta'],
    transferThickness: parts.transferThickness ?? 2,
    transferColor: parts.transferColor ?? '#000000',
    transferStrokeWidth: parts.transferStrokeWidth ?? 0,
    transferStrokeColor: parts.transferStrokeColor ?? '#ffffff',
  };
}

// Convenience: a station with a single stop on the given line, optionally
// positioned + oriented in the unrotated local frame.
export function stationWithStop(
  id: StationId,
  lineId: LineId,
  pos: { x: number; y: number },
  opts: {
    rotation?: Rotation;
    stopRow?: number;
    stopCol?: number;
    orientation?: StopOrientation;
    name?: string;
  } = {},
): Station {
  return makeStation({
    id,
    name: opts.name ?? id,
    x: pos.x,
    y: pos.y,
    rotation: opts.rotation ?? 0,
    stops: [
      makeStop(lineId, {
        row: opts.stopRow ?? 0,
        col: opts.stopCol ?? 0,
        orientation: opts.orientation ?? 'auto-vertical',
      }),
    ],
  });
}
