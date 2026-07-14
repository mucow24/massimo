import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SeamClips, seamClipId } from './SeamClips';
import { buildBands } from '../../geometry/interlining';
import { makeDoc, makeLine, makeStation, makeStop } from '../../test/fixtures';
import type { Line } from '../../model/types';

// A degree-3 junction on line l1: 3 single-stripe bands, so each band gets an
// exclude-self clip = the union of the OTHER two bands' corridors.
function junctionBandsAndLines(seamColor?: string) {
  const hStop = () => makeStop('l1', { orientation: 'auto-horizontal' });
  const doc = makeDoc({
    stations: [
      makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
      makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
      makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
      makeStation({ id: 'd', x: 120, y: -120, stops: [hStop()] }),
    ],
    lines: [
      makeLine({
        id: 'l1',
        strokeWidth: 4,
        edges: ['a|j', 'c|j', 'd|j'],
        ...(seamColor ? { seamColor } : {}),
      }),
    ],
  });
  return {
    bands: buildBands(doc.stations, doc.lines, doc.lineOrder),
    lines: doc.lines,
  };
}

const renderClips = (bands: ReturnType<typeof buildBands>, lines: Record<string, Line>) =>
  render(
    <svg>
      <defs>
        <SeamClips bands={bands} lines={lines} />
      </defs>
    </svg>,
  );

describe('<SeamClips>', () => {
  it('emits one exclude-self corridor clip per band of a seam line', () => {
    const { bands, lines } = junctionBandsAndLines('#ffffff80');
    expect(bands.length).toBe(3);
    const { container } = renderClips(bands, lines);
    expect(container.querySelectorAll('clipPath').length).toBe(3);
    for (const band of bands) {
      const clip = container.querySelector(`clipPath[id="${seamClipId('l1', band.bandKey)}"]`);
      expect(clip).toBeTruthy();
      expect(clip!.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
      // Holds the OTHER two bands' filled ribbons (NOT this band's own).
      const ribbons = clip!.querySelectorAll('path');
      expect(ribbons.length).toBe(2);
      for (const r of ribbons) expect(r.getAttribute('d')).toMatch(/Z\s*$/);
    }
  });

  it('renders nothing for a line without a seam color', () => {
    const { bands, lines } = junctionBandsAndLines(undefined);
    const { container } = renderClips(bands, lines);
    expect(container.querySelector('clipPath')).toBeNull();
  });
});
