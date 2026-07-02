import { test, expect } from '@playwright/test';
import { fourInLine, seedAndOpen } from './fixtures';

// Regression: in a window too narrow for the toolbar, its buttons (pinned to
// their natural width so labels don't collapse) overflow horizontally. The app
// grid must grow to the toolbar's content width so the WHOLE window gets one
// clean horizontal scrollbar — the sidebar staying flush with the right edge of
// the scrollable content, no blank strip beside it, no buttons spilling past the
// toolbar background. Before the fix the grid stayed pinned to the viewport
// width, so the sidebar sat ~500px short of the content's right edge (the
// reported gap) while the toolbar buttons spilled onto the bare page.
test.describe('narrow-window toolbar overflow', () => {
  test.use({ viewport: { width: 560, height: 820 } });

  test('the sidebar stays flush with the scrollable content — no blank strip', async ({ page }) => {
    await seedAndOpen(page, fourInLine);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) throw new Error('sidebar not rendered');
      // scrollLeft is 0 (unscrolled), so getBoundingClientRect().right is the
      // sidebar's x within the scrollable content, even past the viewport edge.
      return {
        sidebarRight: sidebar.getBoundingClientRect().right,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
      };
    });

    // Sanity: the scenario only bites when the toolbar actually overflows this
    // narrow window (otherwise there's no gap to regress on).
    expect(m.scrollWidth).toBeGreaterThan(m.clientWidth + 100);
    // The sidebar's right edge sits at the far right of the scrollable content
    // (within a hair for sub-pixel/toolbar padding) — i.e. no blank strip to its
    // right. Pre-fix this gap was the full toolbar overflow (~500px).
    expect(m.scrollWidth - m.sidebarRight).toBeLessThan(24);
  });
});
