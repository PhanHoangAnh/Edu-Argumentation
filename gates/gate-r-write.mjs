#!/usr/bin/env node
/**
 * gate-r-write.mjs — R-suite: THE TEN WRITE ROUTES, at the API. Phase 04, Tier 2.
 *
 * Runs against the WRITE HARNESS (run-gates-react.sh starts it): a second local uvicorn on
 * :8796 with its OWN stores under /var/tmp, whose provider.env points at gates/stubs/
 * stub-upstream.py on :8797 — a loopback stand-in for 9router AND the runner. No real provider
 * budget is spent and no real kernel runs; the stub LOGS what it received, so the model gate
 * asserts BEHAVIOUR, not configuration.
 *
 * ⛔ NEVER the user's stores. R_WRITE_STORES must be under /var/tmp; the gate refuses otherwise.
 *
 * Fifteen result lines (RS-COUNT in gate-r-self.mjs moves with this number, always):
 *   W-ROUTES W-ORIGIN W-CAP W-BUCKET-QUIZ W-BUCKET-ASK W-BUCKET-EXERCISE W-IDEM W-RACE
 *   W-FORMAT W-SECRET W-NORUN W-MODEL W-SETTINGS W-RENAME W-404
 *
 * ⚑ RULING R24 (23-09-26) REMOVED THE CODE RUNNER. Retired in the same change, stated, not left
 *   failing: W-RUN (the proxy's guards + a round trip) became W-NORUN (the three routes are GONE —
 *   a flat 404); W-BUCKET-RUN retired with RUN_HISTORY; the 256 KB /api/run clause left W-CAP.
 *
 * ⛔ THE BUCKETS ARE COUNTED, NOT ASSUMED. Earlier checks consume slots (a /api/run guard test
 *    is admitted to the bucket BEFORE it is validated — edu_server.py:proxy_run). Each bucket
 *    check therefore carries the exact number of slots already used and asserts that the FIRST
 *    429 lands at precisely `limit` — one early is a regression, one late is an unbounded route.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const BASE = process.env.R_WRITE_BASE || 'http://127.0.0.1:8796';
const STORES = process.env.R_WRITE_STORES || '/var/tmp/edu-write-harness/stores';
const STUB_LOG = process.env.R_STUB_LOG || '/var/tmp/edu-write-harness/stub.log';
const TUTOR_MODEL = process.env.R_TUTOR_MODEL || 'edu-tutor';
const SECRETS = ['SECRETVALUE', 'RUNNERSECRET'];   // substrings of the harness's fake credentials

if (!STORES.startsWith('/var/tmp/')) {
  console.error(`REFUSING: R_WRITE_STORES=${STORES} is not under /var/tmp — this gate writes to it.`);
  process.exit(2);
}
const PROGRESS = path.join(STORES, 'progress.json');

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

async function post(route, body, headers = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(BASE + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: raw,
  });
  let json = null;
  const text = await response.text();
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, text };
}
const get = async (route) => {
  const response = await fetch(BASE + route);
  return { status: response.status, text: await response.text() };
};
const sha = (file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'ABSENT');
const stubLog = () => (fs.existsSync(STUB_LOG) ? fs.readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const used = { quiz: 0, ask: 0, exercise: 0 };
const RUN_OK = { module: 'geron-homl3', lesson: 'ch02-b07', session: 'gate-write-session', target: 'c1', cells: [{ id: 'c1', source: 'x = 1' }] };

/* ---- W-ROUTES: every one of the SEVEN answers a well-formed request (R24 removed three) ---- */
const routeCalls = [
  ['/api/progress', { module: 't-gate-routes', block: 'ch01-b01', score: 1, total: 1 }],
  ['/api/book/rename', { file: 'geron-homl3', title: 'Géron (gate)' }],
  ['/api/settings', { ai_question_count: 5 }],
  ['/api/quiz', { module: 'geron-homl3', chapter: 2, block: 7, count: 3 }],
  ['/api/quiz/fresh', { module: 'geron-homl3', count: 5 }],
  ['/api/ask', { module: 'geron-homl3', chapter: 2, block: 7, question: 'what is a stratum?' }],
  ['/api/exercise/grade', { module: 'geron-homl3', chapter: 2, answers: [{ n: 1, question: 'q', answer: 'a' }] }],
];
const routeCodes = [];
for (const [route, body] of routeCalls) routeCodes.push([route, (await post(route, body)).status]);
used.quiz += 2; used.ask += 1; used.exercise += 1;
check('W-ROUTES all SEVEN POST routes answer a well-formed request with 200',
  routeCodes.every(([, c]) => c === 200),
  routeCodes.map(([r, c]) => `${r}=${c}`).join(' '));

