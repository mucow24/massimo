# HANDOVER — Map Library feature

You are picking up a feature that was **fully designed and red-teamed but never implemented**. No production code was written. The tracked tree is clean.

**Read this file first, then `map-library-plan.md`.** The plan is at v3 and is *stale in four specific ways* listed in §3 — fix those before building.

---

## 0. Read this before anything else

**The previous session's designated "red" tests were wrong three rounds running.** Tests #13, #14, #23, #27 and #38 each *passed* against the exact bug they were named for. Every one was caught only because a subagent **ran** it against the unmodified tree instead of reasoning about it.

So: **run every test you call "red" on the unmodified tree before you believe yourself.** If it passes, your red is fake and your TDD is theatre. This is the single highest-value line in this document.

Corollary: this repo's `CLAUDE.md` says *"A red test must fail on behavioral logic, not on plumbing."* The failure mode here was subtler than plumbing — the tests were *behavioral* and still born green, because of fixture defaults and short-circuiting gates. Check the fixture.

---

## 1. What this is

The user's Downloads folder fills with `map.json`, `map (1).json` … `map (42).json`, because **Save is a download** ([Toolbar.tsx:140](../../src/components/Toolbar.tsx#L140) → `downloadBlob`), so the browser has no file identity and dedupes by suffix.

Build an in-app **map library**: Save writes a *revision*; a two-column dialog lists maps (left) and their revisions (right) with thumbnails; rename and delete from that dialog.

Constraints that shaped everything: single-user alpha, no backend, deployed to GitHub Pages, **must work in all browsers**, biggest real map ≈ **256 KB**.

---

## 2. Settled decisions — WITH the reasoning

Conclusions alone are dangerous here: most of these are only defensible in light of something we discarded. Given just the conclusion you will helpfully propose the thing we already rejected. **Do not relitigate these without the user.**

