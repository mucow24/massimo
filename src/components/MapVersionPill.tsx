import { useLibraryPointer } from '../state/libraryPointer';
import { useSaveStatus } from '../state/saveBaseline';

/**
 * The live document's version, beside the map name: the handle you use to talk
 * about a map ("open v32").
 *
 * Absent — not "v0", not an empty pill — whenever there is nothing true to say:
 * a map with no saves under it yet, or a JSON file, which is not a library map
 * at all. A pill that shows a number the library cannot resolve is worse than
 * no pill.
 *
 * It reports the version the document CAME FROM, and says nothing about whether
 * the canvas still matches it — that is the dot's job. The dot is painted
 * whenever the doc is not clean, pill or no pill: red for unsaved changes, blue
 * for a clean doc the library holds no copy of (a loaded file, a fresh New). It
 * is the same predicate that greys out Save version, so the two never disagree.
 *
 * The dot's box stays MOUNTED when clean (CSS visibility hides the paint):
 * unmounting it shrank the toolbar's min-content width by the dot plus its
 * flex gaps (~18px), and in a window narrow enough to h-scroll, that reflow
 * re-clamps scrollX — the whole page visibly jumped on every save and on the
 * first edit after.
 */
export function MapVersionPill() {
  const version = useLibraryPointer((s) => s.version);
  const status = useSaveStatus();
  return (
    <>
      {version !== null && (
        <span className="map-version-pill" title={`This map came from version ${version}`}>
          v{version}
        </span>
      )}
      <span
        className="map-save-dot"
        data-status={status}
        title={
          status === 'dirty'
            ? 'Unsaved changes'
            : status === 'unsaved'
              ? 'Not saved to the library yet'
              : undefined
        }
      />
    </>
  );
}
