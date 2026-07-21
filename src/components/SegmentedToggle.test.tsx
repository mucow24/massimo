import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedToggle } from './SegmentedToggle';

const OPTIONS = [
  { value: 'left', content: 'L', label: 'Left' },
  { value: 'center', content: 'C', label: 'Center' },
  { value: 'right', content: 'R', label: 'Right' },
];

describe('<SegmentedToggle>', () => {
  it('marks only the current value active', () => {
    render(<SegmentedToggle value="center" options={OPTIONS} onSelect={() => {}} />);
    expect(screen.getByLabelText('Center').className).toContain('active');
    expect(screen.getByLabelText('Left').className).not.toContain('active');
    expect(screen.getByLabelText('Right').className).not.toContain('active');
  });

  it('calls onSelect with the clicked segment', () => {
    const onSelect = vi.fn();
    render(<SegmentedToggle value="left" options={OPTIONS} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText('Right'));
    expect(onSelect).toHaveBeenCalledWith('right');
  });

  it('is radio-like: re-clicking the active segment does not fire onSelect', () => {
    const onSelect = vi.fn();
    render(<SegmentedToggle value="left" options={OPTIONS} onSelect={onSelect} />);
    // Radix would emit '' (deselect) here; the empty-string guard swallows it.
    fireEvent.click(screen.getByLabelText('Left'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('applies the requested item class and renders title only when given', () => {
    render(
      <SegmentedToggle
        value="left"
        options={[{ value: 'left', content: 'L', label: 'Left', title: 'Align left' }, OPTIONS[1]]}
        onSelect={() => {}}
        itemClassName="shape-btn"
      />,
    );
    const left = screen.getByLabelText('Left');
    expect(left.className).toContain('shape-btn');
    expect(left).toHaveAttribute('title', 'Align left');
    // No explicit title → no tooltip attribute (text segments read as their label).
    expect(screen.getByLabelText('Center')).not.toHaveAttribute('title');
  });

  it('disables every segment when disabled', () => {
    const onSelect = vi.fn();
    render(<SegmentedToggle value="left" options={OPTIONS} onSelect={onSelect} disabled />);
    const right = screen.getByLabelText('Right');
    expect(right).toBeDisabled();
    fireEvent.click(right);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
