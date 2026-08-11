import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { GuideWells } from './GuideWells';
import { useDoc } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';

/**
 * The wells are HTML chrome, but they sit ON the canvas — so their ink follows
 * the PAPER's day/night, never the toolbar's. The two disagree in both
 * directions: "Dark UI in day" darkens the chrome over a still-light map, and
 * the gray/black day papers darken the map under a still-light chrome. The
 * `dark-paper` class is what styles.css hangs the night ink off.
 */
const wells = () => {
  const { container } = render(
    <GuideWells
      guidesHidden={false}
      armed={null}
      onWellPointerDown={() => {}}
      onPointerMove={() => {}}
      onPointerUp={() => {}}
    />,
  );
  return [...container.querySelectorAll('.guide-well')];
};

const bothDark = () => wells().map((w) => w.classList.contains('dark-paper'));

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), darkMode: false });
  useViewportStore.setState({ darkUiInDay: false, dayCanvasColor: 'white' });
});

describe('GuideWells ink tracks the paper', () => {
  it('stays day over a day map', () => {
    expect(bothDark()).toEqual([false, false]);
  });

  it('ignores the chrome theme: "Dark UI in day" leaves the wells in day ink', () => {
    useViewportStore.setState({ darkUiInDay: true });
    expect(bothDark()).toEqual([false, false]);
  });

  it('goes night with the map', () => {
    useDoc.setState({ ...useDoc.getState(), darkMode: true });
    expect(bothDark()).toEqual([true, true]);
  });

  it('goes night on a dimmed day paper, with the chrome still light', () => {
    useViewportStore.setState({ dayCanvasColor: 'black' });
    expect(bothDark()).toEqual([true, true]);
  });
});
