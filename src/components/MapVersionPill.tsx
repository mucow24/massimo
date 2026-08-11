import { useLibraryPointer } from '../state/libraryPointer';
import { useSaveStatus } from '../state/saveBaseline';

/**
 * The live document's version, beside the map name: the handle you use to talk
 * about a map ("open v32").
 *
 * Shows nothing — not "v0", not an empty pill — whenever there is nothing true
 * to say: a map with no saves under it yet, or a JSON file, which is not a
 * library map at all. A pill that shows a number the library cannot resolve is
 * worse than no pill. But the box stays MOUNTED and reserves its width (CSS
 * visibility hides the paint off data-empty): conditionally mounting it shifted
 * the toolbar by the pill's width plus its flex gap (~28px), and in a window
 * narrow enough to h-scroll that reflow re-clamps scrollX — the whole page
 * jumped on a fresh map's first save (same failure the dot's placeholder fixes).
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
      <span
        className="map-version-pill"
        data-empty={version === null ? '' : undefined}
        title={version !== null ? `This map came from version ${version}` : undefined}
      >
        {version !== null ? `v${version}` : null}
      </span>
      <span
        className="map-save-dot"
        data-status={status}
        title={
          status === 'dirty'
            ? 'Unsaved changes — Ctrl+S saves a version'
            : status === 'unsaved'
              ? 'Not in the library yet — Ctrl+S saves it'
              : undefined
        }
      />
    </>
  );
}
