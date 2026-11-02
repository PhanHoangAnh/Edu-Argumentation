#!/usr/bin/env node
/**
 * gate-r-qna.mjs — R-suite: THE Q&A EXAMINER API (study-rooms-qna P2, 29-09-26). Tier 2.
 *
 * Runs against its OWN fresh write harness (run-gates-react.sh starts it with
 * QNA_TEST_DEADLINE_S=10 and QNA_TEST_RETRY_MIN_S=5 — the ONLY process that ever sets them; the
 * live unit never does). The stub upstream (gates/stubs/stub-upstream.py) plays the model through
 * its scripted-reply queue (POST /__script), so every grade the app parses is a reply we chose,
 * and the stub LOG proves how many model calls were made.
 *
 * ⛔ What this proves: the parser, the pass rule (raw score > 8), the bucket, the deadline loop,
 *    the 502 path and the fail-closed OUT_OF_SCOPE mapping. It does NOT prove how the real model
 *    grades or refuses — that is the user's Tier-4 check.
 * ⛔ Each case uses its own X-Real-IP (TEST-NET-3, honoured from the loopback peer) so the per-IP
 *    `qna` bucket (30 / 600 s) is counted per case, never shared by accident.
 *
 * Thirty-nine result lines (RS-COUNT in gate-r-self.mjs moves with this number, always):
 *   QNA-P01..QNA-P18 (parser fault cases) · QNA-Q · QNA-G401 · QNA-G403 · QNA-G429 · QNA-B-SKIP
 *   QNA-A1..QNA-A4 · QNA-NOEFFECT · QNA-UI-NOLOOP · QNA-UI-LOADING (28 -> 30 on 30-09-26: defects B, C)
 *   QNA-SETUP-COUNT · -PERLESSON · -ORDER · -STYLE · -400 · QNA-PASSMARK · QNA-HINT · QNA-UI-SETUP · QNA-UI-REDO
 *   (30 -> 39 on 30-09-26: P2b, the user's setup / redo / pass-mark / hint list)
 */
const BASE = process.env.R_WRITE_BASE || 'http://127.0.0.1:8796';
const STUB = `http://127.0.0.1:${process.env.R_STUB_PORT || '8797'}`;
const STUB_LOG = process.env.R_STUB_LOG || '/var/tmp/edu-write-harness/stub.log';
const SESSION = process.env.R_SESSION || '';
const BOOK = 'geron-homl3';
const BLOCK = 'ch02-b07';

import fs from 'node:fs';

if (!SESSION) { console.error('REFUSING: needs R_SESSION — run via run-gates-react.sh'); process.exit(2); }
if (!STUB_LOG.startsWith('/var/tmp/')) { console.error('REFUSING: stub log not under /var/tmp'); process.exit(2); }

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

let ipN = 0;
const freshIp = () => `203.0.113.${(ipN += 1)}`;

async function post(route, body, { ip = freshIp(), cookie = SESSION, origin } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Real-IP': ip };
  if (cookie) headers.Cookie = `edu_session=${cookie}`;
  if (origin) headers.Origin = origin;
  const r = await fetch(BASE + route, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const stubLog = () => (fs.existsSync(STUB_LOG) ? fs.readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const qnaCalls = (since) => stubLog().slice(since).filter((e) => String(e.kind).startsWith('qna-') || e.kind === 'scripted').length;
async function script(replies) {
  const r = await fetch(`${STUB}/__script`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true, replies }) });
  if (!r.ok) throw new Error(`stub /__script -> ${r.status}`);
}
const grade = (answer = 'my own words') => post('/api/qna/grade', { bookId: BOOK, block: BLOCK, question: 'Explain the idea.', answer });

