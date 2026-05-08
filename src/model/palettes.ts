// Color palettes available to the line editor. The active set is stored
// per-document on `MapDoc.activePalettes`, with the invariant that at least
// one palette must always be active (enforced in transforms).

export type PaletteId = 'mta' | 'bart' | 'caltrain';

export interface PaletteSwatch {
  name: string;
  color: string;
}

export interface Palette {
  id: PaletteId;
  name: string;
  swatches: PaletteSwatch[];
}

// Order here is the canonical declaration order — used for storage normalisation,
// UI section order, and the addLine auto-cycle order.
export const PALETTES: readonly Palette[] = [
  {
    id: 'mta',
    name: 'MTA',
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
    id: 'bart',
    name: 'BART',
    // Bay Area Rapid Transit line colors. Source: Wikipedia BART module.
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
    // Caltrain's actual service-type colors are mostly near-white and unusable
    // as line strokes; we use brand-adjacent colors for the three service tiers.
    swatches: [
      { name: 'Express (Red)', color: '#E31837' },
      { name: 'Limited (Teal)', color: '#94DFE2' },
      { name: 'Local (Gray)', color: '#808080' },
    ],
  },
] as const;

const KNOWN_IDS = new Set<PaletteId>(PALETTES.map((p) => p.id));

/**
 * Return the active palettes in canonical (PALETTES) declaration order,
 * silently dropping unknown ids.
 */
export function activePalettes(active: readonly PaletteId[]): Palette[] {
  const set = new Set(active.filter((id) => KNOWN_IDS.has(id)));
  return PALETTES.filter((p) => set.has(p.id));
}

/**
 * Flat list of colors from the active palettes in canonical declaration
 * order — used by `addLine` to auto-pick the next color.
 */
export function cyclingColors(active: readonly PaletteId[]): string[] {
  return activePalettes(active).flatMap((p) => p.swatches.map((s) => s.color));
}
