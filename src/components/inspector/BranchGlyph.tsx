// A downward junction glyph: a track heading down that also branches off to the
// right, both ending in an arrowhead — the "start a branch here" affordance.
// Shared by LineInspector's insert zones and StationGraph's junction markers;
// `size` is the only thing that varies between the two call sites.
export function BranchGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 1.5 V13" />
      <path d="M1.8 10.5 L4 13 L6.2 10.5" />
      <path d="M4 5 C 9 5, 11 6.5, 11.2 12" />
      <path d="M9 9.7 L11.2 12.2 L13.2 9.4" />
    </svg>
  );
}
