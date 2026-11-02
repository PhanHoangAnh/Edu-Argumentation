# Edu-Argumentation gate suite

The safety net for the re-platform. These gates are the only thing standing between a
3,662-line frontend rewrite and silent breakage.

**There is no test suite in this repo.** Nothing here is a unit test. Every gate is a
*data-native* check: a browser measurement, a static scan, or a real code path driven with
one stub. Verify tables and measurements, never logs.

---

## ⛔ Why this folder is a SIBLING of `aws-quiz-app/`, never inside it

`aws-quiz-app/` is the **deploy source**. It is shipped with `rsync --delete`. Gates placed
inside it would be published to production *and then deleted on the next deploy*. This
folder sits beside it so neither happens.

---

## Run everything

```bash
cd ml/study/Edu-Argumentation/gates
npm install                              # first time only
./node_modules/.bin/playwright install chromium   # ⛔ NEVER `npx` — npx hits the registry
bash run-gates.sh
```

`run-gates.sh` re-syncs the smoke harness, restarts the `:8791` server, runs every suite,
and asserts both the exit code and the result-line count of each.

### What "green" means

| Suite | Result lines | Status |
|---|---|---|
| `gate.mjs` | **27** | FROZEN |
| `gate-q.mjs` | **12** | FROZEN |
| `gate-a.mjs` | **10** | FROZEN |
| **frozen vector total** | **49** | **must never change** |
| `gate-b456.mjs` | 6 | new in P0, asserted separately |
| `gate-self.mjs` | 6 | new in P0, asserted separately |
| `gate-multi-answer.mjs` | 24 | 21-10-26, choose-N questions in a real browser on the built `dist/`; run by hand (needs `vite build` + a playwright install), NOT in the frozen vector |
| `gate-srs.mjs` | 27 | 21-10-26, active recall + spaced repetition in a real browser on the built `dist/` (red 25/27 when recall-first is disabled); run by hand like the multi-answer one |
| `gate-srs-backend.py` | 32 | 21-10-26, the schedule (SM-2-lite), validators, migration 004 additive, the three routes; `python3`, no service. ⚠ clear `app/backend/__pycache__` between a mutation and its restore (same-second edits reuse stale bytecode) |
| `gate-multi-answer-backend.py` | 17 | 21-10-26, the server half (wrong-answer validation, rooms skip choose-N, migration 003 is additive); `python3`, no service |
| `gate-study-more-backend.py` | 54 (75 with `--live`) | 22-10-26, exam-recall-suite P1 (G4): AI keys, new-card cap, prefs bounds, validators, migration 005 additive + idempotent, the 6 add-on routes behind `_gate`. `--live` (test venv) adds the real routes + SQL on the ISOLATED gate DB `edu_study_gate`: migrate twice (newest version — 6 since P2 — then nothing), throwaway account (deleted at the end), local uvicorn :8786. Fails when: migration loses `IF NOT EXISTS`, the cap moves off 20, a POST skips `_gate`. |
| `gate-study-more.mjs` | 36 | 22-10-26, exam-recall-suite P1 (G5): built `dist/`, API stubbed — Stats row, Per review 10..50 step 5 + save, New / day, Flagged (N), confidence before options (review only), leech tag, flag toggle with visible status + rollback, AI question enrolled with body under the server's sha1 key, 44 px targets, nothing outside the header sticks out at 390/834/1440, scope label not clipped. Screenshots `/var/tmp/p1c-shots`. Fails when: the confidence row is hidden, AI enrolment is skipped, the flag goes back into the crowded right cluster. |
| `gate-routes.mjs` | exit code | 22-10-26: allow-list now carries the 3 `/api/review/*` routes of 21-10 (they were never added — the gate was RED from 21-10 until this fix) and the 6 study_more routes. |
| `gate-history-backend.py` | 52 (99 with `--live`) | 22-10-26, exam-recall-suite P2 (G6): area rules (chapters / valid `exam` block / every invalid block ignored), mastery (newest 200 per area, retry runs and pre-v5 rows left out, < 5 answers never Next up, tie -> practised longest ago -> book order), history query validation, migration 006 (ease check `>= 1.29`) + its manual rollback. `--live` (test venv, gate DB `edu_study_gate`, uvicorn :8787, 2 throwaway accounts deleted at the end) runs every History / mastery SQL statement for real and reproduces the 21-10 ease bug (7 x "again" on one card). Fails when: 006 is missing (6th grade 500), Wrong/Flagged swapped, retry counted, the 5-answer rule or the tie-break dropped, `runs` counted over the filtered rows. |
| `gate-history.mjs` | 28 | 22-10-26, exam-recall-suite P2 (G7): built `dist/`, API stubbed — Account Progress (bars with number text, Not enough yet, Next up + Practice), History All/Wrong/Flagged + area + Show more, shape + words per row, keyboard focus, Retry wrong keeps the ORIGINAL denominator (6 / 6 from the Wrong filter, 2 / 3 across two pages, logged as `retry`), Practice dialog Next up, Book select, 44 px, nothing sideways at 390/834/1440. Screenshots `/var/tmp/p2c-shots`. Fails when: a retry recomputes its denominator, a bar's text runs together, rows lose their words, a time stamp reads "22-1008:00". |

