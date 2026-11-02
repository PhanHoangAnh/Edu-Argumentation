#!/usr/bin/env node
/**
 * gate-r-style.mjs — THE NEW SCREENS LOOK LIKE THE OLD ONES, MEASURED, NOT EYEBALLED. 23-09-26.
 *
 * WHY IT EXISTS. The user, verbatim: "the shade of the red filled button like continue reading on
 * the home page is the correct red shade, while Account page button is vastly different, both font,
 * font size, shade of red. Even the sign in screen is also off compare to the rest of the UI" — and
 * "Where is the log out button bruh? … there is an upload button on the top bar … Replace that with
 * the logout button". All of it was found BY EYE while 149 gates were green, because no gate ever
 * compared a NEW screen against an OLD one. This one does, with getComputedStyle, pair by pair.
 *
 * WHAT IT COMPARES (every pair, in BOTH emulated colour schemes — prefers-color-scheme light AND dark):
 *   Account primary button   vs  #read-tutorial-btn ("Continue reading")
 *   #login-submit            vs  #read-tutorial-btn
 *   Account secondary button vs  #start-btn ("Practice", the home page's outline button)
 *   #nav-logout (icon)       vs  #nav-account — resting + hover COLOUR only (R-S-NAV-LOGOUT, R-S-HOVER)
 *   Account / sign-in h1     vs  #welcome-title;   Account h2  vs  #library-heading
 *   Account / sign-in copy   vs  #current-meta;    inputs + labels vs the Settings page's
 *   Account / sign-in card   vs  #welcome-screen;  hover colour of the red button and the nav entry
 * Any property difference = FAIL. Plus: every font family, font size and text/fill/border colour on
 * the two new screens must already occur on the home + Settings screens (R-S-VOCAB); the top bar reads
 * HOME, LEARN, PRACTICE, GENERATE QUIZ, SETTINGS, ACCOUNT, then the log-out icon, in the DOM AND left to
 * right on screen (R-S-NAV-ORDER); no top-bar
 * control may open a file chooser (R-S-NOFILE); LOG OUT exists, has a name, is keyboard reachable
 * and really signs out — /api/progress answers 401 with the old cookie (R-S-LOGOUT).
 *
 * ⚠ "BOTH MODES", STATED HONESTLY: this app has ONE theme (dark), like :8767 — there is no light
 *   theme and no toggle, and `body` is a hard-coded #111827. The gate therefore runs the whole
 *   measurement under BOTH `prefers-color-scheme` values, which proves every pair holds whichever
 *   the OS asks for. It does NOT prove a light theme exists; none does.
 *
 * ⛔ RUN WITHOUT lib/auth-preload.mjs (run-gates-react.sh: R_NO_PRELOAD=1). This gate CLICKS LOG OUT.
 *    Under the preload the browser would carry R_SESSION — the one session every other suite signs
 *    in with — and logging it out would turn every later suite red. So it signs in THROUGH THE REAL
 *    FORM as the throwaway gate-reader account (R_GATE_READER / R_GATE_READER_PW), which also means
 *    the sign-in page is measured signed out, the way a person sees it.
 *    ⚠ It must run BEFORE gate-r-auth.mjs: that suite ends by rate-limiting 127.0.0.1's sign-ins for
 *      5 minutes. (Only FAILED attempts count; this gate makes none.)
 *
 * LAYOUT (23-09-26, user), measured in a SECOND browser that draws real scrollbars (Playwright's
 * headless default is --hide-scrollbars, which would make R-S-NOSHIFT vacuous):
 *   R-S-HEADER-ALIGN  logo, title text, every nav LABEL and the header icons share one centre line
 *                     (<= 1px) at 1440px and 390px;
 *   R-S-NOSHIFT       header left/right edges and the logo's x are identical on every top-bar page
 *                     (anti-vacuity: the gutter is > 0 and Home overflows while Learn does not);
 *   R-S-TOC-ROW       the Learn ☰ toggle sits on the title's row, left of it, centres <= 1px,
 *                     44x44, and the title wraps inside the pane at 390px;
 *   R-S-TOC-KEYS      `[` opens / `[` closes / Esc closes, focus into the panel and back to ☰,
 *                     lesson scroll preserved, ignored inside an input, a shadow-root input,
 *                     with Ctrl held, and on a page that is not Learn.
 *
 * Optional: R_STYLE_SHOTS=<dir> saves full-page screenshots of sign-in, home, Account and the top
 * bar in both schemes (used for the 23-09-26 handoff). No effect on the verdict.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const READER = process.env.R_GATE_READER || 'gate-reader';
const READER_PW = process.env.R_GATE_READER_PW || '';
const MODULE = process.env.R_MODULE || 'geron-homl3';
const SHOTS = process.env.R_STYLE_SHOTS || '';
if (SHOTS && /^\/(tmp|dev\/shm)\//.test(SHOTS)) throw new Error('R_STYLE_SHOTS is on tmpfs (RAM). Use /var/tmp or a repo path.');
if (!READER_PW) throw new Error('R_GATE_READER_PW is unset — run through run-gates-react.sh, which creates the gate accounts.');

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

// Longhands only: Chrome's computed SHORTHANDS (`padding`, `border-radius`) are not reliable to diff.
const TEXT_PROPS = [
  'background-color', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-transform', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius',
  'border-bottom-right-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-top-color', 'border-bottom-width', 'border-bottom-color',
];
// Controls also compare HEIGHT. Text blocks and cards do not: a heading's height is its line count,
// which depends on the words in it (a book title vs a person's name), not on the style.
const CONTROL_PROPS = [...TEXT_PROPS, 'height'];
const CARD_PROPS = [
  'background-color', 'border-top-color', 'border-top-width', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'font-family', 'color',
];

const styleOf = (page, sel, props) => page.evaluate(([s, p]) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return Object.fromEntries(p.map((k) => [k, cs.getPropertyValue(k)]));
}, [sel, props]);

/** Every font family / size / colour actually painted inside `rootSel`. Colour of TEXT only where
 *  the element has its own text; fills only when not transparent; borders only when drawn. */
