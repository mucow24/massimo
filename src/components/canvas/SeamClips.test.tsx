import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SeamClips, seamClipId } from './SeamClips';
import { buildBands } from '../../geometry/interlining';
import { makeDoc, makeLine, makeStation, makeStop } from '../../test/fixtures';

// Two interlined lines through s1–s2 (one row apart, tangent): one carries a
// seam color, the other doesn't. buildBands merges them into one 2-stripe band.
function bandsAndLines() {
  const stops = () => [
    makeStop('withSeam', { row: 0, col: 0, orientation: 'auto-horizontal' }),
    makeStop('noSeam', { row: 1, col: 0, orientation: 'auto-horizontal' }),
  ];
  const doc = makeDoc({
    stations: [
      makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
      makeStation({ id: 's2', x: 200, y: 0, stops: stops() }),
    ],
    lines: [
      makeLine({ id: 'withSeam', stations: ['s1', 's2'], strokeWidth: 4, seamColor: '#ffffff80' }),
      makeLine({ id: 'noSeam', stations: ['s1', 's2'], strokeWidth: 4 }),
    ],
  });
  return {
    bands: buildBands(doc.stations, doc.lines, doc.curveRadius, doc.lineOrder),
    lines: doc.lines,
  };
}

const renderClips = (
  bands: ReturnType<typeof buildBands>,
  lines: Record<string, import('../../model/types').Line>,
) =>
  render(
    <svg>
      <defs>
        <SeamClips bands={bands} lines={lines} />
      </defs>
    </svg>,
  );

describe('<SeamClips>', () => {
  it('emits a corridor clipPath ONLY for lines with a seam color', () => {
    const { bands, lines } = bandsAndLines();
    const { container } = renderClips(bands, lines);
    const clips = Array.from(container.querySelectorAll('clipPath'));
    expect(clips.length).toBe(1);
    expect(clips[0].id).toBe(seamClipId('withSeam'));
    expect(clips[0].getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
    // The corridor is one filled ribbon per band stripe — a closed path.
    const ribbons = clips[0].querySelectorAll('path');
    expect(ribbons.length).toBeGreaterThan(0);
    expect(ribbons[0].getAttribute('d')).toMatch(/Z\s*$/);
  });

  it('renders nothing when no line has a seam', () => {
    const { bands, lines } = bandsAndLines();
    const noSeam = { ...lines, withSeam: { ...lines.withSeam, seamColor: undefined } };
    const { container } = renderClips(bands, noSeam);
    expect(container.querySelector('clipPath')).toBeNull();
  });
});
