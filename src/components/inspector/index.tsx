import { soleSelection, useSelection } from '../../state/store';
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
  if (selection.uiMode.kind === 'appending-to-line')
    return <LineInspector id={selection.uiMode.lineId} />;
  // Single-selection only: the station inspector shows iff a station is the
  // SOLE selected item across every type. A co-selected bullet/label/polygon —
  // or a multi-station selection — hides it; it's a single-item editor.
  const sole = soleSelection(selection);
  if (sole?.type === 'station') return <StationInspector id={sole.id} />;
  if (selection.selectedLineId) return <LineInspector id={selection.selectedLineId} />;
  return null;
}
