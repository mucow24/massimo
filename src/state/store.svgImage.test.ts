import { describe, it, expect, beforeEach } from 'vitest';
import { beginHistoryGroup, useDoc } from './store';
import { undo } from './history';
import { DEFAULT_DOC } from '../model/transforms';
import { makeSvgImage } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('svg images participate in document history', () => {
  it('undo removes an added svg image', () => {
    // Behavioral guard on the DOC_FIELDS wiring: if svgImages/backgroundOrder are
    // not part of the tracked document snapshot, the change is invisible to
    // beginHistoryGroup's equality check, no history entry is pushed, and undo
    // is a no-op — so the image would survive the undo.
    const img = makeSvgImage({ id: 'i0' });
    const group = beginHistoryGroup();
    useDoc.setState((s) => ({
      svgImages: { ...s.svgImages, i0: img },
      backgroundOrder: [...s.backgroundOrder, 'i0'],
    }));
    group.commit();
    expect(useDoc.getState().svgImages.i0).toBeDefined();

    undo();
    expect(useDoc.getState().svgImages.i0).toBeUndefined();
    expect(useDoc.getState().backgroundOrder).toEqual([]);
  });
});

describe('svg-image store actions', () => {
  it('duplicateSvgImage offsets the center by the drop offset and drops the lock', () => {
    const img = makeSvgImage({ id: 'i0', x: 0, y: 0, locked: true });
    useDoc.setState({ svgImages: { i0: img }, backgroundOrder: ['i0'] });
    const newId = useDoc.getState().duplicateSvgImage('i0');
    expect(newId).not.toBeNull();
    if (!newId) return;
    const copy = useDoc.getState().svgImages[newId];
    expect(copy.x).toBe(15);
    expect(copy.y).toBe(15);
    expect(copy.locked).toBeUndefined();
    // Both originals + copy are in the paint order.
    expect(useDoc.getState().backgroundOrder).toEqual(['i0', newId]);
  });

  it('rotateSvgImage45 steps the rotation by 45° and normalizes', () => {
    useDoc.setState({
      svgImages: { i0: makeSvgImage({ id: 'i0', rotation: 340 }) },
      backgroundOrder: ['i0'],
    });
    useDoc.getState().rotateSvgImage45('i0');
    expect(useDoc.getState().svgImages.i0.rotation).toBe(25); // 340 + 45 = 385 → 25
  });
});
