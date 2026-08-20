import type {
  LabelCell,
  Line,
  LineId,
  LineTag,
  MapDoc,
  Rotation,
  RouteBullet,
  Station,
  StationId,
  StopCell,
  StopOrientation,
  StyleDef,
  StyleKind,
  StylePropsByKind,
  Polygon,
  SvgImage,
  TextLabel,
  Transfer,
} from '../model/types';
import type { SegmentBandSpec } from '../geometry/interlining';
import { STOP_SIZE, stripeOffsetsForWidths } from '../geometry/orientation';
import {
  DEFAULT_DOT_STYLE,
  DEFAULT_STOP_DOT_STYLE_ID,
  STOP_DOT_FACTORY_STYLES,
} from '../model/dotStyle';
import { DEFAULT_DOC } from '../model/transforms';
import { DOT_SIZE_DEFAULT } from '../model/dotSize';
import { LINE_WIDTH_DEFAULT } from '../model/lineWidth';
import { LINE_CURVE_RADIUS_DEFAULT } from '../model/lineCurve';
import { edgesFromStations } from '../model/lineTopology';

export function makeStation(overrides: Partial<Station> & { id: StationId }): Station {
  return {
    // CAUTION, the station twin of `makeLine`'s name warning below: a default
    // name IS the id, so a test asserting a rendered station name proves
    // nothing unless it overrides `name` — a surface painting the id instead
    // would pass too. Give a name unlike the id wherever the name is the thing
    // under test.
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
  const base: Line = {
    service,
    // Mirrors what production `addLine` names a fresh line, so a fixture line
    // looks like a real one. CAUTION: that string is byte-identical to
    // `lineDisplayName`'s "<service> line" fallback for an UNNAMED line, so a
    // test asserting a user-facing line name proves nothing unless it
    // overrides `name` — a surface hand-spelling the fallback would pass too.
    // Three such tests were vacuous for exactly this reason; override with a
    // name unlike the fallback, and cover the empty-name case separately.
    name: `${service} line`,
    color: '#0039A6',
    stations: [],
    edges: [],
    ...overrides,
  };
  // Topology defaults to the linear path implied by `stations` (the historical
  // shape) unless a fixture supplies an explicit edge set for a loop/branch.
  let line: Line = { ...base, edges: overrides.edges ?? edgesFromStations(base.stations) };
  // A dot-default TAG given without its raw shadow gets the shadow filled from
  // the factory library, so the fixture line is consistent (raw + tag) like a
  // real one — resolveDotStyle reads the raw, the setters key off the tag.
  if (line.singletonDotStyleId && line.singletonDotStyle === undefined) {
    const p = STOP_DOT_FACTORY_STYLES[line.singletonDotStyleId]?.props;
    if (p) line = { ...line, singletonDotStyle: p };
  }
  if (line.multiDotStyleId && line.multiDotStyle === undefined) {
    const p = STOP_DOT_FACTORY_STYLES[line.multiDotStyleId]?.props;
    if (p) line = { ...line, multiDotStyle: p };
  }
  return line;
}

/**
 * Hand-rolled SegmentBandSpec for component/geometry tests that don't want to
 * run the full buildBands pipeline: a horizontal s1→s2 band at (0,0)→(100,0)
 * with one stripe per line id. Centralized so adding a field to the spec is a
 * one-place change instead of a sweep over every test's local builder.
 * `lines` always derives from `lineIds` (not overridable) so the parallel
 * arrays can't fall out of step.
 */
export function makeBandSpec(
  lineIds: string[],
  // `stripeOffsets` is NOT overridable: it always derives from
  // `stripeWidths`, so offsets can never disagree with the widths' tangency
  // positions. Note this does NOT make the whole spec self-consistent —
  // `paths` are placeholders, every stripe getting the centerline rather than
  // its own offset path — so a DOM assertion about where a stripe sits is
  // measuring the fixture, not the builder.
  overrides: Partial<Omit<SegmentBandSpec, 'lines' | 'stripeOffsets'>> = {},
): SegmentBandSpec {
  const stripeWidths = overrides.stripeWidths ?? lineIds.map(() => STOP_SIZE);
  return {
    pairKey: 's1|s2',
    bandKey: `s1|s2#${lineIds.slice().sort().join(',')}`,
    fromId: 's1',
    toId: 's2',
    lines: lineIds.map((id) => ({ id })),
    paths: lineIds.map(() => 'M0,0 L100,0'),
    warning: false,
    centerline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    radius: 24,
    linePriorities: lineIds.map((_, i) => i),
    arms: lineIds.map(() => 0),
    ...overrides,
    stripeWidths,
    // Band fixtures are zero-gap: gapped bands are built through the real
    // buildBands in the interlining tests, not hand-assembled here.
    stripeOffsets: stripeOffsetsForWidths(
      stripeWidths,
      stripeWidths.map(() => 0),
    ),
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

// A 100×60 image centered at the origin, unrotated, with a trivial valid
// data-URI href. Defaults chosen so the unrotated corners land on round
// numbers (±50, ±30) for readable geometry assertions.
export function makeSvgImage(overrides: Partial<SvgImage> & { id: string }): SvgImage {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    rotation: 0,
    href: 'data:image/svg+xml;base64,PHN2Zy8+',
    ...overrides,
  };
}

// A line tag anchored to the s1↔s2 corridor. Callers must keep the
// `fromStationId < toStationId` invariant (canonical/alphabetic) themselves.
export function makeLineTag(overrides: Partial<LineTag> & { id: string }): LineTag {
  return {
    lineId: 'l1',
    fromStationId: 's1',
    toStationId: 's2',
    anchorEnd: 'from',
    distance: 10,
    orientation: 0,
    ...overrides,
  };
}

// A line circle (dashed guide circle stations bind to).
export function makeLineCircle(
  overrides: Partial<import('../model/types').LineCircle> & { id: string },
): import('../model/types').LineCircle {
  return {
    x: 0,
    y: 0,
    radius: 70,
    ...overrides,
  };
}

export function makeGuide(
  overrides: Partial<import('../model/types').AlignmentGuide> & { id: string },
): import('../model/types').AlignmentGuide {
  return {
    orientation: 'horizontal',
    offset: 0,
    ...overrides,
  };
}

// A route bullet showing one line's badge. `lineId` may be null (unset).
export function makeRouteBullet(overrides: Partial<RouteBullet> & { id: string }): RouteBullet {
  return {
    x: 0,
    y: 0,
    rotation: 0,
    lineId: 'l1',
    shape: 'circle',
    size: 12,
    ...overrides,
  };
}

// A transfer joining two station dots. Each end's `lineId` picks which dot at
// an interlined station (null = the station anchor).
export function makeTransfer(overrides: Partial<Transfer> & { id: string }): Transfer {
  return {
    a: { stationId: 's1', lineId: null },
    b: { stationId: 's2', lineId: null },
    ...overrides,
  };
}

// Baseline props per style kind — the app's effective defaults for a fresh
// item, so a fixture style is always well-formed and tests override only the
// fields they exercise. Kept in one place so new props get a default here once.
const STYLE_PROPS_DEFAULTS: StylePropsByKind = {
  line: {
    singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
    multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
    singletonDotSize: DOT_SIZE_DEFAULT,
    multiDotSize: DOT_SIZE_DEFAULT,
    width: LINE_WIDTH_DEFAULT,
    curveRadius: LINE_CURVE_RADIUS_DEFAULT,
    endStyle: 'square',
    strokeWidth: 0,
    strokeColor: { day: '#ffffff', night: '#ffffff' },
  },
  stopDot: DEFAULT_DOT_STYLE,
  textLabel: {
    color: '#111111',
    darkColor: '#ffffff',
    fontSize: 16,
    weight: 400,
    italic: false,
    align: 'left',
    width: 0,
    leading: 1,
    tracking: 0,
  },
  polygon: {
    fill: '#cfe3f2',
    stroke: '#000000',
    darkFill: '#cfe3f2',
    darkStroke: '#000000',
    strokeWidth: 1,
    curveRadius: 0,
    closed: true,
  },
  routeBullet: { shape: 'circle', size: 14 },
  transfer: {
    thickness: 2,
    color: { day: '#000000', night: '#000000' },
    strokeWidth: 0,
    strokeColor: { day: '#ffffff', night: '#ffffff' },
    draw: 'under',
  },
  station: { fontSize: 12, weight: 400, italic: false, leading: 1, tracking: 0 },
};

// A named style preset of the given kind. Props default to the app's
// effective defaults (STYLE_PROPS_DEFAULTS) with per-field overrides.
export function makeStyle<K extends StyleKind>(
  kind: K,
  id: string,
  overrides: { name?: string; props?: Partial<StylePropsByKind[K]> } = {},
): StyleDef {
  return {
    id,
    name: overrides.name ?? id,
    kind,
    props: { ...STYLE_PROPS_DEFAULTS[kind], ...overrides.props },
  } as StyleDef;
}

export function makeDoc(parts: {
  name?: string;
  stations?: Station[];
  lines?: Line[];
  lineOrder?: LineId[];
  lineTags?: import('../model/types').LineTag[];
  routeBullets?: RouteBullet[];
  // FREE transfer anchors only. Station-hosted ones ride on their Station
  // (Station.transferAnchors), so they are seeded through `stations`.
  transferAnchors?: import('../model/types').TransferAnchor[];
  transfers?: import('../model/types').Transfer[];
  textLabels?: TextLabel[];
  polygons?: Polygon[];
  regionAssignments?: import('../model/types').RegionAssignment[];
  svgImages?: SvgImage[];
  // The shared polygon + image z-stack; defaults to polygons then images.
  backgroundOrder?: string[];
  lineCircles?: import('../model/types').LineCircle[];
  guides?: import('../model/types').AlignmentGuide[];
  styles?: StyleDef[];
  styleDefaults?: Partial<Record<StyleKind, string>>;
  palettes?: import('../model/palettes').Palette[];
  darkMode?: boolean;
}): MapDoc {
  const stations: Record<StationId, Station> = {};
  for (const s of parts.stations ?? []) stations[s.id] = s;
  const lines: Record<LineId, Line> = {};
  for (const l of parts.lines ?? []) lines[l.id] = l;
  const lineTags: Record<string, import('../model/types').LineTag> = {};
  for (const t of parts.lineTags ?? []) lineTags[t.id] = t;
  const routeBullets: Record<string, RouteBullet> = {};
  for (const rb of parts.routeBullets ?? []) routeBullets[rb.id] = rb;
  const transferAnchors: Record<string, import('../model/types').TransferAnchor> = {};
  for (const a of parts.transferAnchors ?? []) transferAnchors[a.id] = a;
  const transfers: Record<string, import('../model/types').Transfer> = {};
  for (const x of parts.transfers ?? []) transfers[x.id] = x;
  const textLabels: Record<string, TextLabel> = {};
  for (const g of parts.textLabels ?? []) textLabels[g.id] = g;
  const polygons: Record<string, Polygon> = {};
  for (const pg of parts.polygons ?? []) polygons[pg.id] = pg;
  const regionAssignments: Record<string, import('../model/types').RegionAssignment> = {};
  for (const ra of parts.regionAssignments ?? []) regionAssignments[ra.id] = ra;
  const svgImages: Record<string, SvgImage> = {};
  for (const im of parts.svgImages ?? []) svgImages[im.id] = im;
  const lineCircles: Record<string, import('../model/types').LineCircle> = {};
  for (const lc of parts.lineCircles ?? []) lineCircles[lc.id] = lc;
  const guides: Record<string, import('../model/types').AlignmentGuide> = {};
  for (const gd of parts.guides ?? []) guides[gd.id] = gd;
  // Seed the stopDot LIBRARY into every doc (like a real doc) so the dot-style
  // setters can dereference a style id; explicit parts.styles override.
  const styles: Record<string, StyleDef> = { ...STOP_DOT_FACTORY_STYLES };
  for (const st of parts.styles ?? []) styles[st.id] = st;
  // Per-kind default designation: explicit part wins, else the kind's style
  // named "Default", else its first style (name-sorted), else the factory id
  // (dangling in a style-less fixture doc — lookups guard resolution).
  const styleDefaults = {} as Record<StyleKind, string>;
  const kinds: StyleKind[] = [
    'line',
    'textLabel',
    'polygon',
    'routeBullet',
    'transfer',
    'station',
    'stopDot',
  ];
  for (const kind of kinds) {
    const ofKind = Object.values(styles)
      .filter((d) => d.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name));
    styleDefaults[kind] =
      parts.styleDefaults?.[kind] ??
      (kind === 'stopDot' ? DEFAULT_STOP_DOT_STYLE_ID : undefined) ??
      (ofKind.find((d) => d.name === 'Default') ?? ofKind[0])?.id ??
      `default-${kind}`;
  }
  return {
    name: parts.name ?? 'Untitled map',
    stations,
    lines,
    lineOrder: parts.lineOrder ?? Object.keys(lines),
    lineCounter: 0,
    lineTags,
    routeBullets,
    transferAnchors,
    transfers,
    textLabels,
    polygons,
    backgroundOrder: parts.backgroundOrder ?? [...Object.keys(polygons), ...Object.keys(svgImages)],
    regionAssignments,
    svgImages,
    lineCircles,
    guides,
    styles,
    styleDefaults,
    palettes: parts.palettes ?? DEFAULT_DOC.palettes,
    darkMode: parts.darkMode ?? false,
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
