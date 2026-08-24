import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  LabelAlignButtons,
  LabelValignButtons,
  AutoHAlignButtons,
  AutoVAlignButtons,
} from './LabelAlignButtons';
import { AUTO_H_ALIGNS, AUTO_V_ALIGNS, LABEL_ALIGNS, LABEL_VALIGNS } from '../../model/transforms';

// The station label's two manual alignment clusters. What is worth pinning here
// is the coupling between the ladder and the picker: a cluster short a member
// leaves that stored value uneditable — the segment simply isn't there, and the
// group reads as "nothing selected" for a label that is perfectly valid. The
// `Record` chip maps make that a compile error; these pin the runtime half,
// that the rendered segments ARE the ladder, in the ladder's order.

// The Radix ToggleGroup root carries the cluster's aria-label but no `group`
// role, so reach it the way the style-editor tests do: by its class.
const groupLabelled = (label: string): HTMLElement =>
  document.querySelector(`.align-group[aria-label="${label}"]`) as HTMLElement;
const hGroup = () => groupLabelled('Horizontal alignment');
const vGroup = () => groupLabelled('Vertical alignment');

const segmentValues = (group: HTMLElement): string[] =>
  [...group.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? '');

const pressedCount = (group: HTMLElement): number =>
  [...group.querySelectorAll('button')].filter((b) => b.classList.contains('active')).length;

describe('LabelAlignButtons (horizontal)', () => {
  it('renders one segment per LABEL_ALIGNS member, in ladder order', () => {
    render(<LabelAlignButtons align="auto" onSet={() => {}} />);
    const group = hGroup();
    expect(segmentValues(group)).toEqual([
      'Align auto',
      'Align left',
      'Align center',
      'Align right',
    ]);
    expect(segmentValues(group)).toHaveLength(LABEL_ALIGNS.length);
  });

  it('marks the current value as the pressed segment — for every member', () => {
    for (const align of LABEL_ALIGNS) {
      const { unmount } = render(<LabelAlignButtons align={align} onSet={() => {}} />);
      const group = hGroup();
      expect(pressedCount(group)).toBe(1);
      unmount();
    }
  });

  it('emits the clicked member', () => {
    const onSet = vi.fn();
    render(<LabelAlignButtons align="auto" onSet={onSet} />);
    fireEvent.click(screen.getByLabelText('Align right'));
    expect(onSet).toHaveBeenCalledWith('end');
  });
});

describe('LabelValignButtons (vertical)', () => {
  it('renders one segment per LABEL_VALIGNS member, in ladder order', () => {
    render(<LabelValignButtons valign="auto-down" onSet={() => {}} />);
    const group = vGroup();
    expect(segmentValues(group)).toEqual([
      'V-align auto (down)',
      'V-align top',
      'V-align middle',
      'V-align bottom',
      'V-align auto (up)',
    ]);
    expect(segmentValues(group)).toHaveLength(LABEL_VALIGNS.length);
  });

  it('marks the current value as the pressed segment — for every member', () => {
    for (const valign of LABEL_VALIGNS) {
      const { unmount } = render(<LabelValignButtons valign={valign} onSet={() => {}} />);
      const group = vGroup();
      expect(pressedCount(group)).toBe(1);
      unmount();
    }
  });

  it('emits the clicked member', () => {
    const onSet = vi.fn();
    render(<LabelValignButtons valign="auto-down" onSet={onSet} />);
    fireEvent.click(screen.getByLabelText('V-align auto (up)'));
    expect(onSet).toHaveBeenCalledWith('auto-up');
  });
});

// The wand-on tuning pair adds one thing to the manual clusters' mechanism: its
// domain includes `null` ("leave it to the octant"), carried through Radix as
// the AUTO sentinel. The ladder coupling is worth pinning here for the same
// reason it is above — plus the sentinel mapping, since a sentinel that leaked
// through as the literal string would store nonsense.
describe('auto H/V tuning (wand on)', () => {
  const autoHGroup = () => groupLabelled('Auto horizontal alignment');
  const autoVGroup = () => groupLabelled('Auto vertical alignment');

  it('renders the AUTO sentinel plus one segment per AUTO_H_ALIGNS member', () => {
    render(<AutoHAlignButtons value={null} onSet={() => {}} />);
    expect(segmentValues(autoHGroup())).toEqual([
      'Auto align: auto',
      'Auto align: left',
      'Auto align: center',
      'Auto align: right',
    ]);
    expect(segmentValues(autoHGroup())).toHaveLength(AUTO_H_ALIGNS.length + 1);
  });

  it('renders the AUTO sentinel plus one segment per AUTO_V_ALIGNS member', () => {
    render(<AutoVAlignButtons value={null} onSet={() => {}} />);
    expect(segmentValues(autoVGroup())).toEqual([
      'Auto align V: auto',
      'Auto align V: up',
      'Auto align V: down',
    ]);
    expect(segmentValues(autoVGroup())).toHaveLength(AUTO_V_ALIGNS.length + 1);
  });

  it('marks the current value as the pressed segment — for every member and for null', () => {
    for (const value of [...AUTO_H_ALIGNS, null]) {
      const { unmount } = render(<AutoHAlignButtons value={value} onSet={() => {}} />);
      expect(pressedCount(autoHGroup())).toBe(1);
      unmount();
    }
    for (const value of [...AUTO_V_ALIGNS, null]) {
      const { unmount } = render(<AutoVAlignButtons value={value} onSet={() => {}} />);
      expect(pressedCount(autoVGroup())).toBe(1);
      unmount();
    }
  });

  it('maps the auto segment back to null rather than emitting the sentinel', () => {
    const onSet = vi.fn();
    render(<AutoHAlignButtons value="end" onSet={onSet} />);
    fireEvent.click(screen.getByLabelText('Auto align: auto'));
    expect(onSet).toHaveBeenCalledWith(null);
  });

  it('emits a real member unchanged', () => {
    const onSet = vi.fn();
    render(<AutoVAlignButtons value={null} onSet={onSet} />);
    fireEvent.click(screen.getByLabelText('Auto align V: up'));
    expect(onSet).toHaveBeenCalledWith('up');
  });
});
