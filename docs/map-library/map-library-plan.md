# Map Library — Implementation Plan (v3)

Repo: massimo. PLAN ONLY — no code written.
v1 was red-teamed by 49 agents (34/43 confirmed). v2 folded those in plus the user's id-keying
redesign. v3 folds in the Clear/New split, revision `source` tags, and auto-save-before-doc-switch.

---

## 0. Decisions (user's — do NOT relitigate)

| # | Decision |
|---|----------|
| D1 | Substrate = **IndexedDB** |
| D2 | Key = **unique library id**. **Multiple maps may share a name** (à la Google Docs). |
| D2b | The id lives **outside the doc** (`localStorage['massimo-library-current']`). No `MapDoc` schema change. A downloaded JSON carries no id, so load-file → save-to-library creates a NEW map. |
| D3 | **100 revisions/map**, prune oldest |
| D4 | Rows store **`serialize()` output verbatim**; load via **`parse()`**. A row IS a file. |
| D5 | **No rename prompt.** Id-keying means a rename cannot orphan history. Rename is a non-event for the library; the next save records the new name. |
| D6 | **Renames stay undoable.** No undo-snapshot split. `DOC_FIELDS` untouched. |
| D7 | **Clear** = wipe the canvas only. Preserves `name`. Preserves the map id. **Undoable. No dialog.** |
| D12 | **New** (new menu item, top of Canvas) = auto-save current → wipe → reset name to default → mint a new map id → `clearHistory()`. **Not undoable. No dialog** — the auto-save is the backstop. **Aborts if the auto-save fails.** |
| D13 | Every revision carries **`source: 'user' \| 'auto'`**, shown in the revision list. |
| D14 | **Auto-save before ANY document switch** — New, Load → JSON, Load → From library. One rule: nothing that replaces the document can lose the document. |
| D15 | Auto-save gate: skip if the doc has **no content**, or if `serialize()` is **byte-identical to the latest revision's payload**. Compare **before** capturing the thumbnail. No dirty flag (see §5.1). |
| D8 | Dialog = **library manager** via Load → From library… Per-row rename/delete. |
| D9 | Thumbnails **per revision**, captured **at save time**, fit within 240×180, **no font embedding**, PNG data URI. |
| D10 | Menu: New / Save → {JSON, To library} / Load → {JSON…, From library…} / Export / Clear |
| D11 | Save confirmation reuses a **widened `menuError`**. No new Toast component (one already exists — §1). |

### Deleted (do not resurrect)
- The `UNDO_FIELDS` / `pickUndoSnapshot` / `undoSnapshotsEqual` split, and every change to `history.ts` and `store.ts`'s undo plumbing. **v1 blocker #2, gone.**
- The rename prompt, async `MapNameField.commit()`, all changes to `MapNameField.tsx`/`.test.tsx`, inverting `store.docName.test.ts`.
- `Toast.tsx` / `Toast.test.tsx`.
- `renameMap` merge semantics (ids cannot collide).
- The Clear confirm dialog (Clear is undoable now).

---

## 1. Ground truth (verified; red-team corrections folded in)

Confirmed exact: `serialize.ts:182-185` / `:157` / `:225`; `DOC_FIELDS` (`store.ts:92-119`); `clearHistory` = cancel + clear (`history.ts:53-56`); `MenuItem` has no `disabled` prop (`Menu.tsx:45`); `setDocName` does no trim (`transforms.ts:1727`); `fake-indexeddb` absent from devDeps; the `pre-pr` chain; every line of `exportCanvas.ts`.