const vocabOf = (page, rootSel) => page.evaluate((root) => {
  const out = { family: [], size: [], color: [] };
  const add = (k, v) => { if (!out[k].includes(v)) out[k].push(v); };
  const clear = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
  for (const host of document.querySelectorAll(root)) {
    for (const el of [host, ...host.querySelectorAll('*')]) {
      if (!el.getClientRects().length) continue;               // not rendered
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText) { add('family', cs.fontFamily); add('size', cs.fontSize); add('color', cs.color); }
      if (!clear(cs.backgroundColor)) add('color', cs.backgroundColor);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 && !clear(cs.getPropertyValue(`border-${side}-color`))) {
          add('color', cs.getPropertyValue(`border-${side}-color`));
        }
      }
    }
  }
  return out;
}, rootSel);

const diff = (a, b, props) => {
  if (!a || !b) return [`${a ? '' : 'NEW ELEMENT MISSING '}${b ? '' : 'REFERENCE MISSING'}`.trim()];
  return props.filter((p) => a[p] !== b[p]).map((p) => `${p}: "${a[p]}" vs "${b[p]}"`);
};
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const parkMouse = async (page) => { await page.mouse.move(2, 998); await settle(page, 300); };

// Pairs: [label, newScreenKey, newSel, refKey, refSel, props]. Keys name the screen a value was read on.
const PAIRS = {
  'R-S-PRIMARY-ACCOUNT': [['Account "Change password"', 'account', '#account-password-form button[type="submit"]', 'home', '#read-tutorial-btn', CONTROL_PROPS]],
  'R-S-PRIMARY-LOGIN': [['sign-in submit', 'login', '#login-submit', 'home', '#read-tutorial-btn', CONTROL_PROPS]],
  'R-S-SECONDARY-ACCOUNT': [['Account "Sign out"', 'account', '#account-signout-btn', 'home', '#start-btn', CONTROL_PROPS]],
  // ⚑ 23-09-26, later (user): LOG OUT is an ICON-ONLY button now, so its text styles (font, size,
  //   padding, height) are no longer compared with #nav-account's. R-S-NAV-LOGOUT below asserts what
  //   an icon button owes instead: accessible name, >= 44x44, and the neighbour's colour.
  'R-S-TITLE': [
    ['Account h1', 'account', '#account-title', 'home', '#welcome-title', TEXT_PROPS],
    ['sign-in h1', 'login', '#login-title', 'home', '#welcome-title', TEXT_PROPS],
  ],
  'R-S-SECTION': [
    ['Account h2 "Your progress"', 'account', '#account-progress-title', 'home', '#library-heading', TEXT_PROPS],
    ['Account h2 "Change password"', 'account', '#account-password-form h2', 'home', '#home-kpis-heading', TEXT_PROPS],
  ],
  'R-S-BODY': [
    ['Account body copy', 'account', '#account-progress-title + p', 'home', '#current-meta', TEXT_PROPS],
    ['sign-in body copy', 'login', '#login-copy', 'home', '#current-meta', TEXT_PROPS],
  ],
  'R-S-INPUT': [
    ['Account input', 'account', '#account-current-password', 'settings', '#set-api-url', CONTROL_PROPS],
    ['sign-in input', 'login', '#login-username', 'settings', '#set-api-url', CONTROL_PROPS],
  ],
  'R-S-LABEL': [
    ['Account label', 'account', 'label[for="account-current-password"]', 'settings', 'label[for="set-api-url"]', TEXT_PROPS],
    ['sign-in label', 'login', 'label[for="login-username"]', 'settings', 'label[for="set-api-url"]', TEXT_PROPS],
  ],
  'R-S-CARD': [
    ['Account card', 'account', '#account-screen > div:first-child', 'home', '#welcome-screen', CARD_PROPS],
    ['sign-in card', 'login', '#login-card', 'home', '#welcome-screen', CARD_PROPS],
  ],
};
const HOVER = [
  ['Account primary :hover', 'account', '#account-password-form button[type="submit"]', 'home', '#read-tutorial-btn', ['background-color', 'color']],
  ['sign-in submit :hover', 'login', '#login-submit', 'home', '#read-tutorial-btn', ['background-color', 'color']],
  ['LOG OUT :hover', 'home', '#nav-logout', 'home', '#nav-account', ['color', 'background-color']],
];

