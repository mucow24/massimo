import { useEffect, type CSSProperties } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
import { StatusToasts } from './components/StatusToasts';
import { BouncingBullet } from './components/BouncingBullet';
import { isFunModeActive } from './state/funMode';
import { DEFAULT_PARAMS } from './fun/ballPhysics';
import { nextGridSize, useViewportStore } from './state/viewportStore';
import { kindVisibleNow, setVisibility, VISIBILITY_ITEMS } from './state/visibility';
import {
  beginHistoryGroup,
  cancelAppendMode,
  getCopyableSelection,
  RIGHT_CLICK_PASSTHROUGH_MODES,
  useDoc,
  useSelection,
} from './state/store';
import {
  readClipboard,
  routeBulletPayload,
  textLabelPayload,
  polygonPayload,
  svgImagePayload,
  writeClipboard,
  type ClipPayload,
} from './model/clipboard';
import {
  _clearTextMeasureCache,
  invalidateMeasuredFaces,
  type ArrivedFace,
} from './geometry/textMeasure';
import { guideAlongOf, guideNudgeDelta } from './geometry/snap';
import { useFontEpoch } from './state/fontEpoch';
import { screenDeltaToLabelOffsets } from './geometry/labelLayout';
import { STOP_SIZE, rotateGridDelta, type Rotation } from './geometry/orientation';
import { lineInterlineGapOf, lineWidthOf } from './model/lineWidth';
import { resolveOffsetPerp } from './model/transforms';
import {
  nudgeTarget,
  otherLayoutNodes,
  anchorBlockerNodes,
  sourceCellOf,
  stationLayoutNodes,
  type LayoutSource,
} from './components/inspector/stopGridDrag';
import { dispatchMirrored, fanOutMirrored } from './state/mirrorDispatch';
import { useSnapPrefs } from './state/snapPrefs';
import { pushToast } from './state/toastStore';
import { advanceSnapToggle, SNAP_TOGGLE_COUNT } from './components/SnapToggleBar';
import {
  deleteUnlockedSelection,
  itemIdCount,
  stationsCarriedByCircles,
  unlockedSelectedItemIds,
  visibleCopyableSelection,
} from './state/selectionOps';
import { isHistoryGrouping, redo, undo } from './state/history';
import { decideDeleteKey } from './model/appendGestures';
import { stationAnchorCell } from './model/transferAnchors';

/**
 * The document-level capture handler behind "right-click cancels an active
 * mode". Capture phase + stopPropagation so it beats element-level context
 * menus (station rotate, tag flip): they shouldn't fire when the user is
 * backing out of a mode. Exported for the unit test; registered by App's
 * effect below.
 */
export function cancelModeOnContextMenu(e: globalThis.MouseEvent): void {
  const sel = useSelection.getState();
  // Modes in RIGHT_CLICK_PASSTHROUGH_MODES own the right-click gesture
  // (layering uses it to cycle a region's covering line backward); everything
  // else exits on right-click. The set lives next to UiMode in the store so
  // a new variant declares its right-click policy in one place.
  if (RIGHT_CLICK_PASSTHROUGH_MODES.has(sel.uiMode.kind)) return;
  // Cancel-a-mode is a CANVAS gesture: only a right-click on the canvas backs
  // out of the mode. Chrome — toolbar (including the map-name field), sidebar,
  // popovers — owns its own right-click; cancelling from there kicked the user
  // out of the mode mid-flow (a placing-svg mode even lost its parsed file
  // payload) while ALSO suppressing the native menu they asked for.
  if (!(e.target instanceof Element && e.target.closest('.canvas-host'))) return;
  e.preventDefault();
  e.stopPropagation();
  cancelAppendMode();
  sel.setUiMode({ kind: 'idle' });
}

// Build the ordered clipboard payloads (bullet → label → polygon → image) for a
// set of copyable selection ids, skipping any that no longer resolve in the doc.
// Shared by Ctrl+C (the whole selection) and Ctrl+X (the unlocked subset).
function collectClipItems(
  doc: ReturnType<typeof useDoc.getState>,
  ids: { bullets: string[]; labels: string[]; polygons: string[]; svgImages: string[] },
): ClipPayload[] {
  const items: ClipPayload[] = [];
  for (const id of ids.bullets) {
    const b = doc.routeBullets[id];
    if (b) items.push(routeBulletPayload(b));
  }
  for (const id of ids.labels) {
    const l = doc.textLabels[id];
    if (l) items.push(textLabelPayload(l));
  }
  for (const id of ids.polygons) {
    const p = doc.polygons[id];
    if (p) items.push(polygonPayload(p));
  }
  for (const id of ids.svgImages) {
    const im = doc.svgImages[id];
    if (im) items.push(svgImagePayload(im));
  }
  return items;
}

