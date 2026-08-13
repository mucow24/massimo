import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GuidePopover } from './GuidePopover';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeGuide } from '../test/fixtures';
import type { AlignmentGuide, GuideOrientation } from '../model/types';

/**
 * The alignment guide's editor: one coordinate plus the shared lock/delete
 * footer. Everything else about a guide is direct manipulation on the canvas,
 * so what is left here is worth pinning precisely because it is small — the
 * per-orientation naming (a diagonal's scalar is a Y-INTERCEPT, not a
 * position), the rounded mirror, and the two things `locked` has to reach.
 *
 * Which gates decide the panel MOUNTS at all lives in ItemPopovers' two
 * tables; this file renders it directly.
 */

function seed(guide: AlignmentGuide) {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, guides: { [guide.id]: guide } });
}

function renderGuide(overrides: Partial<AlignmentGuide> = {}) {
  const guide = makeGuide({ id: 'g1', ...overrides });
  seed(guide);
  const onClose = vi.fn();
  const { container } = render(<GuidePopover guide={guide} hostW={800} onClose={onClose} />);
  return { guide, onClose, container };
}

const current = (id = 'g1') => useDoc.getState().guides[id];

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
});

describe('GuidePopover — the one coordinate is named per orientation', () => {
  // A horizontal guide is pinned by its Y and a vertical by its X, but a
  // DIAGONAL's scalar is neither: it is the Y where the guide crosses X = 0.
  // Labelling that "Y" would read as a position the guide does not have.
  const cases: Array<[GuideOrientation, string, string]> = [
    ['horizontal', 'Horizontal guide', 'Y'],
    ['vertical', 'Vertical guide', 'X'],
    ['diagonal-down', 'Diagonal guide (\\)', 'Y₀'],
    ['diagonal-up', 'Diagonal guide (/)', 'Y₀'],
  ];

  it.each(cases)('%s is titled "%s" and labels its field "%s"', (orientation, title, label) => {
    const { container } = renderGuide({ orientation });
    expect(container.textContent).toContain(title);
    expect(screen.getByRole('spinbutton', { name: label })).not.toBeNull();
  });

  it.each(cases.slice(2))('spells the intercept out on hover for %s', (orientation) => {
    renderGuide({ orientation });
    expect(screen.getByText('Y₀').getAttribute('title')).toBe('Y where the guide crosses X = 0');
  });

  it('gives the axis-aligned orientations no such hover — Y and X mean what they say', () => {
    renderGuide({ orientation: 'horizontal' });
    expect(screen.getByText('Y').getAttribute('title')).toBeNull();
  });
});

describe('GuidePopover — the offset field', () => {
  it('shows a dragged guide’s offset as it stands, minus the float dust', () => {
    // A well pull-out lands on whatever the pointer said. The box must not read
    // back "120.4000000001" — but it must not claim "120" either when the guide
    // really sits at 120.4. The whole-unit step moves the wheel and the arrows;
    // it is not a claim about what the field can hold.
    renderGuide({ offset: 120.4 });
    expect(screen.getByRole('spinbutton', { name: 'Y' })).toHaveProperty('value', '120.4');
  });

  it('shows a negative offset the same way', () => {
    renderGuide({ offset: -7.5 });
    expect(screen.getByRole('spinbutton', { name: 'Y' })).toHaveProperty('value', '-7.5');
  });

  it('commits a typed value through moveGuide', () => {
    renderGuide({ offset: 0 });
    const field = screen.getByRole('spinbutton', { name: 'Y' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '-40' } });
    expect(current().offset).toBe(-40);
  });

  it('leaves the guide alone while the field is emptied mid-edit', () => {
    // Number('') === 0 would teleport the guide onto the axis — the whole
    // reason this is useNumericField rather than a bare input.
    renderGuide({ offset: 120 });
    const field = screen.getByRole('spinbutton', { name: 'Y' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '' } });
    expect(current().offset).toBe(120);
  });

  it('steps the offset on a wheel tick over the row', () => {
    const { container } = renderGuide({ offset: 120 });
    const row = container.querySelector('.row')!;
    fireEvent.wheel(row, { deltaY: -1 });
    expect(current().offset).toBe(121);
  });
});

describe('GuidePopover — locked', () => {
  it('disables the offset field', () => {
    renderGuide({ offset: 120, locked: true });
    expect(screen.getByRole('spinbutton', { name: 'Y' })).toHaveProperty('disabled', true);
  });

  it('detaches the wheel handler too — a disabled input still sits under the pointer', () => {
    // The row, not the input, carries the wheel listener, and a disabled
    // input does not stop a wheel event reaching its ancestor. So `locked`
    // has to withhold the listener itself, not lean on the input's state.
    const { container } = renderGuide({ offset: 120, locked: true });
    const row = container.querySelector('.row')!;
    fireEvent.wheel(row, { deltaY: -1 });
    expect(current().offset).toBe(120);
  });

  it('refuses the delete, and does not close the panel', () => {
    const { onClose } = renderGuide({ locked: true });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(current()).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still offers the unlock, which DROPS the flag rather than storing false', () => {
    // Optional flags are omitted at their default across the doc, so an
    // unlocked guide carries no `locked` key at all.
    renderGuide({ locked: true });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock guide' }));
    expect(current().locked).toBeUndefined();
  });
});

describe('GuidePopover — footer', () => {
  it('locks an unlocked guide', () => {
    renderGuide();
    fireEvent.click(screen.getByRole('button', { name: 'Lock guide' }));
    expect(current().locked).toBe(true);
  });

  it('deletes the guide and closes the panel behind it', () => {
    // The popover is mounted for the SOLE selection, so a delete that did not
    // close would leave an editor pointing at a guide that is gone.
    const { onClose } = renderGuide();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(current()).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
