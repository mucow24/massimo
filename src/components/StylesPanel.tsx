import { Fragment, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Cross2Icon,
  PlusIcon,
  StarFilledIcon,
  StarIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { stylesOfKind } from '../model/styles';
import { StyleEditor } from './StyleEditor';
import type { StyleKind } from '../model/types';

const KIND_ORDER: readonly StyleKind[] = [
  'line',
  'textLabel',
  'polygon',
  'routeBullet',
  'transfer',
];
const KIND_LABELS: Record<StyleKind, string> = {
  line: 'Lines',
  textLabel: 'Labels',
  polygon: 'Polygons',
  routeBullet: 'Route bullets',
  transfer: 'Transfers',
};
const KIND_SINGULAR: Record<StyleKind, string> = {
  line: 'line',
  textLabel: 'label',
  polygon: 'polygon',
  routeBullet: 'route bullet',
  transfer: 'transfer',
};

/**
 * Click-to-edit style name (MapNameField pattern): the name shows as a
 * button; clicking swaps in an input that commits once on Enter/blur via
 * `renameStyle` and reverts on Escape. A refused rename (empty name, the
 * reserved "Custom", or a same-kind collision — the transform no-ops) simply
 * re-renders the old name.
 */
function StyleNameField({ id, name }: { id: string; name: string }) {
  const renameStyle = useDoc((s) => s.renameStyle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Escape sets this before blurring so the blur-driven commit is skipped.
  const cancelledRef = useRef(false);

  const startEdit = () => {
    setDraft(name);
    cancelledRef.current = false;
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) return;
    renameStyle(id, draft);
  };

  if (editing) {
    return (
      <input
        className="style-name-input grow"
        aria-label="Style name"
        value={draft}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            cancelledRef.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="style-name grow"
      aria-label={`Rename ${name}`}
      title="Rename style"
      onClick={startEdit}
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const onCreate = (kind: StyleKind) => {
    setExpandedId(createStyle(kind));
  };

  return (
    <section>
      {KIND_ORDER.map((kind) => {
        const defs = stylesOfKind(styles, kind);
        return (
          <Fragment key={kind}>
            <div className="list-header">
              <span className="grow">{KIND_LABELS[kind]}</span>
              <button
                className="btn-mini icon"
                aria-label={`New ${KIND_SINGULAR[kind]} style`}
                title={`New ${KIND_SINGULAR[kind]} style`}
                onClick={() => onCreate(kind)}
              >
                <PlusIcon />
              </button>
            </div>
            {defs.map((d) => {
              const expanded = expandedId === d.id;
              const isDefault = styleDefaults[kind] === d.id;
              return (
                <div key={d.id}>
                  <div className="list-row">
                    <button
                      className="btn-mini icon"
                      aria-label={`Edit ${d.name}`}
                      aria-expanded={expanded}
                      title={expanded ? 'Collapse' : 'Edit style'}
                      onClick={() => setExpandedId(expanded ? null : d.id)}
                    >
                      {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </button>
                    <StyleNameField id={d.id} name={d.name} />
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
                          : 'Delete style (items keep their formatting)'
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
