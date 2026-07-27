import { soleSelection, useDoc, useSelection } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import type { ViewportProjection } from './screenAnchor';
import { useLiveView } from './useViewport';
import {
  polygonAABB,
  routeBulletAABB,
  stationWorldAABB,
  svgImageAABB,
  textLabelAABB,
  transferAABB,
  transferAnchorAABB,
  unionAABBs,
} from '../../geometry/itemBounds';
import { stopGapOf, stopHalfOf } from '../../model/lineWidth';
import { stopDashOf } from '../../model/dashSize';
import { effectiveStationLabelStyle } from '../../model/transforms';
import { resolveTransferStyle } from '../../model/transferStyle';
import type { AABB } from '../../geometry/rectPolygon';
import { itemIdCount, type SelectionItemIds } from '../../state/selectionOps';
import { SIDEBAR_WIDTH, sidebarVisible } from '../Sidebar';
import { LinePopover } from '../LinePopover';
import { SelectionPopover } from '../SelectionPopover';
import { RouteBulletPopover } from '../RouteBulletPopover';
import { TextLabelPopover } from '../TextLabelPopover';
import { PolygonPopover } from '../PolygonPopover';
import { SvgImagePopover } from '../SvgImagePopover';
import { StationPopover } from '../StationPopover';
import { TransferPopover } from '../TransferPopover';
import { transferEndWorld } from '../../geometry/transferEnds';

/**
 * Mounts the single floating popover for the current sole selection — a
 * station, route bullet, text label, polygon, svg image, or transfer. Driven
 * by `soleSelection` for the five multi-select types, so a popover only shows
 * when exactly one item across every type is selected (a co-selected item of
 * another type can't leak one open); transfers are a single-id primary
 * outside `soleSelection`, mutually exclusive with the list selections via
 * SIBLING_PRIMARY_CLEAR. Peeled out of MapCanvas so the canvas no longer
 * carries the near-identical gating blocks + their popover imports.
 *
 * Each branch hands its popover the item's world AABB (geometry/itemBounds):
 * the spawn placement opens the panel beside the item instead of on top of
 * it. The rect is a spawn hint only — useDraggablePopover freezes the placed
 * position and ignores the rect afterwards.
 */
