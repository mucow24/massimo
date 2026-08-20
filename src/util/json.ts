/**
 * The preamble every JSON DOOR runs before it can say anything about a
 * payload's shape: text → a plain object, or a refusal.
 *
 * There are three such doors — the map file (`parse`), the palette file
 * (`parseCustomPalette`) and the clipboard (`readClipboard`) — and until this
 * existed each spelled the same six lines out, two of them repeating the same
 * two user-facing strings verbatim. Which is the real cost: the wording a user
 * sees when a file won't open is not a thing two modules should be able to
 * disagree about, and nothing was holding them together.
 *
 * `null` and non-objects are the same refusal, so a bare `3` or `"hi"` reads as
 * "not a JSON object" rather than reaching a shape gate that has no idea what
 * to make of it. An ARRAY passes (`typeof [] === 'object'`), deliberately: the
 * doors' own format gates reject one on the next line, and tightening here
 * would change which message they answer with.
 *
 * The message-less caller (the clipboard, which returns `null` for anything it
 * doesn't recognize so paste-anything stays safe) simply drops `error`.
 */
export type JsonObjectResult = { ok: true; obj: object } | { ok: false; error: string };

export function parseJsonObject(text: string): JsonObjectResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'File is not a JSON object' };
  }
  return { ok: true, obj: raw };
}