**Corrections the red team forced (each cost v1 a wrong decision):**
- `loadDoc` is at **store.ts:938**, not ":961 area" (`:961` is `clearAll`).
- **A toast ALREADY EXISTS**: `canvas/WarningToasts.tsx` (rendered `MapCanvas.tsx:1833`), CSS `.warning-toasts .toast` at `styles.css:1588-1608`, dark at `:1786-1794`, tests `WarningToasts.test.tsx:56-80`. Persistent, canvas-scoped, doc-derived, at `right:12px; bottom:12px` — the exact corner a save toast wants. **A bare `.toast` selector leaks into it.** What genuinely doesn't exist: any `aria-live`/`role="status"` channel.
- **jsdom `getBBox` is already stubbed here**: `exportCanvas.test.ts:9-20` (`stubGetBBox()` on `SVGGraphicsElement.prototype`); `:100-116` already tests framing + `pixelScale` through the real `buildExportSvg`. Also `exportCanvasPdf.test.ts:102,133`. Only the `toDataURL`/`toBlob` half is untestable (no `canvas` package).
- **`onFileChosen`'s missing `selectLabel(null)` is redundancy, not a bug.** `clearedSelections()` (`selection.ts:97-111`) already has `selectedLabelIds: []`, and `selectStation(null)` — first call in both lists — already clears it. `onClear`'s 8th call is **dead code**. Real (tiny) gap: `hoveredStationId` is absent from `clearedSelections()`.
- **`useDismiss` has an `escape` opt** (`usePopover.ts:31`, docstring `:25-28`, dep array `:57`); precedent `{escape: false}` at `StationInspector.tsx:113`. The `.color-field-popover` hatch (`usePopover.ts:39`) is hardcoded to that class.
- **`user.click` does NOT work on a `SubMenu` leaf in jsdom** — SubMenu closes via `onMouseLeave` (`Menu.tsx:76-77`) and userEvent's pointer movement tears it down first. Workaround + comment already in-repo at `Toolbar.test.tsx:400-403`; helper `openExportSubmenu` at `:389-392`. Symptom (`called 0 times`) is indistinguishable from "not built yet".
- **Portal needs a fallback**: `HelpPopover.tsx:130` + `:189` (`portalTarget ?? document.body`), `ColorField.tsx:148`. `.app` exists only at `App.tsx:654`; React 18.3.1 throws on a null container.
- **`menuError`**: `useState` at `Toolbar.tsx:79`, rendered as a dismissible `role="alert"` span at `:364-379`, already serving export failures (`:156`,`:180`) and parse errors (`:210`). `void fn()` marker at `:189-190`.
- **eslint has no type-aware rules** (`tsPlugin.configs.recommended`, no `parserOptions.project`) → `no-floating-promises`/`no-misused-promises` inactive. A rejected promise from `MenuItem onClick` is a silent `unhandledrejection`.
- **`seedAndOpen`** (`e2e/fixtures.ts:208-227`) = write localStorage → `page.reload()` → wait for SVG. **The doc rehydrates from `vignelli-map-doc-v1` on reload** — this is why v1's e2e #27 was a tautology. 15 specs use `localStorage.removeItem(...)` (`e2e/export.spec.ts:28-29`).
- **`src/test/setup.ts:1-31`** has only `cleanup()` — no `beforeEach`, no storage reset.
- Empty-list precedent: `Sidebar.tsx:235`/`:316` + `.empty` (`styles.css:1610`) — **both read synchronously**; no async-loaded list exists in `src/` to model on.
- `computeContentBounds(doc)` (`geometry/contentBounds.ts`) is **pure over MapDoc**, returns null for an empty map, already used by `fitCameraToDoc` (`Toolbar.tsx:114-122`). This is the app's own definition of "is there anything here" — reuse it as D15's content gate.

---

## 2. Storage schema

DB `massimo-library`, version 1.

```ts
// 'maps'       keyPath 'id'
type MapRow      = { id: string; name: string; updatedAt: number };                                  // ~80 B
// 'revisions'  keyPath 'id' (autoIncrement), index 'mapId' (non-unique)
type RevisionRow = { id: number; mapId: string; savedAt: number; source: 'user'|'auto'; thumb?: string }; // ~15 KB
// 'payloads'   keyPath 'id'  (id === the revision's id)
type PayloadRow  = { id: number; json: string };                                                     // ~256 KB
```

- **`maps` carries the name** so D8's rename has somewhere to write without rewriting a saved revision's JSON. It tracks `doc.name` as of the last save.
- **`payloads` is split off** so listing never pulls JSON. `listMaps()` = `maps.getAll()` (~80 B/row); one map's revision list = `revisions.index('mapId').getAll(id)` (~1.5 MB at a full 100 — one map, on demand, and those thumbs are the ones being painted).
- Thumbs sit **on the revision row**, not a 4th store: every revision row read is one whose thumb is about to render. `listMaps()` gets each map's latest thumb via `index.openCursor(only(mapId),'prev')` (first record only) + `index.count(only(mapId))` — two cheap ops per map, no 100-row read.
- **Current-map pointer**: `localStorage['massimo-library-current']`, a bare id (~36 B). Not a store — nothing reacts to it. (The localStorage objection was always size; this is 36 bytes.)

