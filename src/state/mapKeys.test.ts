import { describe, it, expect, beforeEach } from 'vitest';
import {
  baselineKey,
  cameraKey,
  docKey,
  listDocDrafts,
  pointerKey,
  readDocDraftName,
  removeMapKeys,
} from './mapKeys';

beforeEach(() => localStorage.clear());

describe('mapKeys — finding and sweeping a map’s slots', () => {
  it('lists every map with a working copy, and nothing else', () => {
    localStorage.setItem(docKey('a'), '{"state":{},"version":30}');
    localStorage.setItem(docKey('b'), '{"state":{},"version":30}');
    localStorage.setItem(cameraKey('c'), '{}');
    localStorage.setItem('massimo-viewport', '{}');
    expect(listDocDrafts().sort()).toEqual(['a', 'b']);
  });

  it('reads the name inside a working copy, or null for none / an unreadable one', () => {
    localStorage.setItem(docKey('a'), '{"state":{"name":"Drawn last night"},"version":30}');
    localStorage.setItem(docKey('b'), '{not json');
    expect(readDocDraftName('a')).toBe('Drawn last night');
    expect(readDocDraftName('b')).toBeNull();
    expect(readDocDraftName('c')).toBeNull();
  });

  it('removeMapKeys sweeps all four slots of one map and no other’s', () => {
    for (const id of ['a', 'b']) {
      for (const key of [docKey, baselineKey, cameraKey, pointerKey])
        localStorage.setItem(key(id), '{}');
    }
    removeMapKeys('a');
    for (const key of [docKey, baselineKey, cameraKey, pointerKey]) {
      expect(localStorage.getItem(key('a'))).toBeNull();
      expect(localStorage.getItem(key('b'))).toBe('{}');
    }
  });
});