/* ---- W-ORIGIN: a foreign Origin is refused BEFORE anything else runs ---- */
const originCodes = [];
for (const [route, body] of routeCalls) originCodes.push([route, (await post(route, body, { Origin: 'http://evil.example' })).status]);
check('W-ORIGIN every POST route refuses a foreign Origin with 403 (and takes no bucket slot)',
  originCodes.every(([, c]) => c === 403),
  originCodes.map(([r, c]) => `${r}=${c}`).join(' '));

/* ---- W-CAP: the two per-route body caps (the 256 KB /api/run cap left with the runner, R24) ---- */
const pad = (n) => JSON.stringify({ module: 'geron-homl3', pad: 'x'.repeat(n) });
const cap8 = await post('/api/progress', pad(9 * 1024));
const cap96 = await post('/api/exercise/grade', pad(97 * 1024));
used.exercise += 0;   // refused at read_json, after the bucket CHECK but before the append
const under = await post('/api/progress', pad(7 * 1024));
check('W-CAP body caps reject 9 KB (default) and 97 KB (/api/exercise/grade) — and admit under the cap',
  cap8.status === 400 && /8 KB/.test(cap8.json?.error || '')
    && cap96.status === 400 && /96 KB/.test(cap96.json?.error || '')
    && under.status === 400 && !/KB/.test(under.json?.error || ''),
  `9KB->${cap8.status} "${cap8.json?.error}" · 97KB->${cap96.status} "${cap96.json?.error}"`
  + ` · 7KB->${under.status} "${under.json?.error}" (a size error on the 7 KB body = the cap is too tight)`);

/* ---- W-NORUN: ruling R24 — the three run routes are GONE, and nothing reaches a runner ---- */
const logBeforeRun = stubLog().length;
const noRun = [];
for (const route of ['/api/run', '/api/run/stop', '/api/run/reset-kernel']) {
  const r = await post(route, RUN_OK);
  noRun.push([route, r.status, r.json?.error]);
}
const runnerCalls = stubLog().slice(logBeforeRun).filter((e) => String(e.kind).startsWith('runner'));
check('W-NORUN /api/run, /api/run/stop, /api/run/reset-kernel are GONE (flat 404 "Unknown API route.") and no runner is contacted',
  noRun.every(([, c, e]) => c === 404 && e === 'Unknown API route.') && runnerCalls.length === 0,
  noRun.map(([r, c]) => `${r}=${c}`).join(' ') + ` runnerCalls=${runnerCalls.length}`);

/* ---- W-IDEM: completing the SAME block twice does not double-count ---- */
for (let b = 1; b <= 14; b += 1) await post('/api/progress', { module: 't-gate-idem', block: `ch01-b${String(b).padStart(2, '0')}`, score: 2, total: 2 });
const count = async (m) => Object.keys(JSON.parse((await get(`/api/progress?module=${m}`)).text).completed).length;
const c14 = await count('t-gate-idem');
await post('/api/progress', { module: 't-gate-idem', block: 'ch01-b15', score: 5, total: 5 });
const c15 = await count('t-gate-idem');
await post('/api/progress', { module: 't-gate-idem', block: 'ch01-b15', score: 5, total: 5 });
const c15b = await count('t-gate-idem');
const notYet = await post('/api/progress', { module: 't-gate-idem', block: 'ch01-b16', score: 4, total: 5 });
const c15c = await count('t-gate-idem');
check('W-IDEM the same lesson twice: 14 -> 15 -> STILL 15; a 4/5 is an honest "not yet" (marked:false, no tick)',
  c14 === 14 && c15 === 15 && c15b === 15 && notYet.json?.marked === false && c15c === 15,
  `14->${c14} +b15->${c15} +b15 again->${c15b} +b16@4/5->${c15c} marked=${notYet.json?.marked}`);