---

## 3. Module API — `src/state/mapLibrary.ts`

Knows **nothing** about `MapDoc`. Opaque strings only.

```ts
export const REVISION_LIMIT = 100;
export type RevisionSource = 'user' | 'auto';
export interface MapSummary   { id: string; name: string; updatedAt: number; revisionCount: number; thumb?: string }
export interface RevisionMeta { id: number; mapId: string; savedAt: number; source: RevisionSource; thumb?: string }

export function saveRevision(mapId: string, name: string, json: string, source: RevisionSource, thumb?: string): Promise<number>;
export function listMaps(): Promise<MapSummary[]>;                      // desc by updatedAt
export function listRevisions(mapId: string): Promise<RevisionMeta[]>;  // desc by savedAt
export function getPayload(revisionId: number): Promise<string | undefined>;
export function renameMap(mapId: string, name: string): Promise<void>;
export function deleteMap(mapId: string): Promise<void>;
export function deleteRevision(revisionId: number): Promise<void>;
export function newMapId(): string;                                     // crypto.randomUUID()
export function getCurrentMapId(): string | null;
export function setCurrentMapId(id: string | null): void;
export function __closeForTests(): void;
```

Connection: cached `IDBDatabase` with `db.onversionchange = () => { db.close(); cached = null; }` so a `deleteDatabase` can never wedge on `blocked`.

`saveRevision` in ONE readwrite transaction over all three stores: `put` maps row → `add` revision → id → `put` payload → prune (cursor the `mapId` index ascending; delete revision + payload until count ≤ 100). **No non-IDB `await` between steps** or the transaction auto-closes.

---

## 4. Files

### New
`src/state/mapLibrary.ts` (200) · `src/state/mapLibrary.test.ts` (190) · `src/components/MapLibraryDialog.tsx` (210) · `src/components/MapLibraryDialog.test.tsx` (170) · `src/components/ConfirmDialog.tsx` (60, boolean API — only library deletes need it now) · `src/components/ConfirmDialog.test.tsx` (50) · `e2e/mapLibrary.spec.ts` (110)

### Modified
| File | Change |
|---|---|
| `src/model/transforms.ts` | `clearAll(doc) => ({...DEFAULT_DOC, name: doc.name})` — **the only model change in the feature** |
| `src/export/exportCanvas.ts` | `buildExportSvg` opts += `fitBox?: {w,h}` (**wins over `pixelScale`**) and `embedFonts?: boolean` (default true); new `captureThumbnail(source, background)` |
| `src/components/Toolbar.tsx` | `New` item; Save/Load SubMenus; `onSaveToLibrary`; `autoSaveCurrent()`; dialog mount; `menuError` → `menuStatus: {kind:'error'\|'info'; text}`; extract `adoptParsedDoc()` + `withNeutralSelection()` |
| `src/components/Toolbar.test.tsx` | new menu paths; existing Save test moves one level deeper |
| `src/styles.css` | dialog + confirm CSS; `role="status"` variant of the menu-error span. **Never a bare `.toast`.** |
| `package.json` | `fake-indexeddb` devDep |
| `ARCHITECTURE.md` | document the library |

**NOT modified**: `store.ts`'s undo plumbing, `history.ts`, `store.docName.test.ts`, `MapNameField.*`, `src/test/setup.ts`.

---

## 5. Flows

### 5.1 `autoSaveCurrent()` — the shared doc-switch guard (D14/D15)

```ts
/** Write an 'auto' revision of the live doc before it is replaced. No-op when
 *  there is nothing to save or it would duplicate the latest revision.
 *  THROWS on storage failure — every caller MUST abort its switch. */
async function autoSaveCurrent(): Promise<void> {
  const doc = useDoc.getState();
  if (!computeContentBounds(doc)) return;                 // nothing to lose
  const json = serialize(pickDocSnapshot(doc));
  const id = getCurrentMapId();
  if (id) {
    const latest = (await listRevisions(id))[0];
    if (latest && (await getPayload(latest.id)) === json) return;   // identical
  }
  const thumb = await tryCaptureThumbnail();              // AFTER the gate — only pay when writing
  await saveRevision(id ?? newMapId(), doc.name, json, 'auto', thumb);
}
```

