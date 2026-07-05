import { useDoc } from '../../state/store';
import { useCustomPalettes } from '../../state/customPalettes';
import { activePalettes as activePalettesOf } from '../../model/palettes';
import { ColorField } from '../ColorField';
import { normalizeHex } from '../../util/color';

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
  // Normalize both sides so matching ignores case and a spurious opaque `ff`
  // (a translucent color is intentionally never a swatch hit).
  const v = normalizeHex(value);
  // `isCustom` is computed against the ACTIVE palettes only. A line whose
  // stored color isn't in any visible swatch group is shown as the custom
  // value (so the user can see and replace it). Toggling a palette that
  // contains that color flips it back to a regular swatch hit.
  const isCustom = !palettes.some((p) => p.swatches.some((s) => normalizeHex(s.color) === v));

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
                className={'color-swatch' + (v === normalizeHex(p.color) ? ' selected' : '')}
                title={p.name}
                onClick={() => onChange(p.color)}
                style={{ background: p.color }}
              />
            ))}
          </div>
        </div>
      ))}
      {/* The custom slot: a react-colorful RGBA picker replacing the old hidden
          native <input type=color>. Shows the current custom color and marks
          itself selected when the value isn't in any active palette. */}
      <ColorField
        value={value}
        onChange={onChange}
        ariaLabel="Custom color"
        title={isCustom ? `Custom (${value})` : 'Custom'}
        className={'palette-custom' + (isCustom ? ' selected' : '')}
      />
    </div>
  );
}