/* ---- QNA-P01..P18: the parser fault list, each through a scripted model reply ---- */
// [id, label, first reply, expected: {score, pass} | 'reject' | 'garbage']
const CASES = [
  ['QNA-P01', 'fenced JSON ok', '```json\n{"score":9,"right":["a"],"feedback":"ok"}\n```', { score: 9, pass: true }],
  ['QNA-P02', 'prose-wrapped ok', 'Here is the grade: {"score":7,"missing":["b"]} hope it helps', { score: 7, pass: false }],
  ['QNA-P03', 'braces inside a string ok', '{"score":9,"feedback":"use {x} and } carefully"}', { score: 9, pass: true }],
  ['QNA-P04', 'score 8 -> pass false', '{"score":8}', { score: 8, pass: false }],
  ['QNA-P05', 'score 8.01 -> pass true (raw, unrounded)', '{"score":8.01}', { score: 8.01, pass: true }],
  ['QNA-P06', 'score 9 -> pass true', '{"score":9}', { score: 9, pass: true }],
  ['QNA-P07', 'score 10 -> pass true', '{"score":10}', { score: 10, pass: true }],
  ['QNA-P08', 'score 11 -> reject', '{"score":11}', 'reject'],
  ['QNA-P09', 'score -1 -> reject', '{"score":-1}', 'reject'],
  ['QNA-P10', 'score true -> reject', '{"score":true}', 'reject'],
  ['QNA-P11', 'score "9" (string) -> reject', '{"score":"9"}', 'reject'],
  ['QNA-P12', 'score NaN -> reject', '{"score":NaN}', 'reject'],
  ['QNA-P13', 'score Infinity -> reject', '{"score":Infinity}', 'reject'],
  ['QNA-P14', 'arrays missing -> []', '{"score":6,"feedback":"f"}', { score: 6, pass: false, empty: true }],
  ['QNA-P15', 'array of non-str -> reject', '{"score":9,"right":[1,2]}', 'reject'],
  ['QNA-P16', 'top-level list -> reject', '[{"score":9}]', 'reject'],
  ['QNA-P17', 'nested object inside a rejected one -> reject', '{"score":NaN,"x":{"score":9}}', 'reject'],
  ['QNA-P18', 'garbage twice -> 502', 'not json at all', 'garbage'],
];
for (const [id, label, reply, want] of CASES) {
  const before = stubLog().length;
  // A rejected reply is answered by the retry; script the SAME bad reply twice so the retry cannot rescue it.
  await script(typeof want === 'string' ? [{ text: reply }, { text: reply }] : [{ text: reply }]);
  const r = await grade();
  const calls = qnaCalls(before);
  if (typeof want === 'string') {
    check(`${id} ${label}`, r.status === 502 && r.json?.error === 'grade_unavailable' && r.json?.score === undefined && calls === 2,
      `status=${r.status} body=${r.text.slice(0, 80)} modelCalls=${calls} (want 502 grade_unavailable, no score, 2 calls)`);
  } else {
    const j = r.json || {};
    const arraysOk = !want.empty || ['right', 'wrong', 'missing', 'almost'].every((k) => Array.isArray(j[k]) && j[k].length === 0);
    check(`${id} ${label}`, r.status === 200 && j.score === want.score && j.pass === want.pass && arraysOk && calls === 1,
      `status=${r.status} score=${j.score} pass=${j.pass} arrays=${arraysOk} modelCalls=${calls}`);
  }
}
await script([]);

