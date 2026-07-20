import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DayNightColorRow } from './DayNightColorRow';

// The ColorField swatch is a <button> whose accessible name is the ariaLabel and
// whose tooltip is the title; that's the surface the row's contract shows up on.
const renderRow = (over: Partial<Parameters<typeof DayNightColorRow>[0]> = {}) => {
  const onChange = vi.fn();
  const onDarkChange = vi.fn();
  render(
    <DayNightColorRow
      label="Fill color"
      id="poly-fill"
      darkId="poly-dark-fill"
      lightAriaLabel="Polygon color"
      darkAriaLabel="Dark mode color"
      titleNoun="fill"
      value="#112233"
      darkValue="#445566"
      onChange={onChange}
      onDarkChange={onDarkChange}
      {...over}
    />,
  );
  return { onChange, onDarkChange };
};

describe('DayNightColorRow', () => {
  it('renders the label bound to the light field, and both swatches by their aria names', () => {
    renderRow();
    const labelEl = screen.getByText('Fill color');
    expect(labelEl.getAttribute('for')).toBe('poly-fill');
    expect(screen.getByLabelText('Polygon color').id).toBe('poly-fill');
    expect(screen.getByLabelText('Dark mode color').id).toBe('poly-dark-fill');
  });

  it('derives both tooltips from the single titleNoun', () => {
    renderRow({ titleNoun: 'stroke' });
    expect(screen.getByLabelText('Polygon color').getAttribute('title')).toBe('Light mode stroke');
    expect(screen.getByLabelText('Dark mode color').getAttribute('title')).toBe('Dark mode stroke');
  });

  it('applies disabled to BOTH the light and dark swatch', () => {
    renderRow({ disabled: true });
    expect(screen.getByLabelText('Polygon color')).toBeDisabled();
    expect(screen.getByLabelText('Dark mode color')).toBeDisabled();
  });

  it('keeps the two swatches independent — opening the light one leaves the dark closed', () => {
    renderRow();
    fireEvent.click(screen.getByLabelText('Polygon color'));
    expect(screen.getByLabelText('Polygon color')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Dark mode color')).toHaveAttribute('aria-expanded', 'false');
  });
});
