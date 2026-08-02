import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line } from '../model/types';

/**
 * A station MOVE must re-render the moved station and nothing else.
 *
 * `StationView` is memo'd, but memo cannot stop a store subscription reached
 * from inside it — and `useStopMetrics` is exactly that, called by
 * `StationHitArea`, `StationLabel` and `StationSilhouette`. Subscribing it to
 * `stations` therefore re-rendered every station on the map on every
 * pointermove of a drag, for output that could not have changed. The fix is
 * that `stopMetricsOf` is reference-stable across a content-equal rebuild, so
 * zustand's `Object.is` bail-out holds; this pins the OUTCOME rather than the
 * mechanism, so any future re-plumbing that reintroduces the churn fails here.
 *
 * Probe: `labelLayoutLocal`, which both the hit area and the label run once per
 * render. The mock wraps the real function — output is unchanged, only the call
 * count is observed. This is the same shape as `Sidebar.decoupling.test.tsx`.
 */

const calls = vi.hoisted(() => ({ layout: 0 }));

vi.mock('../geometry/labelLayout', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../geometry/labelLayout')>();
  return {
    ...mod,
    labelLayoutLocal: (...args: Parameters<typeof mod.labelLayoutLocal>) => {
      calls.layout += 1;
      return mod.labelLayoutLocal(...args);
    },
  };
});

// A line with real topology, so `continues` has something to say and the test
// can distinguish "a move that changes nothing" from "a move that does".
const IDS = ['a', 'b', 'c', 'd', 'e'] as const;
const lines: Record<string, Line> = { L1: makeLine({ id: 'L1', stations: [...IDS] }) };

beforeEach(() => {
  calls.layout = 0;
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
  useDoc.setState({
    ...useDoc.getState(),
    ...makeDoc({
      lines: [lines.L1],
      stations: IDS.map((id, i) =>
        makeStation({
          id,
          name: id.toUpperCase(),
          x: i * 100,
          y: 0,
          stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
        }),
      ),
    }),
  });
});

const noop = () => {};

/** The station's hit-layer markup. Throws rather than returning undefined, so a
 *  selector that stops matching fails loudly instead of comparing nothing to
 *  nothing and passing. */
function hitHtml(container: HTMLElement, id: string): string {
  const el = container.querySelector(`[data-station-hit="${id}"]`);
  if (!el) throw new Error(`no hit layer rendered for station ${id}`);
  return el.outerHTML;
}

function renderAll() {
  const Tree = () => {
    const stations = useDoc((s) => s.stations);
    return (
      <svg>
        {Object.values(stations).map((st) => (
          <StationView
            key={`${st.id}-hit`}
            station={st}
            lines={lines}
            zoom={1}
            onStartDrag={noop}
            layer="hit"
          />
        ))}
        {Object.values(stations).map((st) => (
          <StationView
            key={`${st.id}-label`}
            station={st}
            lines={lines}
            zoom={1}
            onStartDrag={noop}
            layer="label"
          />
        ))}
      </svg>
    );
  };
  return render(<Tree />);
}

describe('<StationView /> — a station move re-renders only that station', () => {
  it('a mid-drag move costs one station’s worth of layout, not the map’s', () => {
    renderAll();
    const initial = calls.layout;
    expect(initial).toBeGreaterThanOrEqual(IDS.length); // both layers, 5 stations

    calls.layout = 0;
    // 'c' slides a little: no stop cell moves, no neighbour crosses it.
    act(() => {
      useDoc.getState().moveStation('c', 203, 4);
    });

    // Only 'c' re-renders: its hit area and its label. Before the fix this was
    // every station on the map, both layers — 10 here, ~930 on a real map.
    expect(calls.layout).toBeGreaterThan(0);
    expect(calls.layout).toBeLessThanOrEqual(2);
  });

  it('several successive drag frames stay flat', () => {
    renderAll();
    calls.layout = 0;
    for (let i = 1; i <= 5; i++) {
      act(() => {
        useDoc.getState().moveStation('c', 200 + i * 3, i * 2);
      });
    }
    expect(calls.layout).toBeLessThanOrEqual(10); // ≤2 per frame
  });

  it('…but a move that changes what a NEIGHBOUR sees re-renders it too', () => {
    renderAll();
    calls.layout = 0;
    // Drag 'a' (the terminus) across 'b': b's minus side loses its body, so b's
    // label geometry genuinely changes and it MUST re-render.
    act(() => {
      useDoc.getState().moveStation('a', 500, 0);
    });
    expect(calls.layout).toBeGreaterThan(2);
  });

  it('the moved station’s own DOM actually updates', () => {
    const { container } = renderAll();
    const before = hitHtml(container, 'c');
    act(() => {
      useDoc.getState().moveStation('c', 260, 40);
    });
    expect(hitHtml(container, 'c')).not.toBe(before);
  });

  it('an untouched station’s DOM is byte-identical across a move', () => {
    const { container } = renderAll();
    const before = hitHtml(container, 'e');
    act(() => {
      useDoc.getState().moveStation('c', 203, 4);
    });
    expect(hitHtml(container, 'e')).toBe(before);
  });
});