/* ---- W-RACE: the lost-update race is closed for :8792's own threads ---- */
const blocks = Array.from({ length: 20 }, (_, i) => `ch02-b${String(i + 1).padStart(2, '0')}`);
await Promise.all(blocks.map((block) => post('/api/progress', { module: 't-gate-race', block, score: 1, total: 1 })));
const landed = await count('t-gate-race');
check('W-RACE 20 CONCURRENT completions of 20 distinct blocks: all 20 land (a read-modify-write race loses some)',
  landed === 20, `landed=${landed}/20`);

/* ---- W-FORMAT (re-premised, Phase 06a): :8792 NO LONGER WRITES progress.json AT ALL ----
   ⚑ Ruling R25 moved progress to PostgreSQL, per account. The old check (the legacy byte format,
     probe write + reset restores the sha) asserted a write this service must no longer make. The
     new premise: a probe completion + reset leaves progress.json BYTE-IDENTICAL (and present), while
     the completion itself is visible through the API — i.e. it landed in the account store. A
     regression that re-introduces a JSON write changes the sha and goes red. */
const shaBefore = sha(PROGRESS);
await post('/api/progress', { module: 't-progress-probe-md', block: 'ch03-b03', score: 1, total: 1 });
const shaDuring = sha(PROGRESS);
const landedProbe = Object.keys(JSON.parse((await get('/api/progress?module=t-progress-probe-md')).text).completed);
await post('/api/progress', { module: 't-progress-probe-md', reset: true });
const shaAfter = sha(PROGRESS);
const clearedProbe = Object.keys(JSON.parse((await get('/api/progress?module=t-progress-probe-md')).text).completed);
check('W-FORMAT progress.json is never written by :8792 (probe + reset leave it byte-identical) while the probe lands in, and resets from, the account store',
  shaBefore !== 'ABSENT' && shaDuring === shaBefore && shaAfter === shaBefore
    && landedProbe.join() === 'ch03-b03' && clearedProbe.length === 0,
  `before=${shaBefore.slice(0, 12)} during=${shaDuring.slice(0, 12)} after=${shaAfter.slice(0, 12)} landed=${landedProbe} cleared=${clearedProbe.length === 0}`);

/* ---- W-SECRET: no credential value in any response body ---- */
const bodies = [
  (await get('/api/settings')).text,
  (await get('/api/provider')).text,
  (await get('/api/health')).text,
  (await post('/api/settings', { ai_question_count: 5 })).text,
];
const leaked = SECRETS.filter((s) => bodies.some((b) => b.includes(s)));
const providerJson = JSON.parse(bodies[1]);
check('W-SECRET /api/settings, /api/provider, /api/health and the settings SAVE reply carry no key/token VALUE (booleans only)',
  leaked.length === 0 && providerJson.ready === true && JSON.parse(bodies[0]).api_key_set === true,
  `leaked=${JSON.stringify(leaked)} provider.ready=${providerJson.ready} api_key_set=${JSON.parse(bodies[0]).api_key_set}`
  + ' (ready/api_key_set are the floor: a server with NO credential leaks nothing by construction)');

/* ---- W-MODEL: the tutor/quiz/grader SENT the model from provider.env, streamed ---- */
const calls = stubLog().filter((e) => ['quiz', 'ask', 'grade'].includes(e.kind));
const kinds = new Set(calls.map((e) => e.kind));
check(`W-MODEL every provider call SENT model="${TUTOR_MODEL}" with stream:true and a Bearer key (behaviour, read off the wire)`,
  calls.length > 0 && kinds.size === 3 && calls.every((e) => e.model === TUTOR_MODEL && e.stream === true && e.auth === 'Bearer '),
  `calls=${calls.length} kinds=${[...kinds].join(',')} models=${JSON.stringify([...new Set(calls.map((e) => e.model))])}`);

