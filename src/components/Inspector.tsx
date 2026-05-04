import { MTA_PALETTE, useDoc, useSelection } from '../state/store';
import type { LineId, StationId } from '../state/types';

export function Inspector() {
  const selection = useSelection();
  // While appending to a line, the line inspector is sticky — even if a
  // station gets selected (e.g. via the sidebar), the line editor stays open.
  if (selection.appendingToLineId) return <LineInspector id={selection.appendingToLineId} />;
  if (selection.selectedStationId) return <StationInspector id={selection.selectedStationId} />;
  if (selection.selectedLineId) return <LineInspector id={selection.selectedLineId} />;
  return null;
}

function StationInspector({ id }: { id: StationId }) {
  const station = useDoc((s) => s.stations[id]);
  const lines = useDoc((s) => s.lines);
  const renameStation = useDoc((s) => s.renameStation);
  const rotateStation = useDoc((s) => s.rotateStation);
  const reorderStops = useDoc((s) => s.reorderStops);
  const moveStation = useDoc((s) => s.moveStation);

  if (!station) return null;

  const moveStop = (idx: number, dir: -1 | 1) => {
    const ord = [...station.stopOrder];
    const j = idx + dir;
    if (j < 0 || j >= ord.length) return;
    [ord[idx], ord[j]] = [ord[j], ord[idx]];
    reorderStops(station.id, ord);
  };

  return (
    <section className="inspector">
      <h2>Station</h2>
      <div className="field">
        <label>Name</label>
        <input
          type="text"
          value={station.name}
          onChange={(e) => renameStation(station.id, e.target.value)}
        />
      </div>
      <div className="field">
        <label>Position</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="number"
            value={Math.round(station.x)}
            onChange={(e) => moveStation(station.id, Number(e.target.value), station.y)}
            style={{ width: 70 }}
          />
          <input
            type="number"
            value={Math.round(station.y)}
            onChange={(e) => moveStation(station.id, station.x, Number(e.target.value))}
            style={{ width: 70 }}
          />
        </div>
      </div>
      <div className="field">
        <label>Rotation: {station.rotation * 45}°</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-mini" onClick={() => rotateStation(station.id)}>
            Rotate +45°
          </button>
          <button
            className="btn-mini"
            onClick={() => {
              // -45° = +7
              for (let i = 0; i < 7; i++) rotateStation(station.id);
            }}
          >
            Rotate −45°
          </button>
          <button
            className="btn-mini"
            onClick={() => {
              // reset to 0 by rotating to (8 - r) % 8 times.
              const need = (8 - station.rotation) % 8;
              for (let i = 0; i < need; i++) rotateStation(station.id);
            }}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="field">
        <label>Stop order (left → right at 0° rotation)</label>
        {station.stopOrder.length === 0 && <div className="empty">No lines stop here yet.</div>}
        {station.stopOrder.map((lid, i) => {
          const ln = lines[lid];
          if (!ln) return null;
          return (
            <div key={lid} className="list-row" style={{ paddingLeft: 0 }}>
              <span className="swatch" style={{ background: ln.color }} />
              <strong style={{ width: 28 }}>{ln.service}</strong>
              <span className="grow">{i}</span>
              <button className="btn-mini" disabled={i === 0} onClick={() => moveStop(i, -1)}>↑</button>
              <button
                className="btn-mini"
                disabled={i === station.stopOrder.length - 1}
                onClick={() => moveStop(i, 1)}
              >↓</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ColorPalette({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const v = value.toLowerCase();
  const isCustom = !MTA_PALETTE.some((p) => p.color.toLowerCase() === v);
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

function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const updateLine = useDoc((s) => s.updateLine);
  const removeStationFromLine = useDoc((s) => s.removeStationFromLine);
  const reorderLineStations = useDoc((s) => s.reorderLineStations);
  const selection = useSelection();

  if (!line) return null;

  const moveSt = (idx: number, dir: -1 | 1) => {
    const arr = [...line.stations];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    reorderLineStations(line.id, arr);
  };

  const isAppending = selection.appendingToLineId === line.id;

  return (
    <section className="inspector">
      <h2>Line</h2>
      <div className="field">
        <label>Service code</label>
        <input
          type="text"
          maxLength={3}
          value={line.service}
          onChange={(e) => updateLine(line.id, { service: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="field">
        <label>Color</label>
        <ColorPalette
          value={line.color}
          onChange={(c) => updateLine(line.id, { color: c })}
        />
      </div>
      <div className="field">
        <label>Stations ({line.stations.length})</label>
        {line.stations.length === 0 && (
          <button
            className="btn-mini"
            onClick={() => selection.startAppendAt(line.id, -1)}
            style={
              isAppending
                ? { background: line.color, color: '#fff', borderColor: line.color }
                : undefined
            }
          >
            {isAppending ? 'Stop adding' : 'Add stations from map'}
          </button>
        )}
        {line.stations.map((sid, i) => {
          const st = stations[sid];
          if (!st) return null;
          const isActiveCursor = isAppending && selection.insertAfterIndex === i;
          return (
            <div key={i + ':' + sid}>
              <div className="list-row" style={{ paddingLeft: 0 }}>
                <span style={{ width: 18, color: '#999' }}>{i + 1}.</span>
                <span className="grow">{st.name}</span>
                <button className="btn-mini" disabled={i === 0} onClick={() => moveSt(i, -1)}>↑</button>
                <button
                  className="btn-mini"
                  disabled={i === line.stations.length - 1}
                  onClick={() => moveSt(i, 1)}
                >↓</button>
                {isActiveCursor ? (
                  <button
                    className="btn-mini"
                    onClick={() => selection.setAppending(null)}
                    style={{ background: line.color, color: '#fff', borderColor: line.color }}
                    title="Stop adding stations"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    className="btn-mini"
                    onClick={() => selection.startAppendAt(line.id, i)}
                    title={`Insert stations after ${st.name}`}
                  >
                    +
                  </button>
                )}
                <button className="btn-mini danger" onClick={() => removeStationFromLine(line.id, i)}>×</button>
              </div>
              {isActiveCursor && (
                <div
                  style={{
                    height: 3,
                    background: line.color,
                    margin: '2px 0',
                    borderRadius: 1.5,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
