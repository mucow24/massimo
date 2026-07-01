import { useRef, useState } from 'react';
import { useDoc } from '../state/store';
import { MAP_NAME_DEFAULT } from '../model/transforms';

/**
 * Click-to-edit map name for the toolbar. Displays the current name as a button;
 * clicking swaps in a text input pre-filled with the name. The edit commits once
 * (on Enter or blur) via a single `setDocName` — so a rename is one undo entry —
 * and reverts on Escape. An empty/whitespace commit falls back to the default
 * name so the map is never nameless (which would break the export filename).
 */
export function MapNameField() {
  const name = useDoc((s) => s.name);
  const setDocName = useDoc((s) => s.setDocName);
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
    setDocName(draft.trim() || MAP_NAME_DEFAULT);
  };

  if (editing) {
    return (
      <input
        className="map-name-input"
        aria-label="Map name"
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
    <button type="button" className="map-name" title="Rename map" onClick={startEdit}>
      {name}
    </button>
  );
}
