import { useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon, RocketIcon } from '@radix-ui/react-icons';
import { devCounters, type DevCounters } from '../debug/devHandle';
import { HISTORY_LIMIT } from '../state/store';
import { useThemeColors } from '../state/theme';
import { useDevSettings } from '../state/devSettings';
import { ColorField } from './ColorField';
import { NumericFieldRow } from './NumericFieldRow';
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
 * The performance body. Split out so the reading is taken when the section
 * MOUNTS — you expand this because something feels slow, so the numbers have to
 * be from that moment, and collapsing and re-expanding has to take a fresh one.
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
      <p className="dev-note">
        Clipper memory only grows — reloading is the one thing that frees it. If it has reached
        gigabytes while the map feels slow, that is the lead worth chasing.
      </p>
    </>
  );
}

/**
 * The alignment guides' ink recipe, live (see state/devSettings.ts). Colors
 * show the theme's own value until a dial overrides it, so the swatch always
 * mirrors what is on the canvas; Reset puts the whole recipe back, override
 * included.
 */
function GuideRenderControls() {
  const guide = useDevSettings((s) => s.guide);
  const setGuide = useDevSettings((s) => s.setGuide);
  const resetGuide = useDevSettings((s) => s.resetGuide);
  const theme = useThemeColors();
  // Wheel increments read the store rather than this render's props.
  const live = () => useDevSettings.getState().guide;
  return (
    <>
      <div className="options-popover-row">
        <label htmlFor="dev-guide-color" className="options-popover-label">
          Color
        </label>
        <ColorField
          id="dev-guide-color"
          ariaLabel="Guide color"
          value={guide.color ?? theme.alignGuide}
          onChange={(c) => setGuide({ color: c })}
        />
      </div>
      <div className="options-popover-row">
        <label htmlFor="dev-guide-casing" className="options-popover-label">
          Casing
        </label>
        <ColorField
          id="dev-guide-casing"
          ariaLabel="Guide casing color"
          value={guide.casingColor ?? theme.canvasBg}
          onChange={(c) => setGuide({ casingColor: c })}
        />
      </div>
      <div className="options-popover-row">
        <label htmlFor="dev-guide-dash" className="options-popover-label">
          Dash
        </label>
        <input
          id="dev-guide-dash"
          type="text"
          className="dev-text-field"
          spellCheck={false}
          autoComplete="off"
          value={guide.dash}
          onChange={(e) => setGuide({ dash: e.target.value })}
        />
      </div>
      <NumericFieldRow
        id="dev-guide-thickness"
        label="Thickness"
        min={0}
        max={6}
        step={0.25}
        value={guide.thickness}
        getCurrent={() => live().thickness}
        onChange={(n) => setGuide({ thickness: Math.max(0, n) })}
      />
      <NumericFieldRow
        id="dev-guide-min-thickness"
        label="Min thickness"
        min={0}
        max={3}
        step={0.25}
        value={guide.minThickness}
        getCurrent={() => live().minThickness}
        onChange={(n) => setGuide({ minThickness: Math.max(0, n) })}
      />
      <NumericFieldRow
        id="dev-guide-transition-zoom"
        label="Transition zoom %"
        min={25}
        max={800}
        step={25}
        value={guide.transitionZoomPercent}
        getCurrent={() => live().transitionZoomPercent}
        // Zero would divide the sizing ratio by nothing; one percent is as far
        // out as the dial usefully goes anyway.
        onChange={(n) => setGuide({ transitionZoomPercent: Math.max(1, n) })}
      />
      <p className="dev-note">
        Thicknesses are screen px at the transition zoom; below it the ink rides the canvas, down to
        the minimum.
      </p>
      <button type="button" className="ghost-btn" onClick={resetGuide}>
        Reset
      </button>
    </>
  );
}

/** One collapsible top-level entry of the pane, with the disclosure chrome the
 *  item popovers use for their style detail. */
function DevSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="dev-section">
      <button
        type="button"
        className="style-collapse-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span>{title}</span>
      </button>
      {open && <div className="dev-section-body">{children}</div>}
    </section>
  );
}

/**
 * Toolbar "Developer" button: the pane temporary dev controls are stashed in.
 * Same panel chrome and dismissal as Options and View — click the button again,
 * click away, or press Escape.
 *
 * Performance is the counters worth having in hand the next time the map feels
 * slow, and stays collapsed: it is a lead to chase rather than the reason to
 * open the pane, and mounting it is what takes the reading.
 */
export function DevPopover() {
  const { open, setOpen, wrapRef, panelStyle } = usePopover({ anchored: true });
  const panelId = useId();
  return (
    <div className="options-popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'tool-btn' + (open ? ' active' : '')}
        title="Developer — dev-only controls and counters"
        aria-label="Developer"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <RocketIcon />
      </button>
      {open && (
        <div
          className="options-popover dev-popover"
          id={panelId}
          role="dialog"
          aria-label="Developer"
          style={panelStyle}
        >
          <DevSection title="Performance">
            <PerfStats />
          </DevSection>
          <DevSection title="Guide rendering" defaultOpen>
            <GuideRenderControls />
          </DevSection>
        </div>
      )}
    </div>
  );
}
