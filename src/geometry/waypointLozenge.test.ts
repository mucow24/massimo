import { describe, it, expect } from 'vitest';
import { waypointLozengeSize, waypointLabelRectLocal } from './waypointLozenge';

describe('waypointLozengeSize', () => {
  it('scales with the host font size', () => {
    const small = waypointLozengeSize(10);
    const large = waypointLozengeSize(20);
    expect(large.w).toBeGreaterThan(small.w);
    expect(large.h).toBeGreaterThan(small.h);
    expect(large.pillFont).toBeCloseTo(20 * 0.72, 5);
  });
});

describe('waypointLabelRectLocal — the pill stands in for the name', () => {
  const fontSize = 12;
  const { w, h } = waypointLozengeSize(fontSize);

  it('anchors the LEFT edge on anchorX for a start-anchored label', () => {
    const rect = waypointLabelRectLocal(
      { textAnchor: 'start', anchorX: 100, hitY: 40, hitH: 20 },
      fontSize,
    );
    expect(rect.x).toBeCloseTo(100, 5);
    expect(rect.w).toBeCloseTo(w, 5);
  });

  it('anchors the RIGHT edge on anchorX for an end-anchored label', () => {
    const rect = waypointLabelRectLocal(
      { textAnchor: 'end', anchorX: 100, hitY: 40, hitH: 20 },
      fontSize,
    );
    expect(rect.x + rect.w).toBeCloseTo(100, 5);
  });

  it('centers on anchorX for a middle-anchored label', () => {
    const rect = waypointLabelRectLocal(
      { textAnchor: 'middle', anchorX: 100, hitY: 40, hitH: 20 },
      fontSize,
    );
    expect(rect.x + rect.w / 2).toBeCloseTo(100, 5);
  });

  it('vertically centers on the label block (hitY + hitH/2)', () => {
    const rect = waypointLabelRectLocal(
      { textAnchor: 'start', anchorX: 0, hitY: 40, hitH: 20 },
      fontSize,
    );
    // Block center is 50; the pill is centered there.
    expect(rect.y + rect.h / 2).toBeCloseTo(50, 5);
    expect(rect.h).toBeCloseTo(h, 5);
  });
});
