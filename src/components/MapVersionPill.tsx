import { useLibraryPointer } from '../state/libraryPointer';

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
 * the canvas still matches it — editing v32 leaves this reading v32 until the
 * next save mints v33.
 */
export function MapVersionPill() {
  const version = useLibraryPointer((s) => s.version);
  if (version === null) return null;
  return (
    <span className="map-version-pill" title={`This map came from version ${version}`}>
      v{version}
    </span>
  );
}
