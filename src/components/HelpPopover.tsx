import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cross2Icon, QuestionMarkIcon } from '@radix-ui/react-icons';
import { isInFormField, useDismiss } from './usePopover';
import { SNAP_TOGGLE_COUNT, SNAP_TOGGLE_NAMES } from './SnapToggleBar';
import { VISIBILITY_ITEMS } from '../state/visibility';

/** The layers that carry a bare-letter shortcut, in View-menu order — the same
 *  entries App.tsx binds the keys from, so the row below and the keyboard
 *  cannot come to describe different sets. */
const LETTERED_LAYERS = VISIBILITY_ITEMS.filter((i) => i.shortcut);

interface HelpRow {
  k: string; // the gesture/key, rendered as a <kbd> chip
  effect: string;
}
interface HelpSection {
  title: string;
  rows: HelpRow[];
}

// Every row here is verified by hand against the actual handlers (App.tsx
// keyboard map, useStationInteraction, useRectSelect, the canvas drag hooks,
// …) — when an interaction changes, update its row. The exceptions are the two
// rows whose keys come from a registry that also FIXES them: the snap row (the
// toggle bar's ladder, whose indices are the digit keys) and the layer row
// (VISIBILITY_ITEMS, whose `shortcut` field is what App.tsx binds). Neither is
// re-listed here; see them below.
const SECTIONS: HelpSection[] = [
  {
    title: 'Navigate',
    rows: [
      { k: 'Wheel', effect: 'Zoom at the cursor' },
      { k: 'Space / middle-drag', effect: 'Pan — H hand tool, V arrow tool' },
    ],
  },
  {
    title: 'Select',
    rows: [
      { k: 'Click', effect: 'Select — click the background to deselect' },
      { k: 'Shift+click', effect: 'Add / remove from the selection' },
      {
        k: 'Drag background',
        effect: 'Marquee — Shift adds, Ctrl+Shift inverts, Alt includes locked items',
      },
      { k: 'Alt+click', effect: 'Cycle stacked items under the cursor (locked items last)' },
      { k: 'Esc', effect: 'Clear selection — exit any mode' },
    ],
  },
  {
    title: 'Move & edit',
    rows: [
      { k: 'Drag', effect: 'Move, snapping to lines/grid — Shift bypasses snap' },
      { k: 'Arrows', effect: 'Nudge 1 unit — Shift ×5' },
      {
        k: 'Right-click',
        effect: 'Rotate 45° — a multi-selection rotates around the clicked item',
      },
      { k: 'Delete', effect: 'Delete the selection (or selected polygon vertices)' },
      {
        k: 'Ctrl+C · X · V · D',
        effect: 'Copy · cut · paste · duplicate (bullets, labels, polygons, images)',
      },
      { k: 'Ctrl+Z · Ctrl+Y', effect: 'Undo · redo' },
    ],
  },
  {
    title: 'Stations',
    rows: [
      { k: 'Double-click', effect: 'Edit this station’s layout (dots + name placement)' },
      { k: 'Shift+double-click', effect: 'Rename' },
      {
        k: 'Ctrl+click',
        effect: 'Even out stop spacing from the selected station to the clicked one',
      },
      { k: 'Ctrl+drag', effect: 'Drag while continuously re-spacing toward the selected station' },
      {
        k: 'Ctrl+Shift+click',
        effect: 'Select the whole path between stations along a shared line',
      },
      {
        k: 'Edit layout',
        effect:
          'While editing a layout: drag dots/label between slots — R or right-click rotates, arrows hop, Alt+arrows fine-nudge the label',
      },
    ],
  },
  {
    title: 'Lines',
    rows: [
      { k: 'Click a stripe', effect: 'Edit the line — same as clicking it in the sidebar' },
      {
        k: 'Click stations',
        effect:
          'First click sets the cursor; each next click connects from it (members close loops, interior stops grow branches)',
      },
      {
        k: 'Click a segment',
        effect:
          'Arm insertion into that edge — station/Alt clicks splice in, marching to the far end',
      },
      {
        k: 'Double-click a station',
        effect: 'Leave the editor and edit that stop’s layout (stations on this line only)',
      },
      { k: 'Alt+click canvas', effect: 'Create a station and connect/splice it in one go' },
      {
        k: 'Del / ×',
        effect: 'Remove the armed stop or segment',
      },
      { k: 'Shift+click segment', effect: 'Cycle that segment’s style' },
      { k: 'Esc', effect: 'Drop the cursor, then exit the editor' },
      { k: 'Right-click', effect: 'Exit the editor' },
      { k: 'Tag', effect: 'Drag slides it along the line — right-click cycles text/chevron' },
    ],
  },
  {
    title: 'Snap',
    rows: [
      // Built from the toggle bar's own ladder, not re-listed: the digit keys
      // ARE its indices (see App.tsx's SNAP_TOGGLE_COUNT bound), so a toggle
      // added or reordered there would otherwise leave this row describing a
      // bar that no longer exists.
      {
        k: `1 – ${SNAP_TOGGLE_COUNT}`,
        effect: `Toggle the snap options (${SNAP_TOGGLE_NAMES.join(', ')}) — press again to cycle direction`,
      },
      { k: 'Ctrl+Shift+0 – 9', effect: 'Save the current snap options as that preset' },
      { k: 'Shift+0 – 9', effect: 'Recall that snap preset' },
    ],
  },
  {
    title: 'Guides',
    rows: [
      {
        k: 'Top / left edge',
        effect: 'Drag out of the edge strip to pull an alignment guide — everything snaps to it',
      },
      {
        k: 'Left corners',
        effect: 'Drag out of a corner square for a diagonal guide — upper-left /, lower-left \\',
      },
      {
        k: 'Ctrl while dragging',
        effect:
          'Bound the guide like a highlighter: where Ctrl went down marks one end, sweep to the other — past the screen edge makes it infinite again',
      },
      {
        k: 'End squares',
        effect:
          'Drag a selected guide’s end to resize the span — a bounded guide also slides along its own line',
      },
      { k: 'Drag back', effect: 'Drop a guide on its well to delete it — click one to edit/lock' },
    ],
  },
  {
    title: 'View',
    rows: [
      // Built from the visibility registry, not re-listed: the registry is
      // where a layer's letter lives and what App.tsx binds it from, so a
      // layer given (or losing) one there would otherwise leave this row
      // naming a keyboard nobody has.
      {
        k: LETTERED_LAYERS.map((i) => i.shortcut).join(' · '),
        effect: `Show / hide ${LETTERED_LAYERS.map((i) => i.label.toLowerCase()).join(' · ')} (the View menu holds the rest)`,
      },
      { k: 'R · Shift+R', effect: 'Toggle the grid · cycle its size (R rotates a selected stop)' },
    ],
  },
  {
    title: 'Modes',
    rows: [
      { k: 'T', effect: 'Transfer: click two stop dots to connect them' },
      {
        k: 'L',
        effect:
          'Layering: click an overlap to cycle which line paints on top (right-click cycles back) — Shift-click spreads the line it already shows',
      },
      { k: 'Esc / right-click', effect: 'Cancel the active mode' },
      { k: '?', effect: 'This guide' },
    ],
  },
];

