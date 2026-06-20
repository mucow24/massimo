// Color palettes available to the line editor. The active set is stored
// per-document on `MapDoc.activePalettes`, with the invariant that at least
// one palette must always be active (enforced in transforms).
//
// PALETTES is ordered alphabetically by continent, then alphabetically by
// display name within each continent. The popover renders a horizontal
// separator between continent groups.

// A palette id. Built-in palettes use the stable slugs declared in PALETTES
// below; user-imported custom palettes use arbitrary `custom:<slug>` ids, so the
// type is an open string rather than a closed union. KNOWN_PALETTE_IDS is the
// runtime source of truth for which built-in ids exist.
export type PaletteId = string;

export type Continent = 'asia' | 'europe' | 'na';

export interface PaletteSwatch {
  name: string;
  color: string;
}

export interface Palette {
  id: PaletteId;
  name: string;
  // Built-in palettes are grouped by continent in the options popover. Custom
  // (user-imported) palettes have no continent and render in their own group.
  continent?: Continent;
  swatches: PaletteSwatch[];
}

// Order here is the canonical declaration order — used for storage normalisation,
// UI section order, and the addLine auto-cycle order. Continents in alphabetical
// order (asia → europe → na); palettes in alphabetical order within each.
export const PALETTES: readonly Palette[] = [
  // ---- Asia ----
  {
    id: 'beijing-subway',
    name: 'Beijing Subway',
    continent: 'asia',
    swatches: [
      { name: 'Line 1', color: '#A4343A' },
      { name: 'Line 2', color: '#004B87' },
      { name: 'Line 3', color: '#D90627' },
      { name: 'Line 4', color: '#008C95' },
      { name: 'Line 5', color: '#AA0061' },
      { name: 'Line 6', color: '#B58500' },
      { name: 'Line 7', color: '#FFC56E' },
      { name: 'Line 8', color: '#009B77' },
      { name: 'Line 9', color: '#97D700' },
      { name: 'Line 10', color: '#0092BC' },
      { name: 'Line 11', color: '#FF8674' },
      { name: 'Line 12', color: '#9C4F01' },
      { name: 'Line 13', color: '#F4DA40' },
      { name: 'Line 14', color: '#CA9A8E' },
      { name: 'Line 15', color: '#653279' },
      { name: 'Line 16', color: '#6BA539' },
      { name: 'Line 17', color: '#00ABAB' },
      { name: 'Line 18', color: '#685BC7' },
      { name: 'Line 19', color: '#D3A3C9' },
    ],
  },
  {
    id: 'mtr',
    name: 'MTR',
    continent: 'asia',
    swatches: [
      { name: 'Airport Express', color: '#00888A' },
      { name: 'Disneyland Resort', color: '#F173AC' },
      { name: 'East Rail', color: '#53B7E8' },
      { name: 'Island', color: '#007DC5' },
      { name: 'Kwun Tong', color: '#00AB4E' },
      { name: 'South Island', color: '#BAC429' },
      { name: 'Tseung Kwan O', color: '#7D499D' },
      { name: 'Tsuen Wan', color: '#ED1D24' },
      { name: 'Tuen Ma', color: '#923011' },
      { name: 'Tung Chung', color: '#F7943E' },
    ],
  },
  {
    id: 'shanghai-metro',
    name: 'Shanghai Metro',
    continent: 'asia',
    swatches: [
      { name: 'Line 1', color: '#E3002B' },
      { name: 'Line 2', color: '#82BF25' },
      { name: 'Line 3', color: '#FCD600' },
      { name: 'Line 4', color: '#461D84' },
      { name: 'Line 5', color: '#944D9A' },
      { name: 'Line 6', color: '#D40068' },
      { name: 'Line 7', color: '#ED6F00' },
      { name: 'Line 8', color: '#0094D8' },
      { name: 'Line 9', color: '#87CAED' },
      { name: 'Line 10', color: '#C6AFD4' },
      { name: 'Line 11', color: '#871C2B' },
      { name: 'Line 12', color: '#007A60' },
      { name: 'Line 13', color: '#E999C0' },
      { name: 'Line 14', color: '#626020' },
      { name: 'Line 15', color: '#BCA886' },
      { name: 'Line 16', color: '#98D1C0' },
      { name: 'Line 17', color: '#BC796F' },
      { name: 'Line 18', color: '#C4984F' },
    ],
  },
  {
    id: 'tokyo-subway',
    name: 'Tokyo Subway',
    continent: 'asia',
    // Tokyo Metro (9 lines) + Toei Subway (4 lines), as a single combined
    // palette since both networks share the same city core.
    swatches: [
      { name: 'Metro Chiyoda', color: '#00BB85' },
      { name: 'Metro Fukutoshin', color: '#9C5E31' },
      { name: 'Metro Ginza', color: '#FF9500' },
      { name: 'Metro Hanzōmon', color: '#8F76D6' },
      { name: 'Metro Hibiya', color: '#B5B5AC' },
      { name: 'Metro Marunouchi', color: '#F62E36' },
      { name: 'Metro Namboku', color: '#00AC9B' },
      { name: 'Metro Tōzai', color: '#009BBF' },
      { name: 'Metro Yūrakuchō', color: '#C1A470' },
      { name: 'Toei Asakusa', color: '#EC6E65' },
      { name: 'Toei Mita', color: '#006CB6' },
      { name: 'Toei Ōedo', color: '#CE045B' },
      { name: 'Toei Shinjuku', color: '#B0C124' },
    ],
  },

  // ---- Europe ----
  {
    id: 'berlin-ubahn',
    name: 'Berlin U-Bahn',
    continent: 'europe',
    swatches: [
      { name: 'U1', color: '#7DAD4C' },
      { name: 'U2', color: '#DA421E' },
      { name: 'U3', color: '#16683D' },
      { name: 'U4', color: '#F0D722' },
      { name: 'U5', color: '#7E5330' },
      { name: 'U6', color: '#8C6DAB' },
      { name: 'U7', color: '#009BD5' },
      { name: 'U8', color: '#224F86' },
      { name: 'U9', color: '#F3791D' },
    ],
  },
  {
    id: 'paris-ratp',
    name: 'Paris (RATP)',
    continent: 'europe',
    // Paris Métro lines 1–14 plus the four trams whose colors don't
    // duplicate a Métro line (T6, T9, T12, T14).
    swatches: [
      { name: 'Métro 1', color: '#FFCE00' },
      { name: 'Métro 2', color: '#0064B0' },
      { name: 'Métro 3', color: '#9F9825' },
      { name: 'Métro 4', color: '#C04191' },
      { name: 'Métro 5', color: '#F28E42' },
      { name: 'Métro 6', color: '#83C491' },
      { name: 'Métro 7', color: '#F3A4BA' },
      { name: 'Métro 8', color: '#CEADD2' },
      { name: 'Métro 9', color: '#D5C900' },
      { name: 'Métro 10', color: '#E3B32A' },
      { name: 'Métro 11', color: '#8D5E2A' },
      { name: 'Métro 12', color: '#00814F' },
      { name: 'Métro 13', color: '#98D4E2' },
      { name: 'Métro 14', color: '#662483' },
      { name: 'Tram T6', color: '#E3051C' },
      { name: 'Tram T9', color: '#5291CE' },
      { name: 'Tram T12', color: '#B90845' },
      { name: 'Tram T14', color: '#00A88F' },
    ],
  },
  {
    id: 'tfl',
    name: 'TfL (London)',
    continent: 'europe',
    // London Underground (11) + Overground (6) + DLR.
    swatches: [
      { name: 'Bakerloo', color: '#A45A2A' },
      { name: 'Central', color: '#DA291C' },
      { name: 'Circle', color: '#FFCD00' },
      { name: 'District', color: '#007A33' },
      { name: 'Hammersmith & City', color: '#E89CAE' },
      { name: 'Jubilee', color: '#7C878E' },
      { name: 'Metropolitan', color: '#840B55' },
      { name: 'Northern', color: '#000000' },
      { name: 'Piccadilly', color: '#10069F' },
      { name: 'Victoria', color: '#00A3E0' },
      { name: 'Waterloo & City', color: '#6ECEB2' },
      { name: 'Liberty', color: '#606667' },
      { name: 'Lioness', color: '#EF9600' },
      { name: 'Mildmay', color: '#2774AE' },
      { name: 'Suffragette', color: '#5BA763' },
      { name: 'Weaver', color: '#893B67' },
      { name: 'Windrush', color: '#D22730' },
      { name: 'DLR', color: '#00B2A9' },
    ],
  },

  // ---- North America ----
  {
    id: 'bart',
    name: 'BART',
    continent: 'na',
    swatches: [
      { name: 'Yellow Line', color: '#FFE800' },
      { name: 'Blue Line', color: '#00AEEF' },
      { name: 'Green Line', color: '#4DB848' },
      { name: 'Red Line', color: '#ED1C24' },
      { name: 'Orange Line', color: '#FAA61A' },
    ],
  },
  {
    id: 'caltrain',
    name: 'Caltrain',
    continent: 'na',
    // Most actual Caltrain service-type colors are near-white and unusable
    // as line strokes; we use brand-adjacent colors for the three tiers.
    swatches: [
      { name: 'Express (Red)', color: '#E31837' },
      { name: 'Limited (Teal)', color: '#94DFE2' },
      { name: 'Local (Gray)', color: '#808080' },
    ],
  },
  {
    id: 'cta',
    name: 'CTA',
    continent: 'na',
    swatches: [
      { name: 'Red', color: '#C60C30' },
      { name: 'Blue', color: '#00A1DE' },
      { name: 'Brown', color: '#62361B' },
      { name: 'Green', color: '#009B3A' },
      { name: 'Orange', color: '#F9461C' },
      { name: 'Pink', color: '#E27EA6' },
      { name: 'Purple', color: '#522398' },
      { name: 'Yellow', color: '#F9E300' },
    ],
  },
  {
    id: 'la-metro',
    name: 'LA Metro',
    continent: 'na',
    swatches: [
      { name: 'A Line', color: '#0072BC' },
      { name: 'B Line', color: '#E3131B' },
      { name: 'C Line', color: '#58A738' },
      { name: 'D Line', color: '#A05DA5' },
      { name: 'E Line', color: '#F7B618' },
      { name: 'K Line', color: '#E96BB0' },
    ],
  },
  {
    id: 'mbta',
    name: 'MBTA',
    continent: 'na',
    swatches: [
      { name: 'Red', color: '#DA291C' },
      { name: 'Orange', color: '#ED8B00' },
      { name: 'Blue', color: '#003DA5' },
      { name: 'Green', color: '#00843D' },
      { name: 'Silver', color: '#7C878E' },
    ],
  },
  {
    id: 'mta',
    name: 'MTA',
    continent: 'na',
    // Official MTA NYC subway line trunk colors. Per the MTA developer
    // resources / NYC Subway nomenclature: each service's color corresponds
    // to the trunk line it primarily uses below 60th Street in Manhattan.
    swatches: [
      { name: 'Blue (A·C·E)', color: '#0039A6' },
      { name: 'Orange (B·D·F·M)', color: '#FF6319' },
      { name: 'Lime (G)', color: '#6CBE45' },
      { name: 'Gray (L)', color: '#A7A9AC' },
      { name: 'Brown (J·Z)', color: '#996633' },
      { name: 'Yellow (N·Q·R·W)', color: '#FCCC0A' },
      { name: 'Red (1·2·3)', color: '#EE352E' },
      { name: 'Green (4·5·6)', color: '#00933C' },
      { name: 'Purple (7)', color: '#B933AD' },
      { name: 'Turquoise (T)', color: '#00ADD0' },
      { name: 'Dark Gray (S)', color: '#808183' },
    ],
  },
  {
    id: 'muni',
    name: 'MUNI',
    continent: 'na',
    swatches: [
      { name: 'J Church', color: '#E18813' },
      { name: 'K Ingleside', color: '#549DBF' },
      { name: 'L Taraval', color: '#932290' },
      { name: 'M Ocean View', color: '#008851' },
      { name: 'N Judah', color: '#004988' },
      { name: 'T Third Street', color: '#D40843' },
      { name: 'S Shuttle', color: '#FFCC00' },
    ],
  },
  {
    id: 'wmata',
    name: 'WMATA',
    continent: 'na',
    swatches: [
      { name: 'Red', color: '#E51636' },
      { name: 'Orange', color: '#F68712' },
      { name: 'Yellow', color: '#FCD006' },
      { name: 'Green', color: '#0FAB4B' },
      { name: 'Blue', color: '#1574C4' },
      { name: 'Silver', color: '#9D9F9C' },
    ],
  },
] as const;

