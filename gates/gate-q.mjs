// Portable resolution: `playwright` is a dependency of gates/package.json, so node
// resolves it from gates/node_modules on any machine. No absolute path.
import { chromium } from 'playwright';
const BASE = process.env.GATE_BASE || 'http://127.0.0.1:8791';
const results = [];
const check = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`); };

// GATE_CHROME overrides; otherwise playwright resolves its own pinned revision,
// honouring PLAYWRIGHT_BROWSERS_PATH (works on the Mac's ~/Library cache too).
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.route('**/api/provider', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ ready: true, model: 'edu-tutor', token_required: false }) }));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// start a quiz
await page.locator('#nav-quiz').click();
await page.waitForTimeout(600);
await page.locator('#setup-all-btn').click();
await page.locator('#setup-start-btn').click();
await page.waitForTimeout(1000);

// E5: nothing is measured unless it is really on screen with a non-zero box.
const visible = async (sel) => page.evaluate(s => {
  const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
}, sel);

const geom = () => page.evaluate(() => {
  const q = document.getElementById('quiz-screen');
  const bar = document.querySelector('#action-container .action-bar-inner');
  const qr = q.getBoundingClientRect();
  let barInner = null, barBox = null;
  if (bar) {
    const br = bar.getBoundingClientRect(); const cs = getComputedStyle(bar);
    barBox = { w: br.width, h: br.height };
    barInner = br.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }
  const opts = [...document.querySelectorAll('#options-container .option-card')]
    .map(e => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; });
  return { quiz: Math.round(qr.width), quizH: Math.round(qr.height), bar: barInner === null ? null : Math.round(barInner), barBox, vw: window.innerWidth, opts };
});

// ---- Q1a: the quiz column uses the width it has, at 1920 and 1440 ----
for (const w of [1920, 1440]) {
  await page.setViewportSize({ width: w, height: 1000 });
  await page.waitForTimeout(400);
  const vis = await visible('#quiz-screen');
  const g = await geom();
  check(`Q1a quiz column uses the available width at ${w}`,
    vis && g.quizH > 0 && g.quiz > 1024 && g.quiz >= g.vw - 40,
    `visible=${vis} quiz=${g.quiz} vw=${g.vw} h=${g.quizH}`);
}

// ---- Q1b: the pinned bar's content box equals the question column ----
// Answer one question so the action bar is shown.
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(300);
await page.locator('#options-container .option-card').first().click();
await page.waitForTimeout(700);
for (const w of [1920, 1440]) {
  await page.setViewportSize({ width: w, height: 1000 });
  await page.waitForTimeout(400);
  const visBar = await visible('#action-container .action-bar-inner');
  const visQuiz = await visible('#quiz-screen');
  const g = await geom();
  check(`Q1b action bar inner width == question column at ${w}`,
    visBar && visQuiz && g.barBox && g.barBox.w > 0 && g.barBox.h > 0 && g.bar !== null && Math.abs(g.bar - g.quiz) <= 1,
    `visibleBar=${visBar} barInner=${g.bar} quiz=${g.quiz} (diff=${g.bar === null ? 'n/a' : Math.round(g.bar - g.quiz)})`);
}

// ---- Q2a: 2 per row at >=1024 ----
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(400);
{
  const g = await geom();
  const allVisible = g.opts.length === 4 && g.opts.every(o => o.w > 0 && o.h > 0);
  const twoPerRow = allVisible && g.opts[0].top === g.opts[1].top && g.opts[2].top === g.opts[3].top && g.opts[0].top !== g.opts[2].top;
  check('Q2a four options lay out 2 per row at 1440',
    twoPerRow, `tops=${JSON.stringify(g.opts.map(o => o.top))} sizes=${JSON.stringify(g.opts.map(o => o.w + 'x' + o.h))}`);
  // Equal-height rows. Asserting on the question AS RENDERED is vacuous: these four
  // options happen to be the same length, so the check passed even with stretch
  // switched off (fault-proof FP7, 21-09-26). Lengthen ONE option first, so the two
  // cards in the row genuinely disagree about their natural height.
  await page.evaluate(() => {
    const t = document.querySelectorAll('#options-container .option-card .option-text')[0];
    t.innerHTML += ' ' + 'padding words to force this option to wrap onto several more lines than its neighbour. '.repeat(4);
  });
  await page.waitForTimeout(300);
  const g2 = await geom();
  const natural = await page.evaluate(() => {
    const c = document.querySelectorAll('#options-container .option-card');
    return [...c].map(e => Math.round(e.firstElementChild.getBoundingClientRect().height));
  });
  const uneven = natural[0] > natural[1] + 20;   // the row really is lopsided now
  check('Q2a2 side-by-side options are the same height (no ragged row)',
    uneven && g2.opts.length === 4 && g2.opts.every(o => o.h > 0)
    && g2.opts[0].h === g2.opts[1].h && g2.opts[2].h === g2.opts[3].h,
    `cardHeights=${JSON.stringify(g2.opts.map(o => o.h))} naturalContent=${JSON.stringify(natural)} uneven=${uneven}`);
}

// ---- Q2b: one per row at 390 ----
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
{
  const g = await geom();
  const allVisible = g.opts.length === 4 && g.opts.every(o => o.w > 0 && o.h > 0);
  const tops = g.opts.map(o => o.top);
  check('Q2b one option per row at 390',
    allVisible && new Set(tops).size === 4, `tops=${JSON.stringify(tops)} sizes=${JSON.stringify(g.opts.map(o => o.w + 'x' + o.h))}`);
}

// ---- Q2c: the reveal animation still works ----
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForTimeout(300);
await page.locator('#quiz-new-btn').click();
await page.waitForTimeout(400);
await page.locator('#setup-all-btn').click();
await page.locator('#setup-start-btn').click();
await page.waitForTimeout(1000);
const explH = () => page.evaluate(() => {
  const e = document.querySelector('#options-container .option-card .explanation-inner');
  const t = document.querySelector('#options-container .option-card .explanation-text');
  return { inner: e ? Math.round(e.getBoundingClientRect().height) : -1,
           wrap: t ? Math.round(t.getBoundingClientRect().height) : -1,
           expanded: t ? t.classList.contains('expanded') : null };
});
const before = await explH();
await page.locator('#options-container .option-card').first().click();
await page.waitForTimeout(1200);
const after = await explH();
// Closed is NOT 0: `grid-template-rows: 0fr` floors at the track's min-content,
// and .explanation-inner carries pt-4+pb-6 = 40px of padding even when empty.
// Measured 41px closed on the PRE-CHANGE file too, so that is the baseline, not a
// regression. The contract is: closed == padding only, open == padding + text.
check('Q2c explanation reveal still animates open',
  before.expanded === false && before.wrap <= 45
  && after.expanded === true && after.wrap > 100 && after.wrap > before.wrap * 2.5,
  `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

// ---- Q2d: no horizontal overflow ----
for (const [w, h] of [[390, 844], [834, 1112], [1440, 900], [1920, 1080]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  const vis = await visible('#options-container');
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`Q2d no sideways scroll at ${w}px`, vis && ov <= 1, `visible=${vis} overflow=${ov}px`);
}

console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
const failed = results.filter(r => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map(r => r.id).join(', '));
await browser.close();
if (failed.length) process.exit(1);
