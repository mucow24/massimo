import type { Line } from '../model/types';
import { legibleTextOn } from '../util/color';

/**
 * Resolve a route badge's colors + code from its line (or null/unresolved): the
 * line color (gray `#888` placeholder when absent), a legible text color for
 * the code, and the service code (`?` when unresolved). Shared by the SVG
 * bullet renderers (InlineBullet, RouteBulletView) and the HTML twin
 * (InlineBulletText) so the placeholder + legibility rules live in one place.
 */
export function badgeColors(line: Line | null | undefined): {
  fill: string;
  textColor: string;
  code: string;
} {
  const fill = line?.color ?? '#888';
  return { fill, textColor: legibleTextOn(fill), code: line?.service ?? '?' };
}
