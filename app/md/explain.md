# `app/` — the edu-study stack (`:8792`)

Mandatory per `lakehouse-architecture-standards.md` §10a: a non-orchestrated service still
ships an `explain.md`. `doc-importer/` has one; `aws-quiz-app/` does **not**, and that
omission is not being copied.

**What this is.** The replatformed study app: a React + TypeScript + Vite SPA served by a
FastAPI backend, running as `foxai-edu-study` on `:8792`. Phase 02 stands it up **empty** —
one API route and a page that says hello. Nothing is ported yet.

**What it is not.** It is **not** a replacement for `:8767` yet, and **not** connected to
`:8769`. Three separate services, three separate units, three separate PIDs — by user
ruling: *"The separation is needed since they do 2 different things, and if 1 break i can
still learn."* A migration is exactly where someone consolidates them for tidiness. Do not.

---

## File by file

### `frontend/` — the SPA (built on the workstation, never on `nn`)

| File | Purpose | Input | Output | How |
|---|---|---|---|---|
| `package.json` | pins + build scripts | — | — | react 19.2.7 (exact), react-dom 19.2.7, @tanstack/react-query ^5.101.4; dev: vite ^8.1.1, @vitejs/plugin-react ^6.0.3, typescript ~5.9, tailwindcss ^3.4.19. **No state library** — see below. |
| `vite.config.ts` | build config | `src/` | `dist/` | React plugin; `base: '/'`; `assetsDir: 'assets'`; no sourcemaps. |
| `index.html` | SPA shell | — | `dist/index.html` | Carries `<div id="root">` and the **pinned Tailwind CDN** `<script>`. |
| `src/main.tsx` | entry point | — | DOM mount | Creates the `QueryClient`, wraps `<App/>` in `QueryClientProvider`, mounts on `#root`. |
| `src/App.tsx` | the only screen | `/api/health` | rendered page | `useQuery` on health; renders the seven resolved store paths. |
| `src/api.ts` | the only backend caller | `fetch` | `HealthPayload` | Same-origin `fetch('/api/health')` — the SPA is served by the same app, so there is no base URL and no CORS. |
| `src/ask/chatDock.ts` | tutor chat dock mode (22-10-26) | `localStorage reader:askMode` | `popup` \| `side` + the side slot element | **Dock** (in the Ask panel) moves `AskPanel` into Lab's side slot (`reader/LabDock.tsx` `ChatDock`, same divider/width/snap, phone = full-screen layer); `ReaderScreen` then closes Lab and disables its button + `]` until **Popup**. Conversation (`eduAskConversation`) is untouched by the switch. Gate: `gates/gate-chat-dock.mjs`. |

**No state management library.** Verified against the house reference: the CoreX console
ships **zero** of zustand / redux / jotai / mobx / recoil / valtio. Server state lives in
TanStack Query; genuinely-client state becomes a React context. Adding a store later is a
decision, not a drift.

**English only.** No i18n scaffold, no key files, no coverage gate (ruling R2). The console's
i18n machinery exists because it has two real audiences; this app has one.

**Tailwind is on the CDN for this phase**, pinned verbatim **including the query string**:

```
https://cdn.tailwindcss.com?plugins=typography
```

⛔ `?plugins=typography` is **load-bearing**. Dropping it silently removes every `prose`
style, and the damage surfaces as "the rewrite looks wrong" rather than as a missing
dependency. A URL recorded without its query is a **wrong** pin, not a shorter one. The v3
JIT CDN and the v4 browser build are different products with different class semantics — the
house pin is v3. The CDN→build swap is a Phase 3 slice of its own, because the purge is not
incremental: every screen depends on it at once.

⛔ **Never run a Vite/Node build on `nn`.** Measured 2026-09-21: free 1486 MB, available
8492 MB, **swap 4053/4095** — effectively exhausted. An OOM kill there takes a JVM
(Trino / Polaris / Airflow) with it; the 02-09 precedent cost two Flink jobs and an 11.9 h
crash loop. The larger free figure is not permission. Build here, ship artifacts.

### `backend/` — the FastAPI service

