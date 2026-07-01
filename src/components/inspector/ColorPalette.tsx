import { useDoc } from '../../state/store';
import { useCustomPalettes } from '../../state/customPalettes';
import { activePalettes as activePalettesOf } from '../../model/palettes';
import { useFieldHistory } from '../useFieldHistory';

export function ColorPalette({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  const activeIds = useDoc((s) => s.activePalettes);
  const custom = useCustomPalettes((s) => s.palettes);
  const palettes = activePalettesOf(activeIds, custom);
  const v = value.toLowerCase();
  // `isCustom` is computed against the ACTIVE palettes only. A line whose
  // stored color isn't in any visible swatch group is shown as the custom
  // value (so the user can see and replace it). Toggling a palette that
  // contains that color flips it back to a regular swatch hit.
  const isCustom = !palettes.some((p) => p.swatches.some((s) => s.color.toLowerCase() === v));
  const customField = useFieldHistory();

  return (
    <div className="color-palette">
      {palettes.map((palette, i) => (
        <div key={palette.id} className="color-palette-section">
          <div
            className="color-palette-section-label"
            style={i === 0 ? { marginTop: 0 } : undefined}
          >
            {palette.name}
          </div>
          <div className="color-palette-row">
            {palette.swatches.map((p, si) => (
              <button
                key={si}
                type="button"
                className={'color-swatch' + (v === p.color.toLowerCase() ? ' selected' : '')}
                title={p.name}
                onClick={() => onChange(p.color)}
                style={{ background: p.color }}
              />
            ))}
          </div>
        </div>
      ))}
      <label
        title={isCustom ? `Custom (${value})` : 'Custom'}
        className={'color-swatch custom' + (isCustom ? ' selected' : '')}
        style={{
          // Containing block for the absolutely-positioned native color input
          // below. Kept inline (not in the .custom class) because the scroll-
          // containment regression test asserts it via getComputedStyle, which
          // doesn't see stylesheet rules in jsdom. Without it the input is
          // positioned against the page, and its static offset (deep inside a
          // scrolled line inspector) stretches the document, adding a spurious
          // window scrollbar on line selection.
          position: 'relative',
          background: isCustom ? value : undefined,
        }}
      >
        ?
        <input
          type="color"
          aria-label="Custom color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...customField}
          style={{
            position: 'absolute',
            width: 0,
            height: 0,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      </label>
    </div>
  );
}
