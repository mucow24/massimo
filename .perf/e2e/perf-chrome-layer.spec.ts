/* THROWAWAY browser perf harness — not part of the suite.
 *
 *   npm run build
 *   PORT=5236 npx playwright test -c .perf/playwright.perf-prod.config.ts perf-chrome-layer
 *
 * Settles the one question #523 left open.
 *
 * #523 established that the canvas is ONE composited layer and that Blink
 * re-runs the compositing update over the whole layer for any paint change
 * inside it, at ~3.8µs per painted node — so gesture-start latency is linear in
 * node count and flat in what the gesture does. The shipped fixes all attack
 * the TRIGGER: pan start no longer paints anything, so it no longer pays.
 *
 * Hover, selection and drag cannot use that dodge, because they genuinely
 * change paint. The proposed fix was to move that chrome onto its OWN
 * compositing layer, resting on an assumption nobody had measured: that
 * `.pan-cursor-overlay` — a single childless sibling div — costing 22ms when
 * toggled with `display` showed that a paint change re-composites the layer,
 * and that promoting the layer would therefore be the escape hatch.
 *
 * Both halves of that turned out to be wrong, which is what this file is for.
 *
 * Eleven arms, each one way of making a piece of chrome appear, fired by a
 * class TOGGLE (`.perf-armed` on `.canvas-host`) and interleaved within one
 * page, so the 25%+ run-to-run variance in `.perf/README.md` cannot separate
 * them. The arms cover: MOUNT a box (`display`); paint an always-present box
 * (colour / visibility / opacity); paint inside `.canvas-pan-layer` vs outside
 * it (sibling-svg vs host-svg); paint one real node in the map svg
 * (svg-opacity); and every painting arm again with `will-change: transform`.
 *
 * THE TRIGGER IS THE POINT. An earlier cut fired each arm with a real
 * middle-press (a pan). On `main` that reported the OPPOSITE result — a flat
 * ~31ms baseline, every paint arm at +0 — because `main` promotes
 * `.canvas-pan-layer` per gesture, so the press re-composites the whole layer
 * (~21.7ms) and ABSORBS the chrome paint being measured. A class toggle
 * promotes nothing, so the layer stays in its resting, unpromoted state — the
 * state hover and station-drag chrome actually paint into. The pan-press number
 * was real only on the branch's un-shipped base, which held `will-change` for
 * the session (a press promoted nothing); it did not survive re-measurement.
 *
 * THE ANSWER (medians of 18, two runs, mta-v23, `performance` mode — see
 * .perf/README.md): mounting is the whole cost. `display` (build a box) is
 * +22ms; every way of PAINTING an already-present box is +1 to +10ms. Promotion
 * does nothing — `display+layer` >= `display`, `sibling+layer` >= `sibling`,
 * every pair, with CDP confirming 6 layers unpromoted vs 11 promoted. And
 * leaving the pan layer buys ~1ms (inside +6 vs outside +5), not the ~14ms the
 * pan-press numbers implied. So the rule for chrome is one thing: always
 * mounted, appearing by a paint property. `will-change` and leaving the layer
 * are both off the table.
 *
 * Three gates, all of which exist because a fast number from a mechanism that
 * silently did nothing is the exact failure this project has already paid for
 * twice (see the Event Timing and engagement-gate lessons in the README):
 *
 *   - Every arm asserts its mechanism is IN FORCE, read back from computed
 *     style while the class is applied. An injected stylesheet that matched
 *     nothing would otherwise be the fastest row in the table.
 *   - Computed style is NOT paint, so every arm that makes something appear
 *     screenshots its own subject armed vs unarmed and fails unless the bytes
 *     differ. Three separate in-svg subjects resolved perfectly, changed
 *     computed opacity, and moved zero pixels — each reporting a confident +14
 *     to +24ms for repainting nothing.
 *   - The `display` CONTROL must come back materially slower than the baseline.
 *     That is what proves this probe can see a compositing update at all; if it
 *     cannot, no other row here is evidence of anything.
 *
 * Note what is NOT asserted: that the `colour` arm is slow. It was expected to
 * be, when this was written, and it is not — a repaint of a box that already
 * exists is a different event from creating one. That is a result rather than a
 * broken probe, and the reaches-the-screen gate is what earns the right to say
 * so.
 *
 * A promoted arm that comes back SLOW is ambiguous between "promotion does not
 * help" and "promotion never happened", so the layer count is read from CDP
 * per arm rather than assumed from the stylesheet.
 */