**Why a comparison and not a dirty flag** (decided): a flag answers "did anything touch the doc", the real question is "would this revision duplicate the last one" — they differ (edit-then-undo). And a flag lives in memory, so *edit → refresh → New* reads clean and silently loses the work; the comparison is stateless and cannot have that bug. Cost is one indexed local read on a rare, user-initiated action.

Accepted: `parse()` runs ~20 sanitization passes, so a loaded doc re-serialized is not *guaranteed* byte-identical to its own payload — Load → immediately New may write one redundant `auto` revision. Tagged, legible, harmless.

### 5.2 Save → To library
`onClick={() => void onSaveToLibrary()}` (the `:189-190` marker). `withNeutralSelection` (extracted from `runExport`'s `flushSync` dance) → `getCanvasSvg()` → `try { thumb = await captureThumbnail(...) } catch { thumb = undefined }` (**an empty canvas throws at `exportCanvas.ts:102`; this is what lets a thumbnail-less save succeed**) → `saveRevision(getCurrentMapId() ?? newMapId(), name, json, 'user', thumb)` → `setCurrentMapId(id)` → `setMenuStatus({kind:'info', text: 'Saved to library as "<name>"'})`. Whole body in `try/catch` → `setMenuStatus({kind:'error'})`.

### 5.3 New (D12)
`await autoSaveCurrent()` — **if it throws, surface the error and STOP; do not wipe** → `adoptParsedDoc(DEFAULT_DOC)` (7 selection resets + `loadDoc` + `clearHistory` + camera) → `setViewport({x:0,y:0,zoom:1})` → `setCurrentMapId(newMapId())`. No dialog. `clearHistory()` is correct here and *only* here: New genuinely switches to a different document, which is the same reason the file-load path clears.

### 5.4 Clear (D7)
Selection resets + `clearAll()`. **Nothing else** — no `clearHistory`, no name reset, no id change, no dialog, no auto-save. Ctrl+Z restores everything including the name. Drop `onClear`'s dead 8th `selectLabel(null)`.

### 5.5 Load → JSON…
In `onFileChosen`, after `parse()` succeeds and **before** adopting: `await autoSaveCurrent()` (abort on throw) → `adoptParsedDoc(result.doc)` → `setCurrentMapId(null)` (a file is not a library map — D2b). Auto-save goes after the parse so a cancelled picker or a bad file writes nothing.

### 5.6 Load → From library
`await autoSaveCurrent()` (abort on throw) → `getPayload(revisionId)` → `parse()` → dialog-local error if `!ok` → `adoptParsedDoc(result.doc)` → `setCurrentMapId(mapId)`.

### 5.7 Rename
Toolbar: unchanged, undoable, no library effect. Dialog: `renameMap(id, name)`; if `id === getCurrentMapId()`, also `setDocName(name)` so they can't diverge.

---

## 6. Dialog

Portal to `` document.querySelector('.app') ?? document.body ``. `role="dialog"` `aria-modal="true"` `aria-label="Map library"`.

**Escape ownership (v1 blocker #1):** `MapLibraryDialog` uses `useDismiss`; while a `ConfirmDialog` is open it passes **`{escape: false}`** (`usePopover.ts:31`; precedent `StationInspector.tsx:113`) so one Escape closes only the confirm. The confirm renders **inside the library panel's subtree** so the outside-click check sees it as inside. Do **not** rely on the `.color-field-popover` hatch.

Left column: maps (name, revision count, last saved, latest thumb) + Rename / Delete. Right column: revisions (timestamp, **source tag**, thumb) + Open / Delete.

States, all explicit: **loading** (in-flight `listMaps()` — distinct from empty; a naive port of `Sidebar`'s synchronous `.empty` idiom flashes "No saved maps yet" on first run), **empty** (reuse `.empty`), **populated**; right column **no-selection** / **populated**. `deleteMap` **clears `selectedMapId`** when it targets the selection, or the right column renders a dead map and Open degrades to a bogus "Not valid JSON" (`getPayload` → undefined → `JSON.parse("undefined")` → caught at `serialize.ts:229-231`).

---

## 7. Menu

```tsx
<Menu label="Canvas">
  <MenuItem onClick={() => void onNew()}>New</MenuItem>
  <MenuSeparator />
  <SubMenu label="Save">
    <MenuItem onClick={onSaveJson}>JSON</MenuItem>
    <MenuItem onClick={() => void onSaveToLibrary()}>To library</MenuItem>
  </SubMenu>
  <SubMenu label="Load">
    <MenuItem onClick={onLoadJsonClick}>JSON…</MenuItem>
    <MenuItem onClick={onOpenLibrary}>From library…</MenuItem>
  </SubMenu>
  <SubMenu label="Export"> … unchanged … </SubMenu>
  <MenuSeparator />
  <MenuItem onClick={onClear}>Clear</MenuItem>
</Menu>
```

---

## 8. Test plan (red-first; every red must fail on BEHAVIOR)

**Isolation (v1 blocker #3).** `fake-indexeddb` in `mapLibrary.test.ts` **only**, never the global setup:
```ts
beforeEach(async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  globalThis.indexedDB = new IDBFactory();   // fresh DB — no deleteDatabase, no `blocked` deadlock
  vi.resetModules();
  lib = await import('./mapLibrary');        // fresh module ⇒ no stale cached connection
  localStorage.clear();
});
```
**SubMenu driving.** Trigger opens with `user.click`; **leaf activates with `fireEvent.click`** (`Toolbar.test.tsx:400-403`). Not needed for New/Clear (top-level items).

### `mapLibrary.test.ts` — stub the module first so every red is behavioral
1. `saveRevision` → `getPayload` round-trips the exact string.
2. Two saves, same `mapId` → `listMaps()` has ONE entry, `revisionCount === 2`.
3. Two saves, **different ids, SAME name** → **TWO entries** (D2's whole point).
4. `saveRevision` updates the map row's name → `listMaps()[0].name` is the latest.
5. `source` round-trips: a `'user'` and an `'auto'` save → `listRevisions()` reports each.
6. 101 saves → `listRevisions()` length 100, oldest gone.
7. Pruning deletes the payload too — `getPayload(oldestId)` undefined (orphan-row leak).
8. `renameMap` changes the name, touches no revisions.
9. `deleteMap` removes its revisions + payloads; other maps untouched.
10. `deleteRevision` removes exactly one + its payload.
11. `listMaps` desc by updatedAt; `listRevisions` desc by savedAt.
12. Save with no thumb → payload intact, thumb undefined.
13. `getCurrentMapId`/`setCurrentMapId(null)` round-trip.

### `transforms.test.ts`
14. **`clearAll` preserves the name** and wipes the collections. (Red today — `clearAll` returns `{...DEFAULT_DOC}`.)

### `exportCanvas.test.ts` — extend; `stubGetBBox` already exists at `:9-20`
15. `fitBox` through the **real** `buildExportSvg`, table-driven on the returned `{width,height}`: frame 480×360 + fitBox{240,180} → 240×180; frame 480×120 → 240×60 (width-bound — guards min-vs-max, which would give 720×180); frame 100×50 → 100×50 (guards the no-upscale clamp). **No aspect assertion** — `:116-117` applies one uniform scalar, so letterboxing is architecturally impossible and the assertion unfalsifiable.
16. `embedFonts:false` → no `<style>` emitted; default still embeds.

### `Toolbar.test.tsx`
17. Save → To library calls `saveRevision` with `serialize(pickDocSnapshot(...))`, the current name, and `'user'`.
18. Save → JSON still calls `downloadBlob` once (regression; now a SubMenu leaf).
19. **Empty canvas**: `getCanvasSvg` → stub, `captureThumbnail` → rejects "Nothing to export"; assert `saveRevision` called with `thumb === undefined`, **no error surfaced**.
20. **`saveRevision` rejects** → `menuStatus` error renders, no success message.
21. Save shows the success status; it auto-dismisses.
22. Second save reuses `getCurrentMapId()` — same id twice, `newMapId` not re-minted.
23. **Clear is undoable and keeps the name**: set a name, add a station, Clear → doc empty, name intact, `historyDepth() > 0`; `undo()` → station back. **No confirm dialog appears.**
24. **New auto-saves then wipes**: `saveRevision` called with `'auto'`, then doc is DEFAULT, name is default, `historyDepth() === 0`, `setCurrentMapId` called with a fresh id.
25. **New ABORTS when the auto-save fails**: `saveRevision` rejects → doc **unchanged**, error surfaced, `clearHistory` not called. (The failure the auto-save exists to prevent.)
26. **New skips the auto-save on an empty doc** — `saveRevision` not called.
27. **New skips the auto-save when the payload is identical** — `getPayload` returns the same string → `saveRevision` not called (D15's gate).
28. **Load → JSON auto-saves the outgoing doc first**, then adopts; `setCurrentMapId(null)`.
29. Load → JSON with a **bad file** → no auto-save written, doc unchanged.

### `MapLibraryDialog.test.tsx` — stub first
30. Renders maps; clicking one lists its revisions with their source tags.
31. Open a revision → auto-save fires, then `parse` + `loadDoc` + `clearHistory`; `setCurrentMapId(mapId)`.
32. Corrupt payload → error inside the dialog, doc unchanged.
33. Delete map → confirm → **assert all three: confirm closed, library STILL OPEN, row gone.** (v1's version passed against the very bug it was named for — the library unmounting made the row "disappear".)
34. **Escape with a confirm open closes ONLY the confirm**; the library stays mounted. Blocker #1's real guard.
35. Loading / empty / no-selection states render.

### `e2e/mapLibrary.spec.ts` — real Chromium; the only place real IDB + rasterization run
36. Seed → Save → To library → **Canvas → Clear → assert the canvas is EMPTY** → Load → From library → stations are back. The intermediate empty assertion is **mandatory**: without it the doc just rehydrates from `vignelli-map-doc-v1` and the final assertion cannot fail.
37. The revision row's `<img>` has `naturalWidth`/`naturalHeight` > 0 and ≤ 240/180.
38. Two saves → two revisions, one tagged user; **New** → a third tagged auto.
39. Two maps with the **same name** → two rows.

---

## 9. Sequencing

1. `mapLibrary.ts` + tests 1–13.
2. `clearAll` name preservation — test 14.
3. `captureThumbnail` + `buildExportSvg` opts — tests 15–16.
4. `ConfirmDialog` + CSS.
5. Toolbar: New/Save/Load menus, `menuStatus`, `autoSaveCurrent`, `adoptParsedDoc`, `withNeutralSelection` — tests 17–29.
6. `MapLibraryDialog` — tests 30–35.
7. e2e — 36–39.
8. `npm run pre-pr`.
9. ARCHITECTURE.md.

---

## 10. Known weak points (extend, don't trim)

- **W1** `captureThumbnail`'s rasterization half is untestable in vitest (no `toDataURL`/`toBlob`, no `canvas` package). e2e #37 is the only proof. The framing math IS testable (#15).
- **W2** The theme bakes into the thumbnail. Dark-mode saves sit beside light ones forever.
- **W3** `listMaps()` does 2 index ops per map. Fine at ~5; unmeasured at 100.
- **W4** No IndexedDB quota handling. #20/#25 prove errors surface and New aborts, but there's no pruning-under-pressure story.
- **W5** `hoveredStationId` survives a load holding a stale id (`clearedSelections()` omits it). Transient; not fixed here.
- **W6** `SubMenu` has no keyboard nav and no Escape of its own. Save/Load now sit behind it. Pre-existing, worsened.
- **W7** D2b: Save→JSON→Load→Save-to-library forks a new map. Intended, but it's where "the file is the map" breaks down.
- **W8** Nothing dedupes map names (by design). Two rows can read identically; timestamps and thumbs are the only discriminators.
- **W9** `autoSaveCurrent` reads a 256 KB payload on every doc switch. Single-digit ms locally, but unmeasured.
- **W10** Clear no longer resets the name, but still resets palettes/styles/counters (`{...DEFAULT_DOC}` minus name). That asymmetry is inherited from today's `clearAll`, not introduced here — but it's now visible: "Clear" keeps your title and discards your custom styles.
