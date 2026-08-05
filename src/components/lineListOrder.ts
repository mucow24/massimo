import { lineDisplayName } from '../model/lineNaming';
import type { Line, StyleDef } from '../model/types';

/** Which column the lines list is ordered by. */
export type LineSortColumn = 'name' | 'stops';

/** The untagged bucket's subheader. `isReservedStyleName` refuses this name to
 *  real styles, so it can never label two different things at once. */
export const CUSTOM_GROUP_LABEL = 'Custom';

export interface LineGroup {
  /** Style id, or `''` for the untagged bucket. The collapse-state key. */
  key: string;
  /** Subheader text, or null for the single group of an UNGROUPED list (which
   *  renders no subheader and no collapse toggle, so its `key` goes unused). */
  label: string | null;
  lines: Line[];
}

// Names come from the same helper that names a line everywhere else in the UI,
// so the row's caption and its sort key can never disagree — including the
// `"<service> line"` fallback an unnamed line sorts under.
const byName = (a: Line, b: Line): number => lineDisplayName(a).localeCompare(lineDisplayName(b));

// Always ascending: the list's one sort control picks the COLUMN, and there is
// no direction affordance to read a descending order off of.
function sortLines(lines: readonly Line[], sortBy: LineSortColumn): Line[] {
  return [...lines].sort((a, b) => {
    if (sortBy === 'stops') {
      // Numeric, not the joined-text compare the station list's Lines column
      // uses — "10" must outrank "2".
      const cmp = a.stations.length - b.stations.length;
      return cmp !== 0 ? cmp : byName(a, b);
    }
    return byName(a, b);
  });
}

/**
 * The lines list's display order: the rows the panel walks, as one or more
 * groups.
 *
 * Ungrouped, the result is a single `label: null` group holding every line in
 * sort order. Grouped by style, it is one group per style ANY line wears —
 * alphabetical by style name, with the untagged "Custom" bucket last — and the
 * sort applies inside each group rather than across the whole list. Styles
 * nothing wears get no group; nor does Custom when every line is tagged.
 */
export function groupLinesForList(
  lines: readonly Line[],
  styles: Record<string, StyleDef>,
  opts: { sortBy: LineSortColumn; groupByStyle: boolean },
): LineGroup[] {
  const sorted = sortLines(lines, opts.sortBy);
  if (!opts.groupByStyle) return [{ key: '', label: null, lines: sorted }];

  // Bucket the ALREADY-sorted list, so each bucket inherits the column order
  // without a second sort.
  const buckets = new Map<string, Line[]>();
  for (const ln of sorted) {
    // A tag that doesn't resolve reads as untagged. Dangling ids are pruned on
    // load, so this is a totality guard — the line still has to appear.
    const key = ln.styleId && styles[ln.styleId] ? ln.styleId : '';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(ln);
    else buckets.set(key, [ln]);
  }

  const groups: LineGroup[] = [...buckets]
    .filter(([key]) => key !== '')
    .map(([key, ls]) => ({ key, label: styles[key].name, lines: ls }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const custom = buckets.get('');
  if (custom) groups.push({ key: '', label: CUSTOM_GROUP_LABEL, lines: custom });
  return groups;
}