// The top bar, in order (user, 23-09-26). Labels are the entries' EXISTING text — the user's "AI Quiz"
// is the entry labelled GENERATE QUIZ (#nav-generated-quiz); no entry was renamed or invented.
const NAV_ORDER = [
  ['nav-tutorial', 'HOME'], ['nav-learn', 'LEARN'], ['nav-quiz', 'PRACTICE'], ['nav-generated-quiz', 'AI-QUIZ'],
  ['nav-settings', 'SETTINGS'], ['nav-account', 'ACCOUNT'],
  // ⚑ study-rooms-qna P2 (29-09-26), DELIBERATE: add-on tabs append after the core tabs (registry
  //   order, shell/screens.meta.ts); logout stays last.
  ['nav-qna', 'Q&A'],
  // ⚑ 30-09-26 (study-rooms-qna P3): the second add-on tab, after Q&A, before logout (same reason).
  ['nav-live', 'LIVE'],
  ['nav-logout', ''],
];
// The tab LOG OUT follows in keyboard order (R-S-LOGOUT). Was the literal 'nav-account' until P2
// (29-09-26): it is the same fact as NAV_ORDER's last tab, so it now reads it from there.
const LAST_TAB = NAV_ORDER[NAV_ORDER.length - 2][0];

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const measured = {};      // scheme -> screen -> sel -> props
const hovered = {};       // scheme -> screen -> sel -> props
const vocab = {};         // scheme -> { fresh, ref }
const logout = {};        // scheme -> facts
const nofile = {};        // scheme -> facts
const icon = {};          // scheme -> log-out icon facts
const order = {};         // scheme -> top-bar order facts

const allSelsFor = (screen) => {
  const s = new Set();
  for (const rows of Object.values(PAIRS)) for (const [, nk, ns, rk, rs] of rows) { if (nk === screen) s.add(ns); if (rk === screen) s.add(rs); }
  return [...s];
};

async function readScreen(page, scheme, screen) {
  // RESTING state vs RESTING state. The sign-in page autofocuses its username field, and a focused
  // field's border is brand red — measured 23-09-26, run 1 read that as a mismatch. Blur first.
  await page.evaluate(() => document.activeElement?.blur?.());
  await parkMouse(page);
  measured[scheme][screen] = {};
  for (const sel of allSelsFor(screen)) measured[scheme][screen][sel] = await styleOf(page, sel, CONTROL_PROPS);
  hovered[scheme][screen] = hovered[scheme][screen] || {};
  for (const [, nk, ns, rk, rs, props] of HOVER) {
    for (const [k, sel] of [[nk, ns], [rk, rs]]) {
      if (k !== screen || hovered[scheme][screen][sel]) continue;
      const box = await page.locator(sel).first().boundingBox().catch(() => null);
      if (!box) { hovered[scheme][screen][sel] = null; continue; }
      await page.hover(sel, { force: true });
      await settle(page, 400);                                   // transition-colors is 150ms
      hovered[scheme][screen][sel] = await styleOf(page, sel, props);
      await parkMouse(page);
    }
  }
}

