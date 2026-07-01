import { memo } from 'react';
import { Line, Station } from '../model/types';
import { StationSilhouette } from './StationSilhouette';
import { StationHitArea } from './StationHitArea';
import { StationDots, StationHighlightDots } from './StationDots';
import { StationLabel, StationHighlightLabel, StationStarterLabel } from './StationLabel';

interface Props {
  station: Station;
  lines: Record<string, Line>;
  zoom: number;
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void;
  // Label-drag fork (bg/hit layers only): present ⇒ the sole-selected
  // station's name rect becomes the label's own drag handle.
  onStartLabelDrag?: (id: string, ev: React.PointerEvent) => void;
  layer:
    | 'wash'
    | 'bg'
    | 'hit'
    | 'label'
    | 'highlight-label'
    | 'starter-label'
    | 'dots'
    | 'highlight-dots'
    | 'stroke'
    | 'match-stroke';
  // Override fill for the highlight-* layers (default white).
  highlightColor?: string;
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
 */
export const StationView = memo(function StationView({
  station,
  lines,
  onStartDrag,
  onStartLabelDrag,
  layer,
  highlightColor = '#fff',
}: Props) {
  switch (layer) {
    case 'wash':
    case 'stroke':
    case 'match-stroke':
      return <StationSilhouette station={station} layer={layer} />;
    case 'bg':
      return (
        <StationHitArea
          station={station}
          lines={lines}
          onStartDrag={onStartDrag}
          onStartLabelDrag={onStartLabelDrag}
        />
      );
    case 'hit':
      // Selected-on-top drag proxy: the same transparent hit footprint as 'bg',
      // re-asserted at top z (rendered by MapCanvas only for selected stations)
      // so the station wins pointer hit-testing over anything stacked above it.
      // Routes through the SAME station interaction as 'bg'. Self-gates on locked
      // (defense-in-depth): a locked station can't be dragged, and a proxy with
      // no data-locked would make the rect-select gate misread a pointerdown on
      // it as marquee background.
      return station.locked ? null : (
        <StationHitArea
          station={station}
          lines={lines}
          onStartDrag={onStartDrag}
          onStartLabelDrag={onStartLabelDrag}
          proxy
        />
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
    case 'highlight-dots':
      return <StationHighlightDots station={station} highlightColor={highlightColor} />;
    case 'dots':
      return <StationDots station={station} lines={lines} onStartDrag={onStartDrag} />;
  }
});
