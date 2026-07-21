import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
import { StatusToasts } from './components/StatusToasts';
import { useViewportStore } from './state/viewportStore';
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
import { _clearTextMeasureCache } from './geometry/textMeasure';
import { screenDeltaToLabelOffsets } from './geometry/labelLayout';
import { STOP_SIZE, rotateGridDelta, type Rotation } from './geometry/orientation';
import { lineWidthOf } from './model/lineWidth';
import { resolveOffsetPerp } from './model/transforms';
import {
  nudgeTarget,
  otherLayoutNodes,
  sourceCellOf,
  stationLayoutNodes,
  type LayoutSource,
} from './components/inspector/stopGridDrag';
import { dispatchMirrored, fanOutMirrored } from './state/mirrorDispatch';
import { useSnapPrefs } from './state/snapPrefs';
import { advanceSnapToggle, SNAP_TOGGLE_COUNT } from './components/SnapToggleBar';
import {
  deleteUnlockedSelection,
  itemIdCount,
  unlockedSelectedItemIds,
} from './state/selectionOps';
import { isHistoryGrouping, redo, undo } from './state/history';
import { decideDeleteKey } from './components/canvas/appendGestures';

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
  // first paint runs before Helvetica Neue is ready, so those measurements use
  // the fallback font (whose side bearings differ by a pixel or two) and get
  // cached. Without invalidation the labels stay a hair off until the next edit
  // re-measures them — which looked like a line "shifting" when you edited a
  // sibling line. Dropping the stale cache and bumping this counter on font
  // load lets every label settle at its real metrics up front.
  const [, setFontEpoch] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      _clearTextMeasureCache();
      setFontEpoch((e) => e + 1);
    };
    // `ready` covers the fonts in use at first paint; `loadingdone` covers
    // weights that load later (e.g. switching a label to a weight not yet
    // fetched), so those re-measure too.
    fonts.ready.then(refresh);
    fonts.addEventListener('loadingdone', refresh);
    return () => {
      cancelled = true;
      fonts.removeEventListener('loadingdone', refresh);
    };
  }, []);
  const setUiMode = useSelection((s) => s.setUiMode);
  const selectLineTag = useSelection((s) => s.selectLineTag);
  const selectRouteBullet = useSelection((s) => s.selectRouteBullet);
  const selectTransfer = useSelection((s) => s.selectTransfer);
  const selectLabel = useSelection((s) => s.selectLabel);
  const selectSvgImage = useSelection((s) => s.selectSvgImage);
  const setToolMode = useSelection((s) => s.setToolMode);
  const setSpaceHeld = useSelection((s) => s.setSpaceHeld);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Two-tier form-field guard.
      //
      // `inForm` excludes range sliders and color pickers so the Ctrl-combos
      // (undo/redo/copy/cut/paste/duplicate) still fire while one is focused —
      // otherwise Ctrl+Z is swallowed mid-slider-drag (sliders/pickers have no
      // native text-editing shortcuts worth preserving).
      //
      // `inFormControl` is the stricter "any focusable form control" test used
      // by the non-modifier canvas shortcuts (Delete, arrow-nudge, the a/h/l/t
      // tool toggles, and Space-pan). Those have no business firing while ANY
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
          if (sel.selectedStopLineId || sel.labelSelected) {
            sel.setSelectedStopLineId(null);
            sel.setLabelSelected(false);
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
        if (sel.selectedVertices) {
          const { polygonId, indices } = sel.selectedVertices;
          // Locked polygons can't be edited; ignore the vertex delete.
          if (!useDoc.getState().polygons[polygonId]?.locked) {
            e.preventDefault();
            sel.selectVertices(null);
            useDoc.getState().deleteVertices(polygonId, indices);
            return;
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
        const transferId = sel.selectedTransferId;
        if (transferId) {
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
        if (sel.selectedVertices) {
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
            wSrc: subSource.kind === 'label' ? STOP_SIZE : lineWidthOf(doc.lines[subSource.lineId]),
            srcIsLabel: subSource.kind === 'label',
            otherNodes: otherLayoutNodes(stationLayoutNodes(subStation, doc.lines), subSource),
            basis: e.shiftKey ? 'diagonal' : 'orthogonal',
            stationRotation: rotation,
            arrow: { row: Math.sign(dy), col: Math.sign(dx) },
          });
          if (!target) return;
          const dRow = target.row - subCell.row;
          const dCol = target.col - subCell.col;
          dispatchMirrored(subStation.id, (sid, k) => {
            // Local-frame deltas rotate by the match's layoutOffset so the
            // world-frame edit mirrors the source (same as the inspector).
            const d = rotateGridDelta(dRow, dCol, k);
            if (subSource.kind === 'label') doc.moveLabel(sid, d.dRow, d.dCol);
            else doc.moveStop(sid, subSource.lineId, d.dRow, d.dCol);
          });
          return;
        }
        // Locked stations, bullets, labels, and polygons don't move.
        const ids = unlockedSelectedItemIds();
        if (itemIdCount(ids) > 0) {
          e.preventDefault();
          // Same open-group fold-in as the vertex nudge above.
          const group = isHistoryGrouping() ? null : beginHistoryGroup();
          for (const id of ids.stations) {
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
        const {
          bullets: bulletIds,
          labels: labelIds,
          polygons: polygonIds,
          svgImages: svgImageIds,
        } = getCopyableSelection(useSelection.getState());
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
      // R rotates the selected stop's orientation (4-state axis cycle) or
      // the selected label (8×45°) — the keyboard twin of the layout
      // editor's right-click cycle. Only bound while a stop/label is the
      // active sub-selection, so the key stays free otherwise.
      if (!inFormControl && !mod && (e.key === 'r' || e.key === 'R')) {
        const sel = useSelection.getState();
        const doc = useDoc.getState();
        const subStation =
          sel.selectedStationIds.length === 1 ? doc.stations[sel.selectedStationIds[0]] : null;
        if (subStation && (sel.selectedStopLineId || sel.labelSelected)) {
          e.preventDefault();
          const stopLineId = sel.selectedStopLineId;
          dispatchMirrored(subStation.id, (sid) => {
            // Rotation cycles are relative, hence frame-invariant across
            // mirror matches — no per-match transform.
            if (sel.labelSelected) doc.rotateLabel(sid);
            else if (stopLineId) doc.rotateStop(sid, stopLineId);
          });
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
      if (!inFormControl && !mod && (e.key === 'a' || e.key === 'A')) {
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
            : { kind: 'creating-transfer', anchor: null },
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
    };
    // If the window loses focus while Space is held (alt-tab mid hand-pan), the
    // keyup never arrives and pan mode would stay stuck on. Reset on blur.
    const onBlur = () => setSpaceHeld(false);
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
  ]);

  // Right-click cancels an active mode (see cancelModeOnContextMenu above).
  useEffect(() => {
    document.addEventListener('contextmenu', cancelModeOnContextMenu, true);
    return () => document.removeEventListener('contextmenu', cancelModeOnContextMenu, true);
  }, []);

  return (
    <div className="app" data-theme={chromeDark ? 'dark' : undefined}>
      <Toolbar />
      <MapCanvas />
      <Sidebar />
      {/* Inside .app (not portalled) so the design tokens and data-theme
          apply; position:fixed puts it over the canvas regardless. */}
      <StatusToasts />
    </div>
  );
}
