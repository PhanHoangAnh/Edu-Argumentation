// gate-b456.mjs — coverage for B4 / B5 / B6, the three subtlest pieces of quiz logic.
// R1: a SEPARATE file. The 27/12/10 = 49 vector of the three legacy suites is FROZEN;
// nothing here may be added to them.
//
// What is under test (all three are easy to "simplify" into a bug during a rewrite):
//   B4  retry-wrong-only keeps the ORIGINAL denominator. A retry that fixes the last
//       3 of 20 must read 20/20, never 3/3 — otherwise the reader is told they failed
//       an assessment they passed.
//   B5  the prior correct answers are CARRIED, not discarded, across the retry.
//   B6  owningBlockId() reads the FULL set the run started with, never the narrowed
//       retry set. A module-wide quiz whose only misses land in one block must NOT
//       tick that block — the reader never assessed it on its own.
//
// B6 is made DISCRIMINATING on purpose: the quiz is module-wide (multi-block), so a
// correct owningBlockId() returns null and nothing is posted, while the buggy
// narrowed read would return a single block and tick it. A single-block quiz would
// give the same answer either way and prove nothing.
import { chromium } from 'playwright';

const BASE = process.env.GATE_BASE || 'http://127.0.0.1:8791';
const results = [];
const check = (id, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`); };

const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// Capture every progress write. These are the claims the app makes about what the
// reader completed, and B6's whole point is that a retry must not fabricate one.
const posted = [];
await page.route('**/api/progress', async route => {
  const req = route.request();
  if (req.method() === 'POST') {
    try { posted.push(JSON.parse(req.postData() || '{}')); } catch { posted.push({ unparseable: true }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ completed: {}, marked: false }) });
  }
  return route.continue();
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.locator('#nav-quiz').click();
await page.waitForTimeout(600);
// Deliberately TWO blocks, not "All". Two reasons:
//   * "All" is 1,550 questions here — unplayable in a gate.
//   * Two blocks is the smallest run that makes B6 DISCRIMINATING: owningBlockId()
//     over the full set must return null (two blocks), while the buggy narrowed read
//     could return whichever single block the misses happened to land in.
await page.locator('#setup-none-btn').click();
await page.waitForTimeout(300);
const PICKED = ['ch01-b01', 'ch01-b02'];
const picked = await page.evaluate(ids => {
  let n = 0;
  for (const id of ids) {
    const box = document.querySelector(`#setup-tree input[data-block="${id}"]`);
    if (box && !box.checked) { box.click(); n++; }
  }
  return n;
}, PICKED);
await page.waitForTimeout(400);
const setupCount = await page.evaluate(() => document.getElementById('setup-count')?.textContent?.trim() || '');
await page.locator('#setup-start-btn').click();
await page.waitForTimeout(1200);

const onResults = () => page.evaluate(() => {
  const r = document.getElementById('result-screen');
  return !!r && !r.classList.contains('hidden-view');
});
const fraction = () => page.evaluate(() => (document.getElementById('final-fraction')?.textContent || '').trim());
const blocksInRun = () => page.evaluate(() => {
  // How many distinct source blocks the CURRENT on-screen run draws from.
  const el = document.getElementById('quiz-scope-label');
  return (el?.textContent || '').trim();
});

// Walk the whole run, always taking the first option. Some answers land right and some
// wrong, which is exactly the mixed state the retry path needs.
async function playThrough(limit = 200) {
  for (let i = 0; i < limit; i++) {
    if (await onResults()) return i;
    const opt = page.locator('#options-container .option-card').first();
    if (await opt.count()) { await opt.click(); await page.waitForTimeout(220); }
    const next = page.locator('#next-btn');
    if (await next.count() && await next.isVisible()) { await next.click(); await page.waitForTimeout(320); }
    else { await page.waitForTimeout(200); }
  }
  return -1;
}

const answered1 = await playThrough();
const atResults1 = await onResults();
const frac1 = await fraction();
const m1 = /^(\d+)\s*\/\s*(\d+)$/.exec(frac1);
const score1 = m1 ? +m1[1] : -1, total1 = m1 ? +m1[2] : -1;
const scopeLabel1 = await blocksInRun();

check('B456-0 a two-block run reaches results with a readable N/N fraction',
  atResults1 && total1 > 0 && score1 >= 0 && picked === 2,
  `blocksPicked=${picked}/${PICKED.length} setupCount="${setupCount}" answeredSteps=${answered1} results=${atResults1} fraction="${frac1}" scope="${scopeLabel1}"`);