async function shot(page, scheme, name, clip) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await parkMouse(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`), fullPage: !clip, clip });
}

for (const scheme of ['light', 'dark']) {
  measured[scheme] = {}; hovered[scheme] = {};
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
  const page = await ctx.newPage();

  // ---- sign-in page, signed out ----
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 600);
  await readScreen(page, scheme, 'login');
  const loginVocab = await vocabOf(page, '#login-screen');
  await shot(page, scheme, 'signin');

  // ---- sign in through the real form ----
  await page.fill('#login-username', READER);
  await page.fill('#login-password', READER_PW);
  await page.press('#login-password', 'Enter');
  await page.waitForFunction(() => location.pathname !== '/login', null, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await settle(page, 1200);
  const bookIsOpen = () => page.evaluate((m) => document.querySelector(`#library-grid [data-book="${m}"]`)?.getAttribute('aria-current') === 'true', MODULE);
  if (!(await bookIsOpen())) { await page.locator(`#library-grid [data-book="${MODULE}"]`).click(); await settle(page, 1500); }
  if (!(await bookIsOpen())) throw new Error(`⛔ PRECONDITION: ${MODULE} is not open, so #read-tutorial-btn/#welcome-title would be measured hidden. Refusing to continue.`);
  await page.evaluate(() => document.fonts.ready);

  // ---- home ----
  await readScreen(page, scheme, 'home');
  const homeVocab = await vocabOf(page, 'header, #landing-dashboard, #welcome-screen, #home-kpis, #services-section');
  await shot(page, scheme, 'home');
  await shot(page, scheme, 'topbar', { x: 0, y: 0, width: 1440, height: 90 });

  // ---- R-S-NAV-LOGOUT (icon facts) + R-S-NAV-ORDER, read on the resting home screen ----
  {
    await parkMouse(page);
    const named = await page.locator('header').getByRole('button', { name: 'Log out', exact: true }).count();
    icon[scheme] = {
      named,
      ...(await page.evaluate(() => {
        const b = document.getElementById('nav-logout');
        const n = document.getElementById('nav-account');
        if (!b || !n) return { found: false };
        const r = b.getBoundingClientRect();
        return {
          found: true, w: +r.width.toFixed(1), h: +r.height.toFixed(1),
          ariaLabel: b.getAttribute('aria-label'), title: b.getAttribute('title'),
          text: b.textContent.trim(), svg: b.querySelectorAll('svg[aria-hidden="true"]').length,
          color: getComputedStyle(b).color, neighbour: getComputedStyle(n).color,
        };
      })),
    };
    order[scheme] = await page.evaluate(() => {
      const header = document.querySelector('header');
      const els = [...header.querySelectorAll('#primary-nav button, #nav-logout')];
      return els.map((e) => ({ id: e.id, label: e.textContent.trim(), x: +e.getBoundingClientRect().left.toFixed(1) }));
    });
    order[scheme].lastRight = await page.evaluate(() => {
      const r = [...document.querySelectorAll('header button')].filter((e) => e.getClientRects().length)
        .map((e) => [e.id, e.getBoundingClientRect().right]);
      r.sort((a, b) => b[1] - a[1]);
      return r[0]?.[0] || '';
    });
  }

  // ---- R-S-NOFILE: nothing in the top bar reaches a file chooser ----
  {
    const dom = await page.evaluate(() => {
      const header = document.querySelector('header');
      const fileInputs = [...document.querySelectorAll('input[type="file"]')];
      return {
        headerFound: Boolean(header),
        inHeader: header ? header.querySelectorAll('input[type="file"]').length : -1,
        labelsInHeaderToFile: fileInputs.filter((i) => [...(i.labels || [])].some((l) => header?.contains(l))).length,
        headerControlsToFile: header ? [...header.querySelectorAll('[aria-controls],[for]')]
          .filter((e) => fileInputs.some((i) => i.id && (e.getAttribute('aria-controls') === i.id || e.getAttribute('for') === i.id))).length : -1,
      };
    });
    let choosers = 0;
    page.on('filechooser', () => { choosers += 1; });
    // Positive control FIRST: prove the detector sees a real file chooser, or a 0 below means nothing.
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = '__gate_fc_probe';
      d.style.cssText = 'position:fixed;left:600px;top:500px;z-index:99999';
      d.innerHTML = '<input type="file" id="__gate_fc_input"><label for="__gate_fc_input" id="__gate_fc_label" style="display:inline-block;padding:10px;background:#000;color:#fff">probe</label>';
      document.body.appendChild(d);
    });
    await page.click('#__gate_fc_label');
    await settle(page, 500);
    const detectorWorks = choosers === 1;
    await page.evaluate(() => document.getElementById('__gate_fc_probe')?.remove());
    choosers = 0;
    // Real clicks on EVERY rendered top-bar control except LOG OUT (tested on its own below).
    const ids = await page.evaluate(() => [...document.querySelectorAll('header button, header a, header label, header [role="button"]')]
      .filter((e) => e.getClientRects().length && e.id !== 'nav-logout')
      .map((e, i) => { if (!e.id) e.setAttribute('data-gate-fc', String(i)); return e.id ? `#${e.id}` : `[data-gate-fc="${i}"]`; }));
    for (const sel of ids) {
      await page.locator(sel).first().click({ force: true, timeout: 3000 }).catch(() => {});
      await settle(page, 350);
    }
    nofile[scheme] = { ...dom, detectorWorks, clicked: ids.length, choosers };
    // Back to a known state (the clicks above navigated between screens).
    await page.evaluate(() => document.getElementById('nav-tutorial')?.click());
    await settle(page, 800);
  }

  // ---- settings ----
  await page.evaluate(() => document.getElementById('nav-settings')?.click());
  await page.waitForSelector('#set-api-url', { state: 'visible', timeout: 8000 }).catch(() => {});
  await settle(page, 600);
  await readScreen(page, scheme, 'settings');
  const settingsVocab = await vocabOf(page, '#settings-screen');

  // ---- account ----
  await page.evaluate(() => document.getElementById('nav-account')?.click());
  await page.waitForSelector('#account-progress-title', { state: 'visible', timeout: 8000 }).catch(() => {});
  await settle(page, 1200);
  await readScreen(page, scheme, 'account');
  const accountVocab = await vocabOf(page, '#account-screen');
  await shot(page, scheme, 'account');

  vocab[scheme] = {
    fresh: { login: loginVocab, account: accountVocab },
    ref: {
      family: [...new Set([...homeVocab.family, ...settingsVocab.family])],
      size: [...new Set([...homeVocab.size, ...settingsVocab.size])],
      color: [...new Set([...homeVocab.color, ...settingsVocab.color])],
    },
  };

  // ---- R-S-LOGOUT: exists, named, keyboard reachable (light) / clicked (dark), and REALLY signs out ----
  {
    await page.evaluate(() => document.getElementById('nav-tutorial')?.click());
    await settle(page, 700);
    const cookie = (await ctx.cookies()).find((c) => c.name === 'edu_session')?.value || '';
    const named = await page.locator('header').getByRole('button', { name: /^log out$/i }).count();
    const visible = await page.locator('#nav-logout').isVisible().catch(() => false);
    let reachedBy = 'mouse';
    let tabs = 0;
    let before = '';
    if (scheme === 'light') {
      // From a FRESH page load, so Tab starts at the top of the document — not from whatever the
      // NOFILE clicks last focused (run 1 reached LOG OUT in 1 Tab for exactly that reason).
      reachedBy = 'keyboard';
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await settle(page, 800);
      const seq = [];
      for (tabs = 1; tabs <= 40; tabs += 1) {
        await page.keyboard.press('Tab');
        seq.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || ''));
        if (seq[seq.length - 1] === 'nav-logout') break;
      }
      before = seq[seq.length - 2] || '';
      if (seq[seq.length - 1] === 'nav-logout') await page.keyboard.press('Enter');
      else tabs = -1;
    } else {
      await page.click('#nav-logout');
    }
    await page.waitForFunction(() => location.pathname === '/login', null, { timeout: 10000 }).catch(() => {});
    const onLogin = await page.evaluate(() => location.pathname === '/login');
    const progress = cookie
      ? (await fetch(`${BASE}/api/progress?module=${MODULE}`, { headers: { Cookie: `edu_session=${cookie}` }, redirect: 'manual' })).status
      : -1;
    const cookieCleared = !(await ctx.cookies()).some((c) => c.name === 'edu_session' && c.value);
    logout[scheme] = { visible, named, reachedBy, tabs, before, onLogin, progress, cookieCleared, hadCookie: Boolean(cookie) };
  }
  await ctx.close();
}
await browser.close();

