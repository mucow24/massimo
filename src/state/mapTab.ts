import type { MapDoc } from '../model/types';
import { parse, serialize } from '../model/serialize';
import { computeContentBounds } from '../geometry/contentBounds';
import { fitViewport } from '../components/canvas/viewportMath';
import { getCanvasSvg } from '../export/exportCanvas';
import { pickDocSnapshot, useDoc, useSelection } from './store';
import { clearHistory } from './history';
import { useViewportStore } from './viewportStore';
import { useCustomPalettes } from './customPalettes';
import { storedPointerVersion, tabMapId, useLibraryPointer } from './libraryPointer';
import { getPayload, listVersions } from './mapLibrary';
import {
  markAdopted,
  markSaved,
  rebootBaseline,
  saveStatusOf,
  useSaveBaseline,
} from './saveBaseline';
import { cameraKey, hasDocDraft, moveDocKeys, removeDocDraft } from './mapKeys';
import { acquireMapLock, releaseMapLock } from './mapLock';

/**
 * The tab's relationship to its map: becoming one, coming up on it, and the
 * document swap every path that replaces the live doc goes through.
 *
 * A tab is always ON a map (libraryPointer.ts). Everything that changes WHICH
 * map — New, Make a copy, a file load, opening a version, deleting the map
 * under the live doc — comes through here, so the three things that have to
 * happen in one order happen in one place: take the incoming map's lock
 * (mapLock.ts), move the pointer, and only THEN write the document. The
 * pointer moves first because every per-map storage adapter keys by it: the
 * incoming document's first write has to land in the incoming map's slot.
 */

export const MAP_BUSY = 'That map is open in another window. Close it there first.';

/**
 * Read by Toolbar's initial state, set by main.tsx alone (see
 * bootedWithoutMap — a unit-test render must not open a dialog because jsdom
 * has no hash). A plain flag, not a take-once: StrictMode calls a state
 * initializer twice in dev and keeps the second answer.
 */
let libraryAtBoot = false;
export function requestLibraryAtBoot(): void {
  libraryAtBoot = true;
}
export const libraryRequestedAtBoot = (): boolean => libraryAtBoot;

/**
 * Point the camera at a doc's content: center it and zoom to fit, using the
 * live SVG's pixel size (content-independent, so no wait for a render).
 * Returns false — camera untouched — when the map is empty or the canvas
 * isn't mounted. Shared by every document swap and Reset view.
 */
export function fitCameraToDoc(doc: MapDoc): boolean {
  const bounds = computeContentBounds(doc);
  const svg = getCanvasSvg();
  if (!bounds || !svg) return false;
  // Fit to the VISIBLE canvas: the host box, not the svg — the svg is the
  // oversized pan surface (2× per axis; see panSurfaceViewBox). A detached
  // svg (tests) has no host and keeps its own rect.
  const rect = (svg.closest('.canvas-host') ?? svg).getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  useViewportStore.getState().setViewport(fitViewport(bounds, { w: rect.width, h: rect.height }));
  return true;
}

/** Fit, or fall back to the origin when the fit declines — empty content,
 *  canvas unmounted, or a zero-size rect. */
const fitOrHome = (doc: MapDoc): void => {
  if (!fitCameraToDoc(doc)) useViewportStore.getState().setViewport({ x: 0, y: 0, zoom: 1 });
};

/** Nothing selected, no mode: a different document has nothing to keep. */
function clearSelectionForNewDoc(): void {
  const selection = useSelection.getState();
  selection.selectStation(null);
  selection.selectLine(null);
  selection.selectLineTag(null);
  selection.selectRouteBullet(null);
  selection.selectTransfer(null);
  selection.setUiMode({ kind: 'idle' });
  selection.setEditingStationId(null);
}

/**
 * Replace the live document. Shared by every path that swaps one doc for
 * another — file load, library load, New, the boot from the library — so
 * none of them can drift.
 *
 * `backed` says whether the incoming bytes exist as a library version
 * (opening one) or not (a JSON file, New) — the difference between the doc
 * starting out clean and starting out unsaved-but-armed.
 */
