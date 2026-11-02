// Portable resolution: `playwright` is a dependency of gates/package.json, so node
// resolves it from gates/node_modules on any machine. No absolute path.
import { chromium } from 'playwright';
const BASE = process.env.GATE_BASE || 'http://127.0.0.1:8791';
const results = [];
const check = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`); };

// GATE_CHROME overrides; otherwise playwright resolves its own pinned revision,
// honouring PLAYWRIGHT_BROWSERS_PATH (works on the Mac's ~/Library cache too).
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));

// Provider is stubbed ready: the AI-quiz gate is about the BUTTON's state machine,
// not about whether this test box can reach a model.
await page.route('**/api/provider', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ ready: true, model: 'edu-tutor', token_required: false }) }));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// ---------- HOME ----------
const importBtns = await page.locator('#services-section a, #services-section label').allInnerTexts();
check('G1 one Import button, no Upload JSON',
  importBtns.filter(t => t.trim()).length === 1 && /import/i.test(importBtns.join('|')) && !/upload/i.test(importBtns.join('|')),
  `buttons=${JSON.stringify(importBtns.map(t => t.trim()).filter(Boolean))}`);

const importHref = await page.locator('#import-book-link').getAttribute('target');
check('G2 Import opens in a new tab', importHref === '_blank', `target=${importHref}`);

// G3 REWRITTEN 21-09-26. It was named "library ordered, open book first" but only
// asserted order.length > 1 -- vacuous: it passed on both the hoisting code and the
// fixed code. The real contract is lastReadAt desc -> addedAt desc -> title, and the
// open book must NOT be hoisted to index 0 (A3). The open book here is the default
// (geron-homl3); the book that leads by recency is a DIFFERENT one (demo-book has a
// non-zero lastReadAt), so this assertion fails on the old sort key. That is its
// fault-proof, and it is why the check deliberately does not use the leading book.
const order = await page.$$eval('#library-grid [data-book]', els => els.map(e => e.dataset.book));
const openNow = await page.$$eval('#library-grid [data-book]', els => {
  const e = els.find(x => x.getAttribute('aria-current') === 'true'); return e ? e.dataset.book : null; });
const apiBooks = (await (await page.request.get(`${BASE}/api/modules`)).json()).books;
const expectedOrder = [...apiBooks].sort((a, b) =>
  (Number(b.lastReadAt) || 0) - (Number(a.lastReadAt) || 0)
  || (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0)
  || a.title.localeCompare(b.title)).map(b => b.file);
const leadsByRecency = expectedOrder[0];
check('G3 library ordered by recency, open book not hoisted',
  order.length > 1
  && JSON.stringify(order) === JSON.stringify(expectedOrder)
  && openNow !== null && openNow !== leadsByRecency && order[0] !== openNow,
  `order=${JSON.stringify(order.slice(0, 3))} expected=${JSON.stringify(expectedOrder.slice(0, 3))} open=${openNow}`);

// ---------- DESELECT ----------
const openBook = await page.locator('#library-grid [data-book][aria-current="true"]').first();
const openFile = await openBook.getAttribute('data-book');
await openBook.click();
await page.waitForTimeout(600);
const welcomeVisible = await page.locator('#welcome-screen').isVisible();
const emptyVisible = await page.locator('#welcome-empty').isVisible();
const bodyVisible = await page.locator('#welcome-body').isVisible();
check('G4 deselect keeps the panel, empties it',
  welcomeVisible && emptyVisible && !bodyVisible, `panel=${welcomeVisible} empty=${emptyVisible} body=${bodyVisible}`);

// reopen
await page.locator(`#library-grid [data-book="${openFile}"]`).click();
await page.waitForTimeout(900);
check('G5 reopening the same book restores it',
  await page.locator('#welcome-body').isVisible(), `book=${openFile}`);

// ---------- RENAME ----------
const titleEl = page.locator(`#library-grid [data-rename="${openFile}"]`).first();
const before = (await titleEl.innerText()).trim();
await titleEl.dblclick();
await page.waitForTimeout(250);
const inputShown = await page.locator('#library-grid input[type="text"]').count();
const renamed = `${before} (gate)`;
if (inputShown) {
  await page.locator('#library-grid input[type="text"]').fill(renamed);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
}
const afterApi = await (await page.request.get(`${BASE}/api/modules`)).json();
const stored = (afterApi.books.find(b => b.file === openFile) || {}).title;
check('G6 double-click rename persists to the server',
  inputShown === 1 && stored === renamed, `input=${inputShown} stored=${JSON.stringify(stored)}`);
