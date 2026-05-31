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
  layer:
    | 'wash'
    | 'bg'
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
 */
export function StationView({
  station,
  lines,
  onStartDrag,
  layer,
  highlightColor = '#fff',
}: Props) {
  switch (layer) {
    case 'wash':
    case 'stroke':
    case 'match-stroke':
      return <StationSilhouette station={station} layer={layer} />;
    case 'bg':
      return <StationHitArea station={station} lines={lines} onStartDrag={onStartDrag} />;
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
}
