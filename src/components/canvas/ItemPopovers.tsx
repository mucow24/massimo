import { soleSelection, useDoc, useSelection } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import { kindVisible, type VisibilityKey } from '../../state/visibility';
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
import { LineCirclePopover } from '../LineCirclePopover';

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
  const lineCircles = useDoc((s) => s.lineCircles);
  const lines = useDoc((s) => s.lines);
  const transfers = useDoc((s) => s.transfers);
  // These panels are DOM overlays, not canvas content, so NOTHING about hiding a
  // layer takes them away on its own — a panel would hang there offering to edit,
  // and Delete, an item that is no longer on screen. Every View-menu kind needs
  // its own gate for the reason the lines/stations one has always had.
  //
  // Through `kindVisible` so this agrees with the canvas by construction rather
  // than by two lists staying in step — the registry carries both the reveal
  // and the nesting under `showNetwork`, so transfers and anchors need no
  // hand-written `showNetwork &&` here. The reveal half is inert HERE —
  // entering any non-idle mode runs `clearedSelections`, so there is never a
  // selection left for a placing mode to keep an editor open for — but reading
  // the same helper as every other consumer is what makes "one entry point"
  // true. Stations stay on the raw `showNetwork` because their panel is HIDDEN
  // rather than unmounted below.
  const showNetwork = useViewportStore((s) => s.showNetwork);
  const modeKind = selection.uiMode.kind;
  const shows = (key: VisibilityKey, flag: boolean) =>
    kindVisible(key, { flag, showNetwork, modeKind });
  const vis = {
    bullet: shows(
      'showRouteBullets',
      useViewportStore((s) => s.showRouteBullets),
    ),
    label: shows(
      'showTextLabels',
      useViewportStore((s) => s.showTextLabels),
    ),
    polygon: shows(
      'showPolygons',
      useViewportStore((s) => s.showPolygons),
    ),
    svgImage: shows(
      'showSvgImages',
      useViewportStore((s) => s.showSvgImages),
    ),
    lineCircle: shows(
      'showLineCircles',
      useViewportStore((s) => s.showLineCircles),
    ),
    transfer: shows(
      'showTransfers',
      useViewportStore((s) => s.showTransfers),
    ),
    anchor: shows(
      'showAnchors',
      useViewportStore((s) => s.showAnchors),
    ),
  };

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
    // Hidden kinds drop OUT of the group: its count and its bulk
    // lock/unlock/delete must describe what is on screen, not a tally that
    // silently includes items the user cannot see. They stay SELECTED — hiding
    // is a peek — so unhiding brings them back into the same group. Falling
    // below two visible items shows no group panel rather than promoting the
    // survivor to its own: a selection quietly narrowing under a toggle should
    // not also change which editor is open.
    const multiIds: SelectionItemIds = {
      stations: showNetwork ? selection.selectedStationIds : [],
      bullets: vis.bullet ? selection.selectedRouteBulletIds : [],
      labels: vis.label ? selection.selectedLabelIds : [],
      polygons: vis.polygon ? selection.selectedPolygonIds : [],
      svgImages: vis.svgImage ? selection.selectedSvgImageIds : [],
      anchors: vis.anchor ? selection.selectedAnchorIds : [],
      lineCircles: vis.lineCircle ? selection.selectedLineCircleIds : [],
    };
    if (itemIdCount(multiIds) >= 2 && selection.uiMode.kind === 'idle') {
      return <SelectionPopover ids={multiIds} hostW={hostW} />;
    }
    const t = selection.selectedTransferId ? transfers[selection.selectedTransferId] : undefined;
    if (!t || !vis.transfer) return null;
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
    if (!b || !vis.bullet) return null;
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
    if (!g || !vis.label) return null;
    return <TextLabelPopover label={g} hostW={hostW} onClose={() => selection.selectLabel(null)} />;
  }
  if (sole.type === 'polygon') {
    const p = polygons[sole.id];
    if (!p || !vis.polygon) return null;
    return (
      <PolygonPopover polygon={p} hostW={hostW} onClose={() => selection.selectPolygon(null)} />
    );
  }
  if (sole.type === 'svgImage') {
    const im = svgImages[sole.id];
    if (!im || !vis.svgImage) return null;
    return (
      <SvgImagePopover image={im} hostW={hostW} onClose={() => selection.selectSvgImage(null)} />
    );
  }
  if (sole.type === 'lineCircle') {
    const c = lineCircles[sole.id];
    if (!c || !vis.lineCircle) return null;
    return (
      <LineCirclePopover
        circle={c}
        hostW={hostW}
        onClose={() => selection.selectLineCircle(null)}
      />
    );
  }
  return null;
}
