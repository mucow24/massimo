import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chooseOption } from '../test/interaction';
import { Sidebar } from './Sidebar';
import { StylesPanel } from './StylesPanel';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { historyDepth } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import type { RouteBulletStyleProps, TextLabelStyleProps } from '../model/types';
import { makeRouteBullet, makeStyle, makeTextLabel } from '../test/fixtures';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    textLabels: { g1: makeTextLabel({ id: 'g1', fontSize: 24, styleId: 'y1' }) },
    routeBullets: { b1: makeRouteBullet({ id: 'b1', size: 20, styleId: 'y2' }) },
    styles: {
      y1: makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 24 } }),
      y2: makeStyle('routeBullet', 'y2', { name: 'Big', props: { size: 20 } }),
      // Second textLabel style so deleting "Heading" isn't a last-of-kind
      // refusal; it is also the kind's designated default.
      y0: makeStyle('textLabel', 'y0', { name: 'Body' }),
    },
    styleDefaults: { ...DEFAULT_DOC.styleDefaults, textLabel: 'y0', routeBullet: 'y2' },
  });
  useDoc.temporal.getState().clear();
  useSelection.setState({ sidebarOpen: true, activeTab: 'stations' });
});

describe('Sidebar Styles tab', () => {
  it('offers a third tab with the style count and switches to the panel', () => {
    render(<Sidebar />);
    const tab = screen.getByRole('button', { name: 'Styles (3)' });
    fireEvent.click(tab);
    expect(useSelection.getState().activeTab).toBe('styles');
    expect(screen.getByText('Heading')).toBeInTheDocument();
  });
});