| File | Purpose | Input | Output | How |
|---|---|---|---|---|
| `main.py` | the app | HTTP | JSON + files | Registers `/api/health`, then `GET /`, then mounts the SPA assets. Order matters — see below. |
| `bookctx.py` | what the tutor reads besides the lesson (tutor-book-index, 30-09-26) | `library/<id>/book-index.sqlite` (read-only, `mode=ro`, fresh connection per ask) | `("index", chapter_block, hits)` or `("legacy", excerpts)` | `ask_context()` = THE selector for `/api/ask`: the **whole current chapter** (cap 48k tok, chars/4; over the cap it keeps the first pages and says `TRIMMED`) + the **top 4 FTS5 bm25 hits from other chapters**, every chunk labelled `[ch4, p.196]` (1-based PDF page) or `[ch4, lesson 3 "term"]`; the current lesson is labelled too. Legacy (= the old `ai.book_search`, byte-identical, incl. its page-minus-one label) when: kill switch `EDU_ASK_CONTEXT=legacy` · no index · `schema_version` ≠ 1 · chapter not indexed · any index error. MATCH is built from `[a-z0-9]+` tokens only. `tutor_reply()` is the one `ai.ask_tutor` call site; the index path uses `ai.ASK_SYSTEM_INDEX` (`ASK_SYSTEM` is untouched). `ask.jsonl` rows gain `context` + `chapterTokens`. Kill switch = systemd drop-in `/etc/systemd/system/foxai-edu-study.service.d/ask-context.conf` (`[Service]` + `Environment=EDU_ASK_CONTEXT=legacy`), survives `deploy-study.sh`. The index file is written by the importer (`:8769`), never by this app. |
| `../tools/tutor_index_gates.py` | gate harness (NOT deployed — `scp` to `nn:/var/tmp/tbi/`) | — | JSON verdicts | G2 completeness · G3 dumpsha · G5 cost · G6 legacy byte-identity · G7 replay · G8 cross-chapter hit@4 · G9 citations · G11 hostile FTS input · `make-fault` copies under `/var/tmp/tbi`. |
| `settings.py` | **the one accessor** | env | resolved paths | `store_paths()` / `store_path()` / `provider_config()`. Nothing else reads these variables. |
| `requirements.txt` | pins | — | — | fastapi 0.141.1 · **starlette 1.6.0** · uvicorn 0.52.0 · pydantic 2.13.5. |
| `README.md` | the standing rules | — | — | one worker (three causes) · plain `def` for provider handlers · `FileResponse` not `StaticFiles` · one accessor · no credentials. |

`/api/health` echoes **exactly seven** resolved `EDU_*` store paths and nothing else — no
token, key, model, provider URL or admin flag under any key name. Seven, **never nine**:
`:8767`'s environment holds nine `EDU_*` variables but only seven are paths, and the other
two are live secrets. `:8792` is unauthenticated and ufw rule #1 blanket-allows the whole
LAN, so the payload is public to `192.168.100.0/24` by construction.

### `md/explain.md`

This file.

---

## ⛔ The SPA static mount prefix — NAMED, not left for Phase 3 to rediscover

The SPA's hashed bundles are served from the prefix **`/assets`** (Vite's default, kept
deliberately). That prefix is **shared** with the guarded per-module route Phase 3 adds at
`/assets/<moduleId>/<file>`.

They stay separate because **Starlette matches routes in registration order**:

1. API routes
2. *(Phase 3)* the two guarded file routes — `/assets/<moduleId>/<file>` and `/book/<id>/…`
3. **then** the SPA static mount on `/assets`

So the 2-segment guarded route claims module assets, 1-segment build assets fall through to
the mount, and a guarded **403 does not fall through** to the mount. Registering the mount
first would shadow every guarded route and silently remove the `ASSET_FILE` allowlist —
which is the whole control.

**Phase 3 must keep this order.** If it ever becomes uncomfortable, change the SPA's
`assetsDir` to something disjoint (e.g. `static/`) rather than reordering the routes.

---

## Deployed layout on `nn`

