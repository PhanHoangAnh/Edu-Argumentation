#!/usr/bin/env node
/**
 * gate-r-sep.mjs — R-suite: SERVICE SEPARATION + the three defect fixes Phase 02 handed
 * forward with no file to live in. Tier 1/2, runs over `ssh nn`. No browser.
 *
 * edu-replatform Phase 03, checklist E0c / E0d / E0f / E0h.
 *
 * WHY THIS FILE EXISTS
 *   "The three services stay separate" is a standing-law invariant of this program and it
 *   had NO COMMAND ANYWHERE before Phase 03 PVL cycle 0 (FAIL F-6) — in the very phase that
 *   adds routes to :8792. G16 / G17 / E4 from Phase 02 likewise exist only as inline `ssh nn`
 *   lines inside a COMPLETED phase artifact; they are carried forward here instead of
 *   rewriting a finished plan.
 *
 * ⛔ ASSERT LoadState/ActiveState/SubState BEFORE READING MainPID.
 *   `systemctl show -p MainPID --value <nonexistent>` prints 0 and EXITS 0. Two Phase-02
 *   gates passed against a service that did not exist because of exactly that.
 *
 * ⛔ DO NOT PARSE `systemctl show --value` POSITIONALLY BY FLAG ORDER.
 *   Measured 21-09-26: `-p LoadState -p ActiveState -p SubState -p MainPID --value` printed
 *   `3233505 loaded active running` — systemd emits its OWN order, not the flag order. This
 *   gate therefore uses the `Key=Value` form and parses BY KEY.
 *
 * ⛔ THE PID BASELINE 3233505 / 3224633 / 3221182 IS ADVISORY ONLY (execute instruction E14).
 *   The assertion is THREE DISTINCT NON-ZERO values. Step C restarts :8767 by design, so
 *   pinning equality would make a correct deploy red — the stale-literal class this program
 *   has already hit four times.
 */
import { execFileSync } from 'node:child_process';

const HOST = process.env.EDU_HOST || 'nn';
// ⚑ P6b 24-09-26 (user): the new app took over :8767; the legacy unit is STOPPED + DISABLED (not
//   masked, not deleted — it is the rollback) and :8792 is retired. The LIVE pair is study + importer.
const UNITS = [
  ['foxai-edu-importer', 8769],
  ['foxai-edu-study', 8767],
];
const LEGACY_UNIT = 'foxai-edu-argumentation';
const RETIRED_PORT = 8792;
// E0c: the :8767 unit FILE is untouched. Anchored on content sha256, never on MainPID and
// never on ActiveEnterTimestamp — a legitimate restart moves both, and Step C restarts it.
// mtime 2026-09-14 09:12:08 is ADVISORY ONLY and is deliberately not asserted.
const UNIT_8767_SHA = '8ba65cb3abf37cdf794b337ae916b95356776804b7f74a9e6ded828ef28df48b';
const CRED_VARS = ['EDU_QUIZ_API_KEY', 'EDU_QUIZ_ACCESS_TOKEN', 'EDU_RUNNER_KEY', 'EDU_ADMIN_TOKEN'];

const results = [];
const check = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

function ssh(cmd) {
  try {
    return execFileSync('ssh', ['-o', 'ConnectTimeout=15', HOST, cmd], {
      encoding: 'utf8', timeout: 90_000,
    });
  } catch (e) {
    return `SSH_FAILED: ${(e.stderr || e.message || '').toString().trim()}`;
  }
}

/* ---- R-SEP1: study + importer running, legacy stopped+disabled. Asserted BEFORE any PID read. ---- */
const show = {};
for (const unit of [...UNITS.map(([u]) => u), LEGACY_UNIT]) {
  const out = ssh(`systemctl show -p LoadState -p ActiveState -p SubState -p MainPID -p UnitFileState ${unit}`);
  const kv = {};
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  show[unit] = kv;
}
const liveness = UNITS.map(([u]) => {
  const k = show[u];
  return { u, ok: k.LoadState === 'loaded' && k.ActiveState === 'active' && k.SubState === 'running', k };
});
const notLive = liveness.filter((l) => !l.ok);
const lg = show[LEGACY_UNIT];
// loaded (NOT masked: a masked unit reads LoadState=masked), inactive, disabled — the rollback stays one start away.
const legacyRetired = lg.LoadState === 'loaded' && lg.ActiveState === 'inactive' && lg.UnitFileState === 'disabled';
check(
  'R-SEP1 study + importer loaded+active+running; the legacy unit loaded+inactive+disabled (not masked) (asserted BEFORE MainPID is read)',
  notLive.length === 0 && legacyRetired,
  liveness.map((l) => `${l.u}=${l.k.LoadState || '?'}/${l.k.ActiveState || '?'}/${l.k.SubState || '?'}`).join(' ')
    + ` ${LEGACY_UNIT}=${lg.LoadState || '?'}/${lg.ActiveState || '?'}/${lg.UnitFileState || '?'}`,
);