/* ---- QNA-Q: questions come in lesson order, one per block; done past the end; bad ids 400 ---- */
{
  const ip = freshIp();
  const before = stubLog().length;
  const blocks = [BLOCK, 'ch01-b02'];
  const q0 = await post('/api/qna/question', { bookId: BOOK, blocks, index: 0 }, { ip });
  const q1 = await post('/api/qna/question', { bookId: BOOK, blocks, index: 1 }, { ip });
  const q2 = await post('/api/qna/question', { bookId: BOOK, blocks, index: 2 }, { ip });
  const bad = await post('/api/qna/question', { bookId: BOOK, blocks: ['nope'], index: 0 }, { ip });
  const unknown = await post('/api/qna/question', { bookId: BOOK, blocks: ['ch99-b01'], index: 0 }, { ip });
  const noBook = await post('/api/qna/question', { bookId: 'no-such-book', blocks: [BLOCK], index: 0 }, { ip });
  const calls = qnaCalls(before);
  check('QNA-Q question: lesson order (ch01-b02 then ch02-b07), total 2, done at index 2; malformed / unknown block / unknown book -> 400 with no model call',
    q0.status === 200 && q0.json?.block === 'ch01-b02' && q0.json?.total === 2 && typeof q0.json?.question === 'string' && q0.json.question.length > 0
      && typeof q0.json?.lessonTitle === 'string' && q1.json?.block === BLOCK && q2.json?.done === true
      && bad.status === 400 && unknown.status === 400 && noBook.status === 400 && calls === 2,
    `q0=${q0.status}:${q0.json?.block}/${q0.json?.total} q1=${q1.json?.block} q2=${JSON.stringify(q2.json)} bad=${bad.status} unknown=${unknown.status} noBook=${noBook.status} modelCalls=${calls}`);
}

/* ---- QNA-G401: signed out -> 401 on all three ---- */
{
  const codes = [];
  for (const route of ['/api/qna/question', '/api/qna/grade', '/api/qna/ask']) codes.push((await post(route, { bookId: BOOK }, { cookie: '' })).status);
  check('QNA-G401 signed out: question / grade / ask -> 401', codes.every((c) => c === 401), codes.join(' '));
}

/* ---- QNA-G403: a foreign Origin -> 403, before any model call ---- */
{
  const before = stubLog().length;
  const codes = [];
  for (const [route, body] of [['/api/qna/question', { bookId: BOOK, blocks: [BLOCK], index: 0 }],
    ['/api/qna/grade', { bookId: BOOK, block: BLOCK, question: 'q', answer: 'a' }],
    ['/api/qna/ask', { bookId: BOOK, block: BLOCK, question: 'q' }]]) {
    codes.push((await post(route, body, { origin: 'http://evil.example' })).status);
  }
  check('QNA-G403 cross-origin: question / grade / ask -> 403 and 0 model calls', codes.every((c) => c === 403) && qnaCalls(before) === 0,
    `${codes.join(' ')} modelCalls=${qnaCalls(before)}`);
}

/* ---- QNA-G429: 30 calls pass, the 31st is 429 (the qna bucket exists — no KeyError 500) ---- */
{
  const ip = freshIp();
  const before = stubLog().length;
  const codes = [];
  for (let i = 0; i < 31; i += 1) codes.push((await post('/api/qna/ask', { bookId: BOOK, block: BLOCK, question: `q${i}` }, { ip })).status);
  const last = await post('/api/qna/ask', { bookId: BOOK, block: BLOCK, question: 'again' }, { ip });
  const first30 = codes.slice(0, 30).every((c) => c === 200);
  check('QNA-G429 per-IP qna bucket: calls 1-30 -> 200, call 31 -> 429 with retryAfter; 30 model calls, none after the limit',
    first30 && codes[30] === 429 && last.status === 429 && Number(last.json?.retryAfter) > 0 && qnaCalls(before) === 30,
    `first30=${first30} call31=${codes[30]} retryAfter=${last.json?.retryAfter} modelCalls=${qnaCalls(before)}`);
}

/* ---- QNA-B-SKIP: the retry is skipped when the budget is short (deadline 10 s, retry-min 5 s) ---- */
{
  const before = stubLog().length;
  await script([{ text: 'garbage, slowly', delay_s: 6 }, { text: '{"score":9}' }]);
  const t0 = Date.now();
  const r = await grade();
  const secs = (Date.now() - t0) / 1000;
  const calls = qnaCalls(before);
  await script([]);
  check('QNA-B-SKIP first reply garbage after 6 s of a 10 s budget (5 s retry-min) -> retry skipped: 502 grade_unavailable after 1 model call',
    r.status === 502 && r.json?.error === 'grade_unavailable' && calls === 1 && secs < 10,
    `status=${r.status} error=${r.json?.error} modelCalls=${calls} seconds=${secs.toFixed(1)}`);
}