const retryBtn = page.locator('#result-retry-wrong-btn');
const retryVisible = (await retryBtn.count()) > 0 && await retryBtn.isVisible();

// A perfect first pass leaves nothing to retry, so the whole B4/B5/B6 path is
// unreachable. That is NOT a pass — say so loudly rather than green-lighting an
// untested code path.
check('B456-1 the first pass left wrong answers, so the retry path is reachable',
  retryVisible && score1 < total1,
  `retryButtonVisible=${retryVisible} score=${score1}/${total1}` +
  (retryVisible ? '' : ' <- first pass was perfect; this gate cannot exercise the retry path'));

let total2 = -1, score2 = -1, retryCount = -1, frac2 = '(not reached)', retryScopeLabel = '(not reached)';
if (retryVisible) {
  await retryBtn.click();
  await page.waitForTimeout(900);
  // The number of QUESTIONS the retry narrowed to, read from the scope caption
  // ("... retrying N questions"). Counting option cards here would report 4 — the
  // options of the current question — which is a different quantity entirely.
  retryCount = await page.evaluate(() => {
    const txt = (document.getElementById('quiz-scope-label')?.textContent || '');
    // Measured caption form: "2 blocks from 1 chapter · retrying 7 of 10 · 3 already correct"
    const m = /retrying\s+(\d+)\s+of\s+(\d+)/i.exec(txt);
    return m ? +m[1] : -1;
  }).catch(() => -1);
  retryScopeLabel = await blocksInRun();

  await playThrough();
  frac2 = await fraction();
  const m2 = /^(\d+)\s*\/\s*(\d+)$/.exec(frac2);
  score2 = m2 ? +m2[1] : -1; total2 = m2 ? +m2[2] : -1;
}

// ---- B4: the denominator survives the narrowing ----
check('B4 retry-wrong-only keeps the ORIGINAL denominator (never the narrowed count)',
  retryVisible && total2 === total1 && total1 > 0,
  `before="${frac1}" afterRetry="${frac2}" originalTotal=${total1} retryNarrowedToQuestions=${retryCount} retryScope="${retryScopeLabel}" denominatorAfterRetry=${total2}`);

// ---- B5: the earlier correct answers are carried, not thrown away ----
check('B5 prior correct answers are carried across the retry (score never resets)',
  retryVisible && score2 >= score1 && score1 >= 0,
  `scoreBefore=${score1} scoreAfterRetry=${score2} (carried floor is ${score1})`);

// ---- B6a: no progress write may claim the narrowed retry count as its total ----
// ⚠ On a correct build this run posts NOTHING (two blocks => owningBlockId() is null),
// so this check alone would be VACUOUSLY green. It is kept as a guard against a future
// build that starts posting, and B6b below carries the positive proof.
const badPost = posted.find(p => p.total !== undefined && p.total !== total1);
check('B6a no progress write claims the narrowed retry count as its total',
  !badPost,
  badPost ? `OFFENDING POST=${JSON.stringify(badPost)} originalTotal=${total1}`
          : `progressPosts=${posted.length} bodies=${JSON.stringify(posted)} originalTotal=${total1} ` +
            `(NOTE: 0 posts is CORRECT here — 2 blocks means no single block may be ticked)`);

// ---- B6b: the FULL set survived the narrowing — the positive, discriminating proof ----
// owningBlockId() reads fullQuizData. If the retry had overwritten it with the narrowed
// list, Restart (restartQuiz -> resetRunState(fullQuizData)) would replay only the
// narrowed questions. Replaying the ORIGINAL count is direct evidence the full set is
// still there for owningBlockId() to read.
let restartTotal = -1, restartScope = '(not reached)';
if (retryVisible) {
  const rb = page.locator('#restart-btn');
  if ((await rb.count()) && await rb.isVisible()) {
    await rb.click();
    await page.waitForTimeout(1000);
    restartScope = await blocksInRun();
    restartTotal = await page.evaluate(() => {
      const m = /(\d+)\s*$/.exec((document.getElementById('quiz-scope-label')?.textContent || '').replace(/questions?\s*$/i, '').trim());
      return m ? +m[1] : -1;
    });
  }
}
check('B6b Restart replays the FULL original set, not the narrowed retry set',
  restartTotal === total1 && total1 > 0,
  `originalTotal=${total1} retryNarrowedTo=${retryCount} restartReplayed=${restartTotal} scope="${restartScope}"`);

console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
const failed = results.filter(r => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map(r => r.id).join(', '));
await browser.close();
if (failed.length) process.exit(1);