/* ═══════════════════════ LAYOUT: header line, no shift, ☰ row, `[` key ═══════════════════════ */
const layout = { align: {}, shift: {}, row: {}, keys: {} };
{
  const lb = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath(), ignoreDefaultArgs: ['--hide-scrollbars'] });
  const ctx = await lb.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-username', READER);
  await page.fill('#login-password', READER_PW);
  await page.press('#login-password', 'Enter');
  await page.waitForFunction(() => location.pathname !== '/login', null, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await settle(page, 1200);
  if (await page.evaluate((m) => document.querySelector(`#library-grid [data-book="${m}"]`)?.getAttribute('aria-current') !== 'true', MODULE)) {
    await page.locator(`#library-grid [data-book="${MODULE}"]`).click(); await settle(page, 1500);
  }
  const go = async (id) => { await page.evaluate((i) => document.getElementById(i)?.click(), id); await settle(page, 1300); };
  const headerLine = () => page.evaluate(() => {
    const mid = (r) => r.top + r.height / 2;
    const text = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const r = rg.getBoundingClientRect(); return r.height ? mid(r) : null; };
    const shown = (e) => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const c = { logo: mid(document.querySelector('#brand-home svg').getBoundingClientRect()), title: text(document.querySelector('#brand-home h1')) };
    const nav = document.getElementById('primary-nav');
    // Nav LABELS count only where the nav is an inline row (md+); below md it is a closed dropdown.
    if (getComputedStyle(nav).position === 'static') for (const b of nav.querySelectorAll('button')) if (shown(b)) c[b.id] = text(b);
    for (const id of ['menu-btn', 'nav-logout']) { const e = document.querySelector(`#${id} svg`); if (shown(e)) c[id] = mid(e.getBoundingClientRect()); }
    return c;
  });
  const edges = () => page.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect();
    const se = document.scrollingElement;
    return { left: h.left, right: h.right, logoX: document.querySelector('#brand-home svg').getBoundingClientRect().left,
      gutter: window.innerWidth - document.documentElement.clientWidth, overflows: se.scrollHeight > se.clientHeight };
  });

  // ---- R-S-HEADER-ALIGN, desktop then phone ----
  await go('nav-tutorial');
  layout.align[1440] = await headerLine();
  // ---- R-S-NOSHIFT: every top-bar page, desktop, real scrollbars ----
  for (const [name, id] of [['home', 'nav-tutorial'], ['learn', 'nav-learn'], ['practice', 'nav-quiz'], ['ai-quiz', 'nav-generated-quiz'],
    ['settings', 'nav-settings'], ['account', 'nav-account'], ['home-again', 'nav-tutorial']]) {
    await go(id);
    if (name === 'practice' || name === 'ai-quiz') { layout.shift[name] = await edges(); await page.keyboard.press('Escape'); await settle(page, 500); continue; }
    layout.shift[name] = await edges();
  }
  if (SHOTS) { await go('nav-tutorial'); await parkMouse(page); await page.screenshot({ path: path.join(SHOTS, 'layout-header-1440.png'), clip: { x: 0, y: 0, width: 1440, height: 90 } }); }

  // ---- R-S-TOC-ROW + R-S-TOC-KEYS at both widths ----
  const rowFacts = () => page.evaluate(() => {
    const b = document.getElementById('toc-toggle-btn'); const t = document.getElementById('tutorial-main-title');
    const art = document.getElementById('tutorial-article');
    const br = b.getBoundingClientRect(); const tr = t.getBoundingClientRect(); const pane = art.firstElementChild.getBoundingClientRect();
    // ⚑ 24-09-26 (plan D8): the fixture lesson (ch02-b07) has code, so the Lab link sits in this row too.
    const lab = document.getElementById('lab-open-btn'); const lr = lab ? lab.getBoundingClientRect() : null;
    const lh = parseFloat(getComputedStyle(t).lineHeight);
    return { btn: { l: br.left, r: br.right, w: br.width, h: br.height, mid: br.top + br.height / 2 },
      title: { l: tr.left, r: tr.right, mid: tr.top + tr.height / 2, lines: Math.round(tr.height / lh), text: t.textContent.trim().slice(0, 50) },
      paneRight: pane.right - parseFloat(getComputedStyle(art.firstElementChild).paddingRight),
      titleOverflow: t.scrollWidth > t.clientWidth + 1, articleOverflowX: art.scrollWidth > art.clientWidth + 1,
      ariaLabel: b.getAttribute('aria-label'), title_attr: b.getAttribute('title'), keys: b.getAttribute('aria-keyshortcuts'),
      lab: lr ? { l: lr.left, r: lr.right, h: lr.height, mid: lr.top + lr.height / 2 } : null };
  });
  const tocState = () => page.evaluate(() => {
    const art = document.getElementById('tutorial-article');
    const a = document.activeElement;
    return { open: document.getElementById('toc-toggle-btn').getAttribute('aria-expanded') === 'true',
      panelShown: document.getElementById('toc-panel').getClientRects().length > 0,
      scrollTop: art.scrollTop, focus: a?.id || a?.tagName || '', focusInPanel: Boolean(a && document.getElementById('toc-panel').contains(a)) };
  });
  for (const [vw, vh] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto(`${BASE}/#chapter=2&block=7`, { waitUntil: 'networkidle' });
    await settle(page, 900);
    if (vw === 390) layout.align[390] = await headerLine();
    await go('nav-learn');
    // The phone opens with the drawer closed, the desktop with the column open — both are the app's own defaults.
    layout.row[vw] = await rowFacts();
    if (SHOTS) { await parkMouse(page); await page.screenshot({ path: path.join(SHOTS, `layout-learn-${vw}.png`) }); }
    // Scroll the LESSON (the <article>, not the window) to 40% of its range; anti-vacuity: it must scroll.
    const range = await page.evaluate(() => { const a = document.getElementById('tutorial-article'); a.scrollTop = Math.round((a.scrollHeight - a.clientHeight) * 0.4); return a.scrollHeight - a.clientHeight; });
    await settle(page, 300);
    const k = layout.keys[vw] = { range, steps: [] };
    const step = async (label) => { k.steps.push({ label, ...(await tocState()) }); };
    await step('start');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('['); await settle(page, 350); await step('[1');
    await page.keyboard.press('['); await settle(page, 350); await step('[2');
    await page.keyboard.press('['); await settle(page, 350); await step('[3');
    await page.keyboard.press('Escape'); await settle(page, 350); await step('esc');
    // Ignored with a modifier held.
    await page.keyboard.press('Control+['); await settle(page, 300); await step('ctrl[');
    // Ignored while typing in a plain input and in an input inside a SHADOW ROOT (composedPath).
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = '__gate_kb';
      host.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999';
      host.innerHTML = '<input id="__gate_kb_plain" aria-label="probe">';
      const sh = document.createElement('div'); sh.id = '__gate_kb_shadow'; host.appendChild(sh);
      sh.attachShadow({ mode: 'open' }).innerHTML = '<input id="inner" aria-label="probe shadow">';
      document.body.appendChild(host);
    });
    await page.focus('#__gate_kb_plain'); await page.keyboard.press('['); await settle(page, 300); await step('input[');
    await page.evaluate(() => document.getElementById('__gate_kb_shadow').shadowRoot.getElementById('inner').focus());
    await page.keyboard.press('['); await settle(page, 300); await step('shadow[');
    k.typed = await page.evaluate(() => [document.getElementById('__gate_kb_plain').value, document.getElementById('__gate_kb_shadow').shadowRoot.getElementById('inner').value]);
    await page.evaluate(() => document.getElementById('__gate_kb')?.remove());
    // Scope: on Settings (not Learn) `[` in its real input types a bracket and toggles nothing.
    await go('nav-settings');
    const before = await page.evaluate(() => document.getElementById('toc-toggle-btn').getAttribute('aria-expanded'));
    await page.focus('#set-api-url'); await page.keyboard.press('End'); await page.keyboard.press('[');
    await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press('['); await settle(page, 300);
    k.settings = { before, after: await page.evaluate(() => document.getElementById('toc-toggle-btn').getAttribute('aria-expanded')),
      bracketTyped: await page.evaluate(() => document.getElementById('set-api-url').value.endsWith('[')) };
    // Undo the probe keystroke in the field itself (nothing is saved without the Save button).
    await page.focus('#set-api-url'); await page.keyboard.press('End'); await page.keyboard.press('Backspace');
  }
  await ctx.close();
  await lb.close();
}

