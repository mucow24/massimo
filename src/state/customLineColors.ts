import { useDoc } from './store';
import { customLineColors } from '../model/palettes';

/**
 * The map's CUSTOM COLORS: every distinct line color that no palette of this
 * map covers, in first-seen order.
 *
 * Three surfaces show this set — the line picker's "Custom" section, the
 * palette manager's custom colors row, and the palette editor's Add color menu
 * — and the whole point of it is that they agree: a color leaves all three the
 * moment a palette covers it. So the derivation is here, once, rather than
 * spelled out at each of them.
 */
export function useCustomLineColors(): string[] {
  const lines = useDoc((s) => s.lines);
  const palettes = useDoc((s) => s.palettes);
  return customLineColors(
    Object.values(lines).map((l) => l.color),
    palettes,
  );
}