### Red proofs — exam-recall-suite P1 (22-10-26)

Every mutation was made in a COPY under `/var/tmp` (`SM_BACKEND=/var/tmp/p1c-mut/backend`,
`SM_DIST=/var/tmp/p1c-dist-{A,B,C}`), never in the source; the source then re-ran green.

| Gate | Mutation | Red result | Green after |
|---|---|---|---|
| `gate-routes.mjs` | (none needed — it was already red) | exit 1, 9 UNDECLARED ROUTES (3 × `/api/review/*` from 21-10 + 6 new) | exit 0, `0 missing · 0 extra` |
| `gate-study-more-backend.py` | `CREATE TABLE answer_log` without `IF NOT EXISTS` | 52/54 (D2, D5 FAIL) | 54/54 |
| `gate-study-more-backend.py` | `NEW_PER_DAY_DEFAULT` 20 → 21 | 52/54 (C0, C2 FAIL: the 21st card kept its own schedule) | 54/54 |
| `gate-study-more-backend.py` | `core._gate(req)` dropped from `_limited` | static 53/54 (R3); `--live` 70/75 (L6 cross-origin flag → 200, L7 → 201, L15/L16 knock-on) | 54/54 · 75/75 |
| `gate-study-more.mjs` | `ConfidenceRow` returns null | V1, V2 FAIL, then the run aborts (no Guess button) — exit 1 | 36/36 |
| `gate-study-more.mjs` | `recordReviewSeen` drops every `ai-` question | 34/36 (O4 no body, O5 key ≠ server formula) | 36/36 |
| `gate-study-more.mjs` | flag button back in the header's right cluster | 35/36 (W 390: scope label clipped) | 36/36 |

### Red proofs — exam-recall-suite P2 (22-10-26)

Mutations in COPIES only (`HB_BACKEND=/var/tmp/p2c-mut/<name>`, `HG_DIST=/var/tmp/p2c-mut/eroot/app/fe-<name>/dist` — a frontend
copy must sit two levels under a dir holding `aws-quiz-app`, because vite.config reads `../../aws-quiz-app`). Source re-ran green.

