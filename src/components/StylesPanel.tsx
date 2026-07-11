import { Fragment, useRef, useState } from 'react';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { stylesOfKind } from '../model/styles';
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

/**
 * Click-to-edit style name (MapNameField pattern): the name shows as a
 * button; clicking swaps in an input that commits once on Enter/blur via
 * `renameStyle` and reverts on Escape. A refused rename (empty name or a
 * same-kind collision — the transform no-ops) simply re-renders the old name.
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
 * Sidebar "Styles" tab body: every named style grouped by kind, with
 * click-to-rename and delete. Creation happens in the item popovers ("Save
 * style…" — define-by-example), so this panel only manages what exists.
 * Deleting a style untags its users but leaves their formatting untouched.
 */
export function StylesPanel() {
  const styles = useDoc((s) => s.styles);
  const deleteStyle = useDoc((s) => s.deleteStyle);

  if (Object.keys(styles).length === 0) {
    return <div className="empty">No styles yet. Save one from an item&apos;s Style dropdown.</div>;
  }

  return (
    <section>
      {KIND_ORDER.map((kind) => {
        const defs = stylesOfKind(styles, kind);
        if (defs.length === 0) return null;
        return (
          <Fragment key={kind}>
            <div className="list-header">
              <span className="grow">{KIND_LABELS[kind]}</span>
            </div>
            {defs.map((d) => (
              <div key={d.id} className="list-row">
                <StyleNameField id={d.id} name={d.name} />
                <button
                  className="btn-mini danger"
                  aria-label={`Delete ${d.name}`}
                  title="Delete style (items keep their formatting)"
                  onClick={() => deleteStyle(d.id)}
                >
                  <Cross2Icon />
                </button>
              </div>
            ))}
          </Fragment>
        );
      })}
    </section>
  );
}
