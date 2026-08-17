import { useDoc } from '../../state/store';
import { useCustomLineColors } from '../../state/customLineColors';
import { ColorField } from '../ColorField';
import { normalizeHex } from '../../util/color';
import { isLinePalette } from '../../model/palettes';
import type { SwatchRef } from '../../model/types';

export function ColorPalette({
  value,
  onChange,
}: {
  value: string;
  /** A swatch click hands over its ref; a custom pick hands none (detach). */
  onChange: (c: string, ref?: SwatchRef) => void;
}) {
  // Line palettes only: design palettes hold decoration colors, and their
  // swatches are never line identities.
  const palettes = useDoc((s) => s.palettes).filter(isLinePalette);
  // Every distinct line color that isn't a swatch in one of the map's palettes
  // — the contents of the always-present "Custom" section.
  const customColors = useCustomLineColors();
  // Normalize both sides so matching ignores case and a spurious opaque `ff`
  // (a translucent color is intentionally never a swatch hit).
  const v = normalizeHex(value);

  return (
    <div className="color-palette">
      {palettes.map((palette, i) => (
        <div key={palette.name} className="color-palette-section">
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
                onClick={() => onChange(p.color, { palette: palette.name, swatch: p.name })}
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
