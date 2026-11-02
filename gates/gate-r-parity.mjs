#!/usr/bin/env node
/**
 * gate-r-parity.mjs — R-suite: DOES :8792 LOOK LIKE :8767? Computed style, element by element.
 * Phase 04, Tier 2, browser-backed. Ruling R22's acceptance bar: "exactly look and behave like the
 * current interface I'm learning".
 *
 * ═══ WHY THIS FILE EXISTS ═════════════════════════════════════════════════════════════════════
 * Phase 03 closed "read-only parity" behind 78 green gates, and a side-by-side screenshot on
 * 23-09-26 found the wrong FONT on every screen, an unstyled contents panel, no Begin Assessment
 * button, a stub settings page and bare code-cell buttons. Every one of those gates checked that
 * a SELECTOR RESOLVED; none compared the result to the thing being ported. This one does.
 *
 * ═══ HOW ═══════════════════════════════════════════════════════════════════════════════════════
 * The SAME journey is driven in two browsers — the LEGACY (default the live :8767, read ONLY) and
 * the NEW build ($R_BASE) — and for each (screen, selector) pair the gate reads a fixed list of
 * computed properties from the FIRST matching element on both sides and compares them EXACTLY.
 * ⛔ The legacy page is GET-ONLY: every non-GET request from it is ABORTED by a route handler, so
 *    this gate can never write the user's progress, whatever the page tries.
 * ⛔ NO ALLOW-LIST. A difference is a FAIL with the property named. If a difference is ever
 *    ruled acceptable, it goes in ALLOWED below WITH the ruling, never silently.
 * ⛔ FLOOR: an element absent on EITHER side is a FAIL (a style comparison of nothing is green
 *    for the wrong reason), and at least 30 pairs must be compared.
 *
 * Nine result lines: R-PAR-HOME R-PAR-READER R-PAR-SETTINGS R-PAR-SETUP R-PAR-CODECELL
 *   R-PAR-EXERCISE R-PAR-ASK R-PAR-QUIZ R-PAR-RESULT
 * ⚠ R-PAR-QUIZ/RESULT FINISH A QUIZ ON THE LEGACY. Its completion POST is ABORTED by the route
 *   guard (the legacy then queues it in THIS throwaway browser's localStorage, which dies with it),
 *   so nothing reaches the user's progress.json. legacy.blocked counts those aborts.
 */
import { chromium } from 'playwright';

const NEW = process.env.R_BASE || 'http://127.0.0.1:8795';
// ⚑ P6b 24-09-26: the live legacy is retired (the new app owns :8767). run-gates-react.sh serves the
//   frozen aws-quiz-app/ locally and sets R_LEGACY to it; this default matches that port.
const LEGACY = process.env.R_LEGACY || 'http://127.0.0.1:8799';
const PROPS = [
  'font-family', 'font-size', 'font-weight', 'color', 'background-color', 'border-top-color',
  'border-top-width', 'border-top-left-radius', 'padding-top', 'padding-left', 'display',
  'text-transform', 'letter-spacing', 'line-height',
];
// ⛔ Empty by design. Format: 'screen|selector|property': 'why, and who ruled it'.
const ALLOWED = {};

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

