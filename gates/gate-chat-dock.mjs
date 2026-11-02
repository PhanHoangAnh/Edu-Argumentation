#!/usr/bin/env node
/**
 * gate-chat-dock.mjs — the tutor chat can DOCK into Lab's side slot (22-10-26, user: "allow the
 * chatbot of our edu arg to open in the side, which will replace the lab"). Tier 2 (browser).
 *
 *   C-dock-ctl    the popup panel has a labelled Dock control
 *   C-lab-open    baseline: with the chat as a popup, the Lab button opens Lab (#lab-dock)
 *   C-docked      Dock -> Lab closes, #ask-panel lives inside #chat-dock-slot, the FAB is hidden
 *   C-lab-off     Lab button is aria-disabled with a one-line reason; click and `]` do NOT open Lab
 *   C-history     the 2 seeded turns are still in the log after Dock and after Popup (no loss)
 *   C-popup       Popup -> panel back to a fixed popup, Lab button works again and opens Lab
 *   C-reload      a reload while docked stays docked and Lab stays off
 *   C-nostore     with localStorage throwing, Dock/Popup still work (page renders without it)
 *   C-layout-W    at 390 / 834 / 1440: no NEW horizontal overflow (vs the page without the dock); 1440 = chat beside the lesson
 *                 (both >= 360 px wide), <1024 = full-screen layer; screenshot saved
 *
 * fails-when: set CHAT_DOCK_BREAK=1 to run against a deliberately broken build
 *   (the gate then injects style that keeps Lab enabled by removing aria-disabled) -> C-lab-off RED.
 *
 * Env: GATE_BASE (default http://192.168.100.66:8767), LAB_TOKEN (edu_session cookie value, never argv),
 *      CHAT_SHOTS (screenshot dir, default /var/tmp/chat-dock-shots). Read-only: non-GET aborted.
 * Run:  LAB_TOKEN=$(ssh nn 'cat ~/.config/foxai/lab-gate.tok') node gates/gate-chat-dock.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.GATE_BASE || 'http://192.168.100.66:8767';
const TOKEN = process.env.LAB_TOKEN || '';
const SHOTS = process.env.CHAT_SHOTS || '/var/tmp/chat-dock-shots';
const BREAK = process.env.CHAT_DOCK_BREAK === '1';
const READER = '/geron-homl3/chapter-2/14-x';   // a lesson WITH code, so the Lab button exists
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (id, pass, detail = '') => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}${detail ? '  ' + detail : ''}`); };

const SEED = JSON.stringify({ turns: [{ role: 'user', text: 'what is a tensor?' }, { role: 'assistant', text: 'A tensor is an array.', source: 'book', page: 3 }] });
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const host = new URL(BASE).hostname;

async function open(width, { seed = true, nostore = false, keepStore = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  if (TOKEN) await ctx.addCookies([{ name: 'edu_session', value: TOKEN, domain: host, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  await ctx.route('**/*', (route) => (['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()));
  if (nostore) await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  else if (seed && !keepStore) await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.clear(); localStorage.setItem('eduAskConversation', s); } } catch { /* about:blank */ } }, SEED);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}${READER}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#lab-open-btn', { timeout: 20_000 });
  return { ctx, page, errors };
}
const turnsInLog = (page) => page.evaluate(() => document.querySelector('#ask-log')?.children.length ?? -1);
const labState = (page) => page.evaluate(() => {
  const b = document.querySelector('#lab-open-btn');
  return { open: !!document.querySelector('#lab-dock'), disabled: b?.getAttribute('aria-disabled') === 'true', title: b?.getAttribute('title') || '', href: b?.getAttribute('href') };
});
const chatState = (page) => page.evaluate(() => {
  const p = document.querySelector('#ask-panel'), fab = document.querySelector('#ask-fab');
  const r = p?.getBoundingClientRect();
  return { inSlot: !!p?.closest('#chat-dock-slot'), mode: p?.getAttribute('data-mode'), fabHidden: !fab || fab.getBoundingClientRect().width === 0, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0, dockLabel: document.querySelector('#ask-dock')?.getAttribute('aria-label') };
});

