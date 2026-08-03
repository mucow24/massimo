import type { SeamEdges } from '../model/types';
import { SegmentedToggle } from './SegmentedToggle';

/**
 * What the LINE EDITORS offer for "Inner strokes": the three arms of a branch
 * notch plus 'none'. The model has no fourth mode — 'none' is the editors' name
 * for the seam being OFF (an unset/transparent seam color), which they write
 * instead of a `seamEdges` value. See LineInspector for the full reading.
 */
export type InnerStrokesMode = SeamEdges | 'none';

// Editor order, and the arms under their user-facing names: 'curved' is the
// BRANCH's own stroke curling in, 'straight' the MAINLINE's carrying on
// through. A parallel list to the model's SEAM_EDGES_MODES rather than a
// derivation of it — this one reorders and adds the editor-only 'none' — so a
// new mode has to be added in both places.
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
export function InnerStrokesGlyph({ mode }: { mode: InnerStrokesMode }) {
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
 * The "Inner strokes" control, shared VERBATIM by the line inspector and the
 * line style editor so the two read alike: the arms under their user-facing
 * names, with an explicit OFF segment in front. Both editors show it only while
 * there IS a stroke to draw the seam with, and both spell 'none' as a cleared
 * seam color — the control itself knows nothing of either.
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
        content: <InnerStrokesGlyph mode={mode} />,
      }))}
    />
  );
}
