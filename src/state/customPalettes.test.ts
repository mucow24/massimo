import { describe, it, expect, beforeEach } from 'vitest';
import { useCustomPalettes } from './customPalettes';

const reset = () => {
  localStorage.clear();
  useCustomPalettes.setState({ palettes: [] });
};

describe('useCustomPalettes', () => {
  beforeEach(reset);

  it('adds a new palette with a generated custom: id', () => {
    useCustomPalettes
      .getState()
      .addPalette({ name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] });
    const { palettes } = useCustomPalettes.getState();
    expect(palettes).toHaveLength(1);
    expect(palettes[0].id).toBe('custom:frrf');
    expect(palettes[0].name).toBe('frrf');
  });

  it('upserts by name: re-adding the same name replaces in place, keeping id and position', () => {
    const add = useCustomPalettes.getState().addPalette;
    add({ name: 'a', swatches: [{ name: '1', color: '#111111' }] });
    add({ name: 'b', swatches: [{ name: '1', color: '#222222' }] });
    const aId = useCustomPalettes.getState().palettes[0].id;
    add({ name: 'a', swatches: [{ name: 'X', color: '#999999' }] });
    const { palettes } = useCustomPalettes.getState();
    expect(palettes).toHaveLength(2);
    expect(palettes[0].id).toBe(aId); // same id, in place
    expect(palettes[0].swatches).toEqual([{ name: 'X', color: '#999999' }]); // swatches updated
    expect(palettes[1].name).toBe('b'); // position preserved
  });

  it('gives distinct ids to palettes whose names slugify the same', () => {
    const add = useCustomPalettes.getState().addPalette;
    add({ name: 'frrf', swatches: [{ name: '1', color: '#111111' }] });
    add({ name: 'frrf!', swatches: [{ name: '1', color: '#222222' }] });
    expect(useCustomPalettes.getState().palettes.map((p) => p.id)).toEqual([
      'custom:frrf',
      'custom:frrf-2',
    ]);
  });

  it('removes a palette by id', () => {
    const add = useCustomPalettes.getState().addPalette;
    add({ name: 'a', swatches: [{ name: '1', color: '#111111' }] });
    const id = useCustomPalettes.getState().palettes[0].id;
    useCustomPalettes.getState().removePalette(id);
    expect(useCustomPalettes.getState().palettes).toEqual([]);
  });

  it('persists to localStorage', () => {
    useCustomPalettes
      .getState()
      .addPalette({ name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] });
    const raw = localStorage.getItem('massimo-custom-palettes-v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).state.palettes[0].id).toBe('custom:frrf');
  });

  it('rehydrates palettes seeded in localStorage', () => {
    localStorage.setItem(
      'massimo-custom-palettes-v1',
      JSON.stringify({
        state: {
          palettes: [{ id: 'custom:x', name: 'x', swatches: [{ name: '1', color: '#abcdef' }] }],
        },
        version: 0,
      }),
    );
    useCustomPalettes.persist.rehydrate();
    expect(useCustomPalettes.getState().palettes.map((p) => p.id)).toEqual(['custom:x']);
  });
});
