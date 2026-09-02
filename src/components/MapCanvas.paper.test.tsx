import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import App from '../App';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { stubCanvasHostSize } from '../test/interaction';

stubCanvasHostSize();

/**
 * `data-paper` on the canvas host answers one question for the chrome that sits
 * ON the canvas as HTML — today the guide wells, whose ink flips off it in
 * styles.css. It tracks the PAPER, never the chrome's `data-theme`, because the
 * two disagree in both directions: a "Dark" chrome darkens the toolbar over a
 * still-light map, and a gray or dark paper darkens the map under a still-light
 * toolbar.
 */
beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, darkMode: false });
  useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'idle' } });
  useViewportStore.setState({ interfaceTheme: 'auto', canvasColor: 'auto', showGuides: true });
});

const paper = () => document.querySelector('.canvas-host')!.getAttribute('data-paper');

describe('canvas paper marker', () => {
  it('is absent over a day map', () => {
    render(<App />);
    expect(paper()).toBeNull();
  });

  it('ignores the chrome theme — a "Dark" chrome leaves the paper light', () => {
    useViewportStore.setState({ interfaceTheme: 'dark' });
    render(<App />);
    // The chrome went dark…
    expect(document.querySelector('.app')!.getAttribute('data-theme')).toBe('dark');
    // …and the paper did not.
    expect(paper()).toBeNull();
  });

  it('goes dark with the map', () => {
    useDoc.setState({ ...useDoc.getState(), darkMode: true });
    render(<App />);
    expect(paper()).toBe('dark');
  });

  it('goes dark on a dark paper pinned under a day map, with the chrome still light', () => {
    useViewportStore.setState({ canvasColor: 'dark' });
    render(<App />);
    expect(document.querySelector('.app')!.getAttribute('data-theme')).toBeNull();
    expect(paper()).toBe('dark');
  });

  it('clears on a light paper pinned under a night map, with the chrome still dark', () => {
    useDoc.setState({ ...useDoc.getState(), darkMode: true });
    useViewportStore.setState({ canvasColor: 'light' });
    render(<App />);
    expect(document.querySelector('.app')!.getAttribute('data-theme')).toBe('dark');
    expect(paper()).toBeNull();
  });

  it('keeps the guide wells inside the marked host, which is what the CSS needs', () => {
    useDoc.setState({ ...useDoc.getState(), darkMode: true });
    render(<App />);
    // The selector the night ink is written against, end to end. Four wells:
    // the two edge strips plus the two diagonal corner squares.
    expect(document.querySelectorAll('.canvas-host[data-paper="dark"] .guide-well').length).toBe(4);
  });
});
