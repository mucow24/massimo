import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StyleRow } from './StyleRow';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import type { TextLabelStyleProps } from '../model/types';
import { makeStyle, makeTextLabel } from '../test/fixtures';
import { chooseOption } from '../test/interaction';

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

// The row is a Radix Select: the closed trigger shows the current choice as
// text, and the option list exists in the DOM only while open.
describe('<StyleRow />', () => {
  it('shows Custom when untagged and lists the styles sorted by name', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const select = screen.getByRole('combobox', { name: 'Style' });
    expect(select).toHaveTextContent('Custom');
    await user.click(select);
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Custom', 'Caption', 'Heading', 'Save style…']);
  });

  it('shows the tagged style, and picking a style applies it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await chooseOption(user, 'Style', 'Heading');
    const label = useDoc.getState().textLabels.g1;
    expect(label.styleId).toBe('y1');
    expect(label.fontSize).toBe(24);
    expect(label.weight).toBe(700);
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Heading');
  });

  it('picking Custom detaches the tag but keeps the values', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await chooseOption(user, 'Style', 'Heading');
    await chooseOption(user, 'Style', 'Custom');
    const label = useDoc.getState().textLabels.g1;
    expect(label.styleId).toBeUndefined();
    expect(label.fontSize).toBe(24);
  });

  it('Save style… swaps to a name input; Enter saves and tags', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await chooseOption(user, 'Style', 'Save style…');
    const input = screen.getByRole('textbox', { name: 'Style name' });
    await user.type(input, 'Body{Enter}');
    const s = useDoc.getState();
    const def = Object.values(s.styles).find((d) => d.name === 'Body');
    expect(def).toBeDefined();
    expect((def?.props as TextLabelStyleProps).fontSize).toBe(12);
    expect(s.textLabels.g1.styleId).toBe(def?.id);
    // Back to the dropdown, now showing the new style.
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Body');
  });

  it('pre-fills the current style name when tagged, and re-saving updates it', async () => {
    const user = userEvent.setup();
    useDoc.getState().applyStyle('y1', 'g1');
    render(<Harness />);
    await chooseOption(user, 'Style', 'Save style…');
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
    const openSave = () => chooseOption(user, 'Style', 'Save style…');

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

  it('shows "(edited)" while the item diverges from its style', () => {
    useDoc.getState().applyStyle('y1', 'g1');
    render(<Harness />);
    const select = () => screen.getByRole('combobox', { name: 'Style' });
    expect(select()).toHaveTextContent('Heading');
    expect(select()).not.toHaveTextContent('(edited)');
    act(() => useDoc.getState().updateTextLabel('g1', { weight: 400 })); // override
    expect(select()).toHaveTextContent('Heading (edited)');
  });

  it('Revert to style discards the overrides and keeps the tag', async () => {
    useDoc.getState().applyStyle('y1', 'g1');
    useDoc.getState().updateTextLabel('g1', { weight: 400 });
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Revert to style' }));
    const label = useDoc.getState().textLabels.g1;
    expect(label.weight).toBe(700);
    expect(label.styleId).toBe('y1');
    expect(screen.getByRole('combobox', { name: 'Style' })).not.toHaveTextContent('(edited)');
  });

  it("Sync to style pushes this item's look into the def", async () => {
    useDoc.getState().applyStyle('y1', 'g1');
    useDoc.getState().updateTextLabel('g1', { fontSize: 30 });
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sync to style' }));
    expect((useDoc.getState().styles.y1.props as TextLabelStyleProps).fontSize).toBe(30);
    expect(useDoc.getState().textLabels.g1.styleId).toBe('y1');
    expect(screen.getByRole('combobox', { name: 'Style' })).not.toHaveTextContent('(edited)');
  });

  it('Sync and Revert are disabled on Custom and when nothing diverges', () => {
    render(<Harness />); // untagged ⇒ Custom
    expect(screen.getByRole('button', { name: 'Sync to style' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revert to style' })).toBeDisabled();
    useDoc.getState().applyStyle('y1', 'g1'); // tagged, matching ⇒ still disabled
    expect(screen.getByRole('button', { name: 'Sync to style' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revert to style' })).toBeDisabled();
  });

  // The item popovers live inside `.canvas-host`, whose `isolation: isolate`
  // traps their descendants beneath the toolbar (root z-index). An in-place
  // dropdown that flips up therefore vanishes under the toolbar. The panel must
  // portal OUT of `.canvas-host` — but into `.app`, not `document.body`, so the
  // design tokens + dark-mode reassignment still resolve. `.app` is pre-mounted
  // (as it is in the real app: the root exists before any popover) so the
  // render-time portal-target lookup resolves it.
  it('portals the open list out of the canvas-host trap, staying inside .app', async () => {
    const user = userEvent.setup();
    const app = document.createElement('div');
    app.className = 'app';
    const host = document.createElement('div');
    host.className = 'canvas-host';
    app.appendChild(host);
    document.body.appendChild(app);
    try {
      render(<Harness />, { container: host });
      await user.click(screen.getByRole('combobox', { name: 'Style' }));
      const option = await screen.findByRole('option', { name: 'Heading' });
      expect(option.closest('.canvas-host')).toBeNull();
      expect(option.closest('.app')).not.toBeNull();
    } finally {
      app.remove();
    }
  });
});