/* ---- QNA-A1..A4: ask-back refusal is fail-closed ---- */
for (const [id, reply, refused] of [
  ['QNA-A1', 'OUT_OF_SCOPE', true],
  ['QNA-A2', ' out_of_scope. ', true],
  ['QNA-A3', 'Sorry — OUT_OF_SCOPE', true],
  ['QNA-A4', 'The theory says strata are subgroups.', false],
]) {
  await script([{ text: reply }]);
  const r = await post('/api/qna/ask', { bookId: BOOK, block: BLOCK, question: 'something' });
  const j = r.json || {};
  const ok = refused
    ? r.status === 200 && j.refused === true && j.answer === 'Not in this theory.'
    : r.status === 200 && j.refused === false && j.answer === reply;
  check(`${id} reply ${JSON.stringify(reply)} -> ${refused ? 'refused, fixed text, no model text' : 'not refused, model text returned'}`, ok,
    `status=${r.status} refused=${j.refused} answer=${JSON.stringify(j.answer)}`);
}
await script([]);

/* ---- QNA-NOEFFECT: a pass writes nothing — /api/progress is byte-identical before and after ---- */
{
  const read = async () => (await fetch(`${BASE}/api/progress?module=${BOOK}`, { headers: { Cookie: `edu_session=${SESSION}` } })).text();
  const before = await read();
  await script([{ text: '{"score":10}' }]);
  const r = await grade();
  const after = await read();
  await script([]);
  check('QNA-NOEFFECT a passing grade (score 10) records nothing: /api/progress identical before and after',
    r.status === 200 && r.json?.pass === true && before === after, `grade=${r.status}/${r.json?.pass} progressSame=${before === after}`);
}

/* ---- P2b (30-09-26, user list): the setup options, the pass mark, the hint ----
   Server contract (addons/qna.py): /question {count, perLesson 1-3, styles[], order book|shuffle,
   seed, difficulty easy|normal|hard} builds ONE deterministic slot list; /grade {passMark 1-9.5};
   /hint {bookId, block, question} -> {hint}. The model prompt carries `STYLE: <style>` and
   `DIFFICULTY: <level>` lines — the stub logs the prompt so the options are proven to arrive. */