// put it back
await page.request.post(`${BASE}/api/book/rename`, { data: { file: openFile, title: before }, headers: { Origin: BASE } });

// ---------- READER ----------
await page.locator('#read-tutorial-btn').click();
await page.waitForTimeout(900);

const geo = await page.evaluate(() => {
  const scr = document.getElementById('tutorial-screen').getBoundingClientRect();
  const toc = document.getElementById('toc-panel').getBoundingClientRect();
  const art = document.getElementById('tutorial-article').getBoundingClientRect();
  const cs = el => getComputedStyle(el);
  return {
    vh: window.innerHeight, scrBottom: scr.bottom, scrTop: scr.top,
    gap: Math.round(art.left - toc.right),
    tocRadius: cs(document.getElementById('toc-panel')).borderTopLeftRadius,
    artRadius: cs(document.getElementById('tutorial-article')).borderTopLeftRadius,
    tocLeft: Math.round(toc.left), artRight: Math.round(art.right), vw: window.innerWidth,
    artScrolls: document.getElementById('tutorial-article').scrollHeight > document.getElementById('tutorial-article').clientHeight + 2,
  };
});
// G7/G8/G10 REWRITTEN 21-09-26 for the 6px inset + rounded panes (A2). The old
// assertions (flush to the edge, radius exactly 0px) assert the OPPOSITE of what
// the user asked for; they are updated here, not deleted.
check('G7 reader fills to the bottom of the viewport (6px inset + 1px border)',
  Math.abs(geo.scrBottom - geo.vh) <= 8, `bottom=${Math.round(geo.scrBottom)} vh=${geo.vh}`);
check('G8 panes have rounded corners',
  geo.tocRadius !== '0px' && geo.artRadius !== '0px'
  && parseFloat(geo.tocRadius) > 0 && parseFloat(geo.artRadius) > 0,
  `toc=${geo.tocRadius} article=${geo.artRadius}`);
check('G9 there is a gap between the two panes', geo.gap >= 4 && geo.gap <= 24, `gap=${geo.gap}px`);
check('G10 panes are inset 6px from the window edge',
  Math.abs(geo.tocLeft - 6) <= 1 && Math.abs((geo.vw - geo.artRight) - 6) <= 1,
  `left=${geo.tocLeft} rightInset=${geo.vw - geo.artRight}`);
check('G11 the reading pane scrolls on its own', geo.artScrolls === true, `scrollable=${geo.artScrolls}`);

const tocBtn = await page.evaluate(() => {
  const b = document.getElementById('toc-toggle-btn');
  return { text: b.innerText.trim(), label: b.getAttribute('aria-label') };
});
check('G12 Contents button is the hamburger only',
  tocBtn.text === '' && tocBtn.label === 'Contents', `text=${JSON.stringify(tocBtn.text)} aria-label=${tocBtn.label}`);

const removed = await page.evaluate(() => ({
  lead: Boolean(document.getElementById('tutorial-lead')),
  chapterLabel: Boolean(document.getElementById('theory-chapter-label')),
  blockPos: Boolean(document.getElementById('theory-block-position')),
  articleText: document.getElementById('tutorial-article').innerText.slice(0, 400),
}));
check('G13 duplicated chapter/block + "N theory blocks · pages" lines are gone',
  !removed.lead && !removed.chapterLabel && !removed.blockPos && !/theory blocks\s*·\s*pages/i.test(removed.articleText),
  `lead=${removed.lead} chapterLabel=${removed.chapterLabel} blockPos=${removed.blockPos}`);

const tocCount = await page.evaluate(() => {
  const el = [...document.querySelectorAll('#toc-nav summary div')].find(d => /\d+ of \d+ blocks/.test(d.textContent));
  return el ? el.textContent.trim() : null;
});
check('G14 the page range moved next to the sidebar block count',
  Boolean(tocCount && /\d+ of \d+ blocks · pages? \d+/.test(tocCount)), `sidebar=${JSON.stringify(tocCount)}`);

const row = await page.evaluate(() => {
  const ids = ['prev-block-btn', 'tutorial-to-quiz-btn', 'block-ai-quiz-btn', 'next-block-btn'];
  const r = ids.map(id => { const e = document.getElementById(id); const b = e.getBoundingClientRect();
    return { id, top: Math.round(b.top), h: Math.round(b.height), fs: getComputedStyle(e).fontSize, disabled: e.disabled }; });
  return r;
});
const tops = new Set(row.map(r => r.top));
const heights = new Set(row.map(r => r.h));
const sizes = new Set(row.map(r => r.fs));
check('G15 the four reader buttons share one row', tops.size === 1, `tops=${JSON.stringify([...tops])}`);
check('G16 the four reader buttons are one size', heights.size === 1 && sizes.size === 1, `h=${[...heights]} fs=${[...sizes]}`);
check('G17 AI quiz is enabled with a provider and a book open',
  row.find(r => r.id === 'block-ai-quiz-btn').disabled === false,
  `disabled=${row.find(r => r.id === 'block-ai-quiz-btn').disabled}`);

