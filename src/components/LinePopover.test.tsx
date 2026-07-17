import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinePopover } from './LinePopover';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine } from '../test/fixtures';
import type { LineId } from '../model/types';

const HOST = { w: 800, h: 600 };

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    lines: {
      L1: makeLine({ id: 'L1', service: 'A', name: 'A line', color: '#0039a6', stations: [] }),
    },
    lineOrder: ['L1'],
  });
  useSelection.getState().startAppend('L1' as LineId);
});

const line = () => useDoc.getState().lines['L1'];

describe('<LinePopover />', () => {
  it('hosts the full line inspector under the "Line" title band', () => {
    render(<LinePopover line={line()} hostSize={HOST} />);
    // The black header band carries the panel title.
    expect(document.querySelector('.line-popover .header')?.textContent).toBe('Line');
    // Identity + style controls are all inside — spot-check one of each band:
    // name field, color palette, and a style slider.
    expect(screen.getByLabelText('Line name')).toBeInTheDocument();
    expect(document.querySelector('.color-palette')).not.toBeNull();
    expect(screen.getByRole('spinbutton', { name: 'Line width' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Seam width' })).toBeInTheDocument();
  });

  it('edits write through to the doc (name field)', async () => {
    const user = userEvent.setup();
    render(<LinePopover line={line()} hostSize={HOST} />);
    const name = screen.getByLabelText('Line name');
    await user.clear(name);
    await user.type(name, 'Broadway Express');
    expect(useDoc.getState().lines['L1'].name).toBe('Broadway Express');
  });

  it('has a Delete-only footer: no lock button (lines have no locked field)', () => {
    render(<LinePopover line={line()} hostSize={HOST} />);
    expect(document.querySelector('.line-popover .footer .lock-btn')).toBeNull();
    expect(document.querySelector('.line-popover .footer .delete-btn')).not.toBeNull();
  });

  it('Delete removes the line and exits Edit Stops', async () => {
    const user = userEvent.setup();
    render(<LinePopover line={line()} hostSize={HOST} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(useDoc.getState().lines['L1']).toBeUndefined();
    const s = useSelection.getState();
    expect(s.uiMode.kind).toBe('idle');
    expect(s.selectedLineId).toBeNull();
  });

  it('pins to the top-right, clamped to the edge pad on a narrow host', () => {
    render(<LinePopover line={line()} hostSize={{ w: 200, h: 600 }} />);
    const el = document.querySelector('.line-popover') as HTMLElement;
    // 200 − 320 − 8 would be negative; the pin floors at the 8px pad.
    expect(el.style.left).toBe('8px');
    expect(el.style.top).toBe('8px');
  });
});
