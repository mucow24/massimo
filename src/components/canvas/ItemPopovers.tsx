import { soleSelection, useDoc, useSelection } from '../../state/store';
import type { ViewportProjection } from './screenAnchor';
import { useLiveView } from './useViewport';
import type { LabelStyle } from '../../geometry/labelLayout';
import {
  polygonAABB,
  routeBulletAABB,
  stationWorldAABB,
  svgImageAABB,
  textLabelAABB,
} from '../../geometry/itemBounds';
import { stopHalfOf } from '../../model/lineWidth';
import { effectiveStationLabelStyle } from '../../model/transforms';
import { SIDEBAR_WIDTH, sidebarVisible } from '../Sidebar';
import { RouteBulletPopover } from '../RouteBulletPopover';
import { TextLabelPopover } from '../TextLabelPopover';
import { PolygonPopover } from '../PolygonPopover';
import { SvgImagePopover } from '../SvgImagePopover';
import { StationPopover } from '../StationPopover';

/**
 * Mounts the single floating popover for the current sole selection — a
 * station, route bullet, text label, polygon, or svg image. Driven by
 * `soleSelection`, so a popover only shows when exactly one item across
 * every type is selected (a co-selected item of another type can't leak one
 * open). Peeled out of MapCanvas so the canvas no longer carries the
 * near-identical gating blocks + their popover imports.
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
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const labelWeight = useDoc((s) => s.labelWeight);
  const labelItalic = useDoc((s) => s.labelItalic);
  const labelLeading = useDoc((s) => s.labelLeading);
  const labelTracking = useDoc((s) => s.labelTracking);

  // The popover anchors against the live viewport; a zero-size viewport (first
  // paint) has no screen mapping yet, so wait for a real box.
  if (!(view.vbW > 0 && view.vbH > 0)) return null;
  const sole = soleSelection(selection);
  if (!sole) return null;

  // The open sidebar overlays (and paints above) the host's right strip; a
  // spawn placed "fully on-screen" under it would be invisible. Spawn
  // placement gets the box left of the panel; projection keeps the real view.
  const spawnBox = sidebarVisible(selection)
    ? { w: view.size.w - SIDEBAR_WIDTH, h: view.size.h }
    : view.size;

  if (sole.type === 'station') {
    const st = stations[sole.id];
    if (!st) return null;
    const mode = selection.uiMode;
    // Shown in idle only — except the station's own layout-edit mode, whose
    // per-stop pickers live in this popover. Sticky placing-station must NOT
    // pop an editor open under every placement click on an existing station.
    // Hidden rather than unmounted for other modes: unmounting would drop the
    // frozen anchor and re-spawn the panel against wherever the camera is on
    // the way back to idle — a canvas-lock-breaking jump.
    const show =
      mode.kind === 'idle' ||
      (mode.kind === 'editing-station-layout' && mode.stationId === sole.id);
    // Same style/stopHalf the renderer uses, so the silhouette rect the spawn
    // dodges matches the painted station (cells + name label).
    const baseStyle: LabelStyle = {
      fontSize: labelFontSize,
      weight: labelWeight,
      italic: labelItalic,
      leading: labelLeading,
      tracking: labelTracking,
    };
    return (
      <StationPopover
        station={st}
        worldRect={stationWorldAABB(
          st,
          effectiveStationLabelStyle(st, baseStyle),
          stopHalfOf(lines),
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
