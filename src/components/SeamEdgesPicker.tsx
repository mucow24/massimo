import type { SeamEdges } from '../model/types';
import { SEAM_EDGES_MODES } from '../model/lineStroke';
import { SegmentedToggle } from './SegmentedToggle';

export const SEAM_EDGES_LABELS: Record<SeamEdges, string> = {
  both: 'Both',
  straight: 'Straight',
  curved: 'Curved',
};

const SEAM_EDGES_TITLES: Record<SeamEdges, string> = {
  both: 'Both — the full notch, every piece of the seam edge',
  straight: 'Straight — only the straight runs, so the bend itself stays merged',
  curved: 'Curved — only the fillet arcs, hinting the branch at the corner alone',
};

// A seam edge is a mix of straight runs and fillet arcs, so the glyph is a
// single rounded corner with the pieces this mode DROPS drawn faint: the shape
// stays put across the three segments and only the kept ink moves, which is
// exactly the choice being made. Same one-stroke-tells-the-story idea as
// LineEndGlyph, and the same 15px box.
export function SeamEdgesGlyph({ mode }: { mode: SeamEdges }) {
  const legs = 'M 1.5 3.5 L 6 3.5 M 11 8.5 L 11 13.5';
  const arc = 'M 6 3.5 A 5 5 0 0 1 11 8.5';
  const faint = 0.25;
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" aria-hidden="true" style={{ display: 'block' }}>
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="butt">
        <path d={legs} opacity={mode === 'curved' ? faint : 1} />
        <path d={arc} opacity={mode === 'straight' ? faint : 1} />
      </g>
    </svg>
  );
}

/**
 * The branch inner-edge control for the two line editors (the line inspector
 * and the line style editor): a three-segment icon group, one segment per mode.
 * Sits with the seam width/color rows, whose seam it filters. Ungated, like
 * those two: the seam is switched on by dragging its color's alpha up, so
 * hiding its controls while it is off would hide the way back on.
 */
export function SeamEdgesSegmented({
  value,
  onSelect,
  ariaLabel = 'Branch inner edges',
}: {
  value: SeamEdges;
  onSelect: (mode: SeamEdges) => void;
  ariaLabel?: string;
}) {
  return (
    <SegmentedToggle
      ariaLabel={ariaLabel}
      value={value}
      onSelect={(v) => onSelect(v as SeamEdges)}
      options={SEAM_EDGES_MODES.map((mode) => ({
        value: mode,
        label: SEAM_EDGES_LABELS[mode],
        title: SEAM_EDGES_TITLES[mode],
        content: <SeamEdgesGlyph mode={mode} />,
      }))}
    />
  );
}