```
/srv/foxai/edu-study/
  backend/        <- main.py, settings.py            (rsync'd from app/backend/)
  web/            <- index.html + assets/*.js        (rsync'd from app/frontend/dist/)
/home/ubuntu/edu-study-venv/                          <- python deps, OUTSIDE the rsync tree
```

⛔ The venv lives **outside** `/srv/foxai/edu-study/` on purpose. That tree is deployed with
`rsync --delete`, so anything kept inside it is wiped on every deploy and the service comes
back **healthy and empty** — the exact failure `:8767`'s own unit comments warn about for
`provider.env`. Same reason the house keeps `~/edu-importer-venv` and
`~/geron-learn-app-venv` outside their web roots.

The backend resolves `web/` from `__file__`, not from an environment variable: the unit pins
exactly seven `EDU_*` variables and exit gate G8 asserts that count, so an eighth would fail
the gate. There is nothing to configure.

## Deploy

`deploy/deploy-study.sh` — snapshot → rsync → sha256 gate → restart → verify, with
`--rollback` and a build-refusal grep. It never writes `~/foxai-data/`. See its own header.

⛔ It is a **separate script** from `deploy/deploy.sh` (which serves `:8767`) and that one is
**never edited by this phase**.

## Multi-answer (choose-N) questions — 21-10-26

A quiz question's `correct` is an integer (one right option — every book so far) OR a strictly
ascending list of 2+ option positions (choose-N, e.g. the AWS CLF-C02 "choose TWO").

- **Reader:** shows "Choose N · k selected"; a click ticks or unticks (never more than N); **Check Answer**
  (`#check-btn`, enabled at exactly N ticks) scores the set as ONE answer, **exact set, no partial credit**.
  Every option then gets its verdict and its own `explanations[i]`. Single-answer questions are unchanged.
  Code: `app/frontend/src/quiz/multiAnswer.ts` (the rule), `QuizScreen.tsx`, `OptionCard.tsx` (ticked look).
- **Options:** importer-built books stay at 4; a hand-built module may use 4-6.
- **Wrong answers:** `POST /api/wrong-answers` takes `chosenSet` + `correctSet` for a choose-N miss
  (`store.wrong_answer_positions` validates); the INTEGER `chosen`/`correct` columns hold each set's
  first position. Migration `003_multi_answer.sql` adds nullable JSONB `chosen_set` / `correct_set`.
- **Live rooms:** choose-N questions are NOT drawn (`rooms_store.pick_questions` already skips any
  non-integer `correct`). A timed multi-select room is a separate piece of work.
- **Importer / AI questions:** unchanged, single-answer only (`gates.py` G-QUIZ still wants an int 0-3).
- **Gates:** `gates/gate-multi-answer.mjs`, `gates/gate-multi-answer-backend.py`.

## Active recall + spaced repetition — 21-10-26

Review cards schedule quiz questions so they come back just before he would forget them.

