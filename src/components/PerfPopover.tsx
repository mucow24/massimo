import { useId, useState } from 'react';
import { LightningBoltIcon } from '@radix-ui/react-icons';
import { devCounters, type DevCounters } from '../debug/devHandle';
import { HISTORY_LIMIT } from '../state/store';
import { usePopover } from './usePopover';

interface Stat {
  /** Stable key; also the test id, so the numbers can be asserted on. */
  key: string;
  label: string;
  value: string;
}
interface Group {
  title: string;
  stats: Stat[];
}

const count = (n: number) => n.toLocaleString();
const mb = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;

function groupsOf(c: DevCounters): Group[] {
  return [
    {
      title: 'Memory',
      stats: [
        { key: 'clipper', label: 'Clipper (WebAssembly)', value: mb(c.wasmMB) },
        {
          key: 'js-heap',
          label: 'JavaScript heap',
          // Chrome-only and absent elsewhere; devCounters reports 0 for
          // "no reading", which would otherwise render as a confident 0 MB.
          value: c.heapMB > 0 ? mb(c.heapMB) : 'not reported',
        },
      ],
    },
    {
      title: 'This session',
      stats: [
        { key: 'undo', label: 'Undo steps', value: `${count(c.past)} of ${count(HISTORY_LIMIT)}` },
        { key: 'redo', label: 'Redo steps', value: count(c.future) },
        { key: 'region-cache', label: 'Cached region builds', value: count(c.regionCache) },
      ],
    },
    {
      title: 'Map',
      stats: [
        { key: 'stations', label: 'Stations', value: count(c.stations) },
        { key: 'lines', label: 'Lines', value: count(c.lines) },
        { key: 'region-assignments', label: 'Layering choices', value: count(c.regionAssignments) },
      ],
    },
    {
      title: 'Canvas',
      stats: [
        { key: 'svg-nodes', label: 'Drawn elements', value: count(c.svgNodes) },
        { key: 'clip-paths', label: 'Clip paths', value: count(c.clipPaths) },
        { key: 'defs-nodes', label: 'Definitions', value: count(c.defsNodes) },
      ],
    },
  ];
}

/**
 * The panel body. Split out so the reading is taken when the panel MOUNTS —
 * you press this button because something feels slow, so the numbers have to
 * be from that moment, and re-opening has to take a fresh one.
 */
function PerfStats() {
  const [counters] = useState<DevCounters>(devCounters);
  return (
    <>
      {groupsOf(counters).map((group) => (
        <section key={group.title} className="perf-group">
          <h3 className="perf-group-title">{group.title}</h3>
          {group.stats.map((stat) => (
            <div key={stat.key} className="perf-row" data-testid={`perf-stat-${stat.key}`}>
              <span className="perf-row-label">{stat.label}</span>
              <span className="perf-row-value">{stat.value}</span>
            </div>
          ))}
        </section>
      ))}
      <p className="perf-note">
        Clipper memory only grows — reloading is the one thing that frees it. If it has reached
        gigabytes while the map feels slow, that is the lead worth chasing.
      </p>
    </>
  );
}

/**
 * Toolbar "Perf" button: a snapshot of the counters worth having in hand the
 * next time the map feels slow. Same panel chrome and dismissal as Options and
 * View — click the button again, click away, or press Escape.
 */
export function PerfPopover() {
  const { open, setOpen, wrapRef, panelStyle } = usePopover({ anchored: true });
  const panelId = useId();
  return (
    <div className="options-popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'tool-btn' + (open ? ' active' : '')}
        title="Perf — counters for diagnosing a slow session"
        aria-label="Perf"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <LightningBoltIcon />
      </button>
      {open && (
        <div
          className="options-popover perf-popover"
          id={panelId}
          role="dialog"
          aria-label="Performance"
          style={panelStyle}
        >
          <PerfStats />
        </div>
      )}
    </div>
  );
}
