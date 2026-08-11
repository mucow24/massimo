import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import App from '../App';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { VISIBILITY_ITEMS } from '../state/visibility';
import { DEFAULT_DOC } from '../model/transforms';
import { makeGuide, makeRouteBullet } from '../test/fixtures';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.getState().clearAllSelections();
  useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'idle' }, spaceHeld: false });
  const init = useViewportStore.getInitialState();
  useViewportStore.setState(Object.fromEntries(VISIBILITY_ITEMS.map((i) => [i.key, init[i.key]])));
});

const seed = () =>
  useDoc.setState({
    ...useDoc.getState(),
    guides: {
      gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100 }),
      gv: makeGuide({ id: 'gv', orientation: 'vertical', offset: 200 }),
    },
  });

describe('App keyboard: alignment-guide nudge', () => {
  it('arrows move a guide along its one axis; cross-axis presses no-op', () => {
    render(<App />);
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedGuideIds: ['gh'] });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(useDoc.getState().guides.gh.offset).toBe(101);
    fireEvent.keyDown(document.body, { key: 'ArrowUp', shiftKey: true });
    expect(useDoc.getState().guides.gh.offset).toBe(96);
    // Left/right have no meaning for a horizontal guide.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(useDoc.getState().guides.gh.offset).toBe(96);
  });

  it('a vertical guide answers left/right instead', () => {
    render(<App />);
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedGuideIds: ['gv'] });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(useDoc.getState().guides.gv.offset).toBe(199);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(useDoc.getState().guides.gv.offset).toBe(199);
  });

  it('a diagonal guide projects the nudge onto its intercept', () => {
    render(<App />);
    useDoc.setState({
      ...useDoc.getState(),
      guides: {
        gd: makeGuide({ id: 'gd', orientation: 'diagonal-down', offset: 50 }),
        gu: makeGuide({ id: 'gu', orientation: 'diagonal-up', offset: 50 }),
      },
    });
    useSelection.setState({ ...useSelection.getState(), selectedGuideIds: ['gd', 'gu'] });
    // Down grows both intercepts (dy +1)…
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(useDoc.getState().guides.gd.offset).toBe(51);
    expect(useDoc.getState().guides.gu.offset).toBe(51);
    // …right shrinks the \ one (dy − dx) and grows the / one (dy + dx).
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(useDoc.getState().guides.gd.offset).toBe(50);
    expect(useDoc.getState().guides.gu.offset).toBe(52);
  });

  it('a mixed guide+bullet nudge moves both in ONE undo entry', () => {
    render(<App />);
    seed();
    useDoc.setState({
      ...useDoc.getState(),
      routeBullets: { b1: makeRouteBullet({ id: 'b1', x: 10, y: 10 }) },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedGuideIds: ['gh'],
      selectedRouteBulletIds: ['b1'],
    });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(useDoc.getState().guides.gh.offset).toBe(101);
    expect(useDoc.getState().routeBullets.b1).toMatchObject({ x: 10, y: 11 });
    useDoc.temporal.getState().undo();
    expect(useDoc.getState().guides.gh.offset).toBe(100);
    expect(useDoc.getState().routeBullets.b1).toMatchObject({ x: 10, y: 10 });
  });

  it('a locked guide resists the nudge', () => {
    render(<App />);
    useDoc.setState({
      ...useDoc.getState(),
      guides: { gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100, locked: true }) },
    });
    useSelection.setState({ ...useSelection.getState(), selectedGuideIds: ['gh'] });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(useDoc.getState().guides.gh.offset).toBe(100);
  });

  it('a hidden guides layer answers neither arrows nor Delete (hiding is a peek)', () => {
    render(<App />);
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedGuideIds: ['gh'] });
    useViewportStore.setState({ showGuides: false });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(useDoc.getState().guides.gh.offset).toBe(100);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(useDoc.getState().guides.gh).toBeDefined();
    // The selection survives — unhiding brings the same target back.
    expect(useSelection.getState().selectedGuideIds).toEqual(['gh']);
  });
});

describe('App keyboard: alignment-guide delete', () => {
  it('Delete removes the selected guide and one undo restores it', () => {
    render(<App />);
    seed();
    useSelection.setState({ ...useSelection.getState(), selectedGuideIds: ['gh'] });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(useDoc.getState().guides.gh).toBeUndefined();
    expect(useDoc.getState().guides.gv).toBeDefined();
    expect(useSelection.getState().selectedGuideIds).toEqual([]);
    useDoc.temporal.getState().undo();
    expect(useDoc.getState().guides.gh).toBeDefined();
  });
});