export function adoptParsedDoc(doc: MapDoc, backed: boolean): void {
  clearSelectionForNewDoc();
  useDoc.getState().loadDoc(doc);
  clearHistory(); // undo must not splice two different documents
  // The camera lives outside the doc (saved files are camera-agnostic), so a
  // switch would otherwise keep the old pan/zoom and could land on a blank
  // area.
  fitOrHome(doc);
  // Anchor the baseline to the POST-load store state: those are the exact
  // references the reactive status signal will compare against.
  const snap = pickDocSnapshot(useDoc.getState());
  (backed ? markSaved : markAdopted)(serialize(snap), snap);
}

/**
 * Make this tab another map. Takes the incoming map's lock — rejecting with
 * MAP_BUSY when another window holds it — lets the outgoing one go, and moves
 * the pointer (with the version the incoming map's own slot records). The
 * caller then writes the document.
 *
 * The outgoing map's working copy goes unless it holds unsaved work. By the
 * time a switch reaches here the caller has auto-saved the outgoing doc (or
 * found nothing to save), so the slot holds either bytes the library has or
 * an untouched file/New — neither is work the slot exists for (mapKeys.ts).
 */
export async function becomeMap(mapId: string): Promise<void> {
  const from = tabMapId();
  if (mapId === from) return;
  if (!(await acquireMapLock(mapId))) throw new Error(MAP_BUSY);
  if (saveStatusOf(useDoc.getState(), useSaveBaseline.getState()) !== 'dirty') removeDocDraft(from);
  releaseMapLock(from);
  useLibraryPointer.getState().setPointer(mapId, storedPointerVersion(mapId));
}

/**
 * The same document under a new identity — Make a copy, or the library row
 * under the live doc being deleted. The working copy and the camera come
 * along; the caller rewrites the pointer's version and the baseline, since
 * a new identity is exactly when their old values stop being true.
 */
export async function retargetTab(mapId: string): Promise<void> {
  const from = tabMapId();
  if (mapId === from) return;
  if (!(await acquireMapLock(mapId))) throw new Error(MAP_BUSY);
  moveDocKeys(from, mapId);
  releaseMapLock(from);
  useLibraryPointer.getState().setPointer(mapId, storedPointerVersion(mapId));
}

/**
 * Fetch the tab's map from the library: the version the pointer names, else
 * the newest. Null when the library has nothing under this id — a fresh New
 * map, or a map whose row was deleted.
 */
async function loadFromLibrary(mapId: string): Promise<{ doc: MapDoc; version: number } | null> {
  const versions = await listVersions(mapId); // newest-first
  if (versions.length === 0) return null;
  const wanted = useLibraryPointer.getState().version;
  const meta = versions.find((v) => v.version === wanted) ?? versions[0];
  const json = await getPayload(meta.id);
  if (json === undefined) return null;
  const result = parse(json, useCustomPalettes.getState().palettes);
  if (!result.ok) throw new Error(result.error);
  return { doc: result.doc, version: meta.version };
}

/**
 * Come up on the tab's map when it has no working copy: a URL opened in a
 * fresh tab, or a reload after a clean save (which releases the copy). The
 * library version is what the canvas should show, so fetch and adopt it,
 * clean. A map with a working copy is already on the canvas — the stores
 * hydrated from it — and the library is not consulted.
 *
 * Throws on a payload that will not parse, for the caller to show; a map the
 * library has nothing for stays the empty doc the boot gave it.
 */
export async function openTabMapFromLibrary(): Promise<void> {
  const mapId = tabMapId();
  if (hasDocDraft(mapId)) return;
  const hit = await loadFromLibrary(mapId);
  if (tabMapId() !== mapId) return; // the tab moved on while the read was out
  if (hit === null) return;
  adoptParsedDoc(hit.doc, true);
  useLibraryPointer.getState().setPointer(mapId, hit.version);
}

/**
 * Become another map AND come up on it — the boot sequence, re-run for the
 * new map: its working copy if it has one (unsaved work from a window since
 * closed comes back exactly as left), else its library version.
 */
export async function switchTabToMap(mapId: string): Promise<void> {
  await becomeMap(mapId);
  if (!hasDocDraft(mapId)) {
    await openTabMapFromLibrary();
    return;
  }
  clearSelectionForNewDoc();
  // The working copy comes in through the doc store's own hydrate path, so
  // it gets the same migrate + merge repairs a page load gives it.
  await useDoc.persist.rehydrate();
  clearHistory();
  const hadCamera = localStorage.getItem(cameraKey(mapId)) !== null;
  await useViewportStore.persist.rehydrate();
  if (!hadCamera) fitOrHome(useDoc.getState());
  await rebootBaseline();
}
