import { memo } from 'react';
import { Line, Station } from '../model/types';
import { useViewportStore } from '../state/viewportStore';
import { useFontEpochValue } from '../state/fontEpoch';
import { StationSilhouette } from './StationSilhouette';
import { StationHitArea } from './StationHitArea';
import { StationDots, type DotSubPass } from './StationDots';
import { StationLabel, StationHighlightLabel, StationStarterLabel } from './StationLabel';
import { StationOrientationArrows } from './StationOrientationArrows';

// The three split dot layers, each carrying its StationDots sub-pass.
const DOT_SUB_PASS_OF = {
  'dot-silhouettes': 'silhouettes',
  'dot-bodies': 'bodies',
  'dot-codes': 'codes',
} as const satisfies Record<string, DotSubPass>;

interface Props {
  station: Station;
  lines: Record<string, Line>;
  zoom: number;
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void;
  layer:
    | 'wash'
    | 'bg'
    | 'hit'
    | 'label'
    | 'highlight-label'
    | 'starter-label'
    // 'dots' paints the whole dot stack from one mount; the three 'dot-*'
    // layers cut it into its sub-passes so MapCanvas can slot lifted transfers
    // into the gaps (see TransferDrawOrder). Their union IS 'dots'.
    | 'dots'
    | 'dot-silhouettes'
    | 'dot-bodies'
    | 'dot-codes'
    | 'stroke'
    | 'match-stroke'
    | 'hover-arrows';
  // Override fill for the highlight-* layers (default white).
  highlightColor?: string;
  // Override the `stroke` layer's outline color (default: theme selection
  // stroke). Used by the layout-edit focus to paint a white outline.
  strokeColor?: string;
  // Marks the wash/stroke silhouette as a 50%-opacity mouseover preview so it
  // swaps to `data-station-*-preview` identity attributes (see StationSilhouette).
  preview?: boolean;
}

/**
 * A station is painted across several z-ordered passes (selection silhouette,
 * hit area, dots, labels), each rendered as a separate StationView instance
 * with a different `layer`. This component is a pure dispatcher: it routes
 * each layer to the self-contained component that renders it.
 *
 * Memoized: a station is rendered once per layer per render, and there are
 * many of them. All props are referentially stable across a viewport pan
 * (station/lines are immutable store refs; zoom is constant during a pan;
 * onStartDrag is a stable useCallback), so React skips re-rendering every
 * station's subtree when only the viewBox moves — the dominant pan cost.
 * (memo doesn't block the store subscriptions below: a store change
 * re-renders through them regardless of prop equality — which is also why the
 * font epoch has to be a store and not App-local state.)
 */
export const StationView = memo(function StationView({
  station,
  lines,
  onStartDrag,
  layer,
  highlightColor = '#fff',
  strokeColor,
  preview = false,
}: Props) {
  const showNetwork = useViewportStore((s) => s.showNetwork);
  // Subscribe to the web-font epoch so a font load actually re-measures every
  // station label. The value is unused: reading it is the point — without a
  // store subscription reaching INSIDE this memo, App's post-font-load bump
  // re-renders App and MapCanvas and then React bails out of the whole station
  // subtree, stranding every label at its fallback-font geometry.
  useFontEpochValue();
  // The lines/stations toggle is gated HERE rather than at the ~15 call sites,
  // because this dispatcher is the one chokepoint every station pass — wash,
  // hit area, dots, labels, selection stroke, drag proxy — funnels through, in
  // MapCanvas and in the highlight/placing overlays alike. Returning null (not
  // hiding) is deliberate: an invisible-but-present hit rect would still
  // swallow clicks meant for the background art the toggle exists to uncover.
  if (!showNetwork) return null;
  switch (layer) {
    case 'wash':
    case 'stroke':
    case 'match-stroke':
      return (
        <StationSilhouette
          station={station}
          layer={layer}
          strokeColor={strokeColor}
          preview={preview}
        />
      );
    case 'bg':
      return <StationHitArea station={station} lines={lines} onStartDrag={onStartDrag} />;
    case 'hit':
      // Selected-on-top drag proxy: the same transparent hit footprint as 'bg',
      // re-asserted at top z (rendered by MapCanvas only for selected stations)
      // so the station wins pointer hit-testing over anything stacked above it.
      // Routes through the SAME station interaction as 'bg'. Self-gates on locked
      // (defense-in-depth): a locked station can't be dragged, and a proxy with
      // no data-locked would make the rect-select gate misread a pointerdown on
      // it as marquee background.
      return station.locked ? null : (
        <StationHitArea station={station} lines={lines} onStartDrag={onStartDrag} proxy />
      );
    case 'starter-label':
      return (
        <StationStarterLabel station={station} lines={lines} highlightColor={highlightColor} />
      );
    case 'highlight-label':
      return (
        <StationHighlightLabel station={station} lines={lines} highlightColor={highlightColor} />
      );
    case 'label':
      return <StationLabel station={station} lines={lines} />;
    case 'dots':
      return <StationDots station={station} lines={lines} onStartDrag={onStartDrag} />;
    case 'dot-silhouettes':
    case 'dot-bodies':
    case 'dot-codes':
      return (
        <StationDots
          station={station}
          lines={lines}
          onStartDrag={onStartDrag}
          sub={DOT_SUB_PASS_OF[layer]}
        />
      );
    case 'hover-arrows':
      return <StationOrientationArrows station={station} lines={lines} />;
  }
});
