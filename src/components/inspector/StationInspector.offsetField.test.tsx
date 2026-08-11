import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelOffsetControl } from '../../components/inspector/LabelOffsetControl';
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

describe('Offset (along reading direction) — value-identical edit arc', () => {
  it('does not consume an undo when the committed value never changes', () => {
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    useDoc.getState().renameStation(id, 'Renamed'); // the last REAL edit
    const depthAfterRealEdit = historyDepth();

    render(
      <LabelOffsetControl
        value={useDoc.getState().stations[id].label.offset}
        onChange={(v) => useDoc.getState().setLabelOffset(id, v)}
      />,
    );
    const box = screen.getByRole('spinbutton', { name: 'Offset value' });

    // Focus opens the field-history group; retyping the value the box already
    // holds writes 0 over a stored 0, so the group commits with nothing in it.
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '0' } });
    fireEvent.blur(box); // commits the group

    expect(useDoc.getState().stations[id].label.offset).toBe(0); // nothing changed
    expect(historyDepth()).toBe(depthAfterRealEdit);

    undo(); // the user's single Ctrl+Z
    expect(useDoc.getState().stations[id].name).toBe('Origin');
  });
});
