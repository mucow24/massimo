// The palettes-button mark: Ionicons' `color-palette-outline` (MIT), inlined
// rather than pulled in as a dependency for a single glyph.
//
// Authored in Ionicons' 512×512 box and rendered at 17×17, a notch above the
// 15×15 @radix-ui/react-icons the rest of the toolbar uses: this mark carries
// five paint wells inside an outline, so at 15px the interior detail crowds.
// The 26px button still leaves 4.5px of margin at 17, so it reads as one of the
// set rather than as an outsized button.
//
// Stroked and filled in `currentColor`, so callers control the color the same
// way they do for the Radix icons.

/** Toolbar palette icon, sized to sit with the Radix icons beside it. */
export function PaletteGlyph() {
  return (
    <svg
      width={17}
      height={17}
      viewBox="0 0 512 512"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {/* The palette board */}
      <path
        d="M430.11,347.9c-6.6-6.1-16.3-7.6-24.6-9-11.5-1.9-15.9-4-22.6-10-14.3-12.7-14.3-31.1,0-43.8l30.3-26.9c46.4-41,46.4-108.2,0-149.2-34.2-30.1-80.1-45-127.8-45-55.7,0-113.9,20.3-158.8,60.1-83.5,73.8-83.5,194.7,0,268.5,41.5,36.7,97.5,55,152.9,55.4h1.7c55.4,0,110-17.9,148.8-52.4C444.41,382.9,442,359,430.11,347.9Z"
        fill="none"
        stroke="currentColor"
        strokeMiterlimit={10}
        strokeWidth={32}
      />
      {/* The paint wells, pulled in from Ionicons' r=32/48 to r=29/42: at this
          size the source radii leave the wells close enough to the board's
          inner edge — and to each other — that the whole mark reads as one busy
          blob. The large well stays the largest, so the size hierarchy that
          anchors the eye survives the trim. */}
      <g fill="currentColor">
        <circle cx={144} cy={208} r={29} />
        <circle cx={152} cy={311} r={29} />
        <circle cx={224} cy={144} r={29} />
        <circle cx={256} cy={367} r={42} />
        <circle cx={328} cy={144} r={29} />
      </g>
    </svg>
  );
}
