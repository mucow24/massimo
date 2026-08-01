import { describe, it, expect } from 'vitest';
import {
  anyLayerHidden,
  exportVisibilityOverrides,
  VISIBILITY_ITEMS,
  type VisibilityKey,
} from './visibility';
import { useViewportStore } from './viewportStore';

/** The pristine defaults, as the registry's consumers see them. */
const defaults = (): Record<VisibilityKey, boolean> => {
  const init = useViewportStore.getInitialState();
  return Object.fromEntries(VISIBILITY_ITEMS.map((i) => [i.key, init[i.key]])) as Record<
    VisibilityKey,
    boolean
  >;
};

describe('visibility registry', () => {
  it('covers every show* flag the viewport store holds, exactly once', () => {
    // The whole point of the registry: a flag added to the store but not here
    // would silently miss the View menu AND the export force-on. This is the
    // check that makes forgetting loud.
    const storeFlags = Object.keys(useViewportStore.getInitialState())
      .filter((k) => k.startsWith('show'))
      .sort();
    const registryKeys = VISIBILITY_ITEMS.map((i) => i.key).sort();
    expect(registryKeys).toEqual(storeFlags);
    expect(new Set(registryKeys).size).toBe(registryKeys.length);
  });

  it('every flag has a setter on the store', () => {
    const state = useViewportStore.getState() as unknown as Record<string, unknown>;
    for (const item of VISIBILITY_ITEMS) {
      const setter = 'set' + item.key[0].toUpperCase() + item.key.slice(1);
      expect(typeof state[setter], `${setter} missing`).toBe('function');
    }
  });

  it('groups run in menu order, so a divider never splits a group in two', () => {
    const groups = VISIBILITY_ITEMS.map((i) => i.group);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });
});

describe('anyLayerHidden', () => {
  it('is false for the pristine defaults, even though anchors and waypoints are off', () => {
    // The trap a naive "some flag is false" rule falls into: showAnchors and
    // showWaypoints default to hidden, so that rule would mark a fresh app.
    const d = defaults();
    expect(d.showAnchors).toBe(false);
    expect(d.showWaypoints).toBe(false);
    expect(anyLayerHidden(d)).toBe(false);
  });

  it('is true when a normally-visible layer is hidden', () => {
    expect(anyLayerHidden({ ...defaults(), showPolygons: false })).toBe(true);
  });

  it('is FALSE with every box checked, revealed scaffolding included', () => {
    // The mark means "something you expect to see is missing". Turning ON a
    // reveal hides nothing, so a fully-checked menu must read clean — checking
    // every box and still seeing the mark is the bug this pins.
    const all = Object.fromEntries(VISIBILITY_ITEMS.map((i) => [i.key, true])) as Record<
      VisibilityKey,
      boolean
    >;
    expect(anyLayerHidden(all)).toBe(false);
  });

  it('ignores a revealed normally-hidden layer on its own', () => {
    expect(anyLayerHidden({ ...defaults(), showWaypoints: true })).toBe(false);
  });
});

describe('exportVisibilityOverrides', () => {
  it('asks for nothing when every layer is at its default', () => {
    const { apply, restore } = exportVisibilityOverrides(defaults());
    expect(apply).toEqual({});
    expect(restore).toEqual({});
  });

  it('forces on the flags that gate exported ink, and offers the undo', () => {
    const { apply, restore } = exportVisibilityOverrides({
      ...defaults(),
      showPolygons: false,
      showTransfers: false,
    });
    expect(apply).toEqual({ showTransfers: true, showPolygons: true });
    expect(restore).toEqual({ showTransfers: false, showPolygons: false });
  });

  it('leaves scaffolding flags alone — their layers are export-excluded anyway', () => {
    const { apply } = exportVisibilityOverrides({
      ...defaults(),
      showAnchors: false,
      showLineCircles: false,
    });
    expect(apply).toEqual({});
  });

  it('never forces waypoints on, which would ask for ink the export then strips', () => {
    // showWaypoints REVEALS hidden stations and their overlay carries
    // data-export-exclude (StationDots), so forcing it is pure churn at best
    // and misleading at worst.
    const { apply } = exportVisibilityOverrides({ ...defaults(), showWaypoints: true });
    expect(apply.showWaypoints).toBeUndefined();
  });
});
