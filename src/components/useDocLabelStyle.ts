import { useDoc } from '../state/store';
import { docLabelStyle, type LabelStyle } from '../geometry/labelLayout';

/**
 * The doc's global station-label defaults as a `LabelStyle`, subscribed one
 * scalar at a time so consumers re-render when one of the five label fields
 * changes — never on unrelated doc edits.
 */
export function useDocLabelStyle(): LabelStyle {
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const labelWeight = useDoc((s) => s.labelWeight);
  const labelItalic = useDoc((s) => s.labelItalic);
  const labelLeading = useDoc((s) => s.labelLeading);
  const labelTracking = useDoc((s) => s.labelTracking);
  return docLabelStyle({ labelFontSize, labelWeight, labelItalic, labelLeading, labelTracking });
}