export default function App() {
  const darkMode = useDoc((s) => s.darkMode);
  // The chrome is dark when the map is a night map OR the local "Dark UI in day"
  // preference is on. The canvas half doesn't read this — it stays keyed to the
  // doc's darkMode (see themeColors) — so a dark UI can sit over a light map.
  const darkUiInDay = useViewportStore((s) => s.darkUiInDay);
  const chromeDark = darkMode || darkUiInDay;

  // Keep the browser tab title in sync with the map name: "Massimo - <name>".
  const docName = useDoc((s) => s.name);
  useEffect(() => {
    document.title = `Massimo - ${docName}`;
  }, [docName]);
  // Force a re-measure + re-render once the web fonts finish loading. Label
  // geometry is measured against the canvas and cached by text+style; the very
  // first paint runs before Söhne is ready, so those measurements use
  // the fallback font (whose side bearings differ by a pixel or two) and get
  // cached. Without invalidation the labels stay a hair off until the next edit
  // re-measures them — which looked like a line "shifting" when you edited a
  // sibling line. Dropping the stale cache and bumping this counter on font
  // load lets every label settle at its real metrics up front.
  const bumpFontEpoch = useFontEpoch((s) => s.bump);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let cancelled = false;
    // `ready` covers the fonts in use at first paint. Everything measured
    // before it resolved was measured against the fallback face, so the whole
    // cache is stale and the whole cache goes.
    const onReady = () => {
      if (cancelled) return;
      _clearTextMeasureCache();
      bumpFontEpoch();
    };
    // A LATER arrival — a label switching to a weight not yet fetched — stales
    // only the labels that use that face. Dropping the whole cache here would
    // re-measure every label on the map through the raster probe (587ms on a
    // 464-station drawing) because one label went bold, so the invalidation is
    // narrowed to the faces that actually arrived. The epoch still bumps: the
    // re-render is what shows the new metrics, and it is cheap now that the
    // labels it walks past mostly still hit the cache.
    const onLoadingDone = (e?: globalThis.Event) => {
      if (cancelled) return;
      // `fontfaces` rides on FontFaceSetLoadEvent, which is not in the lint
      // env's globals — read it structurally rather than by name. An event that
      // carries no face list says nothing about WHAT arrived, so there is
      // nothing to narrow by and the whole cache goes.
      const fontfaces = (
        e as (globalThis.Event & { fontfaces?: readonly ArrivedFace[] }) | undefined
      )?.fontfaces;
      if (fontfaces?.length) invalidateMeasuredFaces(fontfaces);
      else _clearTextMeasureCache();
      bumpFontEpoch();
    };
    fonts.ready.then(onReady);
    fonts.addEventListener('loadingdone', onLoadingDone);
    return () => {
      cancelled = true;
      fonts.removeEventListener('loadingdone', onLoadingDone);
    };
  }, [bumpFontEpoch]);
  const setUiMode = useSelection((s) => s.setUiMode);
  const selectLineTag = useSelection((s) => s.selectLineTag);
  const selectRouteBullet = useSelection((s) => s.selectRouteBullet);
  const selectTransfer = useSelection((s) => s.selectTransfer);
  const selectLabel = useSelection((s) => s.selectLabel);
  const selectSvgImage = useSelection((s) => s.selectSvgImage);
  const setToolMode = useSelection((s) => s.setToolMode);
  const setSpaceHeld = useSelection((s) => s.setSpaceHeld);
  const setAltHeld = useSelection((s) => s.setAltHeld);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt tracking, before every guard: the held state drives the Edit
      // Stops create-ghost, and the mouse events that consume it read their
      // own e.altKey (a form focus never makes a held Alt untrue).
      // preventDefault keeps the browser from arming its menu bar on Alt.
      if (e.key === 'Alt') {
        e.preventDefault();
        if (!e.repeat) setAltHeld(true);
        return;
      }
      // The bouncing-badge easter egg is modal: the map is dimmed and inert, so
      // every shortcut below it stays inert too — Delete must not reach the
      // selection behind the scrim. Sits AFTER the Alt block on purpose, so the
      // Alt that opened the egg still clears on keyup instead of latching.
      // BouncingBullet owns Escape for the whole stretch.
      if (isFunModeActive()) return;
      // Two-tier form-field guard.
      //
      // `inForm` excludes range sliders and color pickers so the Ctrl-combos
      // (undo/redo/copy/cut/paste/duplicate) still fire while one is focused —
      // otherwise Ctrl+Z is swallowed mid-slider-drag (sliders/pickers have no
      // native text-editing shortcuts worth preserving).
      //
      // `inFormControl` is the stricter "any focusable form control" test used
      // by the non-modifier canvas shortcuts (Delete, arrow-nudge, the bare
      // letter toggles, and Space-pan). Those have no business firing while ANY
      // input is focused — a bare letter is just typing, and Space/arrows would
      // hijack the native slider/picker behavior (and strand pan mode if the
      // window then blurred before keyup).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inputType = tag === 'INPUT' ? (target as HTMLInputElement).type : '';
      // Radix widgets are buttons/spans wearing ARIA form roles, not native
      // inputs — read the role so they guard like the elements they replaced:
      // checkbox/radio/switch/combobox mirror INPUT/SELECT (Space toggles,
      // letters typeahead), slider mirrors the old range input (arrows move
      // it, and, like range, stays OUT of `inForm` so Ctrl+Z still fires
      // mid-drag — the blur-then-undo contract).
      // Optional-call: the event target can be the window itself (jsdom
      // dispatches, blur-time synthetics), which has no getAttribute.
      const role = target?.getAttribute?.('role');
      const ariaFormRole =
        role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'combobox';
      // Focus inside an open overlay — a Radix Select/DropdownMenu panel or
      // the library dialog — reads as a form context too. Those panels don't
      // stop keydown propagation, so without this, arrows browsing a dropdown
      // also nudge the canvas, letters switch modes (wiping the selection and
      // unmounting the very panel being browsed), and Delete edits the doc
      // behind a modal. The item popovers are plain divs (no dialog role), so
      // canvas shortcuts keep working while one is merely open.
      // Optional-call: the event target can be the window itself.
      const inOverlay = !!target?.closest?.('[role="dialog"],[role="listbox"],[role="menu"]');
      const inForm =
        (tag === 'INPUT' && inputType !== 'range' && inputType !== 'color') ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        ariaFormRole ||
        inOverlay ||
        target?.isContentEditable;
      const inFormControl =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        ariaFormRole ||
        role === 'slider' ||
        inOverlay ||
        !!target?.isContentEditable;

      if (e.key === 'Escape') {
        // Esc while typing belongs to the field — don't close popovers or
        // cancel modes out from under an in-progress edit. Plain fields have
        // no native Esc behavior, so blur instead of swallowing outright:
        // first Esc leaves the field (committing its useFieldHistory group),
        // a second Esc then closes/cancels as usual. Range/color inputs fall
        // through like the Ctrl-combos: no in-progress edit to protect.
        if (inForm) {
          if (target instanceof HTMLElement) target.blur();
          return;
        }
        // Station-editor step-out ladder (App is the single Escape owner —
        // a per-popover listener racing this handler on the same keypress
        // would defeat the ladder): an armed stop/label sub-selection clears
        // first; the layout-edit mode exits next; only then does Esc fall
        // through to the global close-everything wipe below.
        {
          const sel = useSelection.getState();
          if (sel.selectedStopLineId || sel.labelSelected || sel.selectedAnchorCellId) {
            sel.setSelectedStopLineId(null);
            sel.setLabelSelected(false);
            sel.setSelectedAnchorCellId(null);
            return;
          }
          if (sel.uiMode.kind === 'editing-station-layout') {
            setUiMode({ kind: 'idle' });
            return;
          }
          // Edit Stops step-out ladder: a pending connect/splice cursor drops
          // first; only a second Esc exits the editor.
          if (sel.uiMode.kind === 'appending-to-line' && sel.uiMode.cursor) {
            sel.setAppendCursor(null);
            return;
          }
        }
        // cancelAppendMode runs first so a freshly-created empty line gets
        // garbage-collected before setUiMode flips the variant.
        cancelAppendMode();
        setUiMode({ kind: 'idle' });
        // Any one null-select wipes every selection type (clearedSelections in
        // the store), closing whichever item popover is open.
        selectLineTag(null);
        selectRouteBullet(null);
        selectTransfer(null);
        selectLabel(null);
        selectSvgImage(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inFormControl) {
        const sel = useSelection.getState();
        // Edit Stops: Delete removes whatever the cursor has armed — the
        // cursor station leaves the line, the armed edge is cut. (Selections
        // are wiped in this mode, so nothing below would fire anyway.)
        if (sel.uiMode.kind === 'appending-to-line') {
          const { lineId } = sel.uiMode;
          const line = useDoc.getState().lines[lineId];
          const d = line ? decideDeleteKey(line, sel.uiMode.cursor) : { kind: 'none' as const };
          if (d.kind === 'remove-station') {
            e.preventDefault();
            sel.setAppendCursor(null);
            useDoc.getState().removeStationFromLine(lineId, line!.stations.indexOf(d.stationId));
          } else if (d.kind === 'remove-edge') {
            e.preventDefault();
            sel.setAppendCursor(null);
            useDoc.getState().toggleEdgeOnLine(lineId, d.from, d.to);
          }
          return;
        }
        // Selected polygon vertices take top priority: remove them (the
        // transform no-ops if the removal would breach the 3-vertex floor) and
        // keep the polygon selected so the user can keep editing.
        if (sel.selectedVertices && kindVisibleNow('showPolygons')) {
          const { polygonId, indices } = sel.selectedVertices;
          // Locked polygons can't be edited; ignore the vertex delete.
          if (!useDoc.getState().polygons[polygonId]?.locked) {
            e.preventDefault();
            sel.selectVertices(null);
            useDoc.getState().deleteVertices(polygonId, indices);
            return;
          }
        }
        // An armed station sub-selection answers Delete before the whole-station
        // path: the armed NODE goes, not the station hosting it. All three arms
        // are here, and they answer from WHEREVER the arm was set — the layout
        // editor's grab rings and the inspector's rows write the same
        // sub-selection, and the hosted-anchor arm already answered the key from
        // either surface. A DANGLING arm (one naming a stop this station no
        // longer carries) falls through to the whole-station path, same as the
        // arrow-key ladder.
        {
          const sid = sel.selectedStationIds.length === 1 ? sel.selectedStationIds[0] : null;
          const station = sid ? useDoc.getState().stations[sid] : undefined;
          const cellId = sel.selectedAnchorCellId;
          const stopLineId = sel.selectedStopLineId;
          if (station) {
            // The label cell has nothing to delete, so it SWALLOWS the key
            // rather than falling through — falling through deleted the whole
            // station, which is the surprise every arm here exists to prevent.
            // Esc drops the arm (the step-out ladder), and Delete then reaches
            // the station.
            if (sel.labelSelected) {
              e.preventDefault();
              return;
            }
            // Lock DOES close this arm, unlike the stop arm below: a hosted
            // anchor is station-internal data whose only other door — the
            // inspector's anchor row × — sits inside the panel's disabled
            // fieldset. deleteStationAnchor cascades any transfers bound to the
            // cell.
            if (cellId && !station.locked && stationAnchorCell(station, cellId)) {
              e.preventDefault();
              sel.setSelectedAnchorCellId(null);
              useDoc.getState().deleteStationAnchor(station.id, cellId);
              return;
            }
            // A stop dot isn't a thing of its own to erase: the station LEAVES
            // that line, which is what takes the dot with it (plus the edges
            // through it and any transfers hanging off the stop — see
            // removeStationFromLine). Deliberately NOT lock-gated: lock protects
            // geometry and existence, not mode participation, and Edit Stops
            // already adds and removes a locked station's membership freely —
            // two doors onto one operation must not disagree. Not fanned out
            // through dispatchMirrored either, unlike the layout NUDGES: which
            // lines a station serves is topology, not a look to spread across
            // matching stations.
            if (stopLineId && station.stops.some((c) => c.lineId === stopLineId)) {
              // A LIVE arm claims the key whether or not the write can proceed:
              // the dot is on screen wearing a ring, so falling through to the
              // whole-station delete would be the very bug this arm fixes.
              e.preventDefault();
              // Index off the MEMBERSHIP list. The stop cell implies membership
              // (parse closes the two together), but on a doc where it somehow
              // didn't, a -1 index would splice the member list into a copy of
              // itself with every entry but the last duplicated.
              const idx = useDoc.getState().lines[stopLineId]?.stations.indexOf(station.id) ?? -1;
              if (idx >= 0) {
                sel.setSelectedStopLineId(null);
                useDoc.getState().removeStationFromLine(stopLineId, idx);
              }
              return;
            }
          }
        }
        // Mixed station + bullet + label + polygon multi-selection takes
        // priority over the single-element delete paths below; one history
        // entry covers every removed item so a single Ctrl-Z reverts the lot.
        // Locked items are protected from deletion (state/selectionOps.ts —
        // shared with the selection popover's "Delete all").
        if (deleteUnlockedSelection()) {
          e.preventDefault();
          return;
        }
        // Same visibility rule as the multi-selection above (selectionOps):
        // a transfer on a hidden layer is off screen, so Delete doesn't reach
        // it. The selection survives — hiding is a peek.
        const transferId = sel.selectedTransferId;
        if (transferId && kindVisibleNow('showTransfers')) {
          e.preventDefault();
          sel.selectTransfer(null);
          useDoc.getState().deleteTransfer(transferId);
          return;
        }
        const tagId = sel.selectedLineTagId;
        if (tagId) {
          e.preventDefault();
          sel.selectLineTag(null);
          useDoc.getState().deleteLineTag(tagId);
          return;
        }
      }
      const mod = e.metaKey || e.ctrlKey;
      // Arrow keys nudge the current selection: 1px per press, 5px with Shift.
      // Distances are in world units (1px at 100% zoom). Transfers and line
      // tags are skipped — their positions are constrained (between stations /
      // along a line), so a free x/y nudge has no meaning there.
      if (
        !inFormControl &&
        !mod &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight')
      ) {
        const step = e.shiftKey ? 5 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const sel = useSelection.getState();
        const doc = useDoc.getState();
        // Selected polygon vertices take top priority (mirrors Delete): nudge
        // just those handles together, leaving the rest of the polygon put.
        if (sel.selectedVertices && kindVisibleNow('showPolygons')) {
          const { polygonId, indices } = sel.selectedVertices;
          const poly = doc.polygons[polygonId];
          if (poly && !poly.locked) {
            e.preventDefault();
            // May fire while a drag gesture's group is open (groups don't
            // nest) — fold in rather than stealing it, like the Alt+arrow
            // fan-out below.
            const group = isHistoryGrouping() ? null : beginHistoryGroup();
            doc.moveVertices(polygonId, indices, dx, dy);
            group?.commit();
          }
          return;
        }
        // A selected stop or label cell (the station sub-selection driven by
        // the layout editor) takes priority over whole-station nudging:
        // arrows hop the stop/label one lattice slot in the pressed SCREEN
        // direction (Shift = the diagonal lattice, matching Shift-drag);
        // Alt+arrows fine-nudge the LABEL's offsets in screen pixels
        // (Shift ×5, matching the station-nudge step). The station stays
        // put. Allowed on locked stations — lock protects against canvas
        // drags/deletes, not layout edits (inspector-parity). A DANGLING
        // stop sub-selection (the station lost that line's stop, e.g. via
        // undo) does NOT claim the keys — it falls through to the
        // whole-station nudge instead of silently eating every press.
        const subStation =
          sel.selectedStationIds.length === 1 ? doc.stations[sel.selectedStationIds[0]] : null;
        const subSource: LayoutSource | null = !subStation
          ? null
          : sel.labelSelected
            ? { kind: 'label' }
            : sel.selectedStopLineId
              ? { kind: 'stop', lineId: sel.selectedStopLineId }
              : sel.selectedAnchorCellId
                ? { kind: 'anchor', anchorId: sel.selectedAnchorCellId }
                : null;
        const subCell = subStation && subSource ? sourceCellOf(subStation, subSource) : null;
        if (subStation && subSource && subCell) {
          e.preventDefault();
          const rotation = (subStation.rotation % 8) as Rotation;
          if (subSource.kind === 'label' && e.altKey) {
            const { dOffset, dPerp } = screenDeltaToLabelOffsets(
              { x: dx, y: dy },
              rotation,
              subStation.label.rotation,
            );
            // Offsets are rotation-invariant across mirror matches (same
            // convention as the inspector's offset sliders). One group per
            // press: a diagonal reading axis writes BOTH offset fields.
            // Gated on isHistoryGrouping like dispatchMirrored — groups
            // don't nest, and this global listener can fire while a drag
            // gesture's group is open.
            const group = isHistoryGrouping() ? null : beginHistoryGroup();
            fanOutMirrored(subStation.id, (sid) => {
              const st = useDoc.getState().stations[sid];
              if (!st) return;
              doc.setLabelOffset(sid, st.label.offset + dOffset);
              doc.setLabelOffsetPerp(sid, resolveOffsetPerp(st.label) + dPerp);
            });
            group?.commit();
            return;
          }
          const target = nudgeTarget({
            source: subCell,
            // A hosted anchor takes the label's parameters exactly (unit
            // nominal width, no gap, body-less for overlap), so the keyboard
            // reaches the same slots the drag does.
            wSrc: subSource.kind === 'stop' ? lineWidthOf(doc.lines[subSource.lineId]) : STOP_SIZE,
            gSrc: subSource.kind === 'stop' ? lineInterlineGapOf(doc.lines[subSource.lineId]) : 0,
            srcIsPoint: subSource.kind !== 'stop',
            otherNodes: [
              ...otherLayoutNodes(stationLayoutNodes(subStation, doc.lines), subSource),
              ...anchorBlockerNodes(
                subStation,
                subSource.kind === 'anchor' ? subSource.anchorId : undefined,
              ),
            ],
            basis: e.shiftKey ? 'diagonal' : 'orthogonal',
            stationRotation: rotation,
            arrow: { row: Math.sign(dy), col: Math.sign(dx) },
          });
          if (!target) return;
          const dRow = target.row - subCell.row;
          const dCol = target.col - subCell.col;
          if (subSource.kind === 'anchor') {
            // NO mirror fan-out — see useStationLayoutDrag for why: an anchor
            // id is globally unique and lives on this one station, so a mirror
            // match has no counterpart anchor to nudge. Move it once, here.
            doc.moveStationAnchor(subStation.id, subSource.anchorId, dRow, dCol);
            return;
          }
          dispatchMirrored(subStation.id, (sid, k) => {
            // Local-frame deltas rotate by the match's layoutOffset so the
            // world-frame edit mirrors the source (same as the inspector).
            const d = rotateGridDelta(dRow, dCol, k);
            if (subSource.kind === 'label') doc.moveLabel(sid, d.dRow, d.dCol);
            else doc.moveStop(sid, subSource.lineId, d.dRow, d.dCol);
          });
          return;
        }
        // Locked stations, bullets, labels, and polygons don't move — nor does
        // anything on a hidden layer (selectionOps).
        const ids = unlockedSelectedItemIds();
        if (itemIdCount(ids) > 0) {
          e.preventDefault();
          // Same open-group fold-in as the vertex nudge above.
          const group = isHistoryGrouping() ? null : beginHistoryGroup();
          // Rings first, and their passengers filed out of the station loop:
          // moveLineCircle carries a bound station, and moveStation would
          // RESEAT it on the (already moved) rim rather than translate it — the
          // group would arrive in pieces. Same partition groupDrag makes.
          const carried = stationsCarriedByCircles(ids.lineCircles);
          for (const id of ids.lineCircles) {
            const c = doc.lineCircles[id];
            if (c) doc.moveLineCircle(id, c.x + dx, c.y + dy);
          }
          for (const id of ids.stations) {
            if (carried.has(id)) continue;
            const s = doc.stations[id];
            if (s) doc.moveStation(id, s.x + dx, s.y + dy);
          }
          for (const id of ids.bullets) {
            const b = doc.routeBullets[id];
            if (b) doc.moveRouteBullet(id, b.x + dx, b.y + dy);
          }
          for (const id of ids.labels) {
            const l = doc.textLabels[id];
            if (l) doc.moveTextLabel(id, l.x + dx, l.y + dy);
          }
          for (const id of ids.polygons) doc.movePolygon(id, dx, dy);
          for (const id of ids.svgImages) {
            const im = doc.svgImages[id];
            if (im) doc.moveSvgImage(id, im.x + dx, im.y + dy);
          }
          // Absolute coords like every x/y kind above (only movePolygon takes a
          // delta). Inside the same group, so a mixed nudge is one undo entry.
          for (const id of ids.anchors) {
            const a = doc.transferAnchors[id];
            if (a) doc.moveTransferAnchor(id, a.x + dx, a.y + dy);
          }
          // A guide's LINE takes only the offset-changing projection of the
          // nudge (guideNudgeDelta), so cross-axis presses no-op for an
          // infinite guide while still moving co-selected items (moveGuide
          // bails on an unchanged offset). A BOUNDED span answers them: the
          // along-axis projection slides the segment along its street.
          for (const id of ids.guides) {
            const g = doc.guides[id];
            if (g) {
              doc.moveGuide(
                id,
                g.offset + guideNudgeDelta(g.orientation, dx, dy),
                g.extent
                  ? g.extent.center + guideAlongOf(g.orientation, { x: dx, y: dy })
                  : undefined,
              );
            }
          }
          group?.commit();
        }
        return;
      }
      if (mod && !inForm && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        // Blur first so any open useFieldHistory group (slider mid-drag,
        // etc.) commits its entry to the past stack — otherwise undo
        // would skip the in-progress edit and revert the action before it.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && !inForm && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        redo();
        return;
      }
      // Copy / paste / duplicate for the current selection — any mix of route
      // bullets, text labels, and polygons. Stations (and other primaries) are
      // ignored. Stay out of form fields so native text-editing shortcuts keep
      // working; when nothing copyable is selected we fall through WITHOUT
      // preventDefault so native copy/paste still works.
      if (mod && !inForm && (e.key === 'c' || e.key === 'C')) {
        const items = collectClipItems(
          useDoc.getState(),
          getCopyableSelection(useSelection.getState()),
        );
        if (items.length === 0) return;
        navigator.clipboard?.writeText(writeClipboard(items)).catch(() => {});
        e.preventDefault();
        return;
      }
      if (mod && !inForm && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        navigator.clipboard
          ?.readText()
          .then((text) => {
            const items = readClipboard(text);
            if (!items) return;
            const doc = useDoc.getState();
            const bullets: string[] = [];
            const labels: string[] = [];
            const polygons: string[] = [];
            const svgImages: string[] = [];
            // The async read can land mid-drag — same open-group fold-in as
            // the nudges above.
            const group = isHistoryGrouping() ? null : beginHistoryGroup();
            for (const item of items) {
              if (item.kind === 'route-bullet') bullets.push(doc.pasteRouteBullet(item.data));
              else if (item.kind === 'text-label') labels.push(doc.pasteTextLabel(item.data));
              else if (item.kind === 'polygon') polygons.push(doc.pastePolygon(item.data));
              else if (item.kind === 'svg-image') svgImages.push(doc.pasteSvgImage(item.data));
            }
            group?.commit();
            useSelection.getState().setMixedSelection({ bullets, labels, polygons, svgImages });
          })
          .catch(() => {});
        return;
      }
      if (mod && !inForm && (e.key === 'd' || e.key === 'D')) {
        // Visible kinds only (selectionOps): duplicating a hidden item would
        // mint an invisible clone that selects itself — and Delete refuses
        // hidden items, so it couldn't even be removed until the layer came
        // back. Ctrl+C above stays unfiltered: copying is a read.
        const {
          bullets: bulletIds,
          labels: labelIds,
          polygons: polygonIds,
          svgImages: svgImageIds,
        } = visibleCopyableSelection();
        if (bulletIds.length + labelIds.length + polygonIds.length + svgImageIds.length === 0)
          return;
        e.preventDefault();
        const doc = useDoc.getState();
        // Same open-group fold-in as the nudges above.
        const group = isHistoryGrouping() ? null : beginHistoryGroup();
        const bullets = bulletIds
          .map((id) => doc.duplicateRouteBullet(id))
          .filter((id): id is string => id != null);
        const labels = labelIds
          .map((id) => doc.duplicateTextLabel(id))
          .filter((id): id is string => id != null);
        const polygons = polygonIds
          .map((id) => doc.duplicatePolygon(id))
          .filter((id): id is string => id != null);
        const svgImages = svgImageIds
          .map((id) => doc.duplicateSvgImage(id))
          .filter((id): id is string => id != null);
        group?.commit();
        useSelection.getState().setMixedSelection({ bullets, labels, polygons, svgImages });
        return;
      }
      // Cut = copy + delete, both scoped to the UNLOCKED copyable selection.
      // Locked items resist deletion, so cut leaves them entirely alone rather
      // than copying something it can't remove; stations aren't copyable, so
      // (like copy/duplicate) cut ignores them. When nothing is cuttable we fall
      // through WITHOUT preventDefault so a native cut still works.
      if (mod && !inForm && (e.key === 'x' || e.key === 'X')) {
        const {
          bullets: bulletIds,
          labels: labelIds,
          polygons: polygonIds,
          svgImages: svgImageIds,
        } = unlockedSelectedItemIds();
        const doc = useDoc.getState();
        const items = collectClipItems(doc, {
          bullets: bulletIds,
          labels: labelIds,
          polygons: polygonIds,
          svgImages: svgImageIds,
        });
        if (items.length === 0) return;
        // Serialize before deleting so the payload captures the pre-delete state;
        // the async write just flushes that already-built string later.
        navigator.clipboard?.writeText(writeClipboard(items)).catch(() => {});
        e.preventDefault();
        // Clear the selection first so no id dangles at a deleted item
        // (mirrors the Delete handler); then remove them in one history group.
        useSelection.getState().clearAllSelections();
        // Same open-group fold-in as the nudges above.
        const group = isHistoryGrouping() ? null : beginHistoryGroup();
        for (const id of bulletIds) doc.deleteRouteBullet(id);
        for (const id of labelIds) doc.deleteTextLabel(id);
        for (const id of polygonIds) doc.deletePolygon(id);
        for (const id of svgImageIds) doc.deleteSvgImage(id);
        group?.commit();
        return;
      }
      // R does two jobs, split by what is selected and by the Shift.
      //
      // Plain R rotates the selected stop's orientation (4-state axis cycle) or
      // the selected label (8×45°) — the keyboard twin of the layout editor's
      // right-click cycle — but ONLY while a stop/label is the active
      // sub-selection. Otherwise the letter works the grid, which is the far
      // more common press: R toggles it, Shift+R cycles the cell size, the twin
      // of the two paired toolbar buttons. The Shift is read FIRST and wins
      // outright, so the size cycle is never held hostage by whatever happens
      // to be selected (rotation has no shifted variant to lose).
      //
      // Which half runs is decided by e.shiftKey rather than the letter's case,
      // or CapsLock would swap them (it reports 'R' with no shift held). The
      // grid is NOT in the visibility registry — a drawing aid rather than map
      // content — hence the direct setters.
      if (!inFormControl && !mod && (e.key === 'r' || e.key === 'R')) {
        const sel = useSelection.getState();
        const doc = useDoc.getState();
        const subStation =
          sel.selectedStationIds.length === 1 ? doc.stations[sel.selectedStationIds[0]] : null;
        if (!e.shiftKey && subStation && (sel.selectedStopLineId || sel.labelSelected)) {
          e.preventDefault();
          const stopLineId = sel.selectedStopLineId;
          dispatchMirrored(subStation.id, (sid) => {
            // Rotation cycles are relative, hence frame-invariant across
            // mirror matches — no per-match transform.
            if (sel.labelSelected) doc.rotateLabel(sid);
            else if (stopLineId) doc.rotateStop(sid, stopLineId);
          });
          return;
        }
        // Repeats dropped: a held key would otherwise toggle at auto-repeat
        // rate, each press a store write and a full canvas re-render, landing
        // wherever the user happened to let go.
        if (e.repeat) return;
        const vp = useViewportStore.getState();
        if (e.shiftKey) vp.setGridSize(nextGridSize(vp.gridSize));
        else vp.setGridVisible(!vp.gridVisible);
        return;
      }
      // Snapping presets: Shift+digit recalls slot 0–9, Ctrl/Cmd+Shift+digit
      // saves the live snap modes into it. Read off e.code, not e.key: with
      // Shift held a US layout reports '!'/'@'/'#'…, so the digit is only
      // legible in the code. Above the plain-digit toggles below so the preset
      // wins on any layout where both could match, and repeats are dropped —
      // holding the key would otherwise re-fire (and re-toast) at auto-repeat
      // rate for no gain, since saving/recalling twice does nothing new.
      if (!inFormControl && e.shiftKey && !e.repeat && /^Digit\d$/.test(e.code)) {
        e.preventDefault();
        const slot = Number(e.code.slice(5));
        if (mod) {
          useSnapPrefs.getState().savePreset(slot);
          pushToast('info', `Snapping preset ${slot} saved`);
        } else {
          // An unsaved slot leaves the modes alone: recall shouldn't reset the
          // user's snapping just because they reached for a slot they never
          // filled. Say so rather than looking broken.
          const hit = useSnapPrefs.getState().recallPreset(slot);
          pushToast(
            'info',
            hit ? `Snapping preset ${slot} recalled` : `Snapping preset ${slot} is empty`,
          );
        }
        return;
      }
      // Each digit key advances one snap toggle a step — the keyboard twin of
      // a single click on that toolbar button (a multi-state toggle like Snap
      // to all / grid needs repeated presses to cycle, exactly like clicking).
      // The bound range is SNAP_TOGGLE_COUNT, derived from the toggle list, so
      // adding a toggle wires its key automatically instead of drifting from a
      // hardcoded '5'. Numpad digits too: with NumLock on e.key is already the
      // digit; with it off e.key is 'End'/'ArrowDown'/etc. but e.code is
      // 'Numpad1'.. . Ctrl/Cmd+digit is left alone for the browser's tab-switch.
      if (!inFormControl && !mod) {
        const digit =
          e.key >= '1' && e.key <= '9'
            ? Number(e.key)
            : /^Numpad[1-9]$/.test(e.code)
              ? Number(e.code.slice(6))
              : 0;
        if (digit >= 1 && digit <= SNAP_TOGGLE_COUNT) {
          e.preventDefault();
          const next = advanceSnapToggle(useSnapPrefs.getState().modes, digit - 1);
          if (next) useSnapPrefs.getState().setMode(next.key, next.value);
          return;
        }
      }
      // Layer visibility from the keyboard. Anchors, waypoints and guides are
      // the scaffolding layers flipped constantly while working, so they get
      // the letters; the rest stay a View-menu click away. The guides earn
      // theirs from the other side — they default to VISIBLE, and the press
      // that matters is getting them out of the way to see the map under them.
      //
      // WHICH letters is not decided here: the shortcut is a field on the
      // registry entry, beside the menu row that advertises it, and this reads
      // that field rather than re-spelling three letters two modules away. A
      // layer given a letter there is bound the same day — where three
      // hand-written arms would have left it printed on its menu row (and in
      // the help sheet, which reads the same field) and bound to nothing. The
      // write still goes through setVisibility, never a store setter by hand,
      // so the registry stays the one place a flag's name lives. Repeats are
      // dropped: a held key would otherwise toggle at auto-repeat rate, each
      // press a store write and a full canvas re-render, landing wherever the
      // user happened to let go.
      //
      // A press can be a no-op on screen: anchors nest under showNetwork and
      // are force-revealed by creating-transfer/placing-anchor, so toggling
      // under either is a preference change the canvas cannot show until the
      // mode ends. That is the reveal working as designed — the alternative, a
      // temporary write to the flag, needs a matching revert on every exit path
      // and strands the preference the first time one is missed.
      // Which is also why each press toasts: with the layer off-screen, out of
      // view, or held up by a mode, the message is the only confirmation the
      // key landed, and it names the direction so a mis-hit is legible. The
      // noun is the menu row's own label, so the two cannot come to disagree
      // about what the layer is called.
      if (!inFormControl && !mod && !e.repeat) {
        const layer = VISIBILITY_ITEMS.find((i) => i.shortcut === e.key.toUpperCase());
        if (layer) {
          const next = !useViewportStore.getState()[layer.key];
          setVisibility(layer.key, next);
          pushToast('info', `${next ? 'Showing' : 'Hiding'} ${layer.label.toLowerCase()}`);
          return;
        }
      }
      if (!inFormControl && !mod && (e.key === 'v' || e.key === 'V')) {
        setToolMode('arrow');
        return;
      }
      if (!inFormControl && !mod && (e.key === 'h' || e.key === 'H')) {
        setToolMode('hand');
        return;
      }
      if (!inFormControl && !mod && (e.key === 'l' || e.key === 'L')) {
        const cur = useSelection.getState().uiMode;
        setUiMode(cur.kind === 'layering' ? { kind: 'idle' } : { kind: 'layering' });
        return;
      }
      if (!inFormControl && !mod && (e.key === 't' || e.key === 'T')) {
        const cur = useSelection.getState().uiMode;
        setUiMode(
          cur.kind === 'creating-transfer'
            ? { kind: 'idle' }
            : { kind: 'creating-transfer', firstEnd: null },
        );
        return;
      }
      if (!inFormControl && e.key === ' ') {
        // preventDefault EVERY non-form Space keydown, repeats included. The
        // UA arms a focused button's native Space activation per unprevented
        // keydown and fires it on keyup — so if repeats passed through, a
        // toolbar toggle that silently kept focus after a mouse click would
        // re-click itself when Space is released after a held pan.
        e.preventDefault();
        if (!e.repeat) setSpaceHeld(true);
        return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
      if (e.key === 'Alt') {
        // Firefox arms its menu bar on the Alt keyUP — suppress that too.
        e.preventDefault();
        setAltHeld(false);
      }
    };
    // If the window loses focus while Space/Alt is held (alt-tab mid-gesture),
    // the keyup never arrives and the mode would stay stuck on. Reset on blur.
    const onBlur = () => {
      setSpaceHeld(false);
      setAltHeld(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [
    setUiMode,
    selectLineTag,
    selectRouteBullet,
    selectTransfer,
    selectLabel,
    selectSvgImage,
    setToolMode,
    setSpaceHeld,
    setAltHeld,
  ]);

  // Right-click cancels an active mode (see cancelModeOnContextMenu above).
  useEffect(() => {
    document.addEventListener('contextmenu', cancelModeOnContextMenu, true);
    return () => document.removeEventListener('contextmenu', cancelModeOnContextMenu, true);
  }, []);

  return (
    // --fun-ms rides on the root because the easter egg's crossfade has two
    // halves in different subtrees: the loose ball fading out inside the overlay
    // and the toolbar badge fading back in. One inherited property is what stops
    // them drifting apart from each other, or from DEFAULT_PARAMS.dimMs.
    <div
      className="app"
      data-theme={chromeDark ? 'dark' : undefined}
      style={{ '--fun-ms': `${DEFAULT_PARAMS.dimMs}ms` } as CSSProperties}
    >
      <Toolbar />
      <MapCanvas />
      <Sidebar />
      {/* Inside .app (not portalled) so the design tokens and data-theme
          apply; position:fixed puts it over the canvas regardless. */}
      <StatusToasts />
      {/* Easter egg. Inside .app for the same reason: the loose ball is the same
          themed badge the toolbar renders. */}
      <BouncingBullet />
    </div>
  );
}