describe('<StylesPanel />', () => {
  it('always shows every kind heading (with a create button), styles under theirs', () => {
    render(<StylesPanel />);
    for (const heading of ['Lines', 'Labels', 'Polygons', 'Route bullets', 'Transfers']) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    expect(screen.getByText('Heading')).toBeInTheDocument();
    expect(screen.getByText('Big')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New polygon style' })).toBeInTheDocument();
  });

  it('shows the stopDot library but hides the reserved "None" (no rename/delete row)', () => {
    // The factory doc carries the whole stopDot library, including "None".
    useDoc.setState({
      ...useDoc.getState(),
      styles: DEFAULT_DOC.styles,
      styleDefaults: DEFAULT_DOC.styleDefaults,
    });
    render(<StylesPanel />);
    expect(screen.getByText('Stop dots')).toBeInTheDocument();
    // A normal library entry is editable in the list...
    expect(screen.getByRole('button', { name: 'Rename Filled black' })).toBeInTheDocument();
    // ...but "None" is reserved: hidden from the list entirely.
    expect(screen.queryByRole('button', { name: 'Rename None' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete None' })).toBeNull();
  });

  it('click-to-rename commits once on Enter and reverts on Escape', () => {
    render(<StylesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Heading' }));
    const input = screen.getByRole('textbox', { name: 'Style name' });
    const before = historyDepth();
    fireEvent.change(input, { target: { value: 'Header' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(useDoc.getState().styles.y1.name).toBe('Header');
    expect(historyDepth() - before).toBe(1);
    // Escape reverts without committing.
    fireEvent.click(screen.getByRole('button', { name: 'Rename Header' }));
    const again = screen.getByRole('textbox', { name: 'Style name' });
    fireEvent.change(again, { target: { value: 'Nope' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    fireEvent.blur(again);
    expect(useDoc.getState().styles.y1.name).toBe('Header');
  });

  it('a refused rename (same-kind collision) re-renders the old name', () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        y3: makeStyle('textLabel', 'y3', { name: 'Caption' }),
      },
    });
    render(<StylesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Caption' }));
    const input = screen.getByRole('textbox', { name: 'Style name' });
    fireEvent.change(input, { target: { value: 'Heading' } });
    fireEvent.blur(input);
    expect(useDoc.getState().styles.y3.name).toBe('Caption');
    expect(screen.getByText('Caption')).toBeInTheDocument();
  });

  it('delete removes the def and untags its users, keeping their values', () => {
    render(<StylesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Heading' }));
    expect(useDoc.getState().styles.y1).toBeUndefined();
    expect(useDoc.getState().textLabels.g1.styleId).toBeUndefined();
    expect(useDoc.getState().textLabels.g1.fontSize).toBe(24);
    expect(screen.queryByText('Heading')).toBeNull();
  });

  it('marks the default with a star and re-assigns it via "make default"', () => {
    render(<StylesPanel />);
    // y0 ("Body") is the designated textLabel default.
    expect(screen.getByRole('button', { name: 'Body is the default' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const makeDefault = screen.getByRole('button', { name: 'Make Heading the default' });
    makeDefault.focus();
    fireEvent.click(makeDefault);
    expect(useDoc.getState().styleDefaults.textLabel).toBe('y1');
    expect(screen.getByRole('button', { name: 'Heading is the default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make Body the default' })).toBeInTheDocument();
    // One persistent button, not a button→indicator swap: keyboard focus
    // survives the activation instead of dropping to <body>.
    expect(screen.getByRole('button', { name: 'Heading is the default' })).toHaveFocus();
    // Clicking the already-default star is a no-op (transform guard).
    fireEvent.click(screen.getByRole('button', { name: 'Heading is the default' }));
    expect(useDoc.getState().styleDefaults.textLabel).toBe('y1');
  });

  it('the last style of a kind cannot be deleted', () => {
    render(<StylesPanel />);
    const btn = screen.getByRole('button', { name: 'Delete Big' }); // the only routeBullet style
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(useDoc.getState().styles.y2).toBeDefined();
  });

  it('deleting the default re-points the star at the first remaining style', () => {
    render(<StylesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Body' }));
    expect(useDoc.getState().styleDefaults.textLabel).toBe('y1');
    expect(screen.getByRole('button', { name: 'Heading is the default' })).toBeInTheDocument();
  });

  it('"+ New style" creates a factory-props style of the kind and expands its editor', () => {
    render(<StylesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'New route bullet style' }));
    const def = Object.values(useDoc.getState().styles).find((d) => d.name === 'New style');
    expect(def).toMatchObject({ kind: 'routeBullet' });
    expect((def?.props as RouteBulletStyleProps).size).toBe(14);
    // Auto-expanded: its editor's Size control is on screen.
    expect(screen.getByRole('slider', { name: 'Size' })).toHaveAttribute('aria-valuenow', '14');
  });

  it('"Duplicate" clones the style as "{name} copy" and expands the copy for editing', () => {
    render(<StylesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Big' }));
    const copy = Object.values(useDoc.getState().styles).find((d) => d.name === 'Big copy');
    expect(copy).toMatchObject({ kind: 'routeBullet' });
    expect((copy?.props as RouteBulletStyleProps).size).toBe(20); // source props copied
    // The original still exists (this is a copy, not a rename).
    expect(useDoc.getState().styles.y2).toBeDefined();
    // Auto-expanded at the copied value: its editor's Size control is on screen.
    expect(screen.getByText('Big copy')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Size' })).toHaveAttribute('aria-valuenow', '20');
  });

  it('expanding a style and editing a control updates the def AND its tagged items live', () => {
    render(<StylesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Big' }));
    expect(screen.getByRole('slider', { name: 'Size' })).toHaveAttribute('aria-valuenow', '20');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Size' }), {
      target: { value: '30' },
    });
    expect((useDoc.getState().styles.y2.props as RouteBulletStyleProps).size).toBe(30);
    // Live preview: the tagged bullet followed; the tag survived.
    expect(useDoc.getState().routeBullets.b1.size).toBe(30);
    expect(useDoc.getState().routeBullets.b1.styleId).toBe('y2');
  });

  it('the label editor edits typography (weight select + italic + align)', async () => {
    render(<StylesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Heading' }));
    await chooseOption(userEvent.setup(), 'Weight', 'Bold');
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
    const props = useDoc.getState().styles.y1.props as TextLabelStyleProps;
    expect(props.weight).toBe(700);
    expect(props.italic).toBe(true);
    expect(props.align).toBe('center');
    // The tagged label followed each edit.
    expect(useDoc.getState().textLabels.g1).toMatchObject({
      weight: 700,
      italic: true,
      align: 'center',
    });
  });
});
