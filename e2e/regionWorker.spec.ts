import { test, expect } from '@playwright/test';
import { seedAndOpen } from './fixtures';

// The region worker's packaging chain — module-worker construction via
// `import.meta.url`, the clipper's dynamic import + WASM fetch inside the
// worker chunk, structured clone across the boundary — is exactly the kind of
// thing that works in dev and breaks in a build (or vice versa: the dev
// server's untransformed URLs and the prod build's relative base fail in
// different ways). jsdom can't run workers at all, so this e2e is the ONLY
// automated coverage of that chain. It runs against whichever server the
// suite drives (dev in pre-pr; point PORT at a `vite preview` to gate prod).
test('the region worker loads its own clipper and agrees with the main thread', async ({
  page,
}) => {
  await seedAndOpen(page, { stations: [], lines: [] });
  const result = await page.evaluate(async () => {
    const handle = (window as unknown as { __massimo?: { workerPing?: () => Promise<unknown> } })
      .__massimo;
    if (!handle?.workerPing) return { ok: false, error: 'dev handle missing workerPing' };
    return handle.workerPing();
  });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, identical: true });
  // The probe op is a real intersection — an empty answer would mean the
  // engine "loaded" but computes nothing.
  const rings = (result as { workerRings: unknown[] }).workerRings;
  expect(Array.isArray(rings) && rings.length).toBeTruthy();
});