### D1 — Substrate: **IndexedDB**
Rejected, with reasons:
- **localStorage**: ~5 MB shared with `vignelli-map-doc-v1`; synchronous; and zustand persist's `newImpl` calls `void setItem()` with **no try/catch** (`node_modules/zustand/esm/middleware.js:465-471, 475, 480`) over a synchronous `localStorage.setItem` that throws on quota. A full library would make the *next ordinary edit* throw. It would brick the live doc, not fail politely at save time.
- **File System Access API** (`showSaveFilePicker`): Chromium-only, permanently. Mozilla filed **`harmful`** ([standards-positions#154](https://github.com/mozilla/standards-positions/issues/154), **closed**); WebKit filed **`oppose`** ([#28](https://github.com/WebKit/standards-positions/issues/28), **closed**). MDN BCD: `showSaveFilePicker` = `false` (not `null`) for both. This is settled, not pending. User requires all browsers.
  - *Trap*: `FileSystemFileHandle` and `createWritable` **do exist** in Firefox 111+/Safari 15.2+/26+ via OPFS. Any feature detect on the handle types false-positives. Only `'showSaveFilePicker' in window` works.
- **OPFS**: it's a filesystem; this is a key-value store of JSON. Also `createWritable` is Safari 26+; below that you need a Worker + `createSyncAccessHandle`. IndexedDB needs none of that.

### D2 — Key: a **unique library id** (`crypto.randomUUID()`), not the map name
Name-keying produced three problems that all vanish with ids: renames orphaned history; renaming onto an existing name needed invented "merge" semantics; and the shared `'Untitled map'` bucket could not distinguish this doc's history from a previous doc's. **Multiple maps may share a name** (Google Docs).

### D2b — The id lives **outside the doc**: `localStorage['massimo-library-current']`
No `MapDoc` schema change. A downloaded JSON carries no id, so load-file → save-to-library creates a **new** map — same as Google Docs (download a .docx, re-upload, you get a new doc). Putting the id *in* the doc means copying a file gives two files fighting over one history.

> **HAZARD (verified)**: a naive `setCurrentMapId(null)` → `localStorage.setItem(KEY, null)` stores the **string `"null"`**, which is truthy and survives `??`. `getCurrentMapId() ?? newMapId()` then returns `"null"` and every file you load writes into one shared bogus map, forever. Use `removeItem`. `src/` has no raw-localStorage wrapper to inherit correctness from — everything else goes through zustand persist, which handles this itself.

### D3 — 100 revisions per map, prune oldest.

### D4 — Rows store `serialize()` output **verbatim**; load via `parse()`
**A row IS a file.** The DB stores opaque strings and knows nothing about `MapDoc`. This is *not* a third ingestion path — `parse()` already owns all migration, and `serialize()` = `JSON.stringify({format:'massimo-map', version: SCHEMA_VERSION, doc}, null, 2)` ([serialize.ts:182-185](../../src/model/serialize.ts#L182)). Do not "optimize" by storing the structured object — IndexedDB structured-clones, so the temptation is real, and taking it bypasses the version envelope and `parse()` and *creates* the third path.

### D5 — **No rename prompt.** Rename is a non-event for the library.
Id-keying means a rename cannot orphan history. An earlier design had a three-way "rename library map too / fork / cancel" dialog; it existed solely to solve a name-keying problem that no longer exists. The next save records the new name.

### D6 — **Renames stay undoable.** `DOC_FIELDS` untouched.
An earlier design pulled `name` out of the undo snapshot ("Google Docs doesn't undo renames"). Its *only* real justification was a desync: with `clearAll` resetting the name, undo-Clear restored the map still titled "Untitled map". **Id-keying killed that desync.** With ids, an undoable name causes no bug anywhere.

> **DO NOT re-propose the `UNDO_FIELDS` / `pickUndoSnapshot` split.** It was ~20 lines across `store.ts` + `history.ts`, and its type guard didn't even work — `Omit<DocSnapshot,'name'>` is a structural *supertype*, so passing a `DocSnapshot` to `pushHistory` compiles clean (verified against the repo's tsc). It is now pure cost.

### D7 — **Clear** = wipe the canvas. Undoable. No dialog.
**Preserves**: `name`, the map id, `styles`, `styleDefaults`, `activePalettes`, `seamEdges`.
**Wipes**: `stations, lines, lineOrder, lineCounter, lineTags, routeBullets, transfers, textLabels, polygons, polygonOrder, regionAssignments, svgImages, svgImageOrder`.

Why undoable: Clear stays in the **same document**. `clearHistory()` exists on the file-load path because undo would splice *two different documents* — that reasoning does not transfer. An earlier design made Clear non-undoable behind a confirm dialog; that destroys a working recovery path and offers a click-through gate in exchange. It was a mistake, caught by the red team.

Why the wide preservation: once the name survives, Clear reads as *"same document, empty canvas"* — silently dropping your palette activation and define-by-example styles contradicts that. (Today's `clearAll` returns `{...DEFAULT_DOC}` and wipes the name too, which is at least coherent. This is the user's call, made explicitly.)

### D12 — **New** (new Canvas menu item, at top)
Auto-save current → wipe → reset name to default → mint a new map id → `clearHistory()`. **Not undoable. No dialog. Aborts if the auto-save fails.**

Non-undoable is *earned* here: New genuinely switches to a different document, which is exactly when `clearHistory()` is right. And the auto-save is the backstop — recovery is Load → From library, not Ctrl+Z. (This is the distinction the Clear design got wrong.)

### D13 — Every revision carries `source: 'user' | 'auto'`, shown in the revision list.

### D14 — **Auto-save before any document switch**: New, Load → JSON, Load → From library.
One rule, no exceptions: *nothing that replaces the document can lose the document.*

### D8 / D9 / D10 / D11
- **D8**: the dialog is a **library manager** reached via Load → From library…. Per-row rename/delete. You never load-to-delete.
- **D9**: thumbnails **per revision**, captured **at save time** (the only time possible — `MapCanvas()` takes zero props and reads singleton stores, so a doc that isn't on canvas cannot be rendered), fit within 240×180, **no font embedding**, PNG data URI. The theme bakes in.
- **D10**: menu = `New` / `Save → {JSON, To library}` / `Load → {JSON…, From library…}` / `Export` / `Clear`.
- **D11**: the save confirmation reuses a **widened `menuError`** → `menuStatus: {kind:'error'|'info', text}`. **A toast component already exists** — `src/components/canvas/WarningToasts.tsx`, CSS `.warning-toasts .toast` at `styles.css:1588-1608`, sitting at `right:12px; bottom:12px`, the exact corner a save toast wants. **Do not build another, and never write a bare `.toast` selector** — it leaks into that one.

---

## 3. The plan file is stale in exactly four ways

`map-library-plan.md` is v3. These four decisions came after it and are **not** in it:

1. **Clear's preservation widened** (D7 above). The plan says name + id only.
2. **Library deletes get an in-row two-step** — Delete flips to "Sure?", ~5 lines of local state. **Delete `ConfirmDialog.tsx` + its test from the plan** (§4, §9 step 4), **and delete §6's entire Escape-ownership protocol** — with no confirm there is exactly one Escape listener. Rationale: library deletes are the only non-undoable deletes in the app so they warrant *a* speed bump; but `window.confirm|alert|prompt` has **zero** hits in `src/`, there is not one modal anywhere, and every existing destructive action (Sidebar delete station/line, StylesPanel delete style) fires immediately. A modal for two buttons drags in the protocol the red team reproduced breaking.
3. **Clear → New losing a never-saved map is documented, not fixed.** Clear leaves the map only in zundo's `pastStates`; the auto-save gate sees an empty doc; `clearHistory()` then discards the stack. Two destructive actions in a row, already true today on Clear → Load JSON ([Toolbar.tsx:222](../../src/components/Toolbar.tsx#L222) clearHistory's with no auto-save at all). Closing it means exporting a snapshot from `history.ts` (the one module that owns zundo internals) and the thumbnail would depict the live empty canvas — a picture that lies. Add as a known weak point; retitle test #26 to *"New on a virgin empty doc writes nothing"* so it stops reading as a safety proof.
4. **The auto-save dedup baseline changed.** The plan compares against the DB's latest payload. Instead **retain the bytes we last saved or adopted** and compare against those.
   - Why: an unedited file-loaded doc must not be copied into the library on every switch. D2b nulls the id at every file load, so the id-keyed dedup is *structurally inapplicable* — browsing N files deposits N-1 junk maps that nothing dedupes (D2 permits duplicate names) and nothing prunes (D3's cap is per-map).
   - Bonus: it deletes a 256 KB IndexedDB read from every document switch.
   - **This is not the "dirty flag" that was rejected.** The flag was rejected because it dies on refresh and then reads *clean* — false-clean loses data. A retained baseline that's null after a refresh reads *dirty*, which is the safe direction and costs one redundant revision.

---

## 4. The five blockers (from `critique-v3.md` — NOT in the plan file)

### B1 — DATA LOSS. The content gate is a camera predicate.
The plan's §1 claims `computeContentBounds` is "the app's own definition of 'is there anything here'". **It is not.** Its own docstring says it is a camera hull and *"Lines are omitted deliberately"* ([contentBounds.ts:14-26, :20-23, :41-56](../../src/geometry/contentBounds.ts#L14)). It reads **5 of 18** `DOC_FIELDS`.

So a doc whose work lives in lines reads as **empty** → the auto-save writes nothing → New wipes it → the persist store overwrites `vignelli-map-doc-v1` with the corpse. **Total, silent, unrecoverable.** Reachable in three clicks: Add line → Add line → Esc leaves a real stationless line ([selection.ts:598-609](../../src/state/selection.ts#L598) never GCs the previous placeholder).

**Fix**: delete the gate.
```ts
const EMPTY_DOC_JSON = serialize(pickDocSnapshot(DEFAULT_DOC));  // module scope
// ...
const json = serialize(pickDocSnapshot(doc));
if (json === EMPTY_DOC_JSON) return;                 // exact, all 18 fields, one concept
```
Rewrite the plan's test #26 — as specified it **asserts the defect**. Keep "truly-default doc → not called" and add the real red: *"doc with two lines and no stations → New → saveRevision called with 'auto'"*.

### B2 — `saveRevision`'s promise settlement is unspecified, and the natural implementation lies.
The revision id only exists at the `add` request's `onsuccess` — which is exactly where you reach for `resolve(id)`, and the transaction **has not committed there**. Reproduced with real fake-indexeddb, abort injected after add succeeds: resolve-at-`onsuccess` → **RESOLVED id=1, with maps 0 / revisions 0 / payloads 0**. New then wipes a document whose revision does not exist, and D12's abort guarantee is void.

**Fix**: resolve on `tx.oncomplete` with the id captured at add's `onsuccess`; reject on `tx.onabort` and `tx.onerror`. **Never settle on an individual request's `onsuccess`.** Add a mapLibrary test that drives a *real* abort — the plan's #20/#25 mock `saveRevision` to reject, so they pass against the broken implementation too.

### B3 — Test #27 is born green.
The content gate short-circuits before the payload compare, and `Toolbar.test.tsx:36` is a **module-level** `beforeEach` installing an empty doc, so anything added to that file inherits one. #27 becomes identical to #26. **Fix**: seed content explicitly, and capture the `getPayload` stub's value *after* seeding.

### B4 — Test #14's "(Red today)" annotation is false.
`makeDoc`'s default name (`fixtures.ts:314`) **is** `MAP_NAME_DEFAULT` (`transforms.ts:120`) **is** `DEFAULT_DOC.name` (`transforms.ts:2659`). Executed on the unmodified tree: passes as specified. **Fix**: `makeDoc({ name: 'My Map', … })`. Same trap defeats #23's "set a name" and #24's "name is default" — both need a **non-default** name.

### B5 — e2e #38 cannot pass.
"Two saves → New → a third tagged auto": New runs the auto-save on the same unmutated doc, which is byte-identical to revision 2, so the gate skips. No third revision, ever. **Fix**: split into three legs — (a) Save → Save with no edit → two revisions both `'user'`; (b) → New → still two (the gate, end-to-end); (c) Save → move a station → New → a third tagged `'auto'`.

`critique-v3.md` also holds **17 should_fix** items, nearly all one-line plan edits or missing assertions. Read them; several are traps of the same born-green shape.

---

## 5. Ground truth worth not re-deriving

- **Load contract** ([Toolbar.tsx:201-227](../../src/components/Toolbar.tsx#L201)): `parse()` → 7 selection resets → `loadDoc(doc)` → `clearHistory()` → `fitCameraToDoc(doc)`. Extract as `adoptParsedDoc(doc)`; both the file path and the library path must call it.
  - `onFileChosen`'s missing `selectLabel(null)` (vs `onClear`) is **redundancy, not a bug** — `clearedSelections()` already zeroes it and `selectStation(null)` (first call in both) already clears it. `onClear`'s 8th call is dead code.
  - `fitCameraToDoc` has **no fallback** at `:226`, so loading an empty map leaves the camera on the previous map. Fold in `onResetView`'s `if (!fitCameraToDoc(doc)) setViewport({x:0,y:0,zoom:1})` ([:125-127](../../src/components/Toolbar.tsx#L125)).
- **`buildExportSvg`** ([exportCanvas.ts:74-77](../../src/export/exportCanvas.ts#L74)) already reframes to content bounds via `getBBox()` + `PADDING=24` — **the camera never truncates an export**. It **throws** on an empty canvas at `:102` (this is why a thumbnail-less save must still succeed). `collectUsedFontFaces` embeds only faces in use (~347 KB for Roman alone).
- **jsdom `getBBox` is already stubbed here** — `exportCanvas.test.ts:9-20` ships `stubGetBBox()`, and `:100-116` already tests framing + `pixelScale` through the real `buildExportSvg`. Only `toDataURL`/`toBlob` are unavailable (no `canvas` package). Do **not** extract a pure fn to work around a solved problem.
- **`user.click` does NOT work on a `SubMenu` leaf in jsdom** — SubMenu closes on `onMouseLeave` ([Menu.tsx:76-77](../../src/components/Menu.tsx#L76)) and userEvent's pointer movement tears it down first. Symptom is `called 0 times`, indistinguishable from "not built yet". The repo already carries the workaround + comment at `Toolbar.test.tsx:400-403`; helper at `:389-392`. Use `fireEvent.click` on leaves.
- **Portal target needs `?? document.body`** — `.app` exists only at `App.tsx:654` and is absent in standalone component tests; React 18.3.1 throws on a null container. Precedents: `HelpPopover.tsx:130` + `:189`, `ColorField.tsx:148`.
- **eslint has no type-aware rules** (no `parserOptions.project`), so `no-floating-promises`/`no-misused-promises` are **inactive**. A rejected promise from a `MenuItem onClick` is a silent `unhandledrejection`. `MenuItem`'s prop is `onClick: () => void`, so async handlers type-check. Use the `void fn()` marker at `Toolbar.tsx:189-190`.
- **`seedAndOpen`** (`e2e/fixtures.ts:208-227`) writes localStorage then `page.reload()` — **the doc rehydrates from `vignelli-map-doc-v1`**. Any e2e "save → load → it's back" is a **tautology** without an intermediate assertion that the canvas is actually empty first.
- **fake-indexeddb** is not installed. Put it in `mapLibrary.test.ts` **only**, never the global setup. Do **not** use `deleteDatabase` to reset — it fires `versionchange`, and with a cached connection and no `db.onversionchange` handler the request goes to `blocked` and **never settles**, timing out the file and taking `npm run pre-pr` down at step one. Use a fresh `new IDBFactory()` + `vi.resetModules()` + dynamic re-import. (Verified working, and it typechecks.)
- **`npm run pre-pr`** = `format → lint → format:check → test → build → e2e`. `vitest` does not typecheck; run the build or type errors reach CI.

---

## 6. Artifacts

All in this directory (`docs/map-library/`):

| File | What |
|---|---|
| `map-library-plan.md` | The plan, v3. Stale per §3; blockers per §4. |
| `critique.md` | First red team (49 agents): 3 blockers, 15 should_fix, 4 user decisions. Mostly superseded by the v2/v3 redesign — read it only for context on *why* a decision was made. |
| `critique-v3.md` | Second red team (47 agents): 5 blockers, 17 should_fix. **The important one.** §4 above summarizes its blockers; the 17 should_fix items are only here. |

These are working artifacts, not durable documentation — **delete this whole directory when the feature ships.** They are committed only because that is the sole way they survive a worktree being removed. No production code was ever written for this feature; the only commit on this branch is the one that added these files.

---

## 7. How to work this

`CLAUDE.md` governs. Two of its rules did most of the work here and should keep doing it:

- *"Before presenting any plan, do a full adversarial / critique pass over it yourself… locked to the actual source on the ground."* The previous session skipped this and paid for it repeatedly. The multi-agent red teams are what caught B1, B2, and every false-green test.
- *"Push back."* The user wants an argument, not compliance. He was right on essentially every disagreement in the last session, and the ones he lost he lost because the context had changed under him.

Two failure modes from the last session, so you can avoid them:

1. **Anchoring**: the previous session picked an answer early and spent five turns defending it, inventing evidence and reaching for weak arguments rather than updating. When you notice you are building a case rather than testing one, stop.
2. **Stale context beating fresh instruction**: it once overrode a direct instruction by quoting the user's own words from a superseded design. The user's latest instruction wins. If you think the context changed, that's a question, not a license.

And when you ask the user something, ask about **behavior he can see** — not about internal artifacts (`ConfirmDialog`, `D14`, `W11`) that exist only in these files. He has not read them.
