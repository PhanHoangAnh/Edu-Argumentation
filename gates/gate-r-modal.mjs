#!/usr/bin/env node
/**
 * gate-r-modal.mjs — ITEM E: the quiz-setup picker has an OBVIOUS way out.
 *
 * edu-replatform Phase 03. Tier 2 (browser).
 *
 * ⛔⛔ WHAT WAS MEASURED, AND WHAT IT IS NOT. The final EVL found that while
 *     `#quiz-setup-screen` is open the header nav is not clickable:
 *       [home]       elementFromPoint over #brand-home -> H1                (clickable)
 *       [setup open] elementFromPoint over #brand-home -> DIV.relative ...  (BLOCKED)
 *     `#quiz-setup-screen` is `fixed inset-0 z-[60]`, the header is `z-50`. That layering is
 *     the LEGACY's own (index.html:534) and is correct modal behaviour, so it was classified
 *     a CONCERN, not a FAIL — Escape and Cancel both worked, measured. The learner was never
 *     trapped; the way out simply was not VISIBLE from the top of the dialog, where the
 *     covered nav is.
 *
 * ⛔ THE FIX IS THE **DISMISSAL**, NOT THE LAYERING, and this gate is written to keep it that
 *    way. Two things must not be "fixed" later by moving the modal:
 *      1. `aria-modal="true"` says everything outside the dialog is inert; leaving the nav
 *         clickable makes the DOM contradict the attribute.
 *      2. D-8 — the nav trap that killed EVERY nav control on EVERY screen — was caused by
 *         touching `#primary-nav`'s visibility. R-E4 below asserts `#primary-nav` is NEVER
 *         left `display:none`, so a future "make the nav reachable" change cannot
 *         reintroduce it silently.
 * ⛔ B6/B6b: `#action-container` must stay INSIDE `#quiz-screen`. `createPortal(bar,
 *    document.body)` is banned — `position: fixed` escapes layout but NOT `display: none`.
 *    R-E5 asserts the containment.
 * ⛔ `offsetParent` IS ALWAYS null FOR position:fixed — it reports the open modal as "not
 *    visible". Every visibility test here uses the BOUNDING RECT. (Vacuity #15 in this
 *    program was exactly this idiom.)
 *
 * Run:  node gates/gate-r-modal.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.GATE_BASE || process.env.R_REMOTE || 'http://192.168.100.66:8767';  // P6b 24-09-26: was :8792 (retired)

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

/** Visible == a real box. NEVER offsetParent (null for position:fixed). */
const visible = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { exists: false, w: 0, h: 0, display: null };
  const r = el.getBoundingClientRect();
  return { exists: true, w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display };
}, sel);

const openPicker = async () => {
  await page.goto('about:blank');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('#nav-quiz');
  await page.waitForTimeout(900);
};

const screens = () => page.evaluate(() => [...document.querySelectorAll('[id$="-screen"]')]
  .filter((e) => !e.classList.contains('hidden-view')).map((e) => e.id));

// ── R-E1: the close button EXISTS and is a real, visible box while the picker is open ──
await openPicker();
const pickerOpen = await screens();
const closeBox = await visible('#setup-close-btn');
const cancelBox = await visible('#setup-cancel-btn');
check('R-E1 with the picker open, an explicit CLOSE affordance is visible inside the dialog',
  pickerOpen.includes('quiz-setup-screen') && closeBox.exists && closeBox.w > 0 && closeBox.h > 0
    && cancelBox.exists && cancelBox.w > 0 && cancelBox.h > 0,
  `visibleScreens=${JSON.stringify(pickerOpen)}`
  + ` #setup-close-btn=${closeBox.exists ? `${closeBox.w}x${closeBox.h}` : 'ABSENT'}`
  + ` #setup-cancel-btn=${cancelBox.exists ? `${cancelBox.w}x${cancelBox.h}` : 'ABSENT'}`
  + ' — measured by bounding rect, never offsetParent (always null for position:fixed).');

// ── R-E2: clicking it actually dismisses, and the nav is clickable again after ──
let closeWorked = false, navAfter = null, navClickable = false;
if (closeBox.exists) {
  await page.click('#setup-close-btn');
  await page.waitForTimeout(800);
  navAfter = await screens();
  closeWorked = !navAfter.includes('quiz-setup-screen');
  navClickable = await page.evaluate(() => {
    const b = document.getElementById('brand-home');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && b.contains(hit));
  });
}
check('R-E2 the CLOSE button dismisses the picker, and the header nav is clickable again after',
  closeWorked && navClickable,
  `screensAfterClose=${JSON.stringify(navAfter)} brandHomeHitTestOK=${navClickable}`
  + ' — elementFromPoint over #brand-home must resolve back INSIDE the button.');

// ── R-E3: the pre-existing exits still work — this is an ADDITION, not a replacement ──
await openPicker();
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const afterEsc = await screens();
await openPicker();
await page.click('#setup-cancel-btn');
await page.waitForTimeout(700);
const afterCancel = await screens();
check('R-E3 Escape and Cancel still dismiss the picker (the close button is an ADDITION)',
  !afterEsc.includes('quiz-setup-screen') && !afterCancel.includes('quiz-setup-screen'),
  `afterEscape=${JSON.stringify(afterEsc)} afterCancel=${JSON.stringify(afterCancel)}`);

// ── R-E4: D-8 fence — #primary-nav is NEVER left display:none at desktop width ──
await openPicker();
const navWhileOpen = await visible('#primary-nav');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.click('#nav-settings');
await page.waitForTimeout(600);
const navAfterTwoClicks = await visible('#primary-nav');
check('R-E4 D-8 FENCE: #primary-nav is never display:none at 1440px — not while the picker '
  + 'is open, and not after repeated nav clicks',
  navWhileOpen.display !== 'none' && navAfterTwoClicks.display !== 'none'
    && navAfterTwoClicks.w > 0 && navAfterTwoClicks.h > 0,
  `whilePickerOpen: display=${navWhileOpen.display} box=${navWhileOpen.w}x${navWhileOpen.h}`
  + ` | afterTwoNavClicks: display=${navAfterTwoClicks.display} box=${navAfterTwoClicks.w}x${navAfterTwoClicks.h}`
  + ' — D-8 was the port dropping `if (!isWideMenu())` around setMenuOpen(false), which hid'
  + ' the whole nav on the FIRST desktop nav click and never showed it again.');

// ── R-E5: B6/B6b fence — #action-container stays inside #quiz-screen ──
const containment = await page.evaluate(() => {
  const bar = document.getElementById('action-container');
  const quiz = document.getElementById('quiz-screen');
  return {
    barExists: Boolean(bar),
    quizExists: Boolean(quiz),
    inside: Boolean(bar && quiz && quiz.contains(bar)),
    parentIsBody: Boolean(bar && bar.parentElement === document.body),
  };
});
check('R-E5 B6/B6b FENCE: #action-container is still INSIDE #quiz-screen (createPortal to '
  + 'document.body is banned)',
  containment.barExists && containment.quizExists && containment.inside && !containment.parentIsBody,
  `${JSON.stringify(containment)} — position:fixed escapes LAYOUT but not display:none, so a`
  + ' portalled action bar stops hiding with its screen.');

await browser.close();

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