export function ItemPopovers({ view: committed }: { view: ViewportProjection }) {
  // Reproject through the in-flight viewport during a pan/zoom so the popover
  // tracks the canvas frame-for-frame instead of jumping at gesture-commit;
  // identical to `committed` between gestures.
  const view = useLiveView(committed);
  const selection = useSelection();
  const stations = useDoc((s) => s.stations);
  const routeBullets = useDoc((s) => s.routeBullets);
  const textLabels = useDoc((s) => s.textLabels);
  const polygons = useDoc((s) => s.polygons);
  const svgImages = useDoc((s) => s.svgImages);
  const lines = useDoc((s) => s.lines);
  const transfers = useDoc((s) => s.transfers);
  const transferAnchors = useDoc((s) => s.transferAnchors);
  // These panels are DOM overlays, not canvas content, so the lines/stations
  // toggle doesn't take the station/transfer ones with it — they'd hang there
  // anchored to nothing, offering to edit what the user can't see.
  const showNetwork = useViewportStore((s) => s.showNetwork);

  // The popover anchors against the live viewport; a zero-size viewport (first
  // paint) has no screen mapping yet, so wait for a real box.
  if (!(view.vbW > 0 && view.vbH > 0)) return null;

  // Edit Stops: the line editor rides in a panel hard-pinned to the host's
  // top-right corner, mounted for the whole mode (the sidebar cedes the
  // corner — sidebarVisible). Checked before the sole-selection branching:
  // entering the mode wipes every other selection, so nothing below can
  // co-show. Unmounted (not hidden) when the network toggles off — the pin is
  // static, so there's no frozen anchor to preserve (the transfer rationale).
  if (selection.uiMode.kind === 'appending-to-line') {
    const ln = lines[selection.uiMode.lineId];
    if (!ln || !showNetwork) return null;
    return <LinePopover line={ln} hostSize={view.size} />;
  }

  // The open sidebar overlays (and paints above) the host's right strip; a
  // spawn placed "fully on-screen" under it would be invisible. Spawn
  // placement gets the box left of the panel; projection keeps the real view.
  const spawnBox = sidebarVisible(selection)
    ? { w: view.size.w - SIDEBAR_WIDTH, h: view.size.h }
    : view.size;

  const sole = soleSelection(selection);
  if (!sole) {
    // ≥2 items across the six multi-select lists: ONE popover for the whole
    // group (count summary + bulk lock/unlock/delete). Idle-only — the modes
    // that preserve a selection (placing-label's marquee) shouldn't pop a
    // group editor under their placement clicks, mirroring the station gate
    // below. The union of the members' AABBs is the spawn hint; members that
    // don't resolve (transient mid-delete render) just don't contribute.
    const multiIds: SelectionItemIds = {
      stations: selection.selectedStationIds,
      bullets: selection.selectedRouteBulletIds,
      labels: selection.selectedLabelIds,
      polygons: selection.selectedPolygonIds,
      svgImages: selection.selectedSvgImageIds,
      anchors: selection.selectedAnchorIds,
    };
    if (itemIdCount(multiIds) >= 2 && selection.uiMode.kind === 'idle') {
      const rects: AABB[] = [];
      const stopHalf = stopHalfOf(lines);
      const stopDash = stopDashOf(lines);
      const stopGap = stopGapOf(lines);
      for (const id of multiIds.stations) {
        const st = stations[id];
        if (st)
          rects.push(
            stationWorldAABB(st, effectiveStationLabelStyle(st), stopHalf, stopDash, stopGap),
          );
      }
      for (const id of multiIds.bullets) {
        const b = routeBullets[id];
        if (b) rects.push(routeBulletAABB(b));
      }
      for (const id of multiIds.labels) {
        const l = textLabels[id];
        if (l) rects.push(textLabelAABB(l));
      }
      for (const id of multiIds.polygons) {
        const p = polygons[id];
        if (p) rects.push(polygonAABB(p.vertices));
      }
      for (const id of multiIds.svgImages) {
        const im = svgImages[id];
        if (im) rects.push(svgImageAABB(im));
      }
      for (const id of multiIds.anchors) {
        const a = transferAnchors[id];
        if (a) rects.push(transferAnchorAABB(a));
      }
      if (rects.length === 0) return null;
      return (
        <SelectionPopover
          ids={multiIds}
          worldRect={unionAABBs(rects)}
          view={view}
          spawnBox={spawnBox}
        />
      );
    }
    const t = selection.selectedTransferId ? transfers[selection.selectedTransferId] : undefined;
    // Unmounted rather than `hidden` like the station panel below: TransferPopover
    // has no hidden prop, and a transfer's panel is cheap to re-spawn beside its
    // (restored) transfer on the way back.
    if (!t || !showNetwork) return null;
    // A live transfer's ends always resolve (either end's removal cascade-
    // deletes it); the guard covers a transient render mid-delete. Resolved
    // through the SAME helper the two paint passes use, so the popover can't
    // spawn beside a point the transfer isn't drawn at.
    const ea = transferEndWorld(t.a, stations, transferAnchors);
    const eb = transferEndWorld(t.b, stations, transferAnchors);
    if (!ea || !eb) return null;
    const style = resolveTransferStyle(t);
    return (
      <TransferPopover
        transfer={t}
        worldRect={transferAABB(ea, eb, style.thickness / 2 + style.strokeWidth)}
        view={view}
        spawnBox={spawnBox}
        onClose={() => selection.selectTransfer(null)}
      />
    );
  }

  // Anchors have no popover — they are "very boring" by design: select, drag,
  // nudge, delete. They ARE in soleSelection because hitStack's alt-click cycle
  // reads it to find the current entry, so bailing here is what keeps the two
  // consumers honest about the same state.
  if (sole.type === 'anchor') return null;

  if (sole.type === 'station') {
    const st = stations[sole.id];
    if (!st) return null;
    const mode = selection.uiMode;
    // Shown in idle only — except the station's own layout-edit mode, whose
    // per-stop pickers live in this popover. Sticky placing-station must NOT
    // pop an editor open under every placement click on an existing station.
    // Hidden rather than unmounted for other modes: unmounting would drop the
    // frozen anchor and re-spawn the panel against wherever the camera is on
    // the way back to idle — a canvas-lock-breaking jump. A hidden network is
    // the same kind of excursion: the station stays SELECTED (this is a peek at
    // the background, not a deselect), so the panel just goes quiet and returns
    // to the same canvas point on the way back.
    const show =
      showNetwork &&
      (mode.kind === 'idle' ||
        (mode.kind === 'editing-station-layout' && mode.stationId === sole.id));
    // Same style/stopHalf the renderer uses, so the silhouette rect the spawn
    // dodges matches the painted station (cells + name label).
    return (
      <StationPopover
        station={st}
        worldRect={stationWorldAABB(
          st,
          effectiveStationLabelStyle(st),
          stopHalfOf(lines),
          stopDashOf(lines),
          stopGapOf(lines),
        )}
        view={view}
        spawnBox={spawnBox}
        hidden={!show}
        onClose={() => selection.selectStation(null)}
      />
    );
  }

  if (sole.type === 'bullet') {
    const b = routeBullets[sole.id];
    if (!b) return null;
    return (
      <RouteBulletPopover
        bullet={b}
        worldRect={routeBulletAABB(b)}
        view={view}
        spawnBox={spawnBox}
        onClose={() => selection.selectRouteBullet(null)}
      />
    );
  }
  if (sole.type === 'label') {
    const g = textLabels[sole.id];
    if (!g) return null;
    return (
      <TextLabelPopover
        label={g}
        worldRect={textLabelAABB(g)}
        view={view}
        spawnBox={spawnBox}
        onClose={() => selection.selectLabel(null)}
      />
    );
  }
  if (sole.type === 'polygon') {
    const p = polygons[sole.id];
    if (!p) return null;
    return (
      <PolygonPopover
        polygon={p}
        worldRect={polygonAABB(p.vertices)}
        view={view}
        spawnBox={spawnBox}
        onClose={() => selection.selectPolygon(null)}
      />
    );
  }
  if (sole.type === 'svgImage') {
    const im = svgImages[sole.id];
    if (!im) return null;
    return (
      <SvgImagePopover
        image={im}
        worldRect={svgImageAABB(im)}
        view={view}
        spawnBox={spawnBox}
        onClose={() => selection.selectSvgImage(null)}
      />
    );
  }
  return null;
}