/* ---- W-SETTINGS: a save keeps the key it was not given, and keeps the runner's lines ---- */
const envPath = path.join(STORES, 'provider.env');
const envBefore = fs.readFileSync(envPath, 'utf8');
const saved = await post('/api/settings', { model: TUTOR_MODEL, json_mode: true, ai_question_count: 6 });
const envAfter = fs.readFileSync(envPath, 'utf8');
const keyLine = (t, k) => (t.split('\n').find((l) => l.startsWith(`${k}=`)) || '');
const bad = await post('/api/settings', { ai_question_count: 99 });
const badUrl = await post('/api/settings', { api_url: 'http://example.com/x' });
await post('/api/settings', { ai_question_count: 5 });
check('W-SETTINGS a Save WITHOUT a key keeps the stored key AND the runner lines; out-of-range and non-https are refused',
  saved.status === 200 && saved.json?.ready === true
    && ['EDU_QUIZ_API_KEY', 'EDU_RUNNER_URL', 'EDU_RUNNER_KEY'].every((k) => keyLine(envBefore, k) && keyLine(envBefore, k) === keyLine(envAfter, k))
    && bad.status === 400 && badUrl.status === 400,
  `save=${saved.status} ready=${saved.json?.ready} keptKey=${keyLine(envBefore, 'EDU_QUIZ_API_KEY') === keyLine(envAfter, 'EDU_QUIZ_API_KEY')}`
  + ` keptRunner=${keyLine(envBefore, 'EDU_RUNNER_KEY') === keyLine(envAfter, 'EDU_RUNNER_KEY')} 99->${bad.status} http->${badUrl.status}`);

/* ---- W-RENAME: library-meta.json, never module.json; unknown book refused ---- */
const renamed = await post('/api/book/rename', { file: 'geron-homl3', title: '  My   Géron  ' });
const meta = JSON.parse(fs.readFileSync(path.join(STORES, 'library-meta.json'), 'utf8'));
const listed = JSON.parse((await get('/api/modules')).text).books.find((b) => b.file === 'geron-homl3');
const unknown = await post('/api/book/rename', { file: 'no-such-book', title: 'x' });
const empty = await post('/api/book/rename', { file: 'geron-homl3', title: '   ' });
check('W-RENAME a rename lands in library-meta.json, shows in /api/modules (renamed:true), and refuses an unknown book / blank title',
  renamed.status === 200 && meta.titles['geron-homl3'] === 'My Géron' && listed?.title === 'My Géron' && listed?.renamed === true
    && unknown.status === 400 && empty.status === 400,
  `rename=${renamed.status} meta="${meta.titles['geron-homl3']}" listed="${listed?.title}"/${listed?.renamed} unknown=${unknown.status} blank=${empty.status}`);

/* ---- the four buckets, LAST, counted from the slots already used above ---- */
async function bucket(name, limit, fire) {
  let accepted = used[name];
  let firstRefusal = -1;
  for (let i = 0; i < limit + 3 - used[name]; i += 1) {
    const r = await fire();
    if (r.status === 429) { firstRefusal = accepted; break; }
    if (r.status === 200) accepted += 1;
    else return { ok: false, detail: `unexpected ${r.status} ${r.text.slice(0, 80)}` };
  }
  return { ok: firstRefusal === limit, detail: `pre-used=${used[name]} admitted=${accepted} first-429-at=${firstRefusal} limit=${limit}` };
}
const bq = await bucket('quiz', 20, () => post('/api/quiz', { module: 'geron-homl3', chapter: 2, block: 7, count: 3 }));
check('W-BUCKET-QUIZ REQUEST_HISTORY admits exactly 20 per hour, the 21st is 429', bq.ok, bq.detail);
const ba = await bucket('ask', 60, () => post('/api/ask', { module: 'geron-homl3', chapter: 2, block: 7, question: 'why?' }));
check('W-BUCKET-ASK ASK_HISTORY admits exactly 60 per 10 min, the 61st is 429', ba.ok, ba.detail);
const be = await bucket('exercise', 30, () => post('/api/exercise/grade', { module: 'geron-homl3', chapter: 2, answers: [{ n: 1, question: 'q', answer: 'a' }] }));
check('W-BUCKET-EXERCISE EXERCISE_HISTORY admits exactly 30 per 10 min, the 31st is 429', be.ok, be.detail);

/* ---- W-404: anything outside the ten is the legacy's flat 404 JSON, never a 405 ---- */
const nope = await post('/api/nope', {});
const assetPost = await post('/assets/x.js', {});
check('W-404 a POST outside the ten routes is 404 {"error":"Unknown API route."} (also under the /assets mount)',
  nope.status === 404 && nope.json?.error === 'Unknown API route.' && assetPost.status === 404,
  `/api/nope=${nope.status} ${nope.text} /assets/x.js=${assetPost.status}`);

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
