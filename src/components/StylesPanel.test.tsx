import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { StylesPanel } from './StylesPanel';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { historyDepth } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
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
    },
  });
  useDoc.temporal.getState().clear();
  useSelection.setState({ sidebarOpen: true, activeTab: 'stations' });
});

describe('Sidebar Styles tab', () => {
  it('offers a third tab with the style count and switches to the panel', () => {
    render(<Sidebar />);
    const tab = screen.getByRole('button', { name: 'Styles (2)' });
    fireEvent.click(tab);
    expect(useSelection.getState().activeTab).toBe('styles');
    expect(screen.getByText('Heading')).toBeInTheDocument();
  });
});

describe('<StylesPanel />', () => {
  it('groups styles under per-kind headings', () => {
    render(<StylesPanel />);
    expect(screen.getByText('Labels')).toBeInTheDocument();
    expect(screen.getByText('Route bullets')).toBeInTheDocument();
    expect(screen.getByText('Heading')).toBeInTheDocument();
    expect(screen.getByText('Big')).toBeInTheDocument();
    // Kinds with no styles get no heading.
    expect(screen.queryByText('Polygons')).toBeNull();
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
    expect(screen.queryByText('Labels')).toBeNull(); // heading gone with its last style
  });

  it('shows an empty-state hint when there are no styles', () => {
    useDoc.setState({ ...useDoc.getState(), styles: {} });
    render(<StylesPanel />);
    expect(screen.getByText(/No styles yet/)).toBeInTheDocument();
  });
});
