import { useDebugHighlight } from '../state/debugHighlightStore';

export function DebugHighlightPanel() {
  const s = useDebugHighlight();

  const row: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '110px auto 1fr 40px',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
  };

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        padding: 10,
        width: 320,
        zIndex: 1000,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 6 }}>Selection highlight</div>

      <div style={row}>
        <label>Dim color</label>
        <input
          type="color"
          value={s.dimColor}
          onChange={(e) => s.set('dimColor', e.target.value)}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={s.dimAlpha}
          onChange={(e) => s.set('dimAlpha', Number(e.target.value))}
        />
        <span>{s.dimAlpha.toFixed(2)}</span>
      </div>

      <div style={row}>
        <label>Other-line sat</label>
        <span />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={s.desaturate}
          onChange={(e) => s.set('desaturate', Number(e.target.value))}
        />
        <span>{s.desaturate.toFixed(2)}</span>
      </div>
    </div>
  );
}
