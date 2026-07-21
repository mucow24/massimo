import { useDoc } from '../state/store';
import { MAP_NAME_DEFAULT } from '../model/transforms';
import { useInlineRename } from './useInlineRename';

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
  const { editing, start, inputProps } = useInlineRename((draft) =>
    setDocName(draft.trim() || MAP_NAME_DEFAULT),
  );

  if (editing) {
    return <input className="map-name-input" aria-label="Map name" {...inputProps} />;
  }

  return (
    <button type="button" className="map-name" title="Rename map" onClick={() => start(name)}>
      {name}
    </button>
  );
}