import { test, expect, type Page } from '@playwright/test';
import { centroid, loadDoc, med, seedAt } from '../gestureProbe';
import { perfMapPath } from '../perfMap';
import { readPowerMode } from '../powerMode';

const ROUNDS = Number(process.env.CHROME_ROUNDS ?? 3);
const PRESSES = Number(process.env.CHROME_PRESSES ?? 6);

/** What the overlay's styling actually resolved to, read from the live page. */
interface Mech {
  display: string;
  pointerEvents: string;
  willChange: string;
  /** The ::after box, which is the paint the ring arms switch on and off. */
  after: string;
  /** The one SVG node deep in the map tree that the `svg-*` arm switches. */
  targetOpacity: string;
  targetCount: number;
  /** The rect in the injected sibling <svg>, which the gate arm switches. */
  siblingOpacity: string;
  /** The same rect in the copy that lives OUTSIDE the pan layer. */
  hostSiblingOpacity: string;
  /** The `.perf-armed` trigger class is applied, so the arm's rules are live. */
  armed: boolean;
}

interface Arm {
  key: string;
  what: string;
  /** Appended last in <head>, so equal-specificity rules beat the stylesheet. */
  css: string;
  /** Proves this arm's mechanism is in force, given the overlay at rest and
   *  mid-pan. Returns a reason when it is not, so a failure names itself. */
  live: (rest: Mech, pan: Mech) => string | null;
  /** This arm makes something appear, so it must be shown to reach the screen
   *  — see `reachesScreen`. Says which box to screenshot. */
  paints?: 'ring' | 'svg';
}

/* The ::after box the `paint*` arms switch on: one fixed-size,
   fixed-border-width rectangle, identical in every arm, so that the ONLY
   difference between them is which property makes it appear. Geometry never
   changes, so nothing but paint can be charged for.

   `rest` and `active` are the property this arm toggles. The point of running
   three of them is that "make a piece of chrome appear" has three spellings
   with very different costs, and the whole question is which. */
const ring = (rest: string, active: string) => `
  .pan-cursor-overlay::after {
    content: '';
    position: absolute;
    left: 24px;
    top: 24px;
    width: 160px;
    height: 160px;
    border: 4px solid #dd3333;
    ${rest}
  }
  .canvas-host.perf-armed .pan-cursor-overlay::after { ${active} }
`;

const armed = (_rest: Mech, on: Mech): string | null =>
  !on.armed ? 'trigger class .perf-armed not applied' : null;

const promoted = (m: Mech): string | null =>
  m.willChange.includes('transform') ? null : `will-change resolved to "${m.willChange}"`;

/** `svgTarget` is a selector for ONE group inside the map's own svg — see the
 *  `svg-opacity` arm, which is the only one that touches the painted tree. */