const TWO = ['ch01-b02', BLOCK];                      // lesson order: ch01-b02, then ch02-b07
const qAt = (index, extra = {}, ip = freshIp()) => post('/api/qna/question', { bookId: BOOK, blocks: TWO, index, ...extra }, { ip });
const lastQnaPrompt = (since) => stubLog().slice(since).filter((e) => e.kind === 'qna-question').map((e) => e.system || '').pop() || '';
{
  // fails when: the user's total is ignored (always one per lesson) or `done` comes at the wrong index
  const ip = freshIp();
  const opts = { count: 3, perLesson: 2 };
  const [a, b, c, d] = [await qAt(0, opts, ip), await qAt(1, opts, ip), await qAt(2, opts, ip), await qAt(3, opts, ip)];
  check('QNA-SETUP-COUNT the user sets the TOTAL: count 3 over 2 lessons x 2 -> total 3, index 3 is done',
    a.json?.total === 3 && b.json?.total === 3 && c.status === 200 && d.json?.done === true,
    `a=${a.status}/${a.json?.total} b=${b.json?.total} c=${c.status} d=${JSON.stringify(d.json)}`);
}
{
  // fails when: perLesson is ignored, or book order does not keep a lesson's questions together
  const ip = freshIp();
  const opts = { perLesson: 2, order: 'book' };
  const blocks = [];
  for (let i = 0; i < 5; i += 1) blocks.push((await qAt(i, opts, ip)).json);
  check('QNA-SETUP-PERLESSON 2 per lesson, book order -> 4 questions: ch01-b02, ch01-b02, ch02-b07, ch02-b07, then done',
    blocks.slice(0, 4).map((x) => x?.block).join(',') === 'ch01-b02,ch01-b02,ch02-b07,ch02-b07' && blocks[0]?.total === 4 && blocks[4]?.done === true,
    JSON.stringify(blocks.map((x) => x?.block ?? x?.done)));
}
{
  // fails when: shuffle is not applied, or is not reproducible from the session's seed
  const ip = freshIp();
  const many = ['ch01-b01', 'ch01-b02', 'ch01-b03', 'ch01-b04', 'ch01-b05', 'ch01-b06'];
  const run = async (seed) => {
    const out = [];
    for (let i = 0; i < 6; i += 1) out.push((await post('/api/qna/question', { bookId: BOOK, blocks: many, index: i, order: 'shuffle', seed }, { ip })).json?.block);
    return out.join(',');
  };
  const one = await run(12345); const again = await run(12345);
  check('QNA-SETUP-ORDER shuffle is a real reorder of the lessons AND the same seed gives the same order',
    one === again && one !== many.join(',') && one.split(',').sort().join(',') === many.join(','), `seed12345=${one} again=${again}`);
}
{
  // fails when: the chosen style or difficulty never reaches the model prompt, or a style mix is not used
  const ip = freshIp();
  let since = stubLog().length;
  await qAt(0, { styles: ['mistake'], difficulty: 'hard' }, ip);
  const p1 = lastQnaPrompt(since);
  since = stubLog().length;
  const mix = { styles: ['whyhow', 'compare'], perLesson: 2 };
  const m0 = await qAt(0, mix, ip); const m1 = await qAt(1, mix, ip);
  const prompts = stubLog().slice(since).filter((e) => e.kind === 'qna-question').map((e) => e.system || '');
  check('QNA-SETUP-STYLE the chosen style + difficulty reach the model (STYLE: spot the mistake · DIFFICULTY: hard); a mix alternates styles',
    p1.includes('STYLE: spot the mistake') && p1.includes('DIFFICULTY: hard')
      && m0.json?.style === 'whyhow' && m1.json?.style === 'compare'
      && prompts.some((t) => t.includes('STYLE: ask why or how')) && prompts.some((t) => t.includes('STYLE: compare two ideas')),
    `p1=${JSON.stringify(p1.slice(-160))} m0=${m0.json?.style} m1=${m1.json?.style}`);
}
{
  // fails when: a bad option is accepted (and would spend a model call) instead of a 400
  const ip = freshIp();
  const before = stubLog().length;
  const bad = await Promise.all([
    qAt(0, { perLesson: 4 }, ip), qAt(0, { perLesson: 0 }, ip), qAt(0, { count: 0 }, ip), qAt(0, { styles: [] }, ip),
    qAt(0, { styles: ['essay'] }, ip), qAt(0, { order: 'random' }, ip), qAt(0, { difficulty: 'insane' }, ip), qAt(0, { order: 'shuffle', seed: 'x' }, ip),
  ]);
  const calls = qnaCalls(before);
  check('QNA-SETUP-400 invalid setup (perLesson 0/4, count 0, styles empty/unknown, order, difficulty, seed) -> 400 each, no model call',
    bad.every((r) => r.status === 400) && calls === 0, `${bad.map((r) => r.status).join(',')} modelCalls=${calls}`);
}
{
  // fails when: the pass mark is ignored (constant 8), or an out-of-range mark is accepted
  const g = async (passMark, score) => {
    await script([{ text: JSON.stringify({ score }) }]);
    return post('/api/qna/grade', { bookId: BOOK, block: BLOCK, question: 'Explain the idea.', answer: 'my words', passMark });
  };
  const p7 = await g(7, 7.5); const p8 = await g(8, 7.5); const p95 = await g(9.5, 9.6);
  const bad = [await post('/api/qna/grade', { bookId: BOOK, block: BLOCK, question: 'q', answer: 'a', passMark: 0 }),
    await post('/api/qna/grade', { bookId: BOOK, block: BLOCK, question: 'q', answer: 'a', passMark: 10 }),
    await post('/api/qna/grade', { bookId: BOOK, block: BLOCK, question: 'q', answer: 'a', passMark: '8' })];
  await script([]);
  check('QNA-PASSMARK the user pass mark decides on the RAW score: 7.5 > 7 passes, 7.5 > 8 fails, 9.6 > 9.5 passes; 0 / 10 / "8" -> 400',
    p7.json?.pass === true && p8.json?.pass === false && p95.json?.pass === true && p7.json?.passMark === 7 && bad.every((r) => r.status === 400),
    `p7=${p7.status}/${p7.json?.pass} p8=${p8.json?.pass} p9.5=${p95.json?.pass} bad=${bad.map((r) => r.status)}`);
}
{
  // fails when: /api/qna/hint is missing, spends no bucket slot, or returns an empty hint as success
  const ip = freshIp();
  const before = stubLog().length;
  const h = await post('/api/qna/hint', { bookId: BOOK, block: BLOCK, question: 'Explain the idea.' }, { ip });
  const hintCalls = stubLog().slice(before).filter((e) => e.kind === 'qna-hint').length;
  await script([{ text: '' }]);
  const empty = await post('/api/qna/hint', { bookId: BOOK, block: BLOCK, question: 'Explain the idea.' }, { ip });
  await script([]);
  const ip2 = freshIp();
  let last = null;
  for (let i = 0; i < 31; i += 1) last = await post('/api/qna/hint', { bookId: BOOK, block: BLOCK, question: 'q' }, { ip: ip2 });
  check('QNA-HINT one hint = one model call (qna-hint), non-empty; an empty reply -> 502; the 31st hint in the window -> 429 (shared qna bucket)',
    h.status === 200 && typeof h.json?.hint === 'string' && h.json.hint.length > 0 && hintCalls === 1 && empty.status === 502 && last.status === 429,
    `h=${h.status}:${JSON.stringify(h.json)} calls=${hintCalls} empty=${empty.status} 31st=${last.status}`);
}