const SCREENS = {
  home: {
    go: async (page) => {},
    selectors: ['header', '#brand-home', '#nav-tutorial', '#nav-learn', '#welcome-screen', '#welcome-title',
      '#current-meta', '#current-progress-label', '#current-next', '#read-tutorial-btn', '#start-btn',
      '#start-generated-btn', '#home-kpis h2', '#kpi-lessons', '#library-heading', '#import-book-link',
      '#library-grid [data-book] h3'],
    // ⚑ NAMED PARITY DELTA, 23-09-26 (user ruling): `label[for="custom-data-upload"]` (the top-bar
    //   upload icon) was on this list. :8792 no longer has it — it is replaced by LOG OUT, and
    //   :8767 (no sign-in, never touched) keeps its icon. The two apps legitimately differ there, so
    //   the selector is dropped from the comparison rather than ALLOWED property by property.
    //   gate-r-contract R-C6 + gate-r-style R-S-NOFILE keep it from coming back on :8792.
  },
  reader: {
    go: async (page, base) => {
      await page.goto(`${base}/#chapter=2&block=7`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.evaluate(() => document.getElementById('nav-learn')?.click());
      await page.waitForTimeout(1500);
    },
    selectors: ['#toc-panel', '#toc-summary', '#toc-close-btn', '#toc-nav summary', '#toc-nav button[aria-current="true"]',
      '#toc-toggle-btn', '#tutorial-main-title', '#tutorial-content', '#prev-block-btn', '#tutorial-to-quiz-btn',
      '#block-ai-quiz-btn', '#next-block-btn', '#tutorial-content details[data-deeper] summary', '#ask-fab'],
  },
  settings: {
    go: async (page) => {
      await page.evaluate(() => document.getElementById('nav-settings')?.click());
      await page.waitForTimeout(1500);
    },
    selectors: ['#settings-screen h2', '#settings-lock-status', '#set-api-url', '#set-model', '#settings-save-btn'],
  },
  setup: {
    go: async (page) => {
      await page.evaluate(() => document.getElementById('nav-quiz')?.click());
      await page.waitForTimeout(900);
    },
    selectors: ['#setup-title', '#setup-all-btn', '#setup-tree', '#setup-count', '#setup-start-btn', '#setup-cancel-btn'],
  },
  codecell: {
    go: async (page, base) => {
      await page.keyboard.press('Escape');
      await page.goto(`${base}/#chapter=1&block=8`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.evaluate(() => document.getElementById('nav-learn')?.click());
      await page.waitForTimeout(1500);
    },
    // ⚑ R24: the card is a static listing + Copy. `button` is its first (on :8792, only) button.
    //   ⚠ Until :8767 ships its own Copy version its first button is still "Edit" — same class
    //   string, so the comparison holds; a difference after :8767 lands is a real parity gap.
    selectors: ['#tutorial-content section[data-cell]', '#tutorial-content section[data-cell] > div',
      '#tutorial-content section[data-cell] button', '#tutorial-content section[data-cell] pre'],
  },
  exercise: {
    go: async (page, base) => {
      await page.goto(`${base}/#chapter=3&block=13`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.evaluate(() => document.getElementById('nav-learn')?.click());
      await page.waitForTimeout(1500);
    },
    selectors: ['[data-exercise-panel]', '[data-exercise-panel] h3', '[data-exercise-panel] .inline-flex button',
      '[data-exercise-panel] textarea', '[data-exercise-panel] [data-exercise-row]'],
  },
  ask: {
    go: async (page) => {
      await page.evaluate(() => document.getElementById('ask-fab')?.click());
      await page.waitForTimeout(700);
    },
    selectors: ['#ask-panel', '#ask-context', '#ask-new', '#ask-input', '#ask-send'],
  },
  quiz: {
    go: async (page, base) => {
      await page.evaluate(() => document.getElementById('ask-close')?.click());
      await page.goto(`${base}/#chapter=1&block=1`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.evaluate(() => document.getElementById('nav-learn')?.click());
      await page.waitForTimeout(1200);
      await page.evaluate(() => document.getElementById('tutorial-to-quiz-btn')?.click());
      await page.waitForTimeout(1200);
    },
    selectors: ['#quiz-scope-label', '#options-container .option-card', '#options-container .option-letter',
      '#options-container .option-text', '#quiz-new-btn', '#next-btn', '#action-container'],
  },
  result: {
    go: async (page) => {
      for (let i = 0; i < 12; i += 1) {
        const onQuiz = await page.evaluate(() => document.getElementById('quiz-screen')?.offsetParent !== null);
        if (!onQuiz) break;
        await page.evaluate(() => document.querySelector('#options-container .option-card')?.click());
        await page.waitForTimeout(250);
        await page.evaluate(() => document.getElementById('next-btn')?.click());
        await page.waitForTimeout(350);
      }
      await page.waitForTimeout(1200);
    },
    selectors: ['#result-screen', '#final-score', '#final-fraction', '#result-message span', '#result-back-btn',
      '#restart-btn', '#result-new-btn'],
  },
};

async function measure(base, readOnly) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let blocked = 0;
  if (readOnly) {
    await page.route('**/*', (route) => {
      if (route.request().method() !== 'GET') { blocked += 1; return route.abort(); }
      return route.continue();
    });
  }
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const out = {};
  for (const [name, screen] of Object.entries(SCREENS)) {
    await screen.go(page, base);
    out[name] = await page.evaluate(async ([sels, props]) => {
      // ⛔ computed `font-family` is the DECLARED stack whether or not the face loaded — the
      //    Phase-03 build declared Plus Jakarta Sans and never loaded it, and a font-family
      //    comparison read IDENTICAL. So the face is asserted LOADED, on both sides.
      await document.fonts.ready;
      //    ⛔ NOT document.fonts.check(): per spec it returns TRUE when NO face matches at all —
      //       i.e. exactly on the broken build (measured: it read "true" on the Phase-03 :8792).
      //       The assertion is that a Plus Jakarta Sans FACE EXISTS and has status "loaded".
      const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Plus Jakarta Sans');
      const res = { __fontLoaded: { loaded: String(faces.some((f) => f.status === 'loaded')), faces: String(faces.length) } };
      for (const s of sels) {
        const el = document.querySelector(s);
        if (!el) { res[s] = null; continue; }
        const cs = getComputedStyle(el);
        res[s] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
      }
      return res;
    }, [screen.selectors, PROPS]);
  }
  await browser.close();
  return { out, blocked };
}

const legacy = await measure(LEGACY, true);
const fresh = await measure(NEW, false);

let compared = 0;
for (const [name, screen] of Object.entries(SCREENS)) {
  const diffs = [];
  const missing = [];
  for (const sel of screen.selectors) {
    const a = legacy.out[name][sel];
    const b = fresh.out[name][sel];
    if (!a || !b) { missing.push(`${sel}(${a ? 'legacy✓' : 'legacy✗'}/${b ? 'new✓' : 'new✗'})`); continue; }
    compared += 1;
    for (const p of PROPS) {
      if (a[p] !== b[p] && !ALLOWED[`${name}|${sel}|${p}`]) diffs.push(`${sel} ${p}: legacy="${a[p]}" new="${b[p]}"`);
    }
  }
  const fa = legacy.out[name].__fontLoaded.loaded;
  const fb = fresh.out[name].__fontLoaded.loaded;
  if (fa !== 'true' || fb !== 'true') diffs.push(`Plus Jakarta Sans LOADED: legacy=${fa} new=${fb}`);
  check(`R-PAR-${name.toUpperCase()} ${screen.selectors.length} elements × ${PROPS.length} computed properties identical to the legacy`,
    diffs.length === 0 && missing.length === 0,
    `diffs=${diffs.length}${diffs.length ? ' ' + JSON.stringify(diffs.slice(0, 8)) : ''} missing=${JSON.stringify(missing)}`);
}
console.log(`compared pairs=${compared} (floor 30) · legacy non-GET aborted=${legacy.blocked}`);
if (compared < 30) {
  results.push({ id: 'FLOOR', pass: false });
  console.log('FLOOR FAILED: fewer than 30 element pairs compared');
}
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
