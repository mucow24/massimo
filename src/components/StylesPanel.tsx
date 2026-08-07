import { Fragment, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  Cross2Icon,
  PlusIcon,
  StarFilledIcon,
  StarIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { selectableStylesOfKind } from '../model/styles';
import { StyleEditor } from './StyleEditor';
import { StopGlyph } from './StopGlyph';
import { useInlineRename } from './useInlineRename';
import type { StyleDef, StyleKind } from '../model/types';

const KIND_ORDER: readonly StyleKind[] = [
  'line',
  'stopDot',
  'station',
  'textLabel',
  'polygon',
  'routeBullet',
  'transfer',
];
const KIND_LABELS: Record<StyleKind, string> = {
  line: 'Lines',
  stopDot: 'Stop dots',
  station: 'Stations',
  textLabel: 'Labels',
  polygon: 'Polygons',
  routeBullet: 'Route bullets',
  transfer: 'Transfers',
};
const KIND_SINGULAR: Record<StyleKind, string> = {
  line: 'line',
  stopDot: 'stop dot',
  station: 'station',
  textLabel: 'label',
  polygon: 'polygon',
  routeBullet: 'route bullet',
  transfer: 'transfer',
};

// A stand-in line color for stopDot row previews (real color comes per line).
const PREVIEW_LINE_COLOR = '#3b7dd8';

// stopDot rows show a small dot preview beside the name so the library reads
// visually. Other kinds have no glyph.
function StyleRowPreview({ def }: { def: StyleDef }) {
  if (def.kind !== 'stopDot') return null;
  return (
    <svg
      width={16}
      height={16}
      viewBox="-8 -8 16 16"
      aria-hidden="true"
      className="stopdot-preview"
    >
      <StopGlyph cx={0} cy={0} style={def.props} lineColor={PREVIEW_LINE_COLOR} serviceCode="A" />
    </svg>
  );
}

/**
 * Click-to-edit style name (MapNameField pattern): the name shows as a
 * button; clicking swaps in an input that commits once on Enter/blur via
 * `renameStyle` and reverts on Escape. A refused rename (empty name, the
 * reserved "Custom", or a same-kind collision — the transform no-ops) simply
 * re-renders the old name.
 */
function StyleNameField({ id, name }: { id: string; name: string }) {
  const renameStyle = useDoc((s) => s.renameStyle);
  const { editing, start, inputProps } = useInlineRename((draft) => renameStyle(id, draft));

  if (editing) {
    return <input className="style-name-input grow" aria-label="Style name" {...inputProps} />;
  }

  return (
    <button
      type="button"
      className="style-name grow"
      aria-label={`Rename ${name}`}
      title="Rename style"
      onClick={() => start(name)}
    >
      {name}
    </button>
  );
}

/**
 * Sidebar "Styles" tab body: every named style grouped by kind. Each row
 * expands into a direct editor of the style's parameters (StyleEditor) with
 * live preview — editing re-stamps every item wearing the style. "+" per
 * kind creates a fresh style from factory defaults; names are click-to-
 * rename; deleting keeps items' formatting (they just read Custom again).
 * Styles can also be captured by example from an item popover's "Save
 * style…".
 *
 * Exactly one style per kind is the DEFAULT (new items are created wearing
 * it): a filled star marks it, an outline-star button on every other row
 * re-assigns it. The last style of a kind can't be deleted — the designation
 * always has somewhere to point.
 */
export function StylesPanel() {
  const styles = useDoc((s) => s.styles);
  const styleDefaults = useDoc((s) => s.styleDefaults);
  const setDefaultStyle = useDoc((s) => s.setDefaultStyle);
  const deleteStyle = useDoc((s) => s.deleteStyle);
  const createStyle = useDoc((s) => s.createStyle);
  const duplicateStyle = useDoc((s) => s.duplicateStyle);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Collapsed kind sections. Ephemeral like expandedId — a fresh panel opens
  // with every section expanded.
  const [collapsedKinds, setCollapsedKinds] = useState<ReadonlySet<StyleKind>>(new Set());

  const toggleKind = (kind: StyleKind) => {
    setCollapsedKinds((prev) => {
      const next = new Set(prev);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  };

  const onCreate = (kind: StyleKind) => {
    // Re-open a collapsed section so the fresh style's editor is visible.
    setCollapsedKinds((prev) => {
      if (!prev.has(kind)) return prev;
      const next = new Set(prev);
      next.delete(kind);
      return next;
    });
    setExpandedId(createStyle(kind));
  };

  return (
    <section>
      {KIND_ORDER.map((kind) => {
        // The reserved "None" stop-dot is offered in the picker but hidden from
        // the editable list (nothing to edit; protected from rename/delete).
        // Same helper the model's delete uses, so the list, the last-style
        // guard below, and the fallback a delete picks cannot disagree.
        const defs = selectableStylesOfKind(styles, kind);
        const collapsed = collapsedKinds.has(kind);
        return (
          <Fragment key={kind}>
            <div className="list-header">
              <button
                type="button"
                className="section-toggle grow"
                aria-expanded={!collapsed}
                title={collapsed ? 'Expand section' : 'Collapse section'}
                onClick={() => toggleKind(kind)}
              >
                {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                {KIND_LABELS[kind]}
              </button>
              <button
                className="btn-mini icon"
                aria-label={`New ${KIND_SINGULAR[kind]} style`}
                title={`New ${KIND_SINGULAR[kind]} style`}
                onClick={() => onCreate(kind)}
              >
                <PlusIcon />
              </button>
            </div>
            {!collapsed &&
              defs.map((d) => {
                const expanded = expandedId === d.id;
                const isDefault = styleDefaults[kind] === d.id;
                return (
                  <div key={d.id}>
                    <div className={'list-row' + (expanded ? ' style-open' : '')}>
                      <button
                        className="btn-mini icon"
                        aria-label={`Edit ${d.name}`}
                        aria-expanded={expanded}
                        title={expanded ? 'Collapse' : 'Edit style'}
                        onClick={() => setExpandedId(expanded ? null : d.id)}
                      >
                        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                      </button>
                      <StyleRowPreview def={d} />
                      <StyleNameField id={d.id} name={d.name} />
                      {/* Duplicate: a fresh "{name} copy" of this style, expanded
                        for immediate editing. */}
                      <button
                        className="btn-mini icon"
                        aria-label={`Duplicate ${d.name}`}
                        title="Duplicate style"
                        onClick={() => setExpandedId(duplicateStyle(d.id))}
                      >
                        <CopyIcon />
                      </button>
                      {/* One persistent button (not a button/indicator swap):
                        activating it re-renders the row, and replacing the
                        focused element would drop keyboard focus to <body>. */}
                      <button
                        className={`btn-mini icon${isDefault ? ' style-default-star' : ''}`}
                        aria-pressed={isDefault}
                        aria-label={
                          isDefault ? `${d.name} is the default` : `Make ${d.name} the default`
                        }
                        title={
                          isDefault
                            ? `Default ${KIND_SINGULAR[kind]} style (new ${KIND_SINGULAR[kind]}s use it)`
                            : 'Make default'
                        }
                        onClick={() => setDefaultStyle(d.id)}
                      >
                        {isDefault ? <StarFilledIcon /> : <StarIcon />}
                      </button>
                      <button
                        className="btn-mini danger"
                        aria-label={`Delete ${d.name}`}
                        title={
                          defs.length === 1
                            ? 'The last style of a kind can’t be deleted'
                            : `Delete style (existing ${KIND_SINGULAR[kind]}s do not change)`
                        }
                        disabled={defs.length === 1}
                        onClick={() => deleteStyle(d.id)}
                      >
                        <Cross2Icon />
                      </button>
                    </div>
                    {expanded && <StyleEditor def={d} />}
                  </div>
                );
              })}
          </Fragment>
        );
      })}
    </section>
  );
}
