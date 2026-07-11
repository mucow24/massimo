import { useDoc } from '../../state/store';
import { useCustomPalettes } from '../../state/customPalettes';
import { activePalettes as activePalettesOf, customLineColors } from '../../model/palettes';
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
  const lines = useDoc((s) => s.lines);
  const custom = useCustomPalettes((s) => s.palettes);
  const palettes = activePalettesOf(activeIds, custom);
  // Every distinct line color that isn't a swatch in an active palette — the
  // contents of the always-present "Custom" section (see customLineColors).
  const customColors = customLineColors(
    Object.values(lines).map((l) => l.color),
    palettes,
  );
  // Normalize both sides so matching ignores case and a spurious opaque `ff`
  // (a translucent color is intentionally never a swatch hit).
  const v = normalizeHex(value);

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
      {/* The "Custom" palette: always present, containing every hand-picked line
          color in the map (those not in an active palette) followed by the
          new-custom-color picker — an "add" ColorField rendered as a rainbow
          `+` (never the current line color), always here even when there are no
          custom colors yet. */}
      <div className="color-palette-section">
        <div
          className="color-palette-section-label"
          style={palettes.length === 0 ? { marginTop: 0 } : undefined}
        >
          Custom
        </div>
        <div className="color-palette-row">
          {customColors.map((c) => {
            const n = normalizeHex(c);
            return (
              <button
                key={n}
                type="button"
                className={'color-swatch' + (v === n ? ' selected' : '')}
                title={c}
                onClick={() => onChange(c)}
                style={{ background: c }}
              />
            );
          })}
          <ColorField
            value={value}
            onChange={onChange}
            addNew
            ariaLabel="Custom color"
            title="New custom color"
            className="palette-custom"
          />
        </div>
      </div>
    </div>
  );
}
