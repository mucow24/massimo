import { useDoc } from '../../state/store';
import { useCustomPalettes } from '../../state/customPalettes';
import { activePalettes as activePalettesOf } from '../../model/palettes';
import { useFieldHistory } from '../useFieldHistory';

const SWATCH_BASE: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 3,
  cursor: 'pointer',
  padding: 0,
  boxSizing: 'border-box',
};

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {palettes.map((palette, i) => (
        <div key={palette.id} className="color-palette-section">
          <div
            className="color-palette-section-label"
            style={i === 0 ? { marginTop: 0 } : undefined}
          >
            {palette.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {palette.swatches.map((p, si) => {
              const selected = v === p.color.toLowerCase();
              return (
                <button
                  key={si}
                  type="button"
                  title={p.name}
                  onClick={() => onChange(p.color)}
                  style={{
                    ...SWATCH_BASE,
                    background: p.color,
                    border: selected ? '2px solid #000' : '1px solid rgba(0,0,0,0.2)',
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
      <label
        title={isCustom ? `Custom (${value})` : 'Custom'}
        style={{
          ...SWATCH_BASE,
          // Containing block for the absolutely-positioned native color input
          // below. Without it the input is positioned against the page, and its
          // static offset (deep inside a scrolled line inspector) stretches the
          // document, adding a spurious window scrollbar on line selection.
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'flex-start',
          background: isCustom ? value : '#fff',
          border: isCustom ? '2px solid #000' : '1px dashed rgba(0,0,0,0.4)',
          fontSize: 12,
          color: isCustom ? '#fff' : '#666',
          fontWeight: 700,
          textShadow: isCustom ? '0 0 2px rgba(0,0,0,0.5)' : undefined,
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
