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
  if (selection.selectedStationId) return <StationInspector id={selection.selectedStationId} />;
  if (selection.selectedLineId) return <LineInspector id={selection.selectedLineId} />;
  return null;
}