/**
 * Toolbar "?" button opening a centered quick-reference overlay of every
 * mouse/keyboard gesture. Portals to the `.app` ancestor (like ColorField's
 * picker) so the design tokens + dark mode resolve, and so it escapes the
 * toolbar's z-index:1 stacking context. Dismissed by Escape, an outside
 * (backdrop) mousedown, the X button, or pressing "?" again.
 */
export function HelpPopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useDismiss(open, () => setOpen(false), [btnRef, panelRef]);

  useEffect(() => {
    if (open) setPortalTarget(btnRef.current?.closest('.app') ?? null);
  }, [open]);

  // "?" toggles the guide from anywhere except inside a text field, where
  // it's just typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInFormField(e.target)) return;
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={'tool-btn' + (open ? ' active' : '')}
        title="Help (?) — quick reference"
        aria-label="Help"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <QuestionMarkIcon />
      </button>
      {open &&
        createPortal(
          <div className="help-overlay">
            <div className="help-panel" ref={panelRef} role="dialog" aria-label="Quick reference">
              <div className="help-header">
                <h2>Quick reference</h2>
                <button
                  type="button"
                  className="tool-btn"
                  aria-label="Close help"
                  onClick={() => setOpen(false)}
                >
                  <Cross2Icon />
                </button>
              </div>
              <div className="help-sections">
                {SECTIONS.map((section) => (
                  <section key={section.title} className="help-section">
                    <h3>{section.title}</h3>
                    {section.rows.map((row) => (
                      <div key={row.k} className="help-row">
                        <kbd>{row.k}</kbd>
                        <span>{row.effect}</span>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </div>
          </div>,
          portalTarget ?? document.body,
        )}
    </>
  );
}
