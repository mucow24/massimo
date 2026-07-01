import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
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
import { useViewportStore } from './state/viewportStore';
import { redo, undo } from './state/history';

// Selected items minus locked ones — locked items resist both Delete and
// arrow-nudge, so both keyboard paths filter the same way.
function unlockedSelectedPolygonIds(): string[] {
  const doc = useDoc.getState();
  return useSelection.getState().selectedPolygonIds.filter((id) => !doc.polygons[id]?.locked);
}
function unlockedSelectedRouteBulletIds(): string[] {
  const doc = useDoc.getState();
  return useSelection
    .getState()
    .selectedRouteBulletIds.filter((id) => !doc.routeBullets[id]?.locked);
}
function unlockedSelectedLabelIds(): string[] {
  const doc = useDoc.getState();
  return useSelection.getState().selectedLabelIds.filter((id) => !doc.textLabels[id]?.locked);
}
function unlockedSelectedSvgImageIds(): string[] {
  const doc = useDoc.getState();
  return useSelection.getState().selectedSvgImageIds.filter((id) => !doc.svgImages[id]?.locked);
}

// Selected stations minus locked ones — locked stations resist Delete and
// arrow-nudge too, mirroring locked polygons.
function unlockedSelectedStationIds() {
  const doc = useDoc.getState();
  return useSelection.getState().selectedStationIds.filter((id) => !doc.stations[id]?.locked);
}