// The single source of truth for "which built-in palette ids exist". Custom
// palettes live in a separate store, so resolution takes the active custom
// palettes as an explicit argument rather than this module reaching into state.
export const KNOWN_PALETTE_IDS = new Set<string>(PALETTES.map((p) => p.id));

// Resolve active ids to palette objects: active custom palettes first (in the
// order supplied), then active built-ins in canonical (PALETTES) order. Ids that
// match neither a custom palette nor a built-in are dropped. Because a custom id
// can never collide with a built-in id (see makeCustomPaletteId), the result is
// already deduplicated.
function orderedActive(active: readonly PaletteId[], custom: readonly Palette[]): Palette[] {
  const set = new Set(active);
  const customHits = custom.filter((p) => set.has(p.id));
  const builtinHits = PALETTES.filter((p) => set.has(p.id));
  return [...customHits, ...builtinHits];
}

/**
 * Dedupe + drop ids that are neither a built-in nor a supplied custom palette,
 * returning custom-first then canonical (PALETTES) order. The storage normaliser
 * for `MapDoc.activePalettes`.
 */
export function normalizePaletteIds(
  ids: readonly PaletteId[],
  custom: readonly Palette[] = [],
): PaletteId[] {
  return orderedActive(ids, custom).map((p) => p.id);
}

/**
 * Return the active palettes — custom first, then built-ins in canonical order —
 * silently dropping ids that resolve to neither.
 */
export function activePalettes(
  active: readonly PaletteId[],
  custom: readonly Palette[],
): Palette[] {
  return orderedActive(active, custom);
}

/**
 * Flat list of colors from the active palettes (custom first) — used by
 * `addLine` to auto-pick the next color.
 */
export function cyclingColors(active: readonly PaletteId[], custom: readonly Palette[]): string[] {
  return activePalettes(active, custom).flatMap((p) => p.swatches.map((s) => s.color));
}

// Fallback line color when the active palettes yield no colors at all (e.g. every
// active id is a dangling custom reference). Keeps `addLine` from selecting
// `undefined` out of an empty cycle.
export const FALLBACK_LINE_COLOR = '#888888';
