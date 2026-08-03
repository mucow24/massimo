// The Xfer picker's own logic: what the glyph draws, and what the trigger
// claims is on the dot. StopRows.test.tsx covers the wiring (pick → doc).
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StopTransferSelect, TransferGlyph } from './TransferPicker';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeStyle } from '../test/fixtures';
import type { Transfer, TransferStyleProps } from '../model/types';

const props = (over: Partial<TransferStyleProps> = {}): TransferStyleProps => ({
  thickness: 2,
  color: { day: '#000000', night: '#000000' },
  strokeWidth: 0,
  strokeColor: { day: '#ffffff', night: '#ffffff' },
  ...over,
});

// The two circles a glyph can draw, outermost first (halo, then body).
const radii = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('circle')).map((c) => Number(c.getAttribute('r')));

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
});

describe('<TransferGlyph />', () => {
  it('draws at true world scale, so a 12px transfer reads as bigger than a 2px one', () => {
    expect(radii(render(<TransferGlyph props={props({ thickness: 12 })} />).container)).toEqual([
      6,
    ]);
    expect(radii(render(<TransferGlyph props={props()} />).container)).toEqual([1]);
  });

  it('draws the halo outside the body', () => {
    const { container } = render(<TransferGlyph props={props({ thickness: 8, strokeWidth: 2 })} />);
    // visibleExtent 8 + 2*2 = 12 → r 6, over the body's r 4.
    expect(radii(container)).toEqual([6, 4]);
  });

  it('scales an OUTSIZED style down whole, keeping the halo:body ratio', () => {
    // Outer radius would be 30/2 + 5 = 20, way past the 7.5 box — so it scales
    // to fit rather than clipping, and the two circles stay in proportion.
    const { container } = render(
      <TransferGlyph props={props({ thickness: 30, strokeWidth: 5 })} />,
    );
    const [halo, body] = radii(container);
    expect(halo).toBeCloseTo(7.5, 6);
    expect(body / halo).toBeCloseTo(15 / 20, 6);
  });

  it('resolves the NIGHT half of each color on a dark canvas', () => {
    const p = props({ color: { day: '#ff8800', night: '#4400aa' } });
    expect(
      render(<TransferGlyph props={p} />)
        .container.querySelector('circle')
        ?.getAttribute('fill'),
    ).toBe('#ff8800');
    useDoc.setState({ darkMode: true });
    expect(
      render(<TransferGlyph props={p} />)
        .container.querySelector('circle')
        ?.getAttribute('fill'),
    ).toBe('#4400aa');
  });
});

describe('<StopTransferSelect />', () => {
  const selfTransfer = (over: Partial<Transfer> = {}): Transfer => ({
    id: 'x1',
    a: { stationId: 's1', lineId: 'L1' },
    b: { stationId: 's1', lineId: 'L1' },
    ...over,
  });

  const trigger = () => screen.getByRole('combobox', { name: 'Transfer' });

  it('shows an empty slot as a MARK, not as blank space', () => {
    // A blank box would be indistinguishable from the 2px factory style's
    // speck, which is the exact confusion this control exists to end.
    const { container } = render(
      <StopTransferSelect transfer={undefined} onSelect={() => {}} ariaLabel="Transfer" />,
    );
    const ring = container.querySelector('circle');
    expect(ring).not.toBeNull();
    expect(ring!.getAttribute('fill')).toBe('none');
    expect(ring!.getAttribute('stroke-dasharray')).toBe('2 2');
    expect(trigger().getAttribute('title')).toContain('no transfer');
  });

  it('shows the transfer’s own resolved look once there is one', () => {
    const { container } = render(
      <StopTransferSelect
        transfer={selfTransfer({ thickness: 12 })}
        onSelect={() => {}}
        ariaLabel="Transfer"
      />,
    );
    // A filled disc at true scale — no dashed ring in sight.
    expect(radii(container)).toEqual([6]);
    expect(container.querySelector('circle')?.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('reads a tag pointing at another KIND of style as Custom, not as that style', async () => {
    // Parse prunes mismatched tags; only a mid-flight delete can race here. The
    // same belt-and-braces StyleRow keeps — a line style's props would blow up
    // resolveTransferStyle if this fell through.
    useDoc.setState({
      styles: { ...useDoc.getState().styles, 'y-line': makeStyle('line', 'y-line') },
    });
    render(
      <StopTransferSelect
        transfer={selfTransfer({ styleId: 'y-line' })}
        onSelect={() => {}}
        ariaLabel="Transfer"
      />,
    );
    // Custom is offered only while detached, so its presence IS the assertion.
    await userEvent.setup().click(trigger());
    expect(await screen.findByRole('option', { name: 'Custom' })).toBeTruthy();
  });
});
