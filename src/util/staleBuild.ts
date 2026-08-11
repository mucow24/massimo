/**
 * Recognizing the one failure a reload fixes.
 *
 * Chunk filenames carry a content hash, and a deploy replaces the whole of
 * dist/ at once. A tab left open across a deploy keeps running the old entry
 * chunk, which asks for the old hashes — so the first *lazy* import after a
 * deploy 404s, however healthy the code is. Exports are where this lands: they
 * all pull the glyph outliner (and PDF its renderer) on demand, so a page that
 * has been open all morning fails at the moment of export and nowhere else.
 *
 * The browser reports it as a fetch failure naming a chunk URL, which reads
 * like a broken build and offers the user nothing to do. Nothing in the app can
 * repair it — the running code is simply out of date — so the only useful
 * response is to name the situation and ask for a reload.
 *
 * Vite 5 does dispatch a cancelable `vite:preloadError` on `window` carrying
 * this same error, and it is deliberately not used: its built `__vitePreload`
 * helper routes `baseModule().catch(...)` through the same handler, so the
 * event fires just as readily for a chunk that loaded fine and threw while
 * evaluating. It announces that something went wrong during an import; it
 * cannot say the import failed to arrive. The classifying still has to happen
 * here, and once it does the event adds nothing — the helper rethrows the
 * original error, so every `import()` call site already sees it.
 */

/**
 * What the user is told when a chunk would not load. Shared by both surfaces
 * that can hit it — the export toast and the boot screen — because the
 * situation and the remedy are the same either way.
 *
 * It says what happened and what to do, and stops there. A stranded build is
 * the common cause but not a provable one — the same rejection arrives when
 * the network is down, when an extension or proxy blocks the request, and when
 * the CDN blips — and none of that changes the answer, which is to reload.
 */
export const STALE_BUILD_MESSAGE =
  'Something went wrong loading part of massimo. Reload the page and try again.';

/**
 * The engines' wordings for an import that found nothing at the URL it was
 * built with. Matched as text because that is all the platform gives us: a
 * failed `import()` rejects with a plain TypeError carrying no code of its own.
 * Chromium's comes first (the only family massimo supports); Firefox's and
 * Safari's cost nothing to carry. The last is Vite's own, for a stylesheet
 * preload that 404s the same way.
 */
const CHUNK_FETCH_WORDINGS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

/** How deep to follow wrappers. Also what makes a cyclic chain terminate. */
const MAX_CAUSE_DEPTH = 5;

/**
 * What to put on the boot screen when the clipper engine never resolved.
 *
 * Two unrelated failures arrive at `main.tsx` as one rejection, and they want
 * opposite things said. A stranded chunk is ordinary and self-healing, so it
 * gets the reload. A genuinely absent engine is not, and keeps the pointed
 * message it has always had — there is a real setting to check, and no reload
 * will conjure WebAssembly onto a machine without it.
 *
 * Lives here rather than inline in `main.tsx` so the choice is testable: that
 * module mounts the app as an import side effect and cannot be exercised.
 */
export function bootFailureMessage(err: unknown): string {
  return isStaleChunkError(err)
    ? STALE_BUILD_MESSAGE
    : 'Could not load the polygon clipping engine, so the map cannot be drawn. ' +
        'Check the console, and that WebAssembly is enabled.';
}

/**
 * True when `err` is — or wraps — a chunk that could not be fetched.
 *
 * The wrapping matters as much as the match. Boot never sees the raw failure:
 * `clip.ts` catches it and rethrows a `ClipperUnavailableError` holding the
 * original as `reason`, so a check of the outer message alone would read a
 * stranded build as a broken WebAssembly install. Both `cause` (the standard
 * field) and `reason` are followed, since a wrapper may use either.
 */
export function isStaleChunkError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return false;
    // Bound to a const: `current` is a reassigned `let`, so its narrowing does
    // not survive into the callback below.
    const here = current;
    if (CHUNK_FETCH_WORDINGS.some((re) => re.test(here.message))) return true;
    const wrapper = here as Error & { cause?: unknown; reason?: unknown };
    current = wrapper.cause ?? wrapper.reason;
  }
  return false;
}