/* ---- QNA-UI-NOLOOP + QNA-UI-LOADING (30-09-26, defects B and C, in a real browser) ----
   B: a failed question used to auto-retry ~2/s (the hook cleared `busy` BEFORE it set `error`, and
      the auto-fetch effect fired in the gap) and burned the whole 30-call bucket in seconds.
      fails when: more than ONE question request reaches the model before the user presses retry,
      or retry does not send exactly one more.
   C: the Q&A loading state must be the AI-Quiz's own loading panel (reuse, user rule).
      fails when: #qna-loading is absent while a question loads, or its spinner / title / line class
      strings differ from #loading-screen's. */
{
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const host = new URL(BASE).hostname;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'edu_session', value: SESSION, domain: host, path: '/', httpOnly: true, secure: false }]);
  const page = await ctx.newPage();
  // 30-09-26 (defect D): the app has no native dialogs any more (R-RO4); New asks through #app-dialog.
  const nativeDialogs = [];
  page.on('dialog', (d) => { nativeDialogs.push(d.message()); d.dismiss(); });
  const questionCalls = (since) => stubLog().slice(since).filter((e) => e.kind === 'qna-question' || e.kind === 'scripted' || e.kind === 'refused-no-user').length;
  const pickScope = async () => {
    await page.goto(`${BASE}/qna`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#qna-screen:not(.hidden-view)');
    await page.selectOption('#qna-book', BOOK);
    await page.waitForSelector('#qna-tree [data-toggle="0"]', { timeout: 30000 });
    await page.click('#qna-tree [data-toggle="0"]');
    await page.check('#qna-tree input[data-block="ch01-b01"]');
  };
  let noloop = { first: -1, afterRetry: -1, retryShown: false, err: '' };
  try {
    await script(Array.from({ length: 20 }, () => ({ text: '' })));      // every question call -> 502
    await pickScope();
    const since = stubLog().length;
    await page.click('#qna-start-btn');
    await page.waitForTimeout(4000);
    noloop.first = questionCalls(since);
    noloop.retryShown = await page.isVisible('#qna-question-retry-btn');
    if (noloop.retryShown) {
      await page.click('#qna-question-retry-btn');
      await page.waitForTimeout(3000);
    }
    noloop.afterRetry = questionCalls(since);
  } catch (e) { noloop.err = e.message.split('\n')[0]; }
  await script([]);
  check('QNA-UI-NOLOOP a failed question is asked ONCE, then again only on the retry click (fails when the hook auto-retries a failure)',
    noloop.first === 1 && noloop.retryShown && noloop.afterRetry === 2, JSON.stringify(noloop));

  let same = { qna: null, quiz: null, err: '' };
  try {
    if (await page.isVisible('#qna-new-btn')) {
      await page.click('#qna-new-btn');
      await page.click('#app-dialog-confirm', { timeout: 3000 });
    }
    await script([{ text: 'Explain the idea in your own words.', delay_s: 4 }]);
    await pickScope();
    await page.click('#qna-start-btn');
    await page.waitForSelector('#qna-loading', { timeout: 3000 });
    const shape = (root) => page.evaluate((sel) => {
      const r = document.querySelector(sel);
      if (!r) return null;
      return [...r.querySelectorAll(':scope > *, :scope > div > div')].map((e) => `${e.tagName}.${e.className}`).join(' | ');
    }, root);
    same.qna = await shape('#qna-loading');
    same.quiz = await shape('#loading-screen');
  } catch (e) { same.err = e.message.split('\n')[0]; }
  await script([]);
  check('QNA-UI-LOADING the Q&A loading state IS the AI-Quiz loading panel: same spinner, title and line classes (fails when Q&A draws its own loader)',
    same.qna !== null && same.qna === same.quiz && nativeDialogs.length === 0, JSON.stringify({ ...same, nativeDialogs }));

  /* P2b in the browser. Every request body the page sends to /api/qna/* is captured. */
  const bodies = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/qna/') && r.method() === 'POST') {
      try { bodies.push({ path: new URL(r.url()).pathname, body: JSON.parse(r.postData() || '{}') }); } catch { /* not json */ }
    }
  });
  const fresh = async (blocks) => {
    await page.goto(`${BASE}/qna`, { waitUntil: 'networkidle' });
    if (await page.isVisible('#qna-new-btn')) { await page.click('#qna-new-btn'); await page.click('#app-dialog-confirm'); }
    await page.selectOption('#qna-book', BOOK);
    await page.waitForSelector('#qna-tree [data-toggle="0"]', { timeout: 30000 });
    await page.click('#qna-tree [data-toggle="0"]');
    for (const b of blocks) await page.check(`#qna-tree input[data-block="${b}"]`);
  };
  // fails when: any setup control is missing, or its value does not reach the request body
  let setup = { err: '' };
  try {
    await script([]);
    await fresh(['ch01-b01', 'ch01-b02']);
    await page.selectOption('#qna-per-lesson', '2');
    await page.fill('#qna-count', '3');
    await page.uncheck('#qna-styles input[data-style="own"]');
    await page.check('#qna-styles input[data-style="whyhow"]');
    await page.check('#qna-styles input[data-style="mistake"]');
    await page.selectOption('#qna-order', 'shuffle');
    await page.selectOption('#qna-difficulty', 'hard');
    await page.fill('#qna-pass-mark', '7');
    await page.check('#qna-hints');
    const from = bodies.length;
    await page.click('#qna-start-btn');
    await page.waitForSelector('#qna-question', { timeout: 15000 });
    const q = bodies.slice(from).find((x) => x.path === '/api/qna/question')?.body || {};
    await page.click('#qna-hint-btn');
    await page.waitForSelector('#qna-hint', { timeout: 15000 });
    await script([{ text: '{"score":7.5}' }]);
    await page.fill('#qna-answer', 'my words');
    await page.click('#qna-submit-btn');
    await page.waitForSelector('#qna-grade', { timeout: 15000 });
    const g = bodies.slice(from).find((x) => x.path === '/api/qna/grade')?.body || {};
    setup = { q, passMark: g.passMark, hints: bodies.slice(from).filter((x) => x.path === '/api/qna/hint').length,
      status: await page.textContent('#qna-status') };
  } catch (e) { setup.err = e.message.split('\n')[0]; }
  await script([]);
  const sq = setup.q || {};
  check('QNA-UI-SETUP every setup control reaches the server: perLesson 2 · count 3 · styles whyhow+mistake · shuffle + seed · hard · pass mark 7 (7.5 passes) · one hint call',
    sq.perLesson === 2 && sq.count === 3 && JSON.stringify(sq.styles) === '["whyhow","mistake"]' && sq.order === 'shuffle'
      && Number.isInteger(sq.seed) && sq.difficulty === 'hard' && setup.passMark === 7 && setup.hints === 1 && /passed/.test(setup.status || '') && !/not passed/.test(setup.status || ''),
    JSON.stringify(setup));

  // fails when: redo re-asks strong answers, asks the model for a new question, or the result
  // loses the ORIGINAL denominator, or the redo list does not survive a reload
  let redo = { err: '' };
  try {
    await fresh(['ch01-b01', 'ch01-b02', 'ch01-b03']);
    await page.click('#qna-start-btn');
    const answer = async (score, next) => {
      await page.waitForSelector('#qna-question', { timeout: 15000 });
      await script([{ text: JSON.stringify({ score }) }]);
      await page.fill('#qna-answer', `answer scoring ${score}`);
      await page.click('#qna-submit-btn');
      await page.waitForSelector('#qna-grade', { timeout: 15000 });
      const text = await page.textContent('#qna-question');
      await page.click(next);
      return text;
    };
    const t1 = await answer(5, '#qna-next-btn');
    await answer(9, '#qna-proceed-btn');
    const t3 = await answer(6, '#qna-next-btn');
    await page.waitForSelector('#qna-result', { timeout: 10000 });
    const first = await page.textContent('#qna-result');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#qna-redo-btn', { timeout: 10000 });
    const afterReload = await page.textContent('#qna-result');
    const qCallsBefore = bodies.filter((x) => x.path === '/api/qna/question').length;
    await page.click('#qna-redo-btn');
    const r1 = await answer(9, '#qna-proceed-btn');
    const r2 = await answer(8, '#qna-next-btn');           // 8: not weak (>= 7), not a pass (> 8 needed)
    await page.waitForSelector('#qna-result', { timeout: 10000 });
    redo = { first, afterReload, r1Same: r1 === t1, r2Same: r2 === t3, newQuestionCalls: bodies.filter((x) => x.path === '/api/qna/question').length - qCallsBefore,
      final: await page.textContent('#qna-result'), redoLeft: await page.isVisible('#qna-redo-btn') };
  } catch (e) { redo.err = e.message.split('\n')[0]; }
  await script([]);
  check('QNA-UI-REDO scores < 7 go on the redo list; Redo asks ONLY those (cached, 0 new question calls); the result keeps the original 3; the list survives a reload',
    /1 of 3/.test(redo.first || '') && /2 weak/.test(redo.first || '') && redo.afterReload === redo.first && redo.r1Same && redo.r2Same
      && redo.newQuestionCalls === 0 && /2 of 3/.test(redo.final || '') && /0 weak/.test(redo.final || '') && redo.redoLeft === false,
    JSON.stringify(redo));
  await browser.close();
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