export default function App() {
  const darkMode = useViewportStore((s) => s.darkMode);

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
      // (undo/redo/copy/paste/duplicate) still fire while one is focused —
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
      const inForm =
        (tag === 'INPUT' && inputType !== 'range' && inputType !== 'color') ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable;
      const inFormControl =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;

      if (e.key === 'Escape') {
        // cancelAppendMode runs first so a freshly-created empty line gets
        // garbage-collected before setUiMode flips the variant.
        cancelAppendMode();
        setUiMode({ kind: 'idle' });
        selectLineTag(null);
        selectRouteBullet(null);
        selectTransfer(null);
        selectLabel(null);
        selectSvgImage(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inFormControl) {
        const sel = useSelection.getState();
        // A selected polygon vertex takes top priority: remove just that vertex
        // (the transform no-ops at the 3-vertex floor) and keep the polygon
        // selected so the user can keep editing.
        if (sel.selectedVertex) {
          const { polygonId, index } = sel.selectedVertex;
          // Locked polygons can't be edited; ignore the vertex delete.
          if (!useDoc.getState().polygons[polygonId]?.locked) {
            e.preventDefault();
            sel.selectVertex(null);
            useDoc.getState().deleteVertex(polygonId, index);
            return;
          }
        }
        // Mixed station + bullet + label + polygon multi-selection takes
        // priority over the single-element delete paths below; one history
        // entry covers every removed item so a single Ctrl-Z reverts the lot.
        // Locked stations, bullets, labels, and polygons are all protected from deletion.
        const stationIds = unlockedSelectedStationIds();
        const bulletIds = unlockedSelectedRouteBulletIds();
        const labelIds = unlockedSelectedLabelIds();
        const polygonIds = unlockedSelectedPolygonIds();
        const svgImageIds = unlockedSelectedSvgImageIds();
        if (
          stationIds.length +
            bulletIds.length +
            labelIds.length +
            polygonIds.length +
            svgImageIds.length >
          0
        ) {
          e.preventDefault();
          sel.selectStation(null);
          sel.selectRouteBullet(null);
          sel.selectLabel(null);
          sel.selectPolygon(null);
          sel.selectSvgImage(null);
          const group = beginHistoryGroup();
          const doc = useDoc.getState();
          for (const id of stationIds) doc.deleteStation(id);
          for (const id of bulletIds) doc.deleteRouteBullet(id);
          for (const id of labelIds) doc.deleteTextLabel(id);
          for (const id of polygonIds) doc.deletePolygon(id);
          for (const id of svgImageIds) doc.deleteSvgImage(id);
          group.commit();
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
        // A selected polygon vertex takes top priority (mirrors Delete): nudge
        // just that handle, leaving the rest of the polygon put.
        if (sel.selectedVertex) {
          const { polygonId, index } = sel.selectedVertex;
          const poly = doc.polygons[polygonId];
          if (poly && !poly.locked) {
            e.preventDefault();
            const v = poly.vertices[index];
            const group = beginHistoryGroup();
            doc.moveVertex(polygonId, index, v.x + dx, v.y + dy);
            group.commit();
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
            const group = beginHistoryGroup();
            fanOutMirrored(subStation.id, (sid) => {
              const st = useDoc.getState().stations[sid];
              if (!st) return;
              doc.setLabelOffset(sid, st.label.offset + dOffset);
              doc.setLabelOffsetPerp(sid, resolveOffsetPerp(st.label) + dPerp);
            });
            group.commit();
            return;
          }
          const target = nudgeTarget({
            source: subCell,
            wSrc: subSource.kind === 'label' ? STOP_SIZE : lineWidthOf(doc.lines[subSource.lineId]),
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
        const stationIds = unlockedSelectedStationIds();
        const bulletIds = unlockedSelectedRouteBulletIds();
        const labelIds = unlockedSelectedLabelIds();
        const polygonIds = unlockedSelectedPolygonIds();
        const svgImageIds = unlockedSelectedSvgImageIds();
        if (
          stationIds.length +
            bulletIds.length +
            labelIds.length +
            polygonIds.length +
            svgImageIds.length >
          0
        ) {
          e.preventDefault();
          const group = beginHistoryGroup();
          for (const id of stationIds) {
            const s = doc.stations[id];
            if (s) doc.moveStation(id, s.x + dx, s.y + dy);
          }
          for (const id of bulletIds) {
            const b = doc.routeBullets[id];
            if (b) doc.moveRouteBullet(id, b.x + dx, b.y + dy);
          }
          for (const id of labelIds) {
            const l = doc.textLabels[id];
            if (l) doc.moveTextLabel(id, l.x + dx, l.y + dy);
          }
          for (const id of polygonIds) doc.movePolygon(id, dx, dy);
          for (const id of svgImageIds) {
            const im = doc.svgImages[id];
            if (im) doc.moveSvgImage(id, im.x + dx, im.y + dy);
          }
          group.commit();
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
        const { bullets, labels, polygons, svgImages } = getCopyableSelection(
          useSelection.getState(),
        );
        const doc = useDoc.getState();
        const items: ClipPayload[] = [];
        for (const id of bullets) {
          const b = doc.routeBullets[id];
          if (b) items.push(routeBulletPayload(b));
        }
        for (const id of labels) {
          const l = doc.textLabels[id];
          if (l) items.push(textLabelPayload(l));
        }
        for (const id of polygons) {
          const p = doc.polygons[id];
          if (p) items.push(polygonPayload(p));
        }
        for (const id of svgImages) {
          const im = doc.svgImages[id];
          if (im) items.push(svgImagePayload(im));
        }
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
            const group = beginHistoryGroup();
            for (const item of items) {
              if (item.kind === 'route-bullet') bullets.push(doc.pasteRouteBullet(item.data));
              else if (item.kind === 'text-label') labels.push(doc.pasteTextLabel(item.data));
              else if (item.kind === 'polygon') polygons.push(doc.pastePolygon(item.data));
              else if (item.kind === 'svg-image') svgImages.push(doc.pasteSvgImage(item.data));
            }
            group.commit();
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
        const group = beginHistoryGroup();
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
        group.commit();
        useSelection.getState().setMixedSelection({ bullets, labels, polygons, svgImages });
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
      if (!inFormControl && e.key === ' ' && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
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

  // Right-click anywhere cancels an active mode. Capture phase + stopPropagation
  // so we beat element-level context menus (station rotate, tag flip): they
  // shouldn't fire when the user is trying to back out of a mode.
  useEffect(() => {
    const onContextMenu = (e: globalThis.MouseEvent) => {
      const sel = useSelection.getState();
      // Modes in RIGHT_CLICK_PASSTHROUGH_MODES own the right-click gesture
      // (layering uses it to decrement a segment's layer); everything else
      // exits on right-click. The set lives next to UiMode in the store so
      // a new variant declares its right-click policy in one place.
      if (RIGHT_CLICK_PASSTHROUGH_MODES.has(sel.uiMode.kind)) return;
      e.preventDefault();
      e.stopPropagation();
      cancelAppendMode();
      sel.setUiMode({ kind: 'idle' });
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => document.removeEventListener('contextmenu', onContextMenu, true);
  }, []);

  return (
    <div className="app" data-theme={darkMode ? 'dark' : undefined}>
      <Toolbar />
      <MapCanvas />
      <Sidebar />
    </div>
  );
}
