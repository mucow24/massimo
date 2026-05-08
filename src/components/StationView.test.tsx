import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeStation } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    selectedLineId: null,
    appendingToLineId: null,
  });
});

function renderLabel() {
  const station = makeStation({ id: 's1', name: 'Foo', x: 100, y: 100 });
  const { container } = render(
    <svg>
      <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
    </svg>,
  );
  // The first <text> rendered by the label layer is the station name.
  const text = container.querySelector('text');
  if (!text) throw new Error('expected <text> for station label');
  return { text, station };
}

describe('<StationView /> — label styling', () => {
  it('uses the document defaults: fontSize 12, weight 400, no italic', () => {
    const { text } = renderLabel();
    expect(text.getAttribute('font-size')).toBe('12');
    expect(text.getAttribute('font-weight')).toBe('400');
    expect(text.getAttribute('font-style')).toBeNull();
  });

  it('applies labelFontSize, labelBold, and labelItalic from the store', () => {
    useDoc.setState({
      ...useDoc.getState(),
      labelFontSize: 18,
      labelBold: true,
      labelItalic: true,
    });
    const { text } = renderLabel();
    expect(text.getAttribute('font-size')).toBe('18');
    expect(text.getAttribute('font-weight')).toBe('700');
    expect(text.getAttribute('font-style')).toBe('italic');
  });

  it('hover bumps weight to 700 even when labelBold is off', () => {
    const { text, station } = (() => {
      const station = makeStation({ id: 's1', name: 'Foo', x: 0, y: 0 });
      useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
      const { container } = render(
        <svg>
          <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
        </svg>,
      );
      const text = container.querySelector('text');
      if (!text) throw new Error('expected <text>');
      return { text, station };
    })();
    expect(useDoc.getState().labelBold).toBe(false);
    expect(text.getAttribute('font-weight')).toBe('700');
    // Sanity: station was actually rendered.
    expect(text.textContent).toContain(station.name);
  });
});