- **Cards:** one per account x module x question key (`source.question`, e.g. `ch03-b05-q2`), table `review_cards`
  (migration `004_review_cards.sql`; the question TEXT stays in the book's quizData). AI-written questions have no
  key; since 22-10-26 they are keyed by content and their body is stored with the card (see below).
- **Enrolment:** answering a keyed question in an ordinary quiz posts `POST /api/review/seen`: first time right =
  due in a day; first time wrong = due in 10 minutes; an existing card changes only on a wrong answer (a lapse), so
  repeating a quiz never pushes the interval out.
- **Review run:** Practice dialog -> "Review due (N)" (`#setup-review-btn`, with a `#review-status` line). It starts a
  normal quiz run with scope `review` (up to "Per review" due cards, default 20, oldest first). **Active recall:** the question shows alone
  with a "type your answer from memory" box (`#recall-input`, nothing is saved); options appear after "Show options".
  A wrong answer is graded `again` automatically; a right one waits for Hard / Good / Easy (`#grade-*-btn`), which grades
  and moves on. Works for choose-N questions too. A review run never ticks a lesson.
- **Schedule** (`store.srs_next`, SM-2-lite): again = 10 min, lapse +1, ease -0.2 (min 1.3); hard = interval x1.2 (min 1 d),
  ease -0.15; good = 1 d, 3 d, then interval x ease; easy = 4 d, then interval x ease x1.3, ease +0.15; capped at 365 d.
- **API:** `POST /api/review/seen`, `POST /api/review/grade`, `GET /api/review/due?module=&limit=`. If the server does not
  answer, the dialog shows no review UI at all.
- **Gates:** `gates/gate-srs.mjs`, `gates/gate-srs-backend.py`.
- **Fixed 22-10-26 (migration `006_ease_floor.sql`, schema v6):** the check was `ease >= 1.3` on a `REAL`; the stored
  float of 1.3 is 1.29999995, so the 6th `again` on a card answered **500**. Now `ease >= 1.29` (code still floors at 1.3).
  Manual rollback: `migrations/rollback/006_ease_floor.down.sql`.

## Exam + recall suite, phase 1 — 22-10-26 (plan `exam-recall-suite_22-10-26`)

Migration `005_review_more.sql` (additive): `review_cards.body`, tables `question_flags`, `study_prefs`, `answer_log`.
Routes live in the add-on `backend/addons/study_more.py`; store functions in the marked P1 block at the end of `store.py`.

| Piece | What | In | Out |
|---|---|---|---|
| `GET /api/review/stats?module=` | Stats row numbers | session | due now / today, next 7 days per day, cards, leeches (lapses >= 6), new today, cap, size, retention (review answers right, 30 d) |
| `GET`/`POST /api/study/prefs` | per book: `newPerDay` 0-200 (default 20), `sessionSize` 10-50 step 5 (default 20) | session; POST same-origin | `{module, newPerDay, sessionSize}` |
| `GET`/`POST /api/flags` | flag on = upsert, off = delete (idempotent); AI questions keep their body | `{module, question \| body, flagged}` | `{question, flagged}` / list |
| `POST /api/answers` | append one answer to `answer_log`; `clientId` uuid makes a retry log once | `{module, question \| body, runKind, correct, clientId, confidence?, chosen?}` | 201 logged / 200 duplicate |
| `/api/review/seen` (changed) | AI question sends `body`, server keys it `ai-` + 12 hex of sha1(question + options); new cards over the daily cap are `queued` to the next UTC+7 midnight | | `{outcome, question, dueAt?}` |
| `/api/review/due` (changed) | `limit` clamped 10-50; each card has `leech`, AI cards their `body` | | |
| `quiz/ReviewStats.tsx` | collapsed "Stats" row in the Practice dialog + "New / day" stepper | `/api/review/stats` | `#review-stats`, `#stats-*` |
| `quiz/SizePicker.tsx` | [-] n [+] stepper (44 px), used for "Per review" (`#session-size`) and "New / day" | | |
| `quiz/FlagButton.tsx` | flag toggle under the question number (`#flag-btn`, aria-pressed, status Flagged / Unflagged / Not saved) | `/api/flags` | |
| `quiz/ConfidenceRow.tsx` | review runs only: Sure / Unsure / Guess before the options; one tap reveals them | | confidence on the answer log |
| `QuizSetupScreen.tsx` | adds Stats, Per review (caps Review due + Flagged runs, never ordinary Practice), "Flagged (N)" run | | |
| `QuizScreen.tsx` | logs every first answer, enrols AI questions with body, Leech tag (`#leech-tag`) | | |

Gates: `gates/gate-study-more-backend.py` (G4, `--live` on the gate DB), `gates/gate-study-more.mjs` (G5).

## Exam + recall suite, phase 2 — 22-10-26 (history + mastery)

No new table: reads `answer_log`, `question_flags`, `review_cards.body`, pre-v5 `wrong_answers`. Migration 006 = the ease fix above.
Routes in the add-on `backend/addons/history.py` (GET only); store functions in the marked P2 block at the end of `store.py`.

| Piece | What | In | Out |
|---|---|---|---|
| `GET /api/history?module=&filter=all\|wrong\|flagged&chapter=\|domain=&cursor=&limit=` | newest first; pre-v5 wrong rows after the log; a post-v5 double write listed once; `runs` = whole-run totals (Retry's denominator) | session | `{items, nextCursor, counts{all,wrong,flagged}, runs}` |
| `GET /api/mastery?module=` | per area (exam domain if the book has a valid `exam` block, else chapter): right/answered of the newest 200; retry runs + pre-v5 rows left out; < 5 answers = not enough; Next up = weakest with >= 5 (tie: practised longest ago, then book order), else least-practised | session | `{areaKind, areas[], nextUp, target 80, window 200, minAnswers 5}` |
| `account/ProgressPanel.tsx` | Account page "Progress": Book select, mastery, History, Practice an area, Retry wrong | the two routes | quiz runs |
| `account/MasteryBars.tsx` | bars with the number as text + `target 80%`; `NextUpRow` also used in the Practice dialog (`#setup-next-up`) | | |
| `account/HistoryList.tsx` | All / Wrong / Flagged chips (aria-pressed), area select, rows grouped by run, tick/cross + words, Show more, Retry wrong | | |
| `state/quizReducer.ts` `run/retryFrom` | retry a PAST run: only its misses, total = the run's original count (6 / 6, never 2 / 2) | | |

Gates: `gates/gate-history-backend.py` (G6, `--live` on the gate DB), `gates/gate-history.mjs` (G7).

## Exam + recall suite, phase 3 — 22-10-26 (timed mock exam)

Migration `007_exam_runs.sql` (table `exam_runs`, partial UNIQUE index `exam_runs_one_open` = one open run per account x book;
manual rollback `migrations/rollback/007_exam_runs.down.sql`). Routes in `backend/addons/exam.py` (its docstring = the wire
contract); pure rules in `backend/addons/exam_blueprint.py`; SQL in the marked P3 block of `store.py`. The SERVER is the clock.

| Piece | What | In | Out |
|---|---|---|---|
| `GET /api/exam/open?module=` | preview (book `exam` block facts, else editable defaults min(40, pool) q / 60 min) + the open run + the last result; a run past its deadline is closed by this read | session | `{preview, run, last, expiredNow}` |
| `POST /api/exam/start` | new run (largest-remainder by domain weight, else by chapter size) or the open one (`resumed`); `restart` submits the open one first | `{module, questions?, minutes?, restart?}` | `201`/`200 {run, resumed, previous}` |
| `POST /api/exam/answer` · `/flag` | save / clear one answer; flag also writes `question_flags`; at/after the deadline -> `409 deadline` (not saved, run closed) | `{runId, question, chosen\|flagged}` | `200` · `409 {code, result}` · `404` other account |
| `POST /api/exam/finish` | grade, close, append answered questions to `answer_log` (run_kind exam, once); a retried Submit returns the same result | `{runId}` | `{result, alreadyFinished}` |
| Result | raw right/total, per area, missed; `scaled` (labelled Estimate, linear, pass/fail) ONLY when the book's `exam` block has `passScaled` | | |
| `quiz/ExamRunView.tsx` (+ `ExamTimer`, `ExamNavigator`, `ExamResult`, `examMode.ts`) | the exam inside `#quiz-screen`: server countdown, navigator chips (words + shape, arrow keys), Submit / Leave via the app dialog, auto-submit at 0:00, Retry missed keeps the exam's total | | |
| `quiz/QuizSetupScreen.tsx` `ExamRow` | Practice dialog "Exam" row: Start · Resume (time left) · New exam · last Result | | |
| `shell/useStudyActions.ts` `guardExamLeave` | header tab / brand during a running exam -> app dialog "Leave exam?" (never a native dialog) | | |

Reload or browser Back during an exam: the page leaves the exam screen (no prompt); the run stays open on the server —
Practice -> Exam -> Resume continues it with the server's time. No real book has an `exam` block yet -> every live book runs as a
"Practice exam" (no Estimate). Gates: `gates/gate-exam-backend.py` (G8, `--live`), `gates/gate-exam.mjs` (G9, self-staging), fixture `gates/stubs/exam_fixture.py`.
