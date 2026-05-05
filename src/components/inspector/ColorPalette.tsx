import { MTA_PALETTE } from '../../state/store';
import { useFieldHistory } from '../useFieldHistory';

export function ColorPalette({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  const v = value.toLowerCase();
  const isCustom = !MTA_PALETTE.some((p) => p.color.toLowerCase() === v);
  const customField = useFieldHistory();
  const swatchBase: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: 3,
    cursor: 'pointer',
    padding: 0,
    boxSizing: 'border-box',
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {MTA_PALETTE.map((p) => {
        const selected = v === p.color.toLowerCase();
        return (
          <button
            key={p.color}
            type="button"
            title={p.name}
            onClick={() => onChange(p.color)}
            style={{
              ...swatchBase,
              background: p.color,
              border: selected ? '2px solid #000' : '1px solid rgba(0,0,0,0.2)',
            }}
          />
        );
      })}
      <label
        title={isCustom ? `Custom (${value})` : 'Custom'}
        style={{
          ...swatchBase,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
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