/* ---- R-SEP2: DISTINCT NON-ZERO MainPIDs (ruling R5), and each port is held by ITS unit's PID ---- */
const pids = UNITS.map(([u]) => Number(show[u].MainPID || 0));
const distinct = new Set(pids.filter((p) => p > 0));
const listeners = ssh(`ss -ltnpH '( sport = :8767 or sport = :8769 or sport = :${RETIRED_PORT} )'`);
const ownerOf = (port) => {
  const line = listeners.split('\n').find((l) => new RegExp(`:${port}\\s`).test(l)) || '';
  const m = line.match(/pid=(\d+)/);
  return m ? Number(m[1]) : 0;
};
const portOk = UNITS.every(([u, port]) => ownerOf(port) === Number(show[u].MainPID || -1));
const retiredOpen = ownerOf(RETIRED_PORT) !== 0 || new RegExp(`:${RETIRED_PORT}\\s`).test(listeners);
check(
  'R-SEP2 DISTINCT NON-ZERO MainPIDs for :8767 (study) and :8769 (importer), each port held by its own unit, and NOTHING on the retired :8792',
  notLive.length === 0 && pids.every((p) => p > 0) && distinct.size === 2 && portOk && !retiredOpen,
  `pids=${pids.join('/')} distinct=${distinct.size} 8767->${ownerOf(8767)} 8769->${ownerOf(8769)} ${RETIRED_PORT}->${retiredOpen ? 'LISTENING' : 'closed'}`,
);

/* ---- R-SEP3 / E0f: the study unit carries NO EnvironmentFile= ---- */
// E15: `grep -c` EXITS 1 WHEN THE COUNT IS 0 — i.e. on this gate's PASSING case. The count is
// captured and compared as a NUMBER; `|| true` keeps a passing gate from aborting the shell.
const envCount = ssh(
  `grep -c '^EnvironmentFile=' /etc/systemd/system/foxai-edu-study.service || true`,
).trim();
check(
  'R-SEP3 the study unit (:8767) declares ZERO EnvironmentFile= (no credential reaches the new stack)',
  envCount === '0',
  `EnvironmentFile= count=${JSON.stringify(envCount)} (grep -c exits 1 on 0 — captured, not exit-code-tested)`,
);

/* ---- R-SEP4: no credential variable in the :8792 process environment ---- */
const studyPid = Number(show['foxai-edu-study'].MainPID || 0);
// ⛔ NON-VACUITY FLOOR. A refused /proc read yields ZERO lines, and "0 credential hits" out of
// zero readable variables is green for the wrong reason. Proven real 21-09-26: :8767 pid
// 3233505 => 3 credential hits of 18 readable vars; :8792 pid 3221182 => 0 of 16. The gate
// therefore asserts the read RETURNED something before trusting the count of zero.
const environRead = studyPid > 0
  ? ssh(`sudo -n tr '\\0' '\\n' < /proc/${studyPid}/environ 2>/dev/null | ` +
        `awk 'END{print NR}END{}' ; sudo -n tr '\\0' '\\n' < /proc/${studyPid}/environ 2>/dev/null | ` +
        `grep -cE '^(${CRED_VARS.join('|')})=' || true`).trim().split('\n')
  : ['0', 'NO_PID'];
const envTotal = Number(environRead[0] || 0);
const credHits = (environRead[1] ?? '').trim();
// The unit file is the DECLARATION that would have to carry an inline credential. It cannot
// see one arriving through EnvironmentFile= — that channel is R-SEP3's job, and only both
// together close the surface.
const unitCred = ssh(
  `grep -cE '(${CRED_VARS.join('|')})' /etc/systemd/system/foxai-edu-study.service || true`,
).trim();
check(
  'R-SEP4 the study process (:8767) carries no EDU_QUIZ_* / EDU_RUNNER_* / EDU_ADMIN_TOKEN (live /proc environ)',
  unitCred === '0' && envTotal > 0 && credHits === '0',
  `unit-file inline hits=${JSON.stringify(unitCred)} process-environ hits=${JSON.stringify(credHits)} ` +
  `of ${envTotal} readable vars (floor: envTotal>0, or a refused read reads green)`,
);

/* ---- R-CARRY-LEGACYUNIT (E0c / Phase-02 F-1) — P6b: the legacy unit FILE is the rollback, kept byte-untouched ---- */
const sha8767 = ssh('sha256sum /etc/systemd/system/foxai-edu-argumentation.service').trim().split(/\s+/)[0];
check(
  'R-CARRY-LEGACYUNIT the legacy unit FILE (foxai-edu-argumentation, the rollback) is byte-untouched (sha256, not MainPID, not timestamp)',
  sha8767 === UNIT_8767_SHA,
  `got=${sha8767} pinned=${UNIT_8767_SHA}`,
);

/* ---- R-CARRY-ROOTDIV (E0d / Phase-02 F-3) ---- */
// TAG INCLUDED. The bare attribute `id="root"` is satisfiable by an HTML COMMENT — proven.
// Target is the DEPLOYED React build's index.html, not a Phase-02 artifact.
const WEB_INDEX = process.env.EDU_STUDY_WEB_INDEX || '/srv/foxai/edu-study/web/index.html';
const rootDiv = ssh(`grep -c '<div id="root"' ${WEB_INDEX} || true`).trim();
check(
  'R-CARRY-ROOTDIV the React build serves a real <div id="root" (TAG INCLUDED, not the bare attribute)',
  Number(rootDiv) >= 1,
  `matches=${JSON.stringify(rootDiv)} in ${WEB_INDEX} (bare id="root" is satisfiable by a comment — the tag is the assertion)`,
);

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.id).join(', '));
if (failed.length) process.exit(1);