const buildArms = (svgTarget: string): Arm[] => [
  {
    // The no-paint baseline: the trigger fires and flips a NON-painting property
    // (pointer-events) on the overlay, so this measures the class toggle plus a
    // style change that paints nothing — the floor every painting arm is read
    // against. (Everything is reported `vs shipped`, hence the key.)
    key: 'shipped',
    what: 'baseline — trigger flips pointer-events (paints nothing)',
    css: `
      .pan-cursor-overlay { pointer-events: none; }
      .canvas-host.perf-armed .pan-cursor-overlay { pointer-events: auto; }
    `,
    live: (rest, on) =>
      armed(rest, on) ??
      (on.pointerEvents === 'auto' && rest.pointerEvents === 'none'
        ? null
        : `pointer-events ${rest.pointerEvents} -> ${on.pointerEvents}`),
  },
  {
    key: 'display',
    what: 'display toggle, unpromoted  [CONTROL: must be slow]',
    css: `
      .pan-cursor-overlay { display: none; }
      .canvas-host.perf-armed .pan-cursor-overlay { display: block; }
    `,
    live: (rest, pan) =>
      armed(rest, pan) ??
      (rest.display === 'none' && pan.display !== 'none'
        ? null
        : `display ${rest.display} -> ${pan.display}`),
  },
  {
    key: 'display+layer',
    what: 'display toggle, will-change: transform',
    css: `
      .pan-cursor-overlay { display: none; will-change: transform; }
      .canvas-host.perf-armed .pan-cursor-overlay { display: block; }
    `,
    live: (rest, pan) =>
      armed(rest, pan) ??
      promoted(pan) ??
      (rest.display === 'none' && pan.display !== 'none'
        ? null
        : `display ${rest.display} -> ${pan.display}`),
  },
  {
    key: 'colour',
    what: 'ring always laid out, border-color transparent -> red, unpromoted',
    css: ring('border-color: transparent;', 'border-color: #dd3333;'),
    paints: 'ring',
    live: (rest, pan) =>
      armed(rest, pan) ?? (rest.after !== pan.after ? null : `::after unchanged (${pan.after})`),
  },
  {
    key: 'colour+layer',
    what: 'that repaint, will-change: transform  [THE DECIDER]',
    css: `
      .pan-cursor-overlay { will-change: transform; }
      ${ring('border-color: transparent;', 'border-color: #dd3333;')}
    `,
    paints: 'ring',
    live: (rest, pan) =>
      armed(rest, pan) ??
      promoted(pan) ??
      (rest.after !== pan.after ? null : `::after unchanged (${pan.after})`),
  },
  {
    key: 'visibility',
    what: 'ring always laid out, visibility hidden -> visible, unpromoted',
    css: ring('visibility: hidden;', 'visibility: visible;'),
    paints: 'ring',
    live: (rest, pan) =>
      armed(rest, pan) ?? (rest.after !== pan.after ? null : `::after unchanged (${pan.after})`),
  },
  {
    key: 'opacity',
    what: 'ring always laid out, opacity 0 -> 1, unpromoted',
    css: ring('opacity: 0;', 'opacity: 1;'),
    paints: 'ring',
    live: (rest, pan) =>
      armed(rest, pan) ?? (rest.after !== pan.after ? null : `::after unchanged (${pan.after})`),
  },
  {
    // THE GATE for the whole chrome-layer plan. A sibling <svg> inside
    // .canvas-pan-layer is where world-anchored chrome would live: it inherits
    // the pan transform for free, so nothing has to re-project it. The question
    // is whether it is its OWN paint chunk. If it is, it behaves like the HTML
    // ring arms (free) and the plan works; if it behaves like `svg-opacity`
    // (~+20ms) it is just more of the map's chunk and the chrome needs a
    // screen-space projection outside the pan layer instead.
    key: 'sibling-svg',
    what: 'opacity on a rect in a SIBLING <svg> inside .canvas-pan-layer  [THE GATE]',
    css: `
      #perf-chrome-svg rect { opacity: 0; }
      .canvas-host.perf-armed #perf-chrome-svg rect { opacity: 1; }
    `,
    paints: 'svg',
    live: (rest, pan) =>
      armed(rest, pan) ??
      (rest.siblingOpacity !== pan.siblingOpacity
        ? null
        : `sibling rect opacity unchanged (${pan.siblingOpacity})`),
  },
  {
    // The gate's second half, and the one that matters. `sibling-svg` shows that
    // being a sibling is not enough: .canvas-pan-layer is promoted, so its whole
    // subtree is one paint chunk and a sibling joins it. The HTML ring arms are
    // cheap because they sit OUTSIDE that layer. Promoting the sibling should
    // split it into a layer of its own while leaving it inside the pan layer,
    // which is the only place it can be and still ride the pan transform for
    // free. This is the difference between the plan as written and a
    // screen-space re-projection.
    key: 'sibling-svg+layer',
    what: 'that same rect, sibling <svg> given will-change: transform  [THE GATE]',
    css: `
      #perf-chrome-svg { will-change: transform; }
      #perf-chrome-svg rect { opacity: 0; }
      .canvas-host.perf-armed #perf-chrome-svg rect { opacity: 1; }
    `,
    paints: 'svg',
    live: (rest, pan) =>
      armed(rest, pan) ??
      (rest.siblingOpacity !== pan.siblingOpacity
        ? null
        : `sibling rect opacity unchanged (${pan.siblingOpacity})`),
  },
  {
    // Same rect, same svg, one level further out: a sibling of the pan layer
    // rather than a child of it. If this is free while `sibling-svg` is not,
    // the boundary is the promoted pan layer itself, and chrome has to live
    // outside it and be handed the pan transform rather than inheriting it.
    key: 'host-svg',
    what: 'opacity on a rect in an <svg> OUTSIDE the pan layer, in .canvas-host',
    css: `
      #perf-chrome-host-svg rect { opacity: 0; }
      .canvas-host.perf-armed #perf-chrome-host-svg rect { opacity: 1; }
    `,
    paints: 'svg',
    live: (rest, pan) =>
      armed(rest, pan) ??
      (rest.hostSiblingOpacity !== pan.hostSiblingOpacity
        ? null
        : `host-sibling rect opacity unchanged (${pan.hostSiblingOpacity})`),
  },
  {
    // The arm that decides whether any of the above transfers. Every arm before
    // it paints an HTML box that is a SIBLING of the map — and the whole reason
    // this question exists is that the map's own svg is where the 15k nodes
    // are. Real selection and hover chrome is svg INSIDE that tree, so a recipe
    // proven only on a sibling div is a recipe proven somewhere else.
    key: 'svg-opacity',
    what: 'opacity on ONE existing group INSIDE the map svg, unpromoted',
    css: `.canvas-host.perf-armed ${svgTarget} { opacity: 0.2; }`,
    paints: 'svg',
    live: (rest, pan) =>
      armed(rest, pan) ??
      (pan.targetCount > 0 ? null : `svgTarget "${svgTarget}" matched nothing`) ??
      (rest.targetOpacity !== pan.targetOpacity
        ? null
        : `target opacity unchanged (${pan.targetOpacity})`),
  },
];

