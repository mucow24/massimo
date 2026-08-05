import { Fragment, useMemo } from 'react';
import { ChevronDownIcon, ChevronRightIcon, Cross2Icon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { useDoc, useSelection } from '../state/store';
import { useRenderDoc } from '../state/renderDoc';
import { useLineListPrefs } from '../state/lineListPrefs';
import type { LineSortColumn } from '../state/lineListPrefs';
import { FieldCheckbox } from './FieldCheckbox';
import { FieldSelectContent } from './FieldSelectContent';
import { groupLinesForList } from './lineListOrder';
import { lineDisplayName } from '../model/lineNaming';
import { legibleTextOn } from '../util/color';
import type { Line } from '../model/types';

// The sort dropdown's options, in menu order.
const SORT_OPTIONS: readonly { value: LineSortColumn; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'stops', label: '# Stops' },
];

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
export function LinesPanel() {
  const lines = useRenderDoc((s) => s.lines);
  const styles = useDoc((s) => s.styles);
  const sortBy = useLineListPrefs((s) => s.sortBy);
  const setSortBy = useLineListPrefs((s) => s.setSortBy);
  const groupByStyle = useLineListPrefs((s) => s.groupByStyle);
  const setGroupByStyle = useLineListPrefs((s) => s.setGroupByStyle);
  const collapsedGroups = useLineListPrefs((s) => s.collapsed);
  const toggleGroup = useLineListPrefs((s) => s.toggleGroup);

  const groups = useMemo(
    () => groupLinesForList(Object.values(lines), styles, { sortBy, groupByStyle }),
    [lines, styles, sortBy, groupByStyle],
  );

  const isEmpty = Object.keys(lines).length === 0;

  return (
    <section>
      {/* The list's controls ride the top of the scroll box. They are NOT a
          footer: a bar pinned to the bottom sits under the horizontal
          scrollbar the moment a long line name widens the list. With no lines
          there is nothing to sort or group, so the bar goes entirely. */}
      {!isEmpty && (
        <div className="list-controls">
          <label htmlFor="line-sort">Sort by:</label>
          <Select.Root value={sortBy} onValueChange={(v) => setSortBy(v as LineSortColumn)}>
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
              checked={groupByStyle}
              onCheckedChange={setGroupByStyle}
            />
            Group by style
          </label>
        </div>
      )}
      {isEmpty && <div className="empty">No lines yet.</div>}
      {groups.map(({ key, label, lines: rows }) => {
        // Only a real group carries a collapse key — the ungrouped list's is
        // null, so no leftover entry can ever collapse the whole list.
        const collapsed = key !== null && collapsedGroups.has(key);
        return (
          <Fragment key={key ?? 'all'}>
            {key !== null && label !== null && (
              <div className="list-header group-header">
                <button
                  type="button"
                  className="section-toggle grow"
                  aria-expanded={!collapsed}
                  title={collapsed ? 'Expand group' : 'Collapse group'}
                  onClick={() => toggleGroup(key)}
                >
                  {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                  {label}
                </button>
              </div>
            )}
            {!collapsed && rows.map((ln) => <LineRow key={ln.id} line={ln} />)}
          </Fragment>
        );
      })}
    </section>
  );
}
