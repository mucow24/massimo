import type { SeamEdges } from '../model/types';
import { SEAM_EDGES_MODES } from '../model/lineStroke';
import { SegmentedToggle } from './SegmentedToggle';

const SEAM_EDGES_LABELS: Record<SeamEdges, string> = {
  both: 'Both',
  straight: 'Straight',
  curved: 'Curved',
};

const SEAM_EDGES_TITLES: Record<SeamEdges, string> = {
  both: 'Both — the full notch, every edge that meets at the branch',
  straight: 'Straight — the main line runs on through, its stroke unbroken across the branch',
  curved: 'Curved — the branch carries its own stroke into the junction',
};

/**
 * What the LINE INSPECTOR offers for "Inner strokes": the three arms plus
 * 'none'. The model has no fourth mode — 'none' is the editor's name for the
 * seam being OFF (an unset/transparent `Line.seamColor`), which the inspector
 * writes instead of a `seamEdges` value. See LineInspector.
 */
export type InnerStrokesMode = SeamEdges | 'none';

// Editor order for the inspector's four-way, and the arms under their
// user-facing names: 'curved' is the BRANCH's own stroke curling in, 'straight'
// the MAINLINE's carrying on through.
const INNER_STROKES_MODES = ['none', 'curved', 'straight', 'both'] as const;

const INNER_STROKES_LABELS: Record<InnerStrokesMode, string> = {
  none: 'None',
  curved: 'Branch',
  straight: 'Mainline',
  both: 'Both',
};

const INNER_STROKES_TITLES: Record<InnerStrokesMode, string> = {
  none: 'None — the junction stays merged, with no stroke drawn through it',
  curved: 'Branch — the branch carries its own stroke into the junction',
  straight: 'Mainline — the main line runs on through, its stroke unbroken across the branch',
  both: 'Both — the full notch, every edge that meets at the branch',
};

// The notch at a branch is two arms: the line running STRAIGHT through, and the
// one that TURNS away. So the glyph is the junction itself — a through-run with
// a branch curving into it — with the arm this mode drops drawn faint: the
// shape stays put across the segments and only the kept ink moves, which is
// exactly the choice being made ('none' drops both arms). Same
// one-stroke-tells-the-story idea as LineEndGlyph, and the same 15px box.
export function SeamEdgesGlyph({ mode }: { mode: InnerStrokesMode }) {
  const through = 'M 11 1 L 11 14';
  const branch = 'M 1 11 L 4 11 A 7 7 0 0 0 11 4';
  const faint = 0.25;
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" aria-hidden="true" style={{ display: 'block' }}>
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="butt">
        <path d={through} opacity={mode === 'curved' || mode === 'none' ? faint : 1} />
        <path d={branch} opacity={mode === 'straight' || mode === 'none' ? faint : 1} />
      </g>
    </svg>
  );
}

/**
 * The branch inner-edge control for the LINE STYLE editor: a three-segment icon
 * group, one segment per mode. Sits with the seam width/color rows, whose seam
 * it picks arms of. Ungated, like those two: there the seam is switched on by
 * dragging its color's alpha up, so hiding its controls while it is off would
 * hide the way back on. The line inspector unifies those rows instead, and uses
 * {@link InnerStrokesSegmented} below.
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

/**
 * The line inspector's "Inner strokes" control: the same arms under their
 * user-facing names, with an explicit OFF segment in front. The inspector shows
 * it only while there IS a stroke to draw the seam with — unlike
 * {@link SeamEdgesSegmented}, which keeps the style editor's separate seam
 * color row beside it and so stays ungated.
 */
export function InnerStrokesSegmented({
  value,
  onSelect,
  ariaLabel = 'Inner strokes',
}: {
  value: InnerStrokesMode;
  onSelect: (mode: InnerStrokesMode) => void;
  ariaLabel?: string;
}) {
  return (
    <SegmentedToggle
      ariaLabel={ariaLabel}
      value={value}
      onSelect={(v) => onSelect(v as InnerStrokesMode)}
      options={INNER_STROKES_MODES.map((mode) => ({
        value: mode,
        label: INNER_STROKES_LABELS[mode],
        title: INNER_STROKES_TITLES[mode],
        content: <SeamEdgesGlyph mode={mode} />,
      }))}
    />
  );
}
