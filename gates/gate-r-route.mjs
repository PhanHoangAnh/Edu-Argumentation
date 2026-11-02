#!/usr/bin/env node
/**
 * gate-r-route.mjs — R-suite: 9router COMBO PER ACCOUNT AND PER JOB. 23-09-26, Tier 2.
 *
 * The user's ruling (23-09-26):
 *   job                                   | claude_access ON   | claude_access OFF (default)
 *   tutor chat   (/api/ask)               | edu-tutor-claude   | edu-tutor-normal
 *   quiz, fresh quiz, exercise grading    | edu-arg-claude     | edu-arg-normal
 *   legacy :8767 Ask                      | EDU_TUTOR_MODEL, else EDU_QUIZ_MODEL (no accounts there)
 *
 * Runs against a FRESH write harness (run-gates-react.sh starts it; stub upstream on :8797). The
 * stub LOGS the model each call SENT, so every routing check reads the wire, not configuration.
 * The combo names below are harness stand-ins (stub-*) so a pass cannot come from live values.
 *
 * Twelve result lines (RS-COUNT in gate-r-self.mjs moves with this number, always):
 *   M-DEFAULT M-TOGGLE M-NORMAL M-CLAUDE M-SPOOF M-QNA-NORMAL M-QNA-CLAUDE M-FALLBACK
 *   M-SETTINGS-KEEP M-CLI M-LEGACY-TUTOR M-LEGACY-SETTINGS-KEEP
 * ⚑ 10 -> 12 on 29-09-26 (study-rooms-qna P2): M-QNA-NORMAL / M-QNA-CLAUDE — the Q&A examiner's
 *   three calls (question, grade, ask) use the `tutor` job: EDU_MODEL_TUTOR_NORMAL / _CLAUDE (live:
 *   edu-tutor-normal / edu-tutor-claude; here the stub-* stand-ins, read off the wire).
 *
 * ⛔ NEVER the user's stores: R_WRITE_STORES and the legacy scratch dir must be under /var/tmp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const BASE = process.env.R_WRITE_BASE || 'http://127.0.0.1:8796';
const STORES = process.env.R_WRITE_STORES || '/var/tmp/edu-write-harness/stores';
const STUB_LOG = process.env.R_STUB_LOG || '/var/tmp/edu-write-harness/stub.log';
const STUB_PORT = process.env.R_STUB_PORT || '8797';
const OWNER = process.env.R_GATE_OWNER || 'gate-owner';
const READER = process.env.R_GATE_READER || 'gate-reader';
const OWNER_SESSION = process.env.R_SESSION || '';
const PYBIN = process.env.R_PYBIN || '/var/tmp/edu-study-testvenv/bin/python3';
const STAGE_BACKEND = process.env.R_STAGE_BACKEND || '';
const GATE_DB_ENV = process.env.R_GATE_DB_ENV || '';
const LEGACY_DIR = process.env.R_LEGACY_APP || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../aws-quiz-app');
const LIB_ROOT = process.env.R_LIB_ROOT || '/var/tmp/edu-smoke/lib';
const LEGACY_PORT = process.env.R_LEGACY_ROUTE_PORT || '8798';
const LEGACY_DIR_SCRATCH = process.env.R_LEGACY_ROUTE_DIR || '/var/tmp/edu-route-legacy';
const MODULE = 'geron-homl3';

for (const p of [STORES, LEGACY_DIR_SCRATCH]) {
  if (!p.startsWith('/var/tmp/')) { console.error(`REFUSING: ${p} is not under /var/tmp — this gate writes to it.`); process.exit(2); }
}
if (!OWNER_SESSION || !STAGE_BACKEND || !GATE_DB_ENV) {
  console.error('REFUSING: needs R_SESSION, R_STAGE_BACKEND and R_GATE_DB_ENV — run via run-gates-react.sh');
  process.exit(2);
}

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

const COMBOS = {
  EDU_MODEL_TUTOR_CLAUDE: 'stub-tutor-claude',
  EDU_MODEL_TUTOR_NORMAL: 'stub-tutor-normal',
  EDU_MODEL_ARG_CLAUDE: 'stub-arg-claude',
  EDU_MODEL_ARG_NORMAL: 'stub-arg-normal',
};
const QUIZ_MODEL = 'edu-tutor';             // the harness's EDU_QUIZ_MODEL (run-gates-react.sh)
const ENV_PATH = path.join(STORES, 'provider.env');
const baseEnv = fs.readFileSync(ENV_PATH, 'utf8');
const setEnv = (extra) => fs.writeFileSync(ENV_PATH, baseEnv + Object.entries(extra).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });

async function post(route, body, cookie, base = BASE) {
  const r = await fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `edu_session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
async function get(route, cookie) {
  const r = await fetch(BASE + route, { headers: { Cookie: `edu_session=${cookie}` } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json };
}
const stubLog = () => (fs.existsSync(STUB_LOG) ? fs.readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const admin = (args, input = '') => execFileSync(PYBIN, ['-m', 'admin', ...args], {
  cwd: STAGE_BACKEND, env: { ...process.env, EDU_DB_ENV_PATH: GATE_DB_ENV }, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}).trim();

// The four AI jobs, one call each. Returns [{job, status, model}] with the model the STUB received.
const ASK = { module: MODULE, chapter: 2, block: 7, question: 'what is a stratum? [probe routing gate]' };
const QUIZ = { module: MODULE, chapter: 2, block: 7, count: 3 };
const FRESH = { module: MODULE, count: 5, blocks: [[2, 7]] };
const GRADE = { module: MODULE, chapter: 2, answers: [{ n: 1, question: 'q', answer: 'a' }] };
async function fourJobs(cookie, spoof = {}, base = BASE) {
  const out = [];
  for (const [job, route, body] of [['tutor', '/api/ask', ASK], ['quiz', '/api/quiz', QUIZ],
    ['fresh', '/api/quiz/fresh', FRESH], ['grade', '/api/exercise/grade', GRADE]]) {
    const before = stubLog().length;
    const r = await post(route, { ...body, ...spoof }, cookie, base);
    const models = [...new Set(stubLog().slice(before).map((e) => e.model))];
    out.push({ job, status: r.status, model: models.join('|') || 'NONE' });
  }
  return out;
}
const expect = (rows, tutor, arg) => rows.every((r) => r.status === 200 && r.model === (r.job === 'tutor' ? tutor : arg));
const show = (rows) => rows.map((r) => `${r.job}=${r.status}:${r.model}`).join(' ');

const readerSession = admin(['mint-session', '--username', READER, '--ttl', '900']);
const accountsOf = async () => ((await get('/api/accounts', OWNER_SESSION)).json?.accounts || []);
const flagOf = async (u) => (await accountsOf()).find((a) => a.username === u)?.claudeAccess;

try {
  admin(['set-claude-access', '--username', READER, '--off']);

  /* ---- M-DEFAULT: the column exists, is exposed, and a NEW account starts OFF ---- */
  const created = await post('/api/accounts', { username: 'gate-route-new', displayName: 'Route New', password: 'longenough1' }, OWNER_SESSION);
  const list = await accountsOf();
  const me = (await get('/api/auth/me', readerSession)).json?.account;
  check('M-DEFAULT every listed account carries claudeAccess; a NEW account and the reader start OFF; /api/auth/me reports it',
    created.status === 201 && created.json?.account?.claudeAccess === false && list.length >= 3
      && list.every((a) => typeof a.claudeAccess === 'boolean') && me?.claudeAccess === false,
    `create=${created.status} new=${created.json?.account?.claudeAccess} listed=${list.length} me=${me?.claudeAccess}`);

  /* ---- M-TOGGLE: owner only; body validated; unknown user 404 ---- */
  const byReader = await post('/api/accounts/claude-access', { username: READER, on: true }, readerSession);
  const afterReader = await flagOf(READER);
  const badBody = await post('/api/accounts/claude-access', { username: READER, on: 'yes' }, OWNER_SESSION);
  const unknown = await post('/api/accounts/claude-access', { username: 'no-such-user', on: true }, OWNER_SESSION);
  const on = await post('/api/accounts/claude-access', { username: READER, on: true }, OWNER_SESSION);
  const onFlag = await flagOf(READER);
  const off = await post('/api/accounts/claude-access', { username: READER, on: false }, OWNER_SESSION);
  const offFlag = await flagOf(READER);
  check('M-TOGGLE only the owner can toggle (reader 403, flag unchanged); non-boolean 400; unknown user 404; on/off round-trips',
    byReader.status === 403 && afterReader === false && badBody.status === 400 && unknown.status === 404
      && on.status === 200 && on.json?.account?.claudeAccess === true && onFlag === true
      && off.status === 200 && offFlag === false,
    `reader=${byReader.status}/${afterReader} bad=${badBody.status} unknown=${unknown.status} on=${on.status}/${onFlag} off=${off.status}/${offFlag}`);

  setEnv(COMBOS);

  /* ---- M-NORMAL: access OFF -> normal combos, per job ---- */
  const normal = await fourJobs(readerSession);
  check('M-NORMAL access OFF: tutor SENT EDU_MODEL_TUTOR_NORMAL; quiz, fresh quiz and grading SENT EDU_MODEL_ARG_NORMAL',
    expect(normal, COMBOS.EDU_MODEL_TUTOR_NORMAL, COMBOS.EDU_MODEL_ARG_NORMAL), show(normal));

  /* ---- M-CLAUDE: owner turns it ON -> Claude combos on the very next call, no restart ---- */
  await post('/api/accounts/claude-access', { username: READER, on: true }, OWNER_SESSION);
  const claude = await fourJobs(readerSession);
  check('M-CLAUDE access ON (toggled live): tutor SENT EDU_MODEL_TUTOR_CLAUDE; quiz, fresh quiz and grading SENT EDU_MODEL_ARG_CLAUDE',
    expect(claude, COMBOS.EDU_MODEL_TUTOR_CLAUDE, COMBOS.EDU_MODEL_ARG_CLAUDE), show(claude));
  await post('/api/accounts/claude-access', { username: READER, on: false }, OWNER_SESSION);

  /* ---- M-SPOOF: the client cannot choose — body fields are ignored ---- */
  const spoof = await fourJobs(readerSession, { claudeAccess: true, claude_access: true, model: 'evil-model' });
  check('M-SPOOF an OFF account sending {claudeAccess:true, model:"evil-model"} still gets the normal combos (server-side resolution)',
    expect(spoof, COMBOS.EDU_MODEL_TUTOR_NORMAL, COMBOS.EDU_MODEL_ARG_NORMAL), show(spoof));

  /* ---- M-QNA-NORMAL / M-QNA-CLAUDE: the Q&A examiner routes as job `tutor` (P2, 29-09-26) ---- */
  async function qnaJobs(cookie) {
    const out = [];
    for (const [job, route, body] of [
      ['qna-question', '/api/qna/question', { bookId: MODULE, blocks: ['ch02-b07'], index: 0 }],
      ['qna-grade', '/api/qna/grade', { bookId: MODULE, block: 'ch02-b07', question: 'Explain it.', answer: 'my own words [probe routing gate]' }],
      ['qna-ask', '/api/qna/ask', { bookId: MODULE, block: 'ch02-b07', question: 'what is a stratum? [probe routing gate]' }],
    ]) {
      const before = stubLog().length;
      const r = await post(route, body, cookie);
      const models = [...new Set(stubLog().slice(before).map((e) => e.model))];
      out.push({ job, status: r.status, model: models.join('|') || 'NONE' });
    }
    return out;
  }
  const qnaOff = await qnaJobs(readerSession);
  check('M-QNA-NORMAL access OFF: Q&A question, grade and ask SENT EDU_MODEL_TUTOR_NORMAL (job tutor)',
    qnaOff.every((r) => r.status === 200 && r.model === COMBOS.EDU_MODEL_TUTOR_NORMAL), show(qnaOff));
  await post('/api/accounts/claude-access', { username: READER, on: true }, OWNER_SESSION);
  const qnaOn = await qnaJobs(readerSession);
  await post('/api/accounts/claude-access', { username: READER, on: false }, OWNER_SESSION);
  check('M-QNA-CLAUDE access ON: Q&A question, grade and ask SENT EDU_MODEL_TUTOR_CLAUDE (job tutor)',
    qnaOn.every((r) => r.status === 200 && r.model === COMBOS.EDU_MODEL_TUTOR_CLAUDE), show(qnaOn));

  /* ---- M-FALLBACK: an older provider.env keeps working ---- */
  setEnv({});
  const fbOff = await fourJobs(readerSession);
  setEnv({ EDU_TUTOR_MODEL: 'stub-legacy-tutor' });
  await post('/api/accounts/claude-access', { username: READER, on: true }, OWNER_SESSION);
  const fbOn = await fourJobs(readerSession);
  await post('/api/accounts/claude-access', { username: READER, on: false }, OWNER_SESSION);
  check('M-FALLBACK no EDU_MODEL_* keys: everything SENT EDU_QUIZ_MODEL; a Claude tutor falls back to EDU_TUTOR_MODEL first',
    expect(fbOff, QUIZ_MODEL, QUIZ_MODEL) && expect(fbOn, 'stub-legacy-tutor', QUIZ_MODEL),
    `off: ${show(fbOff)} | on+EDU_TUTOR_MODEL: ${show(fbOn)}`);

  /* ---- M-SETTINGS-KEEP: an owner Save on :8792 keeps the routing keys (and any other key) ---- */
  setEnv({ ...COMBOS, EDU_TUTOR_MODEL: 'stub-legacy-tutor', EDU_SOME_FUTURE_KEY: 'kept' });
  const saved = await post('/api/settings', { ai_question_count: 6 }, OWNER_SESSION);
  const after = fs.readFileSync(ENV_PATH, 'utf8');
  const kept = [...Object.entries(COMBOS), ['EDU_TUTOR_MODEL', 'stub-legacy-tutor'], ['EDU_SOME_FUTURE_KEY', 'kept'],
    ['EDU_RUNNER_KEY', null]].filter(([k, v]) => !after.split('\n').some((l) => (v === null ? l.startsWith(`${k}=`) : l === `${k}=${v}`)));
  await post('/api/settings', { ai_question_count: 5 }, OWNER_SESSION);
  check('M-SETTINGS-KEEP a Settings Save on :8792 keeps the four EDU_MODEL_* keys, EDU_TUTOR_MODEL, the runner line and an unknown key',
    saved.status === 200 && kept.length === 0, `save=${saved.status} missing=${JSON.stringify(kept.map(([k]) => k))}`);

  /* ---- M-CLI: python -m admin set-claude-access --on/--off ---- */
  const cliOn = JSON.parse(admin(['set-claude-access', '--username', READER, '--on']));
  const flagOn = await flagOf(READER);
  const cliOff = JSON.parse(admin(['set-claude-access', '--username', READER, '--off']));
  const flagOff = await flagOf(READER);
  let bothRefused = false;
  try { admin(['set-claude-access', '--username', READER, '--on', '--off']); } catch { bothRefused = true; }
  let noneRefused = false;
  try { admin(['set-claude-access', '--username', READER]); } catch { noneRefused = true; }
  check('M-CLI admin set-claude-access flips the flag both ways (read back through the API); --on --off together or neither is refused',
    cliOn.claudeAccess === true && flagOn === true && cliOff.claudeAccess === false && flagOff === false && bothRefused && noneRefused,
    `on=${cliOn.claudeAccess}/${flagOn} off=${cliOff.claudeAccess}/${flagOff} both-refused=${bothRefused} none-refused=${noneRefused}`);

  /* ---- the legacy :8767 server, run locally against the same stub ---- */
  fs.rmSync(LEGACY_DIR_SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(LEGACY_DIR_SCRATCH, { recursive: true });
  const legacyEnvPath = path.join(LEGACY_DIR_SCRATCH, 'provider.env');
  const legacyEnvText = [
    '# Edu-Argumentation provider credentials.',
    '# Written by the in-app Settings page. Mode 600. Never commit this file.',
    `EDU_QUIZ_API_URL=http://127.0.0.1:${STUB_PORT}/v1/chat/completions`,
    'EDU_QUIZ_API_KEY=fake-key-SECRETVALUE-for-gates', `EDU_QUIZ_MODEL=${QUIZ_MODEL}`,
    'EDU_QUIZ_ACCESS_TOKEN=', 'EDU_QUIZ_JSON_MODE=true', 'EDU_TUTOR_MODEL=stub-legacy-tutor',
    'EDU_MODEL_ARG_NORMAL=stub-arg-normal', 'EDU_RUNNER_KEY=fake-runner-RUNNERSECRET-for-gates', '',
  ].join('\n');
  const envFrom = (text) => Object.fromEntries(text.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  async function legacy(withTutor, fn) {
    const text = withTutor ? legacyEnvText : legacyEnvText.replace(/^EDU_TUTOR_MODEL=.*\n/m, '');
    fs.writeFileSync(legacyEnvPath, text, { mode: 0o600 });
    fs.writeFileSync(path.join(LEGACY_DIR_SCRATCH, 'progress.json'), '{}\n');
    fs.writeFileSync(path.join(LEGACY_DIR_SCRATCH, 'settings.json'), '{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n');
    const child = spawn('python3', ['edu_server.py', '--port', LEGACY_PORT, '--directory', LEGACY_DIR], {
      cwd: LEGACY_DIR, stdio: 'ignore',
      env: { ...process.env, ...envFrom(text), EDU_ENV_PATH: legacyEnvPath, EDU_LIBRARY_ROOT: LIB_ROOT,
        EDU_PROGRESS_PATH: path.join(LEGACY_DIR_SCRATCH, 'progress.json'), EDU_SETTINGS_PATH: path.join(LEGACY_DIR_SCRATCH, 'settings.json'),
        EDU_LIBRARY_META_PATH: path.join(LEGACY_DIR_SCRATCH, 'library-meta.json'), EDU_BOOK_ROOT: path.join(LEGACY_DIR_SCRATCH, 'books'),
        EDU_ASK_LOG_PATH: path.join(LEGACY_DIR_SCRATCH, 'ask.jsonl') },
    });
    try {
      const base = `http://127.0.0.1:${LEGACY_PORT}`;
      for (let i = 0; i < 60; i += 1) {
        try { if ((await fetch(`${base}/api/provider`)).ok) break; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      return await fn(base);
    } finally { child.kill(); await new Promise((r) => setTimeout(r, 300)); }
  }
  const legacyRun = async (base) => {
    const rows = await fourJobs('', {}, base);
    return rows;
  };
  const withTutor = await legacy(true, legacyRun);
  const withoutTutor = await legacy(false, legacyRun);
  check('M-LEGACY-TUTOR :8767 Ask SENT EDU_TUTOR_MODEL (quiz, fresh, grading keep EDU_QUIZ_MODEL); without EDU_TUTOR_MODEL Ask falls back to EDU_QUIZ_MODEL',
    expect(withTutor, 'stub-legacy-tutor', QUIZ_MODEL) && expect(withoutTutor, QUIZ_MODEL, QUIZ_MODEL),
    `with: ${show(withTutor)} | without: ${show(withoutTutor)}`);

  const legacySave = await legacy(true, async (base) => {
    const r = await post('/api/settings', { ai_question_count: 6 }, '', base);
    return { status: r.status, after: fs.readFileSync(legacyEnvPath, 'utf8') };
  });
  const lostLegacy = ['EDU_TUTOR_MODEL=stub-legacy-tutor', 'EDU_MODEL_ARG_NORMAL=stub-arg-normal', 'EDU_RUNNER_KEY=fake-runner-RUNNERSECRET-for-gates']
    .filter((line) => !legacySave.after.split('\n').includes(line));
  check('M-LEGACY-SETTINGS-KEEP a Settings Save on :8767 keeps EDU_TUTOR_MODEL, the EDU_MODEL_* keys and the runner line',
    legacySave.status === 200 && lostLegacy.length === 0, `save=${legacySave.status} missing=${JSON.stringify(lostLegacy.map((l) => l.split('=')[0]))}`);
} finally {
  try { admin(['set-claude-access', '--username', READER, '--off']); } catch { /* reported by the checks */ }
  try { admin(['revoke-session'], `${readerSession}\n`); } catch { /* expires in 15 min anyway */ }
  fs.writeFileSync(ENV_PATH, baseEnv, { mode: 0o600 });
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
