// gate-r-ask-live.mjs — LIVE tutor check for :8792, SIGNED IN (Phase 06a).
//
// WHY: 23-09-26 the user saw the Ask panel "spin forever" on :8792. Measured: the request DID reach
// the server; the model router's first model (edu-tutor combo) stalled without erroring, so the
// router never fell back and the server gave up at its 120 s model timeout (502). This gate proves,
// on the LIVE service, that a signed-in ask (1) reaches the server, (2) returns an answer, and
// (3) takes a time comparable to :8767 asked the same probe question.
//
// ⛔ NOT part of run-gates-react.sh: it spends two real model calls and writes two lines to the live
//    ask log (tagged "[gate-r-ask-live]"). Run it by hand after a deploy:
//        node gates/gate-r-ask-live.mjs
// ⛔ It never uses a user's password or question. It signs in with a 120-second machine session
//    minted on nn by the admin CLI (purpose='gate') and REVOKES it before exiting.
// Output: 'PASS  ' / 'FAIL  ' lines (two spaces), exit 1 on any FAIL.
import { execFileSync } from 'node:child_process';

const HOST = process.env.ASK_HOST || 'nn';
// ⚑ P6b 24-09-26: the new app took over :8767 and :8792 is retired. There is no live legacy any
//   more, so ASK-4 needs ASK_OLD pointed at a locally served legacy edu_server.py to mean anything.
const NEW = process.env.ASK_NEW || 'http://192.168.100.66:8767';
const OLD = process.env.ASK_OLD || 'http://192.168.100.66:8767';
const BACKEND = '/srv/foxai/edu-study/backend';
const PY = '/home/ubuntu/edu-study-venv/bin/python';
const LIMIT_S = Number(process.env.ASK_LIMIT_S || 90);

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};
const ssh = (cmd, input) => execFileSync('ssh', [HOST, cmd], { input, encoding: 'utf8' }).trim();

const token = ssh(`cd ${BACKEND} && ${PY} -m admin mint-session --ttl 120`);
const question = `[gate-r-ask-live ${new Date().toISOString()}] In one sentence, what is a label in supervised learning?`;
const body = JSON.stringify({ module: 'geron-homl3', chapter: 1, block: 1, question, history: [] });
const ask = async (base, cookie) => {
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/api/ask`, {
      method: 'POST', body, signal: AbortSignal.timeout(150_000),
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `edu_session=${cookie}` } : {}) },
    });
    return { status: r.status, json: await r.json().catch(() => ({})), s: (Date.now() - t0) / 1000 };
  } catch (e) {
    return { status: 0, json: { error: String(e) }, s: (Date.now() - t0) / 1000 };
  }
};

try {
  const since = ssh('date -u +%H:%M:%S');
  const signedOut = await ask(NEW, '');
  const fresh = await ask(NEW, token);
  const legacy = await ask(OLD, '');
  const journal = ssh(`journalctl -u foxai-edu-study --since ${since} --no-pager | grep -c 'POST /api/ask HTTP/1.1" 200' || true`);
  const logged = ssh(`grep -F ${JSON.stringify(question.slice(0, 45))} ~/foxai-data/edu-argumentation/logs/ask.jsonl | grep -c '"via": "8792", "account": [0-9]*, "username": "' || true`);
  check('ASK-1 signed out, :8792 refuses the tutor (401), never reaching the model', signedOut.status === 401, `status=${signedOut.status}`);
  check('ASK-2 signed in, the ask REACHES the :8792 server (journal shows a 200 POST /api/ask)', Number(journal) >= 1, `journal 200s=${journal}`);
  check('ASK-3 signed in, :8792 returns an answer with a source badge',
    fresh.status === 200 && (fresh.json.answer || '').length > 20 && Boolean(fresh.json.source),
    `status=${fresh.status} source=${fresh.json.source} chars=${(fresh.json.answer || '').length} err=${fresh.json.error || ''}`);
  check(`ASK-4 time-to-answer is comparable: :8792 under ${LIMIT_S}s and not more than 30s slower than :8767 on the same question`,
    fresh.s < LIMIT_S && fresh.s - legacy.s < 30,
    `:8792=${fresh.s.toFixed(1)}s :8767=${legacy.s.toFixed(1)}s (:8767 status=${legacy.status})`);
  check('ASK-5 the :8792 ask is logged with the account that asked (account id + username)', Number(logged) === 1, `:8792 log lines for this probe carrying an account=${logged}`);
} finally {
  ssh(`cd ${BACKEND} && ${PY} -m admin revoke-session`, `${token}\n`);
}
console.log(failed ? `\nFAILED: ${failed}` : '\nALL PASS');
process.exit(failed ? 1 : 0);