/** Replace the arm stylesheet, re-appending so it stays last in <head>. */
const applyArm = async (page: Page, css: string): Promise<void> => {
  await page.evaluate((text: string) => {
    const prev = document.getElementById('chrome-layer-arm');
    if (prev) prev.remove();
    const el = document.createElement('style');
    el.id = 'chrome-layer-arm';
    el.textContent = text;
    document.head.appendChild(el);
  }, css);
  // Let the style change settle and its own repaint land, so the first press of
  // an arm is not measuring the arm being installed.
  await page.waitForTimeout(500);
};

const readMech = (page: Page, svgTarget: string): Promise<Mech | null> =>
  page.evaluate((target) => {
    const overlay = document.querySelector('.pan-cursor-overlay');
    if (!overlay) return null;
    const cs = getComputedStyle(overlay);
    const after = getComputedStyle(overlay, '::after');
    const hits = document.querySelectorAll(target);
    return {
      display: cs.display,
      pointerEvents: cs.pointerEvents,
      willChange: cs.willChange,
      // Every property any arm toggles, so one `rest !== on` comparison gates
      // all of them and none can quietly resolve to a no-op.
      after: `${after.borderTopColor}/${after.borderTopWidth}/${after.visibility}/${after.opacity}`,
      targetOpacity: hits[0] ? getComputedStyle(hits[0]).opacity : '—',
      targetCount: hits.length,
      siblingOpacity: (() => {
        const r = document.querySelector('#perf-chrome-svg rect');
        return r ? getComputedStyle(r).opacity : '—';
      })(),
      hostSiblingOpacity: (() => {
        const r = document.querySelector('#perf-chrome-host-svg rect');
        return r ? getComputedStyle(r).opacity : '—';
      })(),
      armed: !!document.querySelector('.canvas-host.perf-armed'),
    };
  }, svgTarget);

