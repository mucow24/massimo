import { soleSelection, useDoc, useSelection } from '../../state/store';
import type { ViewportProjection } from './screenAnchor';
import { useLiveView } from './useViewport';
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

  // The popover anchors against the live viewport; a zero-size viewport (first
  // paint) has no screen mapping yet, so wait for a real box.
  if (!(view.vbW > 0 && view.vbH > 0)) return null;
  const sole = soleSelection(selection);
  if (!sole) return null;

  if (sole.type === 'station') {
    const st = stations[sole.id];
    const mode = selection.uiMode;
    // Idle only — except the station's own layout-edit mode, whose per-stop
    // pickers live in this popover. Sticky placing-station must NOT pop an
    // editor open under every placement click on an existing station.
    const show =
      st &&
      (mode.kind === 'idle' ||
        (mode.kind === 'editing-station-layout' && mode.stationId === sole.id));
    if (!show) return null;
    return (
      <StationPopover station={st} view={view} onClose={() => selection.selectStation(null)} />
    );
  }

  if (sole.type === 'bullet') {
    const b = routeBullets[sole.id];
    if (!b) return null;
    return (
      <RouteBulletPopover
        bullet={b}
        world={{ x: b.x, y: b.y }}
        view={view}
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
        world={{ x: g.x, y: g.y }}
        view={view}
        onClose={() => selection.selectLabel(null)}
      />
    );
  }
  if (sole.type === 'polygon') {
    const p = polygons[sole.id];
    if (!p) return null;
    return <PolygonPopover polygon={p} view={view} onClose={() => selection.selectPolygon(null)} />;
  }
  if (sole.type === 'svgImage') {
    const im = svgImages[sole.id];
    if (!im) return null;
    return (
      <SvgImagePopover image={im} view={view} onClose={() => selection.selectSvgImage(null)} />
    );
  }
  return null;
}
