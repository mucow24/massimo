import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cross2Icon, QuestionMarkIcon } from '@radix-ui/react-icons';
import { isInFormField, useDismiss } from './usePopover';

interface HelpRow {
  k: string; // the gesture/key, rendered as a <kbd> chip
  effect: string;
}
interface HelpSection {
  title: string;
  rows: HelpRow[];
}

// Every row here is verified against the actual handlers (App.tsx keyboard
// map, useStationInteraction, useRectSelect, the canvas drag hooks, …) — when
// an interaction changes, update its row.
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
      {
        k: '1 – 6',
        effect:
          'Toggle the snap options (line, equidistant, grid length, all, grid, circle cardinals) — press again to cycle direction',
      },
      { k: 'Ctrl+Shift+0 – 9', effect: 'Save the current snap options as that preset' },
      { k: 'Shift+0 – 9', effect: 'Recall that snap preset' },
    ],
  },
  {
    title: 'View',
    rows: [
      { k: 'A · W', effect: 'Show / hide anchors · waypoints (the View menu holds the rest)' },
      { k: 'G · Shift+G', effect: 'Toggle the grid · cycle its size' },
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
        title="Help (?) — quick reference sheet"
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