/**
 * Add or remove the `.perf-armed` trigger class on `.canvas-host`. This is what
 * replaces the middle-press: it activates every arm's rule WITHOUT arming a
 * pan, so the pan layer stays in its resting, UNPROMOTED state — which is the
 * state hover and station-drag chrome actually paint into.
 *
 * The middle-press the harness first used was a confound. On `main`,
 * `useViewport` promotes `.canvas-pan-layer` per gesture, so a pan-press
 * re-composites the whole layer wholesale (~21.7ms, the shipped pan-start cost)
 * and ABSORBS the chrome paint this harness is trying to isolate — every paint
 * arm reads ~0 against that inflated baseline. A class toggle promotes nothing,
 * so the paint cost stands on its own.
 */
const setArmed = (page: Page, on: boolean): Promise<void> =>
  page.evaluate((v) => {
    document.querySelector('.canvas-host')?.classList.toggle('perf-armed', v);
  }, on);

/**
 * Arm the trigger and time class-add -> the task after the next paint, in page
 * (same rAF -> setTimeout(0) interval as `probeFloor`). Leaves the class ON so
 * the caller can read computed style or screenshot the armed state; the caller
 * disarms with `setArmed(page, false)`.
 */
const armAndTime = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const host = document.querySelector('.canvas-host')!;
        const t0 = performance.now();
        host.classList.add('perf-armed');
        requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - t0), 0));
      }),
  );

