import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LineTagsLayer } from '../../components/canvas/LineTagsLayer';
import { buildExportSvg } from '../../export/exportCanvas';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeBandSpec, makeLine } from '../../test/fixtures';
import { fakeSvgRef, stubGetBBox } from '../../test/interaction';
import type { LineTag } from '../../model/types';

const identityScreenToWorld = (x: number, y: number) => ({ x, y });

const STRIPE_WIDTH = 28; // world units; the chevron arms should reach exactly ±14

const chevronTag: LineTag = {
  id: 'T',
  lineId: 'L2',
  fromStationId: 's1',
  toStationId: 's2',
  anchorEnd: 'from',
  distance: 50,
  orientation: 0,
  kind: 'chevron',
};

/** Render the layer at `zoom` and hand back the mounted <svg> — the export source. */
function renderCanvasAt(zoom: number): SVGSVGElement {
  const { ref } = fakeSvgRef();
  const { container } = render(
    <svg>
      <LineTagsLayer
        bands={[makeBandSpec(['L2'], { stripeWidths: [STRIPE_WIDTH] })]}
        zoom={zoom}
        svgRef={ref}
        screenToWorld={identityScreenToWorld}
      />
    </svg>,
  );
  return container.querySelector('svg')! as unknown as SVGSVGElement;
}

/**
 * Max |y| of the chevron polygon in the exported SVG *file text* — its arm
 * half-height in world units, which is what the reader of the file sees.
 *
 * Read with a regex rather than DOMParser: jsdom's XMLSerializer emits a
 * duplicate `xmlns` attribute that makes its own XML parser reject the string.
 * That is a jsdom serialization quirk, not the behavior under test; the bytes
 * below are the real export payload either way.
 */
function exportedArmHalfHeight(svgText: string): number {
  const m = /<polygon points="([^"]+)"/.exec(svgText);
  if (!m) throw new Error('the chevron polygon did not survive into the export');
  return Math.max(...m[1].split(' ').map((p) => Math.abs(Number(p.split(',')[1]))));
}

describe('a chevron line tag in an export is zoom-independent world geometry', () => {
  let restore: (() => void) | null = null;

  beforeEach(() => {
    restore = stubGetBBox({ x: -50, y: -50, width: 200, height: 100 });
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: { L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: STRIPE_WIDTH }) },
      lineOrder: ['L2'],
      lineTags: { T: chevronTag },
    });
    useDoc.temporal.getState().clear();
  });
  afterEach(() => {
    cleanup();
    restore?.();
    restore = null;
  });

  const exportAt = async (zoom: number): Promise<number> => {
    const source = renderCanvasAt(zoom);
    const { svg } = await buildExportSvg(source, { background: '#ffffff', outlineText: false });
    return exportedArmHalfHeight(svg);
  };

  it('the exported arms are the same size whether the user was zoomed out or in', async () => {
    // buildExportSvg reframes a CLONE of the live canvas to the content bbox, so
    // the viewport zoom is gone by the time the file is written. Anything baked
    // as `k / zoom` world units becomes a permanent geometry error scaled by
    // whatever zoom happened to be committed when Export was clicked.
    const zoomedOut = await exportAt(0.25);
    const zoomedIn = await exportAt(4);
    expect(zoomedOut).toBeCloseTo(zoomedIn, 3);
  });

  it('the exported arms stay flush with the 28-unit stripe at ZOOM_MIN', async () => {
    // ZOOM_MIN is 0.1 (viewportMath.ts) — a normal "fit a big map on screen"
    // zoom. The arms must stay at the stripe edges (±14) up to the sub-unit
    // antialias bleed, not spill onto the touching interlined neighbor.
    const armH = await exportAt(0.1);
    expect(armH).toBeLessThanOrEqual(STRIPE_WIDTH / 2 + 0.5);
  });

  it('overshoots the zoom-independent hit rect by exactly the constant bleed', async () => {
    // The invisible hit rect is sized `2 * (stripeWidth / 2)` with no zoom term.
    // The arms deliberately bleed a hair past it (covering the antialias seam
    // against the stripe), so they should be slightly LARGER — but by a fixed
    // world amount, identically at every zoom, never by a zoom-scaled one.
    const atQuarter = await exportAt(0.25);
    const atFour = await exportAt(4);
    const overshoot = atQuarter * 2 - STRIPE_WIDTH;
    expect(overshoot).toBeGreaterThan(0);
    expect(overshoot).toBeLessThan(1); // a hairline, not a visible spill
    expect(atFour * 2 - STRIPE_WIDTH).toBeCloseTo(overshoot, 6);
  });
});