// ---------- EXERCISE BLOCK ----------
const ex = await page.evaluate(async () => {
  // jump to the exercise lesson of chapter 1 (the last block of chapter 1)
  const chapters = window.location;
  return null;
});
await page.evaluate(() => {
  const nav = document.querySelectorAll('#toc-nav details');
  const last = nav[0].querySelectorAll('ol li button');
  last[last.length - 1].click();
});
await page.waitForTimeout(700);
const exBtns = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#tutorial-content button')]
    // A hidden button measures 0x0; "Retry the wrong ones" is display:none until
    // something is marked wrong, so only VISIBLE actions are compared.
    .filter(b => /submit|clear|start over|retry/i.test(b.textContent) && b.getBoundingClientRect().height > 0);
  return btns.map(b => { const r = b.getBoundingClientRect();
    return { t: b.textContent.trim().slice(0, 24), h: Math.round(r.height), w: Math.round(r.width), fs: getComputedStyle(b).fontSize, px: getComputedStyle(b).paddingLeft }; });
});
if (exBtns.length >= 2) {
  const hs = new Set(exBtns.map(b => b.h)), fss = new Set(exBtns.map(b => b.fs)), pxs = new Set(exBtns.map(b => b.px));
  check('G18 exercise action buttons are one size',
    hs.size === 1 && fss.size === 1 && pxs.size === 1, JSON.stringify(exBtns));
} else {
  check('G18 exercise action buttons are one size', false, `only found ${exBtns.length} action buttons`);
}

// ---------- QUIZ SETUP DIALOG ----------
await page.locator('#nav-quiz').click();
await page.waitForTimeout(600);
const dlgOverHome = await page.locator('#quiz-setup-screen').isVisible();
check('G19 the picker opens as a dialog', dlgOverHome, `visible=${dlgOverHome}`);
await page.locator('#setup-all-btn').click();
await page.locator('#setup-start-btn').click();
await page.waitForTimeout(900);
const qId = () => page.evaluate(() => document.getElementById('question-number-badge').textContent + '|' + document.getElementById('question-text').innerHTML.slice(0, 80));
const qText1 = await qId();
await page.locator('#quiz-new-btn').click();
await page.waitForTimeout(500);
const dlgOverQuiz = await page.locator('#quiz-setup-screen').isVisible();
const quizStillThere = await page.locator('#quiz-screen').isVisible();
await page.locator('#setup-cancel-btn').click();
await page.waitForTimeout(500);
const qText2 = await qId();
const dlgClosed = !(await page.locator('#quiz-setup-screen').isVisible());
check('G20 New opens the picker over the running quiz, Cancel returns to it',
  dlgOverQuiz && quizStillThere && dlgClosed && qText1 === qText2 && qText1.length > 0,
  `dialog=${dlgOverQuiz} quizKept=${quizStillThere} closed=${dlgClosed} sameQuestion=${qText1 === qText2}`);

// Escape also closes
await page.locator('#quiz-new-btn').click();
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('G21 Escape closes the picker', !(await page.locator('#quiz-setup-screen').isVisible()), 'escape');

// ---------- HORIZONTAL SPACE + RESPONSIVE ----------
const widths = await page.evaluate(() => ({
  quiz: Math.round(document.getElementById('quiz-screen').getBoundingClientRect().width),
  vw: window.innerWidth,
}));
check('G22 the quiz column uses the width it has', widths.quiz >= 900, `quiz=${widths.quiz} of ${widths.vw}`);

for (const [w, h] of [[390, 844], [834, 1112], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`G23 no sideways scroll at ${w}px`, overflow <= 1, `overflow=${overflow}px`);
}
await page.setViewportSize({ width: 390, height: 844 });
// Below md the nav is a dropdown behind #menu-btn, so clicking #nav-learn directly
// just waits out the actionability timeout. Open the menu first.
await page.locator('#menu-btn').click().catch(() => {});
await page.waitForTimeout(200);
await page.locator('#nav-learn').click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(600);
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('G24 reader has no sideways scroll on a phone', mobileOverflow <= 1, `overflow=${mobileOverflow}px`);

check('G25 no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gates green`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.id).join(', ')); process.exit(1); }
