// gate-r-auth.mjs — Phase 06a (ruling R25): sign-in, owner-only admin, per-account progress,
// wrong-answer capture, and path routing. Tier 2, against the LOCAL harness (R_BASE) and the
// ISOLATED gate database (edu_study_gate). Never the live :8792, never edu_study.
//
// ⛔ RUN WITHOUT lib/auth-preload.mjs (run-gates-react.sh sets R_NO_PRELOAD=1 for this suite):
//    this suite is ABOUT being signed out, signing in, and who may do what.
// ⛔ Output contract: one line per check, 'PASS  ' / 'FAIL  ' (TWO spaces), exit 1 on any FAIL.
//
// Every check below was made to fail once on purpose (fault injection) before it was trusted —
// see the Phase 06a report's gate table for the injected fault per check.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.R_BASE || 'http://127.0.0.1:8795';
const OWNER = process.env.R_GATE_OWNER || 'gate-owner';
const READER = process.env.R_GATE_READER || 'gate-reader';
const OWNER_PW = process.env.R_GATE_OWNER_PW || '';
const READER_PW = process.env.R_GATE_READER_PW || '';
const LIB = process.env.R_LIB_ROOT || '/var/tmp/edu-smoke/lib';
const GENERIC = 'Username or password is incorrect.';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`);
};

/** Run SQL-free python against the GATE db through the backend's own modules. */
function gateDb(code) {
  if (!/edu-study-gate-db\.env$/.test(process.env.R_GATE_DB_ENV || '')) throw new Error('R_GATE_DB_ENV is not the gate database');
  return execFileSync(process.env.R_PYBIN, ['-c', code], {
    cwd: process.env.R_STAGE_BACKEND,
    env: { ...process.env, EDU_DB_ENV_PATH: process.env.R_GATE_DB_ENV },
    encoding: 'utf8',
  }).trim();
}

const raw = (path, init = {}) => fetch(BASE + path, { redirect: 'manual', ...init });
const post = (path, body, cookie) => raw(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});
async function login(username, password) {
  const r = await post('/api/auth/login', { username, password });
  const set = r.headers.getSetCookie?.() ?? [];
  const cookie = (set.find((c) => c.startsWith('edu_session=')) || '').split(';')[0];
  return { r, set, cookie, body: await r.json().catch(() => ({})) };
}

// ------------------------------------------------------------------ signed out
{
  const codes = {};
  for (const p of ['/api/modules', '/api/progress?module=geron-homl3', '/api/auth/me', '/api/account/stats', '/book/geron-homl3/module.json', '/api/nope']) {
    const r = await raw(p);
    codes[p] = `${r.status}:${(r.headers.get('content-type') || '').split(';')[0]}`;
  }
  const w = await post('/api/progress', { module: 'geron-homl3', block: 'ch01-b01', score: 5, total: 5 });
  codes['POST /api/progress'] = `${w.status}`;
  check('AUTH-1 signed out: every API/data route is 401 JSON (GET and POST)',
    Object.values(codes).every((c) => c === '401:application/json' || c === '401'), JSON.stringify(codes));
}
{
  const a = await raw('/');
  const b = await raw('/geron-homl3/chapter-2/3-some-lesson');
  const la = a.headers.get('location') || '', lb = b.headers.get('location') || '';
  check('AUTH-2 signed out: a page redirects to /login with the page as ?next=',
    a.status === 302 && la.endsWith('/login?next=%2F') && b.status === 302 && lb.endsWith('/login?next=%2Fgeron-homl3%2Fchapter-2%2F3-some-lesson'),
    `/ -> ${a.status} ${la} ; deep -> ${b.status} ${lb}`);
}
{
  const h = await raw('/api/health');
  const l = await raw('/login');
  const html = await l.text();
  check('AUTH-3 public: /api/health and the /login document answer 200 signed out',
    h.status === 200 && l.status === 200 && html.includes('<div id="root"></div>'), `${h.status} ${l.status}`);
}

// ------------------------------------------------------------------ sign-in
{
  const bad = await login(OWNER, 'definitely-not-it');
  const ghost = await login('no-such-user', 'whatever-1234');
  check('AUTH-4 wrong password AND unknown user: 401, the same generic sentence, no cookie',
    bad.r.status === 401 && ghost.r.status === 401 && bad.body.error === GENERIC && ghost.body.error === GENERIC
      && !bad.set.length && !ghost.set.length,
    JSON.stringify({ bad: [bad.r.status, bad.body, bad.set.length], ghost: [ghost.r.status, ghost.body, ghost.set.length] }));
}
const owner = await login(OWNER, OWNER_PW);
const reader = await login(READER, READER_PW);
{
  const c = owner.set.find((s) => s.startsWith('edu_session=')) || '';
  const flags = c.toLowerCase();
  check('AUTH-5 good login: 200, cookie HttpOnly + SameSite=Lax + Path=/ + 30-day Max-Age (not Secure: plain HTTP)',
    owner.r.status === 200 && reader.r.status === 200 && flags.includes('httponly') && flags.includes('samesite=lax')
      && flags.includes('path=/') && flags.includes('max-age=2592000'),
    `${owner.r.status} ${c.replace(/edu_session=[^;]+/, 'edu_session=<redacted>')}`);
}
{
  const me = await (await raw('/api/auth/me', { headers: { Cookie: owner.cookie } })).json();
  const me2 = await (await raw('/api/auth/me', { headers: { Cookie: reader.cookie } })).json();
  check('AUTH-6 /api/auth/me names the signed-in account (and only the owner is owner)',
    me.account?.username === OWNER && me.account?.isOwner === true && me2.account?.username === READER && me2.account?.isOwner === false,
    JSON.stringify({ me, me2 }));
}

// ------------------------------------------------------------------ owner-only
{
  const ol = await raw('/api/accounts', { headers: { Cookie: owner.cookie } });
  const rl = await raw('/api/accounts', { headers: { Cookie: reader.cookie } });
  const rc = await post('/api/accounts', { username: 'sneaky', displayName: 'Sneaky', password: 'longenough1' }, reader.cookie);
  const rs = await post('/api/settings', { model: 'x' }, reader.cookie);
  const oc = await post('/api/accounts', { username: 'gate-extra', displayName: 'Gate Extra', password: 'longenough1' }, owner.cookie);
  const dup = await post('/api/accounts', { username: 'GATE-EXTRA', displayName: 'Dup', password: 'longenough1' }, owner.cookie);
  const list = (await (await raw('/api/accounts', { headers: { Cookie: owner.cookie } })).json()).accounts || [];
  check('AUTH-7 owner-only is SERVER-enforced: reader gets 403 on list, create and settings; owner creates; case-insensitive duplicate 409',
    ol.status === 200 && rl.status === 403 && rc.status === 403 && rs.status === 403 && oc.status === 201 && dup.status === 409
      && list.some((a) => a.username === 'gate-extra') && !list.some((a) => a.username === 'sneaky'),
    JSON.stringify({ ol: ol.status, rl: rl.status, rc: rc.status, rs: rs.status, oc: oc.status, dup: dup.status, n: list.length }));
}

// ------------------------------------------------------------------ per-account progress
{
  const mod = 'geron-homl3';
  await post('/api/progress', { module: mod, reset: true }, owner.cookie);
  await post('/api/progress', { module: mod, reset: true }, reader.cookie);
  const w = await (await post('/api/progress', { module: mod, block: 'ch02-b03', score: 5, total: 5, source: 'written' }, reader.cookie)).json();
  const rp = await (await raw(`/api/progress?module=${mod}`, { headers: { Cookie: reader.cookie } })).json();
  const op = await (await raw(`/api/progress?module=${mod}`, { headers: { Cookie: owner.cookie } })).json();
  check('AUTH-8 progress is per account: a reader completion is the reader\'s and never appears on the owner',
    w.marked === true && Boolean(rp.completed?.['ch02-b03']) && !op.completed?.['ch02-b03'],
    JSON.stringify({ marked: w.marked, reader: Object.keys(rp.completed || {}), owner: Object.keys(op.completed || {}) }));
}
{
  // The store is PostgreSQL now: a completion must not touch the harness's progress.json.
  const file = process.env.R_PROGRESS_PATH;
  const before = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  await post('/api/progress', { module: 'geron-homl3', block: 'ch02-b04', score: 5, total: 5 }, reader.cookie);
  const after = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  check('AUTH-9 :8792 no longer writes progress.json (a completion leaves the file byte-identical)', before === after,
    `progress.json changed at ${file}`);
}

// ------------------------------------------------------------------ wrong answers (API + DB)
{
  const marker = `GATE-WRONG ${Date.now()} — which of these is a regressor?`;
  const opts = ['Linear regression ×', 'k-means', 'PCA', 'DBSCAN'];
  const r = await post('/api/wrong-answers', { module: 'geron-homl3', block: 'ch01-b01', kind: 'ai', question: marker, options: opts, chosen: 2, correct: 0, attempt: 'gate' }, reader.cookie);
  const same = await post('/api/wrong-answers', { module: 'geron-homl3', block: null, kind: 'bank', question: 'x', options: ['a', 'b'], chosen: 1, correct: 1 }, reader.cookie);
  const row = JSON.parse(gateDb(`import db,json; r=db.fetch_one("SELECT a.username, w.question, w.options, w.chosen, w.correct, w.quiz_kind FROM wrong_answers w JOIN accounts a ON a.id=w.account_id WHERE w.question=%s", (${JSON.stringify(marker)},)); print(json.dumps(r, default=str))`));
  check('AUTH-10 a wrong answer is stored with the FULL question text and options, for its account; a "right" one is refused',
    r.status === 201 && same.status === 400 && row && row.username === READER && row.question === marker
      && JSON.stringify(row.options) === JSON.stringify(opts) && row.chosen === 2 && row.correct === 0 && row.quiz_kind === 'ai',
    JSON.stringify({ status: r.status, same: same.status, row }));
}

// ------------------------------------------------------------------ import (idempotent)
{
  const tmp = '/var/tmp/p6a-gate-import-progress.json';
  const doc = { version: 2, modules: { 'geron-homl3': { completed: {
    'ch05-b01': { at: '2026-09-01T10:00:00+00:00', score: 5, total: 5, source: 'written' },
    'ch05-b02': { at: '2026-09-02T10:00:00+00:00', score: 5, total: 5, source: 'ai' } } },
    'f-sagemaker-clarify': { completed: { 'ch01-b01': { at: '2026-09-03T10:00:00+00:00', score: 3, total: 3, source: 'written' } } } } };
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  const sha0 = execFileSync('sha256sum', [tmp], { encoding: 'utf8' }).split(' ')[0];
  const run = () => JSON.parse(execFileSync(process.env.R_PYBIN, ['-m', 'admin', 'import-progress', '--username', 'gate-extra'], {
    cwd: process.env.R_STAGE_BACKEND, encoding: 'utf8',
    env: { ...process.env, EDU_DB_ENV_PATH: process.env.R_GATE_DB_ENV, EDU_PROGRESS_PATH: tmp },
  }));
  const first = run();
  const second = run();
  const sha1 = execFileSync('sha256sum', [tmp], { encoding: 'utf8' }).split(' ')[0];
  check('AUTH-11 import: rows == progress.json entries (3), a second run inserts 0, and the file is never written',
    first.entries === 3 && first.inserted === 3 && first.rows_for_account === 3 && second.inserted === 0 && second.rows_for_account === 3 && sha0 === sha1,
    JSON.stringify({ first, second, same: sha0 === sha1 }));
  fs.rmSync(tmp, { force: true });
}

// ------------------------------------------------------------------ routing + UI (browser)
const browser = await chromium.launch({ executablePath: process.env.GATE_CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Read from INSIDE the page: Playwright's page.url() can lag a history.replaceState under load.
const path = () => page.evaluate(() => location.pathname);
// ⚑ 24-09-26 (plan D9): the title reads "<n>. <term>". titleRaw() is the whole text; title() strips the
//   number so the term compares exactly as before, and each check below ALSO asserts the number.
const titleRaw = () => page.evaluate(() => document.getElementById('tutorial-main-title')?.textContent?.trim() || '');
const title = async () => (await titleRaw()).replace(/^\d+\.\s/, '');
const numbered = async (n) => (await titleRaw()).startsWith(`${n}. `);
const bank = JSON.parse(fs.readFileSync(`${LIB}/geron-homl3/module.json`, 'utf8'));
const term = (ci, bi) => String(bank.tutorialData.sections[ci].items[bi].term || '');

{
  await page.goto(`${BASE}/geron-homl3/chapter-2/3-stale-words`, { waitUntil: 'networkidle' });
  const atLogin = (await path()) === '/login';
  await page.fill('#login-username', READER);
  await page.fill('#login-password', 'wrong-wrong-wrong');
  await page.press('#login-password', 'Enter');
  await page.waitForTimeout(700);
  const alert = await page.textContent('#login-status');
  const noCookie = !(await ctx.cookies()).some((c) => c.name === 'edu_session');
  await page.fill('#login-password', READER_PW);
  await page.press('#login-password', 'Enter');
  await page.waitForLoadState('networkidle');
  // Bounded wait for the canonical slug (the book is a multi-MB download); the assertion is unchanged.
  await page.waitForFunction(() => /^\/geron-homl3\/chapter-2\/3-/.test(location.pathname) && !location.pathname.includes('stale-words'), null, { timeout: 5000 }).catch(() => {});
  const canonical = (await path()).startsWith('/geron-homl3/chapter-2/3-') && !(await path()).includes('stale-words');
  check('AUTH-12 browser: deep link -> /login; wrong password shows the generic alert, sets no cookie; right password returns to the lesson, slug canonicalised',
    atLogin && alert?.trim() === GENERIC && noCookie && canonical && (await title()) === term(1, 2) && (await numbered(3)),
    JSON.stringify({ atLogin, alert, noCookie, path: (await path()), title: await title() }));
}
{
  await page.goto(`${BASE}/#chapter=1&block=8`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('AUTH-13 legacy #chapter=1&block=8 is rewritten to its path and opens that lesson (B15 retired)',
    /^\/geron-homl3\/chapter-1\/8-/.test((await path())) && !page.url().includes('#') && (await title()) === term(0, 7) && (await numbered(8)),
    `${page.url()} ${await title()}`);
}
{
  await page.goto(`${BASE}/geron-homl3/chapter-3/2-this-is-the-wrong-title`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const fixed = (await path());
  const lenBefore = await page.evaluate(() => history.length);
  await page.goto(`${BASE}/no-such-book/chapter-1/1-x`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('AUTH-14 a wrong lesson slug is replaced by the canonical one; an unknown book slug goes home (/)',
    /^\/geron-homl3\/chapter-3\/2-/.test(fixed) && !fixed.includes('wrong-title') && (await path()) === '/' && lenBefore > 0,
    `${fixed} -> unknown -> ${(await path())}`);
}
{
  await page.goto(`${BASE}/geron-homl3/chapter-4/5-anything`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const doc = await raw((await path()), { headers: { Cookie: reader.cookie } });
  check('AUTH-15 refresh on a deep path: 200 app document and the same lesson', doc.status === 200
    && /^\/geron-homl3\/chapter-4\/5-/.test((await path())) && (await title()) === term(3, 4) && (await numbered(5)), `${doc.status} ${(await path())} ${await title()}`);
}
{
  await page.goto(`${BASE}/geron-homl3/chapter-2/1-x`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('#next-block-btn'); await page.waitForTimeout(600);
  await page.click('#next-block-btn'); await page.waitForTimeout(600);
  const third = (await path());
  await page.goBack(); await page.waitForTimeout(700);
  const back = [(await path()), await title()];
  await page.goForward(); await page.waitForTimeout(700);
  check('AUTH-16 Back and Forward move lesson by lesson (path AND content)',
    /\/chapter-2\/3-/.test(third) && /\/chapter-2\/2-/.test(back[0]) && back[1] === term(1, 1) && (await path()) === third && (await title()) === term(1, 2) && (await numbered(3)),
    JSON.stringify({ third, back, fwd: (await path()) }));
}
{
  const signedIn = await raw('/api/nope', { headers: { Cookie: reader.cookie } });
  const body = await signedIn.json().catch(() => null);
  check('AUTH-17 signed in: an unknown /api path is 404 JSON, never the app document', signedIn.status === 404 && body?.error === 'Unknown API route.',
    `${signedIn.status} ${JSON.stringify(body)}`);
}
{
  // Wrong answer through the REAL quiz UI, then counted on the Account page.
  const count = () => Number(gateDb(`import db; r=db.fetch_one("SELECT count(*) AS n FROM wrong_answers w JOIN accounts a ON a.id=w.account_id WHERE a.username=%s AND w.quiz_kind='bank'", (${JSON.stringify(READER)},)); print(r['n'])`));
  const before = count();
  await page.goto(`${BASE}/geron-homl3/chapter-1/1-x/quiz`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const onQuiz = /\/chapter-1\/1-.*\/quiz$/.test((await path())) && (await page.evaluate(() => document.getElementById('quiz-screen')?.offsetParent !== null));
  const shown = await page.evaluate(() => {
    const v = document.querySelector('#question-text rich-text-viewer');
    return (v?.shadowRoot?.textContent || document.getElementById('question-text')?.textContent || '').replace(/\s+/g, ' ').trim();
  });
  const q = bank.quizData.find((x) => x.source?.block === 'ch01-b01' && shown.includes(String(x.question).replace(/\s+/g, ' ').trim().slice(0, 40)));
  const wrongIndex = q ? (q.correct === 0 ? 1 : 0) : 0;
  await page.click(`#options-container .option-card >> nth=${wrongIndex}`);
  await page.waitForTimeout(1000);
  const after = count();
  const stored = q ? gateDb(`import db; r=db.fetch_one("SELECT question FROM wrong_answers ORDER BY id DESC LIMIT 1"); print(r['question'])`) : '';
  await page.click('#nav-account');
  await page.waitForTimeout(1500);
  const shownTotal = Number((await page.textContent('#account-wrong-total'))?.trim());
  const adminHidden = !(await page.$('#account-admin'));
  check('AUTH-18 a wrong pick in the quiz UI is recorded (full text) and counted on the Account page; the reader sees no Accounts admin',
    onQuiz && Boolean(q) && after === before + 1 && stored === String(q?.question) && (await path()) === '/account' && shownTotal >= after && adminHidden,
    JSON.stringify({ onQuiz, found: Boolean(q), before, after, stored: stored.slice(0, 50), path: (await path()), shownTotal, adminHidden }));
}
{
  // Owner sees the admin section and its list.
  const octx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await octx.addCookies([{ name: 'edu_session', value: owner.cookie.split('=')[1], url: BASE }]);
  const op = await octx.newPage();
  await op.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await op.waitForTimeout(1500);
  const rows = await op.$$eval('#account-list [data-account]', (els) => els.map((e) => e.getAttribute('data-account')));
  check('AUTH-19 the owner\'s Account page shows the Accounts admin with every account',
    rows.includes(OWNER) && rows.includes(READER) && rows.includes('gate-extra'), JSON.stringify(rows));
  await octx.close();
}
{
  // Sign out: the cookie is cleared AND the session row is gone (the BROWSER's own session — the
  // Node-side login above holds a different one and must survive this sign-out).
  const browserToken = (await ctx.cookies()).find((c) => c.name === 'edu_session')?.value || '';
  await page.click('#account-signout-btn');
  await page.waitForTimeout(1200);
  const stale = await raw('/api/auth/me', { headers: { Cookie: `edu_session=${browserToken}` } });
  const other = await raw('/api/auth/me', { headers: { Cookie: reader.cookie } });
  check('AUTH-20 sign out: back on /login, the browser cookie is cleared, its session is dead server-side, and another session of the same account is untouched',
    Boolean(browserToken) && (await path()) === '/login' && stale.status === 401 && other.status === 200
      && !(await ctx.cookies()).some((c) => c.name === 'edu_session' && c.value),
    `${(await path())} token=${Boolean(browserToken)} stale=${stale.status} other=${other.status}`);
}
await browser.close();
check('AUTH-21 no page errors during the browser checks', errors.length === 0, errors.slice(0, 3).join(' | '));

// ------------------------------------------------------------------ rate limit (LAST: it locks this IP out)
{
  // The window is per client IP across the whole suite: AUTH-4 (2) and AUTH-12 (1) already spent
  // failures, so the lock-out may come before the 6th try here. What must hold: once 429 appears it
  // stays, no more than 5 failures are ever accepted in the window, and even the RIGHT password is
  // refused while locked.
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push((await login('gate-extra', `nope-${i}-xxxx`)).r.status);
  const locked = await login('gate-extra', 'longenough1');
  const first = codes.indexOf(429);
  check('AUTH-22 sign-in rate limit: at most 5 failures per IP per 5 min, then 429 — even for the right password',
    first >= 0 && first <= 5 && codes.slice(0, first).every((c) => c === 401) && codes.slice(first).every((c) => c === 429) && locked.r.status === 429,
    JSON.stringify({ codes, locked: locked.r.status }));
}

console.log(failed ? `\nFAILED: ${failed}` : '\nALL PASS');
process.exit(failed ? 1 : 0);
