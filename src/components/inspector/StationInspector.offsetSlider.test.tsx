import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelOffsetControl } from '../../components/inspector/LabelOffsetControl';
import { stepSlider } from '../../test/interaction';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { historyDepth, undo } from '../../state/history';

// End-to-end version of the claim, through the REAL control (its own
// useFieldHistory group), the REAL store action, the REAL transform and the
// REAL zundo history. Only StationInspector's `dispatchAll` fan-out is
// stubbed — for a single selected station it is a pass-through.

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('Offset (along reading direction) slider — detent-only gesture', () => {
  it('does not consume an undo when the value never leaves the ±2 detent', () => {
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    useDoc.getState().renameStation(id, 'Renamed'); // the last REAL edit
    const depthAfterRealEdit = historyDepth();

    render(
      <LabelOffsetControl
        value={useDoc.getState().stations[id].label.offset}
        onChange={(v) => useDoc.getState().setLabelOffset(id, v)}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Offset' });

    // focus (opens the field-history group) + one arrow step inside the
    // detent. LabelOffsetControl maps |n| <= 2 to 0, and the stored offset
    // is already 0, so this write is value-identical.
    stepSlider(slider, 1);
    fireEvent.blur(slider); // commits the group

    expect(useDoc.getState().stations[id].label.offset).toBe(0); // nothing changed
    expect(historyDepth()).toBe(depthAfterRealEdit);

    undo(); // the user's single Ctrl+Z
    expect(useDoc.getState().stations[id].name).toBe('Origin');
  });
});
