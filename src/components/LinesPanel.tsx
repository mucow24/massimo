import { Fragment, useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, Cross2Icon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { useDoc, useSelection } from '../state/store';
import { useRenderDoc } from '../state/renderDoc';
import { FieldCheckbox } from './FieldCheckbox';
import { FieldSelectContent } from './FieldSelectContent';
import { groupLinesForList } from './lineListOrder';
import type { LineSortColumn } from './lineListOrder';
import { lineDisplayName } from '../model/lineNaming';
import { legibleTextOn } from '../util/color';
import type { Line } from '../model/types';

// The sort dropdown's options, in menu order.
const SORT_OPTIONS: readonly { value: LineSortColumn; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'stops', label: '# Stops' },
];

export interface LineListView {
  sortBy: LineSortColumn;
  setSortBy: (col: LineSortColumn) => void;
  groupByStyle: boolean;
  setGroupByStyle: (on: boolean) => void;
  /** Collapsed group keys (style ids, `''` for Custom). */
  collapsed: ReadonlySet<string>;
  toggleGroup: (key: string) => void;
}

/**
 * The Lines list's view state: sort column, group-by-style, collapsed groups.
 * Ephemeral (a fresh session opens sorted by name, ungrouped, all expanded) —
 * but it must live in the SIDEBAR, not in this panel. Clicking a row is the
 * list's primary action and it hides the whole panel for Edit Stops, which
 * unmounts LinesPanel; state held here would reset on every single edit.
 * Sidebar stays mounted through that (it renders null), so its hooks keep it.
 */
export function useLineListView(): LineListView {
  const [sortBy, setSortBy] = useState<LineSortColumn>('name');
  const [groupByStyle, setGroupByStyle] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return { sortBy, setSortBy, groupByStyle, setGroupByStyle, collapsed, toggleGroup };
}

// One line row. Handlers read the stores at event time (getState), like
// StationRow, so the row needs no callback props. Clicking it goes STRAIGHT
// into Edit Stops — there is no selected-but-not-editing state.
function LineRow({ line }: { line: Line }) {
  return (
    <div data-line-row={line.id} style={{ padding: '4px 0' }}>
      <div
        className="list-row"
        title="Edit stops"
        onClick={() => useSelection.getState().startAppend(line.id)}
      >
        <span
          className="line-badge"
          style={{
            background: line.color,
            color: legibleTextOn(line.color),
            width: 24,
            height: 24,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {line.service}
        </span>
        <span className="grow">{lineDisplayName(line)}</span>
        <span className="line-stops">
          {line.stations.length} {line.stations.length === 1 ? 'stop' : 'stops'}
        </span>
        <button
          className="btn-mini danger"
          aria-label="Delete line"
          title="Delete line"
          onClick={(e) => {
            e.stopPropagation();
            useDoc.getState().deleteLine(line.id);
          }}
        >
          <Cross2Icon />
        </button>
      </div>
    </div>
  );
}

/**
 * Sidebar "Lines" tab body: every line as a row — color badge, name, stop
 * count — under a control bar that picks the sort column and optionally groups
 * the rows by each line's assigned style. Rows delete or pick-for-editing only;
 * which line paints in front where two overlap is settled per overlap by region
 * painting (see MapDoc.regionAssignments), so there is no z-order control here.
 */
export function LinesPanel({ view }: { view: LineListView }) {
  const lines = useRenderDoc((s) => s.lines);
  const styles = useDoc((s) => s.styles);

  const groups = useMemo(
    () =>
      groupLinesForList(Object.values(lines), styles, {
        sortBy: view.sortBy,
        groupByStyle: view.groupByStyle,
      }),
    [lines, styles, view.sortBy, view.groupByStyle],
  );

  return (
    <section>
      {/* The list's controls ride the top of the scroll box. They are NOT a
          footer: a bar pinned to the bottom sits under the horizontal
          scrollbar the moment a long line name widens the list. */}
      <div className="list-controls">
        <label htmlFor="line-sort">Sort by:</label>
        <Select.Root value={view.sortBy} onValueChange={(v) => view.setSortBy(v as LineSortColumn)}>
          <Select.Trigger id="line-sort" className="field-select" aria-label="Sort by">
            <Select.Value />
            <Select.Icon className="field-select-caret" aria-hidden="true">
              <ChevronDownIcon />
            </Select.Icon>
          </Select.Trigger>
          <FieldSelectContent>
            {SORT_OPTIONS.map((o) => (
              <Select.Item key={o.value} value={o.value} className="field-select-item">
                <Select.ItemText>{o.label}</Select.ItemText>
              </Select.Item>
            ))}
          </FieldSelectContent>
        </Select.Root>
        <label className="control-check">
          <FieldCheckbox
            ariaLabel="Group by style"
            checked={view.groupByStyle}
            onCheckedChange={view.setGroupByStyle}
          />
          Group by style
        </label>
      </div>
      {Object.keys(lines).length === 0 && <div className="empty">No lines yet.</div>}
      {groups.map((g) => {
        // Only a real GROUP collapses. Guarding on the label keeps a
        // collapsed "Custom" (key '') from swallowing the whole ungrouped
        // list, which shares that key, when the checkbox goes back off.
        const collapsed = g.label !== null && view.collapsed.has(g.key);
        return (
          <Fragment key={g.key}>
            {g.label !== null && (
              <div className="list-header group-header">
                <button
                  type="button"
                  className="section-toggle grow"
                  aria-expanded={!collapsed}
                  title={collapsed ? 'Expand group' : 'Collapse group'}
                  onClick={() => view.toggleGroup(g.key)}
                >
                  {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  {g.label}
                </button>
              </div>
            )}
            {!collapsed && g.lines.map((ln) => <LineRow key={ln.id} line={ln} />)}
          </Fragment>
        );
      })}
    </section>
  );
}
