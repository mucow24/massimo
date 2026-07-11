import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StyleRow } from './StyleRow';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import type { TextLabelStyleProps } from '../model/types';
import { makeStyle, makeTextLabel } from '../test/fixtures';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    textLabels: { g1: makeTextLabel({ id: 'g1', fontSize: 12 }) },
    styles: {
      y1: makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 24, weight: 700 } }),
      y2: makeStyle('textLabel', 'y2', { name: 'Caption', props: { fontSize: 8 } }),
    },
  });
  useDoc.temporal.getState().clear();
});

// Mirrors real usage: the popovers read the item live from the store, so the
// row re-renders when an action writes the tag.
function Harness() {
  const label = useDoc((s) => s.textLabels.g1);
  return <StyleRow kind="textLabel" itemId="g1" styleId={label?.styleId} />;
}

describe('<StyleRow />', () => {
  it('shows Custom when untagged and lists the styles sorted by name', () => {
    render(<Harness />);
    const select = screen.getByRole('combobox', { name: 'Style' });
    expect(select).toHaveValue('__custom__');
    const names = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(names).toEqual(['Custom', 'Caption', 'Heading', 'Save style…']);
  });

  it('shows the tagged style, and picking a style applies it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const select = screen.getByRole('combobox', { name: 'Style' });
    await user.selectOptions(select, 'y1');
    const label = useDoc.getState().textLabels.g1;
    expect(label.styleId).toBe('y1');
    expect(label.fontSize).toBe(24);
    expect(label.weight).toBe(700);
    expect(select).toHaveValue('y1');
  });

  it('picking Custom detaches the tag but keeps the values', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Style' }), 'y1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Style' }), '__custom__');
    const label = useDoc.getState().textLabels.g1;
    expect(label.styleId).toBeUndefined();
    expect(label.fontSize).toBe(24);
  });

  it('Save style… swaps to a name input; Enter saves and tags', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Style' }), '__save__');
    const input = screen.getByRole('textbox', { name: 'Style name' });
    await user.type(input, 'Body{Enter}');
    const s = useDoc.getState();
    const def = Object.values(s.styles).find((d) => d.name === 'Body');
    expect(def).toBeDefined();
    expect((def?.props as TextLabelStyleProps).fontSize).toBe(12);
    expect(s.textLabels.g1.styleId).toBe(def?.id);
    // Back to the dropdown, now showing the new style.
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue(def?.id);
  });

  it('pre-fills the current style name when tagged, and re-saving updates it', async () => {
    const user = userEvent.setup();
    useDoc.getState().applyStyle('y1', 'g1');
    render(<Harness />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Style' }), '__save__');
    const input = screen.getByRole('textbox', { name: 'Style name' });
    expect(input).toHaveValue('Heading');
    // Commit as-is: redefines "Heading" from this item (a values no-op here).
    await user.keyboard('{Enter}');
    expect(Object.keys(useDoc.getState().styles)).toHaveLength(2); // no new style
    expect(useDoc.getState().textLabels.g1.styleId).toBe('y1');
  });

  it('Escape cancels the save; empty and reserved names are refused', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const openSave = async () =>
      user.selectOptions(screen.getByRole('combobox', { name: 'Style' }), '__save__');

    await openSave();
    await user.type(screen.getByRole('textbox', { name: 'Style name' }), 'Nope{Escape}');
    expect(Object.keys(useDoc.getState().styles)).toHaveLength(2);

    await openSave();
    await user.keyboard('{Enter}'); // empty
    expect(Object.keys(useDoc.getState().styles)).toHaveLength(2);

    await openSave();
    await user.type(screen.getByRole('textbox', { name: 'Style name' }), 'custom{Enter}');
    expect(Object.keys(useDoc.getState().styles)).toHaveLength(2);
    expect(useDoc.getState().textLabels.g1.styleId).toBeUndefined();
  });

  it('disables the select when asked (locked items)', () => {
    render(<StyleRow kind="textLabel" itemId="g1" styleId={undefined} disabled />);
    expect(screen.getByRole('combobox', { name: 'Style' })).toBeDisabled();
  });
});
