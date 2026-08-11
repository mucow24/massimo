import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderDocArmed, setRenderDocOverlay, useRenderDoc } from './renderDoc';
import { useDoc } from './store';
import { DEFAULT_DOC } from '../model/transforms';

// The render-source contract: a perfect mirror at rest, a frozen frame while
// armed. The canvas paints from here, so "armed live writes don't notify" is
// the equality-bail the worker pipeline's liveness win depends on, and
// "every exit disarms" is what keeps a canceled drag from stranding a stale
// frame — both pinned below.

describe('useRenderDoc', () => {
  beforeEach(() => {
    setRenderDocOverlay(null);
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
  });

  afterEach(() => {
    setRenderDocOverlay(null);
  });

  it('mirrors the live doc at rest — same references, every write notifies', () => {
    const id = useDoc.getState().addStation(10, 20);
    // Same object, not a copy: selector/memo identity semantics must be
    // indistinguishable from reading useDoc directly.
    expect(useRenderDoc.getState().stations).toBe(useDoc.getState().stations);
    let notified = 0;
    const unsub = useRenderDoc.subscribe(() => notified++);
    useDoc.getState().moveStation(id, 30, 40);
    expect(notified).toBe(1);
    expect(useRenderDoc.getState().stations[id].x).toBe(30);
    unsub();
  });

  it('serves the armed overlay instead of the live doc, and live writes stop notifying', () => {
    const id = useDoc.getState().addStation(0, 0);
    const laggedStations = useDoc.getState().stations; // frame N-1's snapshot
    useDoc.getState().moveStation(id, 100, 0); // the doc runs ahead to frame N

    setRenderDocOverlay({
      stations: laggedStations,
      lineCircles: useDoc.getState().lineCircles,
      polygons: useDoc.getState().polygons,
      svgImages: useDoc.getState().svgImages,
      routeBullets: useDoc.getState().routeBullets,
      textLabels: useDoc.getState().textLabels,
      transferAnchors: useDoc.getState().transferAnchors,
      guides: useDoc.getState().guides,
    });
    expect(renderDocArmed()).toBe(true);
    // The canvas sees the lagged frame…
    expect(useRenderDoc.getState().stations[id].x).toBe(0);
    // …and further live writes produce ZERO notifications while armed — the
    // equality-bail that keeps 60-125Hz pointermoves from re-rendering a
    // canvas that is showing frame N-1.
    let notified = 0;
    const unsub = useRenderDoc.subscribe(() => notified++);
    useDoc.getState().moveStation(id, 200, 0);
    useDoc.getState().moveStation(id, 300, 0);
    expect(notified).toBe(0);
    expect(useRenderDoc.getState().stations[id].x).toBe(0);
    unsub();
  });

  it('non-overlaid fields keep reading through from the live doc', () => {
    useDoc.getState().addStation(0, 0);
    setRenderDocOverlay({
      stations: useDoc.getState().stations,
      lineCircles: useDoc.getState().lineCircles,
      polygons: useDoc.getState().polygons,
      svgImages: useDoc.getState().svgImages,
      routeBullets: useDoc.getState().routeBullets,
      textLabels: useDoc.getState().textLabels,
      transferAnchors: useDoc.getState().transferAnchors,
      guides: useDoc.getState().guides,
    });
    // Fields outside the seven towed collections come from the doc as of the
    // overlay set — the frame's own base.
    expect(useRenderDoc.getState().lines).toBe(useDoc.getState().lines);
    expect(useRenderDoc.getState().name).toBe(useDoc.getState().name);
  });

  it('disarming snaps back to the live doc and resumes notifications', () => {
    const id = useDoc.getState().addStation(0, 0);
    const lagged = useDoc.getState().stations;
    useDoc.getState().moveStation(id, 50, 0);
    setRenderDocOverlay({
      stations: lagged,
      lineCircles: useDoc.getState().lineCircles,
      polygons: useDoc.getState().polygons,
      svgImages: useDoc.getState().svgImages,
      routeBullets: useDoc.getState().routeBullets,
      textLabels: useDoc.getState().textLabels,
      transferAnchors: useDoc.getState().transferAnchors,
      guides: useDoc.getState().guides,
    });

    setRenderDocOverlay(null);
    expect(renderDocArmed()).toBe(false);
    // The disarm itself re-bases on the CURRENT doc — no stale frame survives
    // a gesture exit, canceled or committed.
    expect(useRenderDoc.getState().stations[id].x).toBe(50);
    expect(useRenderDoc.getState().stations).toBe(useDoc.getState().stations);
    let notified = 0;
    const unsub = useRenderDoc.subscribe(() => notified++);
    useDoc.getState().moveStation(id, 60, 0);
    expect(notified).toBe(1);
    unsub();
  });
});
