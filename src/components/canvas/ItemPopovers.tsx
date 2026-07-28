import { soleSelection, useDoc, useSelection } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
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

/**
 * Mounts the single popover for the current sole selection — a station, route
 * bullet, text label, polygon, svg image, or transfer. Driven by
 * `soleSelection` for the five multi-select types, so a popover only shows
 * when exactly one item across every type is selected (a co-selected item of
 * another type can't leak one open); transfers are a single-id primary outside
 * `soleSelection`, mutually exclusive with the list selections via
 * SIBLING_PRIMARY_CLEAR. Peeled out of MapCanvas so the canvas no longer
 * carries the near-identical gating blocks + their popover imports.
 *
 * Every panel docks to the host's top-right corner (usePinnedPopover), so the
 * only geometry this component owns is `hostW`: the host box minus the open
 * sidebar's strip, since the sidebar overlays — and paints above — the host's
 * right edge. No camera state reaches the popovers at all; a pan or zoom moves
 * the map under a panel that stays put.
 */
export function ItemPopovers({ hostSize }: { hostSize: { w: number; h: number } }) {
  const selection = useSelection();
  const stations = useDoc((s) => s.stations);
  const routeBullets = useDoc((s) => s.routeBullets);
  const textLabels = useDoc((s) => s.textLabels);
  const polygons = useDoc((s) => s.polygons);
  const svgImages = useDoc((s) => s.svgImages);
  const lines = useDoc((s) => s.lines);
  const transfers = useDoc((s) => s.transfers);
  // These panels are DOM overlays, not canvas content, so the lines/stations
  // toggle doesn't take the station/transfer ones with it — they'd hang there
  // offering to edit what the user can't see.
  const showNetwork = useViewportStore((s) => s.showNetwork);

  // A zero-size host (first paint, before the ResizeObserver measures) has no
  // corner to dock into yet; waiting for a real box keeps the panel from
  // flashing at the left edge.
  if (!(hostSize.w > 0 && hostSize.h > 0)) return null;
  const hostW = sidebarVisible(selection) ? hostSize.w - SIDEBAR_WIDTH : hostSize.w;

  // Edit Stops: the line editor rides in a panel mounted for the whole mode
  // (the sidebar cedes the corner — sidebarVisible). Checked before the
  // sole-selection branching: entering the mode wipes every other selection,
  // so nothing below can co-show.
  if (selection.uiMode.kind === 'appending-to-line') {
    const ln = lines[selection.uiMode.lineId];
    if (!ln || !showNetwork) return null;
    return <LinePopover line={ln} hostW={hostW} />;
  }

  const sole = soleSelection(selection);
  if (!sole) {
    // ≥2 items across the six multi-select lists: ONE popover for the whole
    // group (count summary + bulk lock/unlock/delete). Idle-only — the modes
    // that preserve a selection (placing-label's marquee) shouldn't pop a
    // group editor under their placement clicks, mirroring the station gate
    // below.
    const multiIds: SelectionItemIds = {
      stations: selection.selectedStationIds,
      bullets: selection.selectedRouteBulletIds,
      labels: selection.selectedLabelIds,
      polygons: selection.selectedPolygonIds,
      svgImages: selection.selectedSvgImageIds,
      anchors: selection.selectedAnchorIds,
    };
    if (itemIdCount(multiIds) >= 2 && selection.uiMode.kind === 'idle') {
      return <SelectionPopover ids={multiIds} hostW={hostW} />;
    }
    const t = selection.selectedTransferId ? transfers[selection.selectedTransferId] : undefined;
    if (!t || !showNetwork) return null;
    return (
      <TransferPopover transfer={t} hostW={hostW} onClose={() => selection.selectTransfer(null)} />
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
    // Hidden rather than unmounted for other modes: the panel keeps its DOM
    // node (and any scrolled-to position inside it) across the excursion. A
    // hidden network is the same kind of excursion — the station stays
    // SELECTED (this is a peek at the background, not a deselect).
    const show =
      showNetwork &&
      (mode.kind === 'idle' ||
        (mode.kind === 'editing-station-layout' && mode.stationId === sole.id));
    return (
      <StationPopover
        station={st}
        hostW={hostW}
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
        hostW={hostW}
        onClose={() => selection.selectRouteBullet(null)}
      />
    );
  }
  if (sole.type === 'label') {
    const g = textLabels[sole.id];
    if (!g) return null;
    return <TextLabelPopover label={g} hostW={hostW} onClose={() => selection.selectLabel(null)} />;
  }
  if (sole.type === 'polygon') {
    const p = polygons[sole.id];
    if (!p) return null;
    return (
      <PolygonPopover polygon={p} hostW={hostW} onClose={() => selection.selectPolygon(null)} />
    );
  }
  if (sole.type === 'svgImage') {
    const im = svgImages[sole.id];
    if (!im) return null;
    return (
      <SvgImagePopover image={im} hostW={hostW} onClose={() => selection.selectSvgImage(null)} />
    );
  }
  return null;
}
