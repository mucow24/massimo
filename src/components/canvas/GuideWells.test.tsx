import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { GuideWells } from './GuideWells';
import type { GuideOrientation } from '../../model/types';

/**
 * The wells' PROPS contract — the half of the guide-creation affordance that
 * useGuideDrag's own suite cannot see, because it drives the hook's handlers
 * directly and so enters the gesture past this component.
 *
 * The load-bearing one is `guidesHidden`. Hiding the guides layer must leave
 * the strips visible but inert: there is no placing mode for guides, so no
 * `revealedBy` reveal to lean on, and a pull that mints a guide nobody can see
 * reads as the gesture being broken. That inertness is three characters of
 * ternary per handler and nothing else in the suite notices if they go.
 */

const wellAt = (container: HTMLElement, orientation: GuideOrientation) =>
  container.querySelector<HTMLElement>(`[data-guide-well="${orientation}"]`)!;

const ORIENTATIONS: GuideOrientation[] = ['horizontal', 'vertical', 'diagonal-up', 'diagonal-down'];

function renderWells(props: Partial<Parameters<typeof GuideWells>[0]> = {}) {
  const handlers = {
    onWellPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
  };
  const { container } = render(
    <GuideWells guidesHidden={false} armed={null} {...handlers} {...props} />,
  );
  return { container, ...handlers };
}

describe('GuideWells', () => {
  it('mounts one strip per orientation', () => {
    const { container } = renderWells();
    expect(container.querySelectorAll('.guide-well').length).toBe(4);
    for (const o of ORIENTATIONS) expect(wellAt(container, o)).not.toBeNull();
  });

  it('pulls a guide out of the strip the press landed on', () => {
    const { container, onWellPointerDown, onPointerMove, onPointerUp } = renderWells();
    const well = wellAt(container, 'diagonal-up');
    fireEvent.pointerDown(well);
    fireEvent.pointerMove(well);
    fireEvent.pointerUp(well);
    expect(onWellPointerDown).toHaveBeenCalledTimes(1);
    expect(onWellPointerDown.mock.calls[0][0]).toBe('diagonal-up');
    // The sub-threshold stretch happens with the pointer still over the strip
    // (capture moves to the svg only on the first real move), so the strip has
    // to forward moves and ups into the same shared handlers the svg runs.
    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });

  describe('with the guides layer hidden', () => {
    it('takes no gesture at all — a pull would mint an invisible guide', () => {
      const { container, onWellPointerDown, onPointerMove, onPointerUp } = renderWells({
        guidesHidden: true,
      });
      for (const o of ORIENTATIONS) {
        const well = wellAt(container, o);
        fireEvent.pointerDown(well);
        fireEvent.pointerMove(well);
        fireEvent.pointerUp(well);
      }
      expect(onWellPointerDown).not.toHaveBeenCalled();
      expect(onPointerMove).not.toHaveBeenCalled();
      expect(onPointerUp).not.toHaveBeenCalled();
    });

    it('stays visible, marked inert, and names the fix', () => {
      // Visible-but-disabled rather than unmounted: the strips are where the
      // user goes looking for guides, so they have to be able to find out WHY
      // nothing comes out of them.
      const { container } = renderWells({ guidesHidden: true });
      expect(container.querySelectorAll('.guide-well.disabled').length).toBe(4);
      expect(wellAt(container, 'horizontal').title).toBe(
        'Guides are hidden (Hit G or use the view menu to enable)',
      );
    });
  });

  it('tints only the well a guide is hovering over', () => {
    const { container } = renderWells({ armed: 'vertical' });
    expect(wellAt(container, 'vertical').classList.contains('armed')).toBe(true);
    for (const o of ORIENTATIONS) {
      if (o === 'vertical') continue;
      expect(wellAt(container, o).classList.contains('armed'), o).toBe(false);
    }
  });

  it('hints the pull direction, per orientation', () => {
    // The corner squares mint the guide PERPENDICULAR to the drag, which is
    // the non-obvious half — a hint that said "drag out to pull a falling
    // diagonal" from the upper-left corner would be wrong, not just vague.
    const { container } = renderWells();
    expect(wellAt(container, 'horizontal').title).toBe('Drag down to pull out a horizontal guide');
    expect(wellAt(container, 'vertical').title).toBe('Drag right to pull out a vertical guide');
    expect(wellAt(container, 'diagonal-up').title).toBe('Drag out to pull a rising diagonal guide');
    expect(wellAt(container, 'diagonal-down').title).toBe(
      'Drag out to pull a falling diagonal guide',
    );
  });
});
