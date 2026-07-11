import { describe, it, expect } from 'vitest';
import { selectionOutlineTones } from './selectionStyle';
import { themeColors } from '../state/theme';

// The two-tone selection ring flips with the theme: the CORE is the theme's
// selection ink (black in day, white in night) and the wider UNDERLAY its
// opposite, so the ring reads white-black-white on the light canvas and
// black-white-black on the dark one. Paint order is underlay first, core on top.
describe('selectionOutlineTones — theme flip', () => {
  it('light mode: white underlay (4px) under a black ink core (2px) → WBW', () => {
    const [edge, core] = selectionOutlineTones(themeColors(false));
    expect(edge.tone).toBe('edge');
    expect(edge.stroke).toBe('#ffffff');
    expect(edge.strokeWidth).toBe(4);
    expect(core.tone).toBe('core');
    expect(core.stroke).toBe('#000000');
    expect(core.strokeWidth).toBe(2);
  });

  it('dark mode: black underlay (4px) under a white ink core (2px) → BWB', () => {
    const [edge, core] = selectionOutlineTones(themeColors(true));
    expect(edge.stroke).toBe('#000000');
    expect(edge.strokeWidth).toBe(4);
    expect(core.stroke).toBe('#ffffff');
    expect(core.strokeWidth).toBe(2);
  });
});