/* ═══════════════════════ verdicts ═══════════════════════ */
const table = [];
for (const [id, rows] of Object.entries(PAIRS)) {
  const bad = [];
  for (const scheme of ['light', 'dark']) {
    for (const [label, nk, ns, rk, rs, props] of rows) {
      const a = measured[scheme][nk]?.[ns] ?? null;
      const b = measured[scheme][rk]?.[rs] ?? null;
      const d = diff(a && Object.fromEntries(props.map((p) => [p, a[p]])), b && Object.fromEntries(props.map((p) => [p, b[p]])), props);
      if (d.length) bad.push(`[${scheme}] ${label} (${ns} vs ${rs}): ${d.join('; ')}`);
      if (scheme === 'light') table.push({ id, label, ns, rs, n: props.length, match: d.length === 0, a });
    }
  }
  const n = rows.reduce((t, r) => t + r[5].length, 0);
  check(id, bad.length === 0,
    bad.length ? `MISMATCH ${bad.join(' | ')}` : `${rows.map((r) => `${r[2]}==${r[4]}`).join(', ')} — ${n} properties × 2 schemes identical`);
}
{
  const bad = [];
  for (const scheme of ['light', 'dark']) {
    for (const [label, nk, ns, rk, rs, props] of HOVER) {
      const d = diff(hovered[scheme][nk]?.[ns] ?? null, hovered[scheme][rk]?.[rs] ?? null, props);
      if (d.length) bad.push(`[${scheme}] ${label}: ${d.join('; ')}`);
    }
  }
  check('R-S-HOVER', bad.length === 0,
    bad.length ? `MISMATCH ${bad.join(' | ')}` : `hover colours identical for ${HOVER.map((h) => h[2]).join(', ')} (e.g. primary -> ${hovered.light.home['#read-tutorial-btn']?.['background-color']})`);
}
{
  const bad = [];
  for (const scheme of ['light', 'dark']) {
    const { fresh, ref } = vocab[scheme];
    for (const [screen, v] of Object.entries(fresh)) {
      for (const k of ['family', 'size', 'color']) {
        const extra = v[k].filter((x) => !ref[k].includes(x));
        if (extra.length) bad.push(`[${scheme}] ${screen} ${k} not on home/settings: ${extra.join(', ')}`);
      }
    }
  }
  const r = vocab.light.ref;
  check('R-S-VOCAB', bad.length === 0,
    bad.length ? bad.join(' | ')
      : `every family/size/colour painted on sign-in + Account already occurs on home/settings (reference: ${r.family.length} family, ${r.size.length} sizes [${r.size.join(' ')}], ${r.color.length} colours)`);
}
{
  const ok = ['light', 'dark'].every((s) => {
    const i = icon[s];
    return i.found && i.named === 1 && i.ariaLabel === 'Log out' && i.title === 'Log out' && i.text === ''
      && i.svg === 1 && i.w >= 44 && i.h >= 44 && i.color === i.neighbour;
  });
  check('R-S-NAV-LOGOUT', ok, `log-out is an icon-only button named "Log out" (aria-label + title), >= 44x44, resting colour == #nav-account's: ${JSON.stringify(icon)}`);
}
{
  const want = NAV_ORDER.map(([id, label]) => `${id}:${label}`).join(' > ');
  const bad = [];
  for (const s of ['light', 'dark']) {
    const o = order[s];
    const got = o.map((e) => `${e.id}:${e.label}`).join(' > ');
    if (got !== want) bad.push(`[${s}] DOM order ${got}`);
    const xs = o.map((e) => e.x);
    if (!xs.every((x, k) => k === 0 || x > xs[k - 1])) bad.push(`[${s}] not left-to-right on screen: ${JSON.stringify(xs)}`);
    if (o.lastRight !== 'nav-logout') bad.push(`[${s}] rightmost header control is #${o.lastRight}, not #nav-logout`);
  }
  check('R-S-NAV-ORDER', bad.length === 0, bad.length ? `MISMATCH ${bad.join(' | ')} — want ${want}` : `top bar is exactly ${want}, left to right at 1440px, log-out rightmost (both schemes)`);
}
{
  const ok = ['light', 'dark'].every((s) => {
    const f = nofile[s];
    return f.headerFound && f.inHeader === 0 && f.labelsInHeaderToFile === 0 && f.headerControlsToFile === 0
      && f.detectorWorks && f.clicked >= 7 && f.choosers === 0;
  });
  check('R-S-NOFILE', ok, `no top-bar control reaches a file input or opens a file chooser: ${JSON.stringify(nofile)}`
    + ' (detectorWorks = a probe <input type=file> DID raise a chooser, so choosers=0 is a real zero)');
}
{
  const ok = ['light', 'dark'].every((s) => {
    const l = logout[s];
    return l.visible && l.named === 1 && l.hadCookie && l.onLogin && l.progress === 401 && l.cookieCleared
      && (l.reachedBy !== 'keyboard' || (l.tabs > 1 && l.before === LAST_TAB));
  });
  check('R-S-LOGOUT', ok, `LOG OUT visible, named, keyboard-reachable from the top of a fresh page (tab order: straight after the last tab, ${LAST_TAB}), lands on /login, old session -> /api/progress 401: ${JSON.stringify(logout)}`);
}