test('chrome-layer promotion ablation', async ({ page }) => {
  test.setTimeout(900_000);
  const doc = loadDoc();
  const stations = Object.values(doc.stations);
  await seedAt(page, doc, centroid(stations));

  // Layer count, straight from the compositor. This is the second instrument: a
  // promoted arm that comes back slow is otherwise ambiguous between
  // "promotion does not help" and "the promotion never happened".
  const cdp = await page.context().newCDPSession(page);
  let layerCount: number | null = null;
  cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: unknown[] }) => {
    layerCount = e.layers?.length ?? 0;
  });
  await cdp.send('LayerTree.enable');

  const nodes = await page.evaluate(
    () => document.querySelectorAll('.canvas-pan-layer svg *').length,
  );

  const host = (await page.locator('.canvas-host').boundingBox())!;

  const hostClip = { x: host.x, y: host.y, width: host.width, height: host.height };
  const ringClip = { x: host.x + 16, y: host.y + 16, width: 184, height: 184 };

  /**
   * Install `css`, press once, and say whether the pixels in `clip` moved.
   *
   * This is the harness's second instrument, and the reason it exists is that
   * `live` reads COMPUTED STYLE, which a rule that resolves perfectly and
   * paints nothing satisfies completely — and an arm that paints nothing is
   * how you get a fast, meaningless number. Kept well away from the timing
   * loop, since a screenshot forces a composite of its own.
   */
  const pixelsMove = async (
    css: string,
    clip: { x: number; y: number; width: number; height: number },
    sel: string,
  ) => {
    await applyArm(page, css);
    await setArmed(page, false);
    await page.waitForTimeout(120);
    const rest = await page.screenshot({ clip });
    await setArmed(page, true);
    await page.waitForTimeout(200);
    const during = await page.screenshot({ clip });
    const mech = await readMech(page, sel);
    await setArmed(page, false);
    await page.waitForTimeout(120);
    return { changed: !rest.equals(during), mech };
  };

  /**
   * The subject of the `svg-opacity` arm: one group inside the map's own svg
   * whose opacity change is SHOWN to reach the screen.
   *
   * Every candidate is tried until one demonstrably paints, rather than picked
   * on a rule about which node ought to carry ink. Two guesses at that rule
   * were already wrong: a group can sit inside the viewport and still be
   * scissored away (the pan layer is a 2x surface that `.canvas-host` clips,
   * and the window also holds the sidebar), and a `[data-station-id]` wrapper
   * can be laid out at 159x159px while the visible dot and label are painted
   * by sibling layers keyed on the same id. Both produced a rule that applied,
   * a computed opacity that changed, and not one moved pixel — which times out
   * at +14 to +24ms of pure fiction if nothing checks.
   */
  // Stand up the candidate chrome layer: a sibling <svg> inside
  // .canvas-pan-layer, matching the map svg's box and viewBox so it shares its
  // coordinate system and rides the same pan transform. Injected rather than
  // built into MapCanvas, so the gate costs nothing if the answer is no.
  const siblingReady = await page.evaluate(() => {
    const map = document.querySelector('.canvas-pan-layer > svg');
    if (!map) return false;
    document.getElementById('perf-chrome-svg')?.remove();
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.id = 'perf-chrome-svg';
    const vb = map.getAttribute('viewBox');
    if (vb) svg.setAttribute('viewBox', vb);
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none');
    const [vx, vy, vw, vh] = (vb ?? '0 0 100 100').split(/\s+/).map(Number);
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(vx + vw * 0.45));
    rect.setAttribute('y', String(vy + vh * 0.45));
    rect.setAttribute('width', String(vw * 0.06));
    rect.setAttribute('height', String(vh * 0.06));
    rect.setAttribute('fill', '#dd3333');
    svg.appendChild(rect);
    map.parentElement!.appendChild(svg);

    // The same layer again, but OUTSIDE .canvas-pan-layer — a sibling of it,
    // inside .canvas-host, where the cursor overlay and popovers already live.
    // This is the production shape if the in-pan-layer answer is no: it cannot
    // inherit the pan transform, so it would have to be given the same one
    // useViewport already writes imperatively.
    const host = document.querySelector('.canvas-host');
    if (host) {
      document.getElementById('perf-chrome-host-svg')?.remove();
      const outer = svg.cloneNode(true) as SVGSVGElement;
      outer.id = 'perf-chrome-host-svg';
      host.appendChild(outer);
    }
    return true;
  });
  if (!siblingReady) throw new Error('could not inject the sibling chrome svg — no map svg found');

  const TARGET_SEL = '[data-perf-target]';

  /** Mark the i-th paintable leaf in the map svg, so the arm has a selector
   *  that is unique by construction. Returns null past the end of the list. */
  const markTarget = (i: number) =>
    page.evaluate((idx: number) => {
      for (const p of document.querySelectorAll('[data-perf-target]')) {
        p.removeAttribute('data-perf-target');
      }
      const hostRect = document.querySelector('.canvas-host')!.getBoundingClientRect();
      const q = ['circle', 'rect', 'path', 'text']
        .map((t) => `.canvas-pan-layer svg ${t}`)
        .join(', ');
      const out: Element[] = [];
      for (const el of document.querySelectorAll(q)) {
        const r = el.getBoundingClientRect();
        if (r.width < 12 || r.height < 12) continue;
        const m = 8;
        if (
          r.left < hostRect.left + m ||
          r.top < hostRect.top + m ||
          r.right > hostRect.right - m ||
          r.bottom > hostRect.bottom - m
        ) {
          continue;
        }
        const cs = getComputedStyle(el);
        if (cs.visibility !== 'visible' || Number(cs.opacity) < 0.9) continue;
        if (cs.fill === 'none' && cs.stroke === 'none') continue;
        out.push(el);
      }
      const el = out[idx];
      if (!el) return null;
      el.setAttribute('data-perf-target', '1');
      const r = el.getBoundingClientRect();
      return { count: out.length, tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height) };
    }, i);

  // CHROME_SVG_WHOLE=1 points the arm at the ENTIRE pan layer. Nothing to
  // measure — it is the control for the proof itself: fading the whole map is
  // as visible as a change gets, so if even that shows no pixel difference the
  // screenshot cannot see inside the pan layer and every in-tree verdict here
  // is about the instrument rather than the app. (It can: verified.)
  let svgSel = process.env.CHROME_SVG_WHOLE ? '.canvas-pan-layer' : '';
  let tried = 0;
  let targetInfo = 'the whole pan layer';
  for (let i = 0; !svgSel && i < 14; i++) {
    const info = await markTarget(i);
    if (!info) break;
    tried++;
    const { changed } = await pixelsMove(
      `.canvas-host.perf-armed ${TARGET_SEL} { opacity: 0.2; }`,
      hostClip,
      TARGET_SEL,
    );
    if (changed) {
      svgSel = TARGET_SEL;
      targetInfo = `<${info.tag.toLowerCase()}> ${info.w}x${info.h}px, candidate ${i + 1} of ${info.count}`;
    }
  }
  if (!svgSel) {
    throw new Error(
      `no paintable leaf in the map svg changed a pixel when faded (tried ${tried}) — re-run ` +
        `with CHROME_SVG_WHOLE=1 to check the screenshot can see the pan layer at all before ` +
        `believing anything this harness says about in-tree chrome`,
    );
  }
  const ARMS = buildArms(svgSel);

  const paintProof = new Map<string, boolean>();
  for (const arm of ARMS.filter((a) => a.paints)) {
    const { changed, mech } = await pixelsMove(
      arm.css,
      arm.paints === 'svg' ? hostClip : ringClip,
      svgSel,
    );
    if (!changed) {
      // Say WHICH assumption broke, rather than only that the proof failed.
      console.log(
        `  [proof] ${arm.key}: no pixel change. armed=${mech?.armed} ` +
          `targetOpacity=${mech?.targetOpacity} targetCount=${mech?.targetCount} ` +
          `after=${mech?.after}`,
      );
    }
    paintProof.set(arm.key, changed);
  }

  // Instrument floor: the same arm/time interval with an EMPTY stylesheet, so
  // the class toggles but nothing matches it. Any arm at this level painted
  // nothing (or the class-add itself is what costs, not the paint — the two are
  // separated by comparing painting arms to the no-paint `shipped` baseline).
  await applyArm(page, '');
  const floorSamples: number[] = [];
  for (let i = 0; i < 10; i++) {
    await setArmed(page, false);
    await page.waitForTimeout(60);
    floorSamples.push(await armAndTime(page));
    await setArmed(page, false);
    await page.waitForTimeout(60);
  }
  const floor = floorSamples.sort((a, b) => a - b);

  const samples = new Map<string, number[]>(ARMS.map((a) => [a.key, []]));
  const failures = new Map<string, string[]>(ARMS.map((a) => [a.key, []]));
  const layers = new Map<string, number | null>(ARMS.map((a) => [a.key, null]));

  for (let round = 0; round < ROUNDS; round++) {
    for (const arm of ARMS) {
      await applyArm(page, arm.css);
      for (let i = 0; i < PRESSES; i++) {
        await setArmed(page, false);
        await page.waitForTimeout(60);
        const rest = await readMech(page, svgSel);
        const toPaint = await armAndTime(page);
        const on = await readMech(page, svgSel);
        await setArmed(page, false);
        await page.waitForTimeout(60);
        if (!rest || !on) {
          failures.get(arm.key)!.push('overlay missing');
        } else {
          const why = arm.live(rest, on);
          if (why) failures.get(arm.key)!.push(why);
        }
        if (layers.get(arm.key) == null) layers.set(arm.key, layerCount);
        samples.get(arm.key)!.push(toPaint);
      }
    }
  }

  const p = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))];
  const base = med(samples.get('shipped')!);

  console.log(`\n=== chrome-layer promotion ablation ===`);
  // Print the resolved map. perfMapPath() takes the alphabetically FIRST
  // .massimo.json in .perf/, so a gitignored drawing dropped in by an earlier
  // session silently outranks the committed mta-v23 — which is how the first
  // run of this harness measured an 81-station map while reporting numbers
  // against a 464-station table.
  console.log(`  map: ${perfMapPath()}`);
  console.log(`       ${stations.length} stations, ${nodes} painted svg nodes`);
  console.log(`  CPU perf mode: ${readPowerMode()}  (swings these numbers; see README)`);
  console.log(`  svg-arm subject: ${targetInfo}  (proved to paint; ${tried} tried)`);
  console.log(`  ${ROUNDS} rounds x ${PRESSES} arm-toggles per arm, interleaved`);
  console.log(
    `  PROBE FLOOR (same interval, empty stylesheet):  med ${med(floor).toFixed(1)}ms   max ${floor[floor.length - 1].toFixed(1)}ms`,
  );
  console.log(`\n  arm             live  layers   n     med     p90     max   vs shipped`);
  for (const arm of ARMS) {
    const xs = [...samples.get(arm.key)!].sort((a, b) => a - b);
    const bad = failures.get(arm.key)!;
    const lc = layers.get(arm.key);
    const delta = xs.length ? med(xs) - base : 0;
    console.log(
      `  ${arm.key.padEnd(14)} ${(bad.length ? 'NO' : 'yes').padStart(4)} ` +
        `${String(lc ?? '—').padStart(7)} ${String(xs.length).padStart(3)} ` +
        `${(xs.length ? med(xs) : 0).toFixed(1).padStart(7)} ` +
        `${(xs.length ? p(xs, 0.9) : 0).toFixed(1).padStart(7)} ` +
        `${(xs.length ? xs[xs.length - 1] : 0).toFixed(1).padStart(7)}   ` +
        `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}ms`,
    );
  }
  console.log('');
  for (const arm of ARMS) {
    const proof = arm.paints ? (paintProof.get(arm.key) ? '  [ring painted]' : '  [RING NEVER PAINTED]') : '';
    console.log(`  ${arm.key.padEnd(14)} ${arm.what}${proof}`);
    const bad = [...new Set(failures.get(arm.key)!)];
    if (bad.length) console.log(`  ${''.padEnd(14)} NOT LIVE: ${bad.join('; ')}`);
  }

  // Every arm must have been measured and must have done what it claims.
  for (const arm of ARMS) {
    expect(samples.get(arm.key)!.length, `${arm.key}: no samples`).toBeGreaterThan(0);
    expect(failures.get(arm.key)!, `${arm.key}: mechanism not in force`).toEqual([]);
  }
  // A `paint*` arm whose ring never reached the screen measured nothing, and
  // would report the fastest row in the table for doing so.
  for (const arm of ARMS.filter((a) => a.paints)) {
    expect(
      paintProof.get(arm.key),
      `${arm.key}: the ring never reached the screen, so its timing measures an arm that paints nothing`,
    ).toBe(true);
  }
  // The control is the claim. If toggling `display` on one childless div does
  // NOT cost materially more than the shipped no-paint path, this probe cannot
  // see a compositing update and no other row here is evidence of anything.
  expect(
    med(samples.get('display')!) - base,
    'CONTROL `display` is not slower than shipped — the probe cannot see a compositing update, so this run is void',
  ).toBeGreaterThan(5);
});
