import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapNameField } from './MapNameField';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('MapNameField', () => {
  it('shows the current map name (default "Untitled map")', () => {
    render(<MapNameField />);
    expect(screen.getByRole('button', { name: 'Untitled map' })).toBeInTheDocument();
  });

  it('a single click does NOT open the editor (double-click, like the station title)', async () => {
    const user = userEvent.setup();
    render(<MapNameField />);
    await user.click(screen.getByRole('button', { name: 'Untitled map' }));
    expect(screen.queryByLabelText('Map name')).toBeNull();
  });

  it('commits an edit to the store on Enter', async () => {
    const user = userEvent.setup();
    render(<MapNameField />);
    await user.dblClick(screen.getByRole('button', { name: 'Untitled map' }));
    const input = screen.getByLabelText('Map name');
    await user.clear(input);
    await user.type(input, 'Night Owl{Enter}');
    expect(useDoc.getState().name).toBe('Night Owl');
    // Back in display mode showing the new name.
    expect(screen.getByRole('button', { name: 'Night Owl' })).toBeInTheDocument();
  });

  it('commits an edit to the store on blur', async () => {
    const user = userEvent.setup();
    render(<MapNameField />);
    await user.dblClick(screen.getByRole('button', { name: 'Untitled map' }));
    const input = screen.getByLabelText('Map name');
    await user.clear(input);
    await user.type(input, 'Blurred');
    await user.tab(); // move focus away → blur
    expect(useDoc.getState().name).toBe('Blurred');
  });

  it('reverts on Escape without touching the store', async () => {
    const user = userEvent.setup();
    render(<MapNameField />);
    await user.dblClick(screen.getByRole('button', { name: 'Untitled map' }));
    const input = screen.getByLabelText('Map name');
    await user.clear(input);
    await user.type(input, 'Discarded{Escape}');
    expect(useDoc.getState().name).toBe('Untitled map');
    expect(screen.getByRole('button', { name: 'Untitled map' })).toBeInTheDocument();
  });

  it('falls back to the default name when committed empty', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), name: 'Something' });
    render(<MapNameField />);
    await user.dblClick(screen.getByRole('button', { name: 'Something' }));
    const input = screen.getByLabelText('Map name');
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(useDoc.getState().name).toBe('Untitled map');
  });
});