{
  const bad = [];
  for (const vw of [1440, 390]) {
    const c = layout.align[vw] || {};
    const vals = Object.values(c);
    if (vals.some((v) => v == null) || vals.length < (vw === 1440 ? 9 : 4)) bad.push(`[${vw}] missing/too few items ${JSON.stringify(c)}`);
    const spread = Math.max(...vals) - Math.min(...vals);
    if (!(spread <= 1)) bad.push(`[${vw}] centre spread ${spread.toFixed(2)}px ${JSON.stringify(c)}`);
  }
  check('R-S-HEADER-ALIGN', bad.length === 0, bad.length ? bad.join(' | ')
    : `logo, title, nav labels and header icons share one centre line (<= 1px) at 1440 (${Object.keys(layout.align[1440]).length} items) and 390 (${Object.keys(layout.align[390]).length} items): ${JSON.stringify(layout.align)}`);
}
{
  const s = layout.shift;
  const ref = s.home;
  const bad = Object.entries(s).filter(([, v]) => v.left !== ref.left || v.right !== ref.right || v.logoX !== ref.logoX)
    .map(([k, v]) => `${k}: left ${v.left} right ${v.right} logoX ${v.logoX} (home ${ref.left}/${ref.right}/${ref.logoX})`);
  const vacuous = !(ref.gutter > 0) || !s.home.overflows || s.learn.overflows;
  check('R-S-NOSHIFT', bad.length === 0 && !vacuous,
    `${bad.length ? 'SHIFT ' + bad.join(' | ') : 'header edges + logo x identical on ' + Object.keys(s).join(', ')}`
    + ` (anti-vacuity: scrollbar gutter ${ref.gutter}px, Home overflows=${s.home.overflows}, Learn overflows=${s.learn.overflows}${vacuous ? ' <-- VACUOUS' : ''})`);
}
{
  const bad = [];
  for (const vw of [1440, 390]) {
    const r = layout.row[vw];
    if (!r) { bad.push(`[${vw}] not measured`); continue; }
    if (!(r.btn.r <= r.title.l)) bad.push(`[${vw}] button not left of title (btn.r ${r.btn.r} title.l ${r.title.l})`);
    if (!(Math.abs(r.btn.mid - r.title.mid) <= 1)) bad.push(`[${vw}] not on one row: centres ${r.btn.mid} vs ${r.title.mid}`);
    if (!(r.btn.w >= 44 && r.btn.h >= 44)) bad.push(`[${vw}] button ${r.btn.w}x${r.btn.h}`);
    // Lab link (24-09-26): right of the title, same row (centres <= 1px), inside the pane, >= 44px tall.
    if (!r.lab) bad.push(`[${vw}] no #lab-open-btn on the code lesson ch02-b07`);
    else if (!(r.lab.l >= r.title.r - 1 && Math.abs(r.lab.mid - r.title.mid) <= 1 && r.lab.r <= r.paneRight + 1 && r.lab.h >= 44)) bad.push(`[${vw}] Lab link off the row / outside the pane: ${JSON.stringify(r.lab)} title.r ${r.title.r} pane ${r.paneRight}`);
    if (r.title.r > r.paneRight + 1 || r.titleOverflow || r.articleOverflowX) bad.push(`[${vw}] title overflows the pane (title.r ${r.title.r} pane ${r.paneRight})`);
    if (r.ariaLabel !== 'Contents' || r.title_attr !== 'Toggle sidebar ( [ )' || r.keys !== '[') bad.push(`[${vw}] attrs ${r.ariaLabel}/${r.title_attr}/${r.keys}`);
  }
  if (!(layout.row[390]?.title.lines > 1)) bad.push(`[390] title did not wrap (lines ${layout.row[390]?.title.lines}) — pick a longer fixture title`);
  check('R-S-TOC-ROW', bad.length === 0, bad.length ? bad.join(' | ')
    : `☰ left of the title on one row (centres <= 1px), 44x44, title wraps inside the pane at 390 (${layout.row[390].title.lines} lines): ${JSON.stringify(layout.row)}`);
}
{
  const bad = [];
  for (const vw of [1440, 390]) {
    const k = layout.keys[vw];
    if (!k) { bad.push(`[${vw}] not measured`); continue; }
    const st = Object.fromEntries(k.steps.map((x) => [x.label, x]));
    const s0 = st.start;
    if (!(k.range > 200)) bad.push(`[${vw}] lesson cannot scroll (range ${k.range}) — vacuous`);
    // [1 flips, [2 flips back, [3 flips again; Esc always ends CLOSED.
    const flip = (a, b) => a.open !== b.open && a.panelShown !== b.panelShown && b.open === b.panelShown;
    if (!flip(s0, st['[1'])) bad.push(`[${vw}] [ did not toggle from ${s0.open}`);
    if (!flip(st['[1'], st['[2'])) bad.push(`[${vw}] second [ did not toggle back`);
    if (!flip(st['[2'], st['[3'])) bad.push(`[${vw}] third [ did not toggle`);
    if (st.esc.open || st.esc.panelShown) bad.push(`[${vw}] Esc did not close`);
    for (const x of ['[1', '[2', '[3']) {
      const e = st[x];
      if (e.open && !e.focusInPanel) bad.push(`[${vw}] ${x} opened but focus is on ${e.focus}, not in the panel`);
      if (!e.open && e.focus !== 'toc-toggle-btn') bad.push(`[${vw}] ${x} closed but focus is on ${e.focus}, not ☰`);
    }
    if (st.esc.focus !== 'toc-toggle-btn') bad.push(`[${vw}] Esc closed but focus is on ${st.esc.focus}`);
    // Scroll: a phone drawer overlays the pane, so scrollTop must never move; on desktop the column
    // changes the pane's width, so the ROUND TRIP ([1 -> [2) must land back within 2px.
    const tops = k.steps.filter((x) => ['start', '[1', '[2', '[3', 'esc'].includes(x.label)).map((x) => x.scrollTop);
    if (vw === 390 && new Set(tops).size !== 1) bad.push(`[390] scroll moved ${JSON.stringify(tops)}`);
    if (Math.abs(s0.scrollTop - st['[2'].scrollTop) > 2 || s0.scrollTop < 100) bad.push(`[${vw}] scroll not preserved over a [ [ round trip: ${JSON.stringify(tops)}`);
    const esc = st.esc;
    if (st['ctrl['].open !== esc.open) bad.push(`[${vw}] Ctrl+[ toggled`);
    if (st['input['].open !== esc.open) bad.push(`[${vw}] [ inside an input toggled`);
    if (st['shadow['].open !== esc.open) bad.push(`[${vw}] [ inside a SHADOW-ROOT input toggled (composedPath not honoured)`);
    if (k.typed[0] !== '[' || k.typed[1] !== '[') bad.push(`[${vw}] the bracket was swallowed instead of typed: ${JSON.stringify(k.typed)}`);
    if (k.settings.before !== k.settings.after || !k.settings.bracketTyped) bad.push(`[${vw}] on Settings: ${JSON.stringify(k.settings)}`);
  }
  check('R-S-TOC-KEYS', bad.length === 0, bad.length ? bad.join(' | ')
    : `[ opens/[ closes/Esc closes at 1440 and 390, focus into the panel and back to ☰, lesson scroll kept (${JSON.stringify(Object.fromEntries([1440, 390].map((v) => [v, layout.keys[v].steps.map((x) => `${x.label}:${x.open ? 'open' : 'shut'}@${x.scrollTop}`).join(' ')])))}), ignored with Ctrl, in an input, in a shadow-root input and on Settings`);
}

// The parity table, for the report (not a result line).
console.log('\nPARITY TABLE (light; dark identical where PASS):');
for (const t of table) {
  const a = t.a || {};
  console.log(`  ${t.match ? 'match ' : 'DIFFER'}  ${t.id.padEnd(22)} ${t.label.padEnd(30)} ${t.ns} vs ${t.rs}  [${t.n} props]  bg=${a['background-color']} color=${a.color} size=${a['font-size']} weight=${a['font-weight']} lh=${a['line-height']} radius=${a['border-top-left-radius']} pad=${a['padding-top']}/${a['padding-left']} h=${a.height}`);
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) { console.log(`FAILED: ${failed.map((r) => r.id).join(', ')}`); process.exit(1); }