try {
  const { ctx, page, errors } = await open(1440);
  await page.click('#ask-fab');
  await page.waitForSelector('#ask-panel[data-mode="popup"]');
  const ctl = await page.$eval('#ask-dock', (e) => ({ label: e.getAttribute('aria-label'), h: Math.round(e.getBoundingClientRect().height) }));
  check('C-dock-ctl', ctl.label === 'Dock' && ctl.h >= 44, JSON.stringify(ctl));

  await page.click('#ask-close');                       // popup closed; open Lab first (baseline)
  await page.click('#lab-open-btn');
  await page.waitForSelector('#lab-dock');
  check('C-lab-open', (await labState(page)).open, 'Lab opened beside the lesson with the chat as a popup');

  await page.click('#ask-fab');
  await page.click('#ask-dock');
  await page.waitForSelector('#chat-dock-slot #ask-panel');
  const cs = await chatState(page), ls = await labState(page);
  check('C-docked', cs.inSlot && cs.mode === 'side' && !ls.open && cs.fabHidden && cs.dockLabel === 'Popup', JSON.stringify({ ...cs, labOpen: ls.open }));
  if (BREAK) await page.evaluate(() => document.querySelector('#lab-open-btn')?.removeAttribute('aria-disabled'));

  const ls2 = await labState(page);
  await page.click('#lab-open-btn').catch(() => {});
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press(']');
  await page.waitForTimeout(400);
  const ls3 = await labState(page);
  const note = await page.$eval('#lab-off-note', (e) => e.textContent).catch(() => '');
  check('C-lab-off', ls2.disabled && ls2.title.length > 0 && ls2.title.length < 80 && !ls3.open && !ls3.href && /Popup/.test(note), JSON.stringify({ disabled: ls2.disabled, title: ls2.title, openAfterClickAndBracket: ls3.open, note }));

  const docked = await turnsInLog(page);
  await page.click('#ask-dock');
  await page.waitForSelector('#ask-panel[data-mode="popup"]');
  const popped = await turnsInLog(page);
  check('C-history', docked === 2 && popped === 2, `turns in log: docked=${docked} popup=${popped} (seeded 2)`);

  const ls4 = await labState(page), cs4 = await chatState(page);
  await page.click('#ask-close');
  await page.click('#lab-open-btn');
  await page.waitForSelector('#lab-dock', { timeout: 5000 }).catch(() => {});
  check('C-popup', !cs4.inSlot && cs4.mode === 'popup' && !ls4.disabled && (await labState(page)).open, JSON.stringify({ inSlot: cs4.inSlot, labDisabled: ls4.disabled, labOpenAfterClick: (await labState(page)).open }));

  await page.click('#ask-fab');
  await page.click('#ask-dock');
  await page.waitForSelector('#chat-dock-slot #ask-panel');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#chat-dock-slot #ask-panel', { timeout: 15_000 }).catch(() => {});
  const rs = await chatState(page), rl = await labState(page);
  check('C-reload', rs.inSlot && rl.disabled && !rl.open && (await turnsInLog(page)) === 2, JSON.stringify({ ...rs, labDisabled: rl.disabled }));
  check('C-noerrors', errors.length === 0, errors.join(' | ').slice(0, 200));
  await ctx.close();
} catch (e) { check('C-harness', false, String(e).slice(0, 300)); }

try {
  const { ctx, page } = await open(1440, { nostore: true });
  await page.click('#ask-fab');
  await page.click('#ask-dock');
  const a = await page.waitForSelector('#chat-dock-slot #ask-panel', { timeout: 5000 }).then(() => true, () => false);
  await page.click('#ask-dock');
  const b = await page.waitForSelector('#ask-panel[data-mode="popup"]', { timeout: 5000 }).then(() => true, () => false);
  check('C-nostore', a && b, `dock=${a} popup=${b} with localStorage throwing`);
  await ctx.close();
} catch (e) { check('C-nostore', false, String(e).slice(0, 300)); }

for (const w of [390, 834, 1440]) {
  try {
    const { ctx, page } = await open(w);
    const base = await page.evaluate(() => document.documentElement.scrollWidth);   // the page's own width (834 has a pre-existing header overflow)
    await page.click('#ask-fab');
    await page.click('#ask-dock');
    await page.waitForSelector('#chat-dock-slot #ask-panel');
    await page.waitForTimeout(500);
    const m = await page.evaluate((base) => {
      const dock = document.querySelector('#chat-dock').getBoundingClientRect();
      const art = document.querySelector('article')?.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > base, dockL: Math.round(dock.left), dockW: Math.round(dock.width), dockH: Math.round(dock.height), artW: art ? Math.round(art.width) : 0, vw: window.innerWidth, vh: window.innerHeight };
    }, base);
    await page.screenshot({ path: path.join(SHOTS, `chat-docked-${w}.png`) });
    const ok = !m.overflow && (w >= 1024 ? m.dockW >= 360 && m.artW >= 360 : m.dockL === 0 && m.dockW >= m.vw - 12 && m.dockH === m.vh);
    check(`C-layout-${w}`, ok, JSON.stringify(m));
    await ctx.close();
  } catch (e) { check(`C-layout-${w}`, false, String(e).slice(0, 300)); }
}

await browser.close();
const bad = results.filter((r) => !r.pass).length;
console.log(`${results.length - bad}/${results.length} pass${bad ? ` — FAILED: ${bad}` : ''}`);
process.exit(bad ? 1 : 0);
