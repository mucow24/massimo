import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GuideView } from './GuideView';
import { makeGuide } from '../test/fixtures';
import type { AlignmentGuide } from '../model/types';

const renderGuide = (guide: AlignmentGuide) =>
  render(
    <svg>
      <GuideView
        guide={guide}
        zoom={1}
        vbX={-500}
        vbY={-500}
        vbW={1000}
        vbH={1000}
        guideColor="#888"
        selectedColor="#a80"
        hoverColor="#cb6"
        accentColor="#1a4ea8"
        selected={false}
        hovered={false}
        engaged={false}
        interactive={true}
        inHandMode={false}
      />
    </svg>,
  );

describe('<GuideView /> diagonals', () => {
  it('draws a diagonal clipped to the overdrawn box, with the move cursor', () => {
    // The / at intercept 200: from the top edge (700, -500)… but x is capped
    // at the box's right edge, so it runs (−500, 700)→… — clipped both ways:
    // enters at the left edge (−500, 700)? y 700 is outside; the real span is
    // x ∈ [−300, 500], i.e. (−300, 500) → (500, −300).
    const { container } = renderGuide(
      makeGuide({ id: 'gu', orientation: 'diagonal-up', offset: 200 }),
    );
    const visible = container.querySelector('line')!;
    expect(Number(visible.getAttribute('x1'))).toBe(-300);
    expect(Number(visible.getAttribute('y1'))).toBe(500);
    expect(Number(visible.getAttribute('x2'))).toBe(500);
    expect(Number(visible.getAttribute('y2'))).toBe(-300);
    const hit = container.querySelector<HTMLElement>('[data-guide-hit]')!;
    expect(hit.style.cursor).toBe('nwse-resize');
  });

  it('mounts nothing for a diagonal that misses the box', () => {
    const { container } = renderGuide(
      makeGuide({ id: 'gd', orientation: 'diagonal-down', offset: 5000 }),
    );
    expect(container.querySelector('[data-guide]')).toBeNull();
  });
});
