import { describe, it, expect, beforeEach } from 'vitest';
import { auditExportDoc } from './exportAudit';
import { useToasts } from './toastStore';
import * as T from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

const doc = () =>
  makeDoc({
    stations: [makeStation({ id: 's1', stops: [makeStop('l1')] })],
    lines: [makeLine({ id: 'l1', stations: ['s1'] })],
    styles: Object.values(T.DEFAULT_STYLES),
  });

beforeEach(() => {
  useToasts.setState({ toasts: [] });
});

describe('auditExportDoc — the export-door audit', () => {
  it('stays silent on a coherent doc', () => {
    expect(auditExportDoc(doc())).toEqual([]);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('raises a persistent error toast when a writer corrupted the doc', () => {
    const corrupt = doc();
    corrupt.lines.l1 = { ...corrupt.lines.l1, stations: ['s1', 'ghost'] };
    const violations = auditExportDoc(corrupt);
    expect(violations.length).toBeGreaterThan(0);
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('error');
    expect(toasts[0].text).toMatch(/consistency check/);
    expect(toasts[0].text).toMatch(/still written/);
  });
});