| Gate | Mutation | Red result | Green after |
|---|---|---|---|
| `gate-routes.mjs` | (none — red before the allow-list) | exit 1, 2 UNDECLARED (`GET /api/history`, `GET /api/mastery`) | exit 0 |
| `gate-history-backend.py --live` | backend without `006_ease_floor.sql` (gate DB at v5) | 88/99 — E1 `1:200,2:200,3:200,4:200,5:200,6:500,7:500` (CheckViolation `review_cards_ease_check`), E2-E4, L1, L3, G1-G3 | 99/99 (`applied: 006_ease_floor.sql`) |
| `gate-history-backend.py --live` | rollback drill: `rollback/006_ease_floor.down.sql` applied to the gate DB, then the no-006 backend | 88/99, same 6th-grade 500 (rollback restores v5 exactly); then the source re-applied 006 | 99/99 |
| `gate-history-backend.py --live` | `MASTERY_RUN_KINDS` + `retry` | 97/99 (K1; Y2 ch1 = 5/9) | 99/99 |
| `gate-history-backend.py --live` | `MASTERY_MIN_ANSWERS` 5 -> 1 | 89/99 (N1, N4, N5, K2, Y4, Y5 Next up = ch4 at 0% with 4 answers, Y8, Y10 …) | 99/99 |
| `gate-history-backend.py --live` | tie-break without `lastAt` | 97/99 (N2; Y5 Next up = ch2) | 99/99 |
| `gate-history-backend.py --live` | `runs` counted over the Wrong rows only | 98/99 (Z7 run 2 = 4/0, not 6/2) | 99/99 |
| `gate-history-backend.py --live` | Wrong / Flagged filters swapped (plan's named mutation) | 95/99 (Z6, Z7, Z8, Z10) | 99/99 |
| `gate-history.mjs` | `run/retryFrom` uses the missed count as the total (plan's named mutation) | 25/28 (R1 "retrying 2 of 2", R2 `2 / 2`, R4 `0 / 1`) | 28/28 |
| `gate-history.mjs` | bar text without the spaces | 27/28 (P2 `92%11/12`) | 28/28 |
| `gate-history.mjs` | row words (`sr-only` Right:/Wrong:) removed | 26/28 (H3, H6) | 28/28 |
| `gate-history.mjs` | time stamp with a plain space | 27/28 (H9) | 28/28 |
| `gate-study-more-backend.py --live` | P1's literal `schema version: 5` (now the newest migration file) | 74/75 on the v6 gate DB (L1) | 75/75 |

### Red proofs — exam-recall-suite P3 (22-10-26)

Backend mutations in COPIES (`EB_BACKEND=/var/tmp/p3c-red/<m>`); frontend in `/var/tmp/p3c-fault/app/fe-x`
(+ `aws-quiz-app` beside `app/`), staged with `EXAM_WEB=/var/tmp/p3c-fault/dist`. Source re-ran green.
Fixture books: `gates/stubs/exam_fixture.py` (block book 65 q, D1-D4 24/30/34/12; no-block book 30 q) — written under
`/var/tmp` at run time, never into the real library. `gate-exam.mjs` stages itself (copy of the backend + built dist + gate DB).

| Gate | Mutation | Red result | Green after |
|---|---|---|---|
| `gate-routes.mjs` | (none — red before the allow-list) | 5 UNDECLARED (`/api/exam/{open,start,answer,flag,finish}`) | `0 missing · 0 extra · 0 unexpected` |
| `gate-exam-backend.py --live` | backend without `007_exam_runs.sql` (gate DB at v6) | exit 1 — M1-M4, L1 `schema version: 6`, L3, S1-S4 (`500`) | 83/83 (`applied: 007_exam_runs.sql`) |
| `gate-exam-backend.py` | largest remainder = floor only (plan's named mutation) | 32/41 — A1 `[15, 19, 22, 7] sum 63` (plan guessed 64), A2-A4, P1, G1-G3, G9 | 41/41 |
| `gate-exam-backend.py` | deadline `now > deadline` instead of `>=` | 39/41 (C1, C3) | 41/41 |
| `gate-exam-backend.py` | Estimate without `passScaled` (defaults 1000 / 700) | 40/41 (G6: no-block run gets `estimate 1000`) | 41/41 |
| `gate-exam-backend.py --live` | run lookup not scoped to the account | X1 `[400, 200, 200]` — account B could FLAG and FINISH A's exam; X2, D1 | 83/83 |
| `gate-exam-backend.py --live` | lost-race fallback removed in `store.exam_start` | 81/83 — K1 `codes [200 x6, 201, 503] ids 2` (proves 8 parallel Starts really race) | 83/83 |
| `gate-exam-backend.py --live` | P2's literal `schema version: 6` in `gate-history-backend.py` L1 | 98/99 on the v7 gate DB | 99/99 (L1 now = newest file) |
| `gate-exam.mjs` | leave guard `window.confirm` instead of `askConfirm` (plan's named mutation) | see P3 report (run when nn was reachable) | 39/39 |

⚠ At 834 px the WHOLE page scrolls sideways by 177 px because of the site header (`#nav-qna`,
`#nav-live`) — measured identically on the committed pre-P1 build. `gate-study-more.mjs` prints it as
`INFO W-hdr` and measures everything outside `<header>`; the header defect is its own open item.

> ⛔ **The 49-line vector is frozen.** It is a *no-regression* gate: it proves the suites
> still assert the same things, **not** that those assertions are right. A different vector
> means the hardening changed behaviour — that is a FAILED phase, **not** a new baseline.
> New gates go in **new files**. Never add a `check()` to the three frozen suites.

---

## The `:8791` smoke harness — read this before debugging a red gate

**`:8791` is NOT a static file server.** It is the real `edu_server.py`, run from the repo,
serving static assets out of a *separate* tree at `/var/tmp/edu-smoke`. The consequence:

- a **backend** change needs a **process restart**;
- a **frontend** change needs a **file copy** into `/var/tmp/edu-smoke`.

That split is the stale-code trap: skip the copy and every gate measures old code, and
neither green nor red means anything. Before `run-gates.sh` existed, the only defence was a
human remembering to `cp`.

The exact recipe `run-gates.sh` uses:

```bash
cd ml/study/Edu-Argumentation/aws-quiz-app
EDU_LIBRARY_ROOT=/var/tmp/edu-smoke/lib \
EDU_PROGRESS_PATH=/var/tmp/edu-smoke/progress.json \
EDU_LIBRARY_META_PATH=/var/tmp/edu-smoke/library-meta.json \
python3 edu_server.py --port 8791 --directory /var/tmp/edu-smoke
```

### ⛔ `/var/tmp/edu-smoke` is NOT a copy of the repo

It holds three things the repo does not contain and cannot regenerate:

| Path | What | If it goes missing |
|---|---|---|
| `lib/` | the **book library** (`EDU_LIBRARY_ROOT`), ~102 MB, two real book packages | every gate dies with a `page.goto` *networkidle* timeout — the app retries the now-404 `/book/<id>/module.json` forever |
| `progress.json` | the harness's own study progress | progress resets |
| `library-meta.json` | the book titles the library list renders | titles vanish |

A naive `rsync --delete` from `aws-quiz-app/` **deletes `lib/`**. Measured 21-09-26: that
wipe took the suite from 49 result lines to **0**, with three suites "failing" for a reason
that had nothing to do with the code under test. `run-gates.sh` therefore syncs only the
frontend, and refuses to run at all if the library is missing.

Restore it (read-only; no service is touched):

```bash
rsync -a nn:'~/foxai-data/edu-argumentation/library/geron-homl3/' /var/tmp/edu-smoke/lib/geron-homl3/
rsync -a nn:'~/foxai-data/edu-argumentation/library/openintro-statistics-2019-1045f2f5/' /var/tmp/edu-smoke/lib/demo-book/
```

The **real** Géron module must be present — the A5 gates measure real equations, so a
fixture stub will not do.

⚑ `/var/tmp/`, never `/tmp/` or `/dev/shm`: those are tmpfs (RAM) on the work PC.

---

## The gate-count question, settled (three numbers, three meanings)

This caused a genuine disagreement because three different quantities were all being called
"the number of gates". All three are real:

| Quantity | `gate-q.mjs` | How to measure |
|---|---|---|
| **call sites** | **7** | `grep -cE '\bcheck\(' gate-q.mjs` |
| **result lines** | **12** | `grep -cE '^(PASS\|FAIL)  ' <transcript>` |
| **literal quoted ids** | **4** | `grep -oE "check\('" gate-q.mjs \| wc -l` |

Why 7 call sites emit 12 lines: **three call sites sit inside `for` loops and build their id
from a template literal** — `:50` Q1a (2 widths), `:67` Q1b (2 widths), `:147` Q2d (4
widths). A grep for `check('` cannot see them. So 4 + 2 + 2 + 4 = **12**.

⛔ Do not use `grep -c 'check(' gate-q.mjs` as evidence — it returns 7 and answers neither
question. `gate.mjs`'s own header comment declares **27 a deliberate contract**.

### ⚠ The counting regex needs TWO trailing spaces

`check()` prints `VERDICT␠␠ID␠␠DETAIL`. Count with `^(PASS|FAIL)␠␠`. The one-space form
also matches the `FAILED: ...` summary line and **over-counts a red run** (measured: a red
`gate-a` transcript counts 10 with two spaces, 11 with one).

---

## Portability

No machine-local path and no pinned chromium revision may appear here. The gates resolve
the browser as:

```js
executablePath: process.env.GATE_CHROME || chromium.executablePath()
```

⚠ Pinning the playwright *version* is **not** a portability fix on its own: 1.61.1 pins
chromium revision **1228**, while the gates used to hardcode **1234**. `chromium.executablePath()`
honours `PLAYWRIGHT_BROWSERS_PATH`, which is what makes this work on the Mac's
`~/Library/Caches/ms-playwright` with no env var at all.

`playwright` is pinned **EXACT** (`"1.61.1"`, no caret) and the dependency is **`playwright`,
not `playwright-core`** — `playwright-core` ships no browser downloader, so only the wrapper
provides the `playwright install` CLI. A caret would float the chromium revision and could
silently shift the 49-line vector.

> ⚠ **Offline `playwright install chromium` works here by luck, not design.** It is a no-op
> only because revision 1228 already happens to be cached. **Bump the pin and it needs the
> CDN.** Do not assume the offline story survives a version bump.

---

## `gate-self.mjs` — the suite watching itself

Both defects P0 fixed survived because nothing watched the watchers. It asserts: the three
frozen counts (27/12/10, from **transcripts**), the portability ban-list, that
`A_G18_BASELINE` is set *and the file it names exists*, and that `gate-q.mjs` still contains
`process.exit(1)`.

It parses the transcripts `run-gates.sh` captured — **never the source, never a re-run**.
Static grepping cannot see the template-literal ids above (that is the 7-vs-12 problem), and
a fourth chromium launch would double the cost for no new signal. So it must run **last**.

The ban-list is **scoped, not a blanket** "no absolute paths": it bans the home dir, the Mac
home, `edu-verify` and a pinned chromium revision. `/var/tmp/edu-smoke` and `/var/tmp/p0-*`
are **required** by `run-gates.sh` and are real disk on both machines, so a blanket ban would
false-red on correct code.

---

## `A_G18_BASELINE`

`ag18-before.json` ships **with the suite** and `run-gates.sh` exports it automatically.
Without it `gate-a.mjs` reports 9/10 and any vector diff fails for the wrong reason.

A-G18 **has always failed loudly** without a baseline — the guard is in the source. Only its
message used to lie, saying "comparison leg skipped" while the gate was red. That wording is
now gone.

To regenerate: `A_G18_WRITE=/var/tmp/ag18-new.json node gate-a.mjs`. Write-mode falls through
into the same gated run, so A-G18 still reads red on that pass; re-run with
`A_G18_BASELINE=/var/tmp/ag18-new.json` to go green.

> ⚠ `ag18-before.json` encodes **current-render pixel values** (`svg: 61.9`,
> `radicand: 61.1`). Phase 3 rewrites the frontend, so this baseline must be **re-captured at
> Phase 3**, not carried over.

---

## Every new gate must be fault-proven

A gate that has never been seen failing is not evidence. In one session six gates passed on
broken code: an uppercased label, a shadow-DOM `innerText` that is always empty, a
`display:none` button measured 0×0, a hidden element where `0 >= 0.9*0` is true, an equation
sweep rendered outside its `<figure>`, and an ordering gate that only asserted list length.

Before adding a gate: break the thing deliberately, watch it go red, restore, watch it go
green, and record all four in the phase report. Fault-inject into `/var/tmp/edu-smoke`
(scratch) — **never into `aws-quiz-app/`**.

---

## Files

| File | What |
|---|---|
| `gate.mjs` | 27 results — home page, deselect, rename, reader shell, button set, dialog picker, responsive overflow. FROZEN. |
| `gate-q.mjs` | 12 results — quiz column width, pinned action bar, option layout, overflow at 4 widths. FROZEN. |
| `gate-a.mjs` | 10 results — workstream-A layout/CSS gates incl. A-G18 relayout baseline. FROZEN. |
| `gate-b456.mjs` | 6 results — B4/B5/B6: retry-wrong-only denominator, carried score, full-set read. |
| `gate-self.mjs` | 6 results — the suite's own invariants. Runs LAST. |
| `gate-study-more-backend.py` | G4 (exam-recall-suite P1) — server half of stats / cap / flags / prefs / answer log; `--live` on the gate DB. |
| `gate-study-more.mjs` | G5 (exam-recall-suite P1) — the same features in a real browser on the built bundle. |
| `gate-history-backend.py` | G6 (exam-recall-suite P2) — History / mastery server half + migration 006; `--live` on the gate DB. |
| `gate-history.mjs` | G7 (exam-recall-suite P2) — Account Progress + Practice Next up in a real browser on the built bundle. |
| `gate-exam-backend.py` | G8 (exam-recall-suite P3) — exam allocation / grading / Estimate / clock + migration 007; `--live` runs every exam SQL on the gate DB (race, deadline, idempotent Submit, other account 404). |
| `gate-exam.mjs` | G9 (exam-recall-suite P3) — the timed exam in a real browser on the built app + real backend + gate DB at 390/834/1440 (resume after reload, app leave dialog, Back, auto-submit, Estimate only with the block, Retry missed keeps the total). Self-staging. |
| `stubs/exam_fixture.py` | P3 fixture books (with / without an `exam` block) + `serve` = the local staged preview used by `gate-exam.mjs`. |
| `htmlcheck.py` | static HTML structure check. |
| `ag18-before.json` | the A-G18 render baseline. A first-class suite file. |
| `b15probe.mjs` | **probe, not a gate** — records the pre-existing `#chapter=1&block=8` defect. Cannot fail. |
| `run-gates.sh` | the runner. Re-syncs, restarts, runs, asserts. |
