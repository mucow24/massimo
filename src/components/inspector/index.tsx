import { useSelection } from '../../state/store';
import { StationInspector } from './StationInspector';
import { LineInspector } from './LineInspector';

export { StationInspector } from './StationInspector';
export { LineInspector } from './LineInspector';
export { StopGrid } from './StopGrid';
export { ColorPalette } from './ColorPalette';
export { LabelOffsetControl } from './LabelOffsetControl';

export function Inspector() {
  const selection = useSelection();
  // While appending to a line, the line inspector is sticky — even if a
  // station gets selected (e.g. via the sidebar), the line editor stays open.
  if (selection.appendingToLineId) return <LineInspector id={selection.appendingToLineId} />;
  // Single-selection only: multi-selection hides the station inspector.
  // A selected route bullet alongside the station also disqualifies —
  // the inspector is a single-item editor.
  if (selection.selectedStationIds.length === 1 && selection.selectedRouteBulletIds.length === 0)
    return <StationInspector id={selection.selectedStationIds[0]} />;
  if (selection.selectedLineId) return <LineInspector id={selection.selectedLineId} />;
  return null;
}
