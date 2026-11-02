# edu-study backend (`:8792`)

FastAPI service for the replatformed study app. Phase 02 ships it **empty**: one route
(`/api/health`) plus the built SPA. None of the legacy app's 15 API routes are ported yet.

Run: `uvicorn main:app --host 0.0.0.0 --port 8792 --workers 1`

---

## ⛔ Standing rules — read before adding the first real handler

### 1. ONE WORKER. Three independent causes, not one.

`--workers 1` is not a placeholder. Three separate pieces of per-process state make a
second worker **wrong**, and all three must go before it becomes right:

| # | Cause | Evidence in `aws-quiz-app/edu_server.py` |
|---|---|---|
| a | `save_settings` mutates `os.environ` **live** | `1153-1154`, the 5 `ENV_FIELDS` keys |
| b | **Four** in-process rate-limit deques, keyed on client IP | `REQUEST_HISTORY` 20/3600 s · `ASK_HISTORY` 60/600 s · `EXERCISE_HISTORY` 30/600 s · `RUN_HISTORY` 120/60 s |
| c | **Three** in-process caches | `_MODULE_CACHE` L314 · `_BOOK_CACHE` L59 · `_BOOK_DF` / `_BOOK_CHAPTERS` L60-61 |

The plan originally blamed (a) alone. That is wrong and actively misleading: someone who
sees only (a) moves settings out of the environment, adds a worker, and then cannot explain
why rate limits and cache hits still diverge between requests. **Moving settings out of env
buys zero concurrency** — (b) and (c) survive it untouched.

### 2. AI / provider handlers are plain `def`, **never** `async def`.

They block on `urlopen` with a **120 s** timeout. Under `async def` that blocks the event
loop and the service stops answering *everything*, health included. Under plain `def`
FastAPI runs the handler in a threadpool, which is the behaviour we want. There is no such
handler yet — the rule is written down **before** the first one exists, because retrofitting
it means auditing every handler.

### 3. `/book/` and `/assets/<moduleId>/` are custom `FileResponse` routes, **never** `StaticFiles`.

`StaticFiles` serves anything beneath its root. That would silently drop the `ASSET_FILE`
allowlist, and `import-report.json` (233 KB) sits **beside** `module.json` in every library
package — it must stay non-servable. `FileResponse` also streams rather than reading a
5.4 MB asset into RAM.

The SPA's own build output is the one exception, and a narrow one: `StaticFiles` is mounted
over `/srv/foxai/edu-study/web/` only, a directory that contains nothing but Vite output.
**Never** over the web root, **never** over `~/foxai-data/`, **never** over the book or asset
stores.

### 4. All provider/settings reads go through `settings.py`.

One accessor, no exceptions (`store_paths()`, `store_path()`, `provider_config()`). The
legacy app calls `ProviderConfig.from_environment()` from inside individual handlers, which
is why changing the source of a setting means finding every reader. Phase 4 swaps env →
SQLite; it must not have to hunt.

### 5. No credential in the ENVIRONMENT — read from the file, echoed nowhere. (Phase 04)

⚑ Superseded 23-09-26. Phases 02-03 held no credential at all. Phase 04 ports the AI routes and
the runner proxy, which need them — so they are read from `EDU_ENV_PATH` (the same `provider.env`
`:8767` uses) **on each request**, by `settings.py` alone (decision D-P4-2). What did NOT change:
the unit still pins exactly seven `EDU_*` **path** variables and has **no `EnvironmentFile=`**,
so `/proc/<pid>/environ` holds no key (R-SEP3/R-SEP4), and `/api/health` echoes the seven paths
only. `:8792` is **unauthenticated** and ufw rule #1 blanket-allows `192.168.100.0/24`, so no
value read from that file may reach a response body — `/api/settings` returns `*_set` booleans
(gate `W-SECRET`, fault-proved).

---

## A latent bug FastAPI removes by construction

The stdlib `http.server` the legacy app is built on returns early on 404 / 403 / 401 / 429 /
503 **without draining the request body**. Under keep-alive the undrained bytes are then
parsed as the next request line. FastAPI/Starlette own the ASGI request lifecycle and do not
have this failure mode — worth knowing so nobody ports the defensive workarounds along with
the handlers.

---

## Pins

Measured on `nn` 2026-09-21 against `~/edu-importer-venv`:

| Package | Pin |
|---|---|
| fastapi | 0.141.1 |
| **starlette** | **1.6.0** |
| uvicorn | 0.52.0 |
| pydantic | 2.13.5 |

`nn`'s system Python is **3.10.12** — nothing may require newer.

⚠ starlette is pinned **explicitly**. `fastapi 0.141.1` declares `starlette>=0.46.0` with no
upper cap, so leaving it unpinned resolves to whatever is current and the reference this
program claims to have measured stops being the one it runs. That matters from Phase 3
onward, where the API surface is the entire job.

## Phase 06a — accounts, sign-in, PostgreSQL (ruling R25, 23-09-26)

- **Everything needs a session** except `/login`, `/api/health`, `/api/auth/login`, the Vite
  `/assets/<file>` bundles and `/favicon.svg`. Signed out: API/data -> `401` JSON, pages -> `302 /login?next=…`.
- **Store:** PostgreSQL `edu_study` on `nn:5432`, role `edu_study` (CONNECTION LIMIT 10, owns only that DB).
  Credentials: `nn:~/.config/foxai/edu-study-db.env` (mode 600), **read by the backend itself** — the unit
  has no `EnvironmentFile=` (R-SEP3/R-SEP4 stay green). Tables: `accounts`, `sessions` (token SHA-256 only),
  `progress`, `attempts`, `wrong_answers`, `schema_migrations`. Migrations: `migrations/NNN_*.sql`, idempotent.
- **:8792 no longer writes `progress.json`.** `:8767` still does until the cutover.
- **Admin CLI** (on nn, passwords on STDIN only, never an argument):
  ```bash
  cd /srv/foxai/edu-study/backend && PY=/home/ubuntu/edu-study-venv/bin/python
  $PY -m admin migrate                      # pg_dump to ~/foxai-snapshots first, then apply
  printf '%s\n' "$PW" | $PY -m admin create-user --username X --display-name "Y"
  $PY -m admin list-users
  $PY -m admin import-progress              # progress.json -> the owner; idempotent, re-run at cutover
  printf '%s\n' "$PW" | $PY -m admin set-password --username X
  $PY -m admin set-claude-access --username X --on   # or --off: which 9router combos X's AI calls use
  $PY -m admin delete-user --username X --yes        # a NON-owner account and all its rows
  ```
- **Gates** use a separate database, `edu_study_gate` (own role), through an SSH tunnel; see
  `gates/run-gates-react.sh` and `gates/lib/auth-preload.mjs`.

## Model routing per account (23-09-26, user ruling)

The combo each AI call sends is chosen from the signed-in account's `claude_access` flag (migration
002, default OFF; owner toggles it on the Account page or with `set-claude-access`) and the job:

| Job | claude_access ON | OFF |
|---|---|---|
| tutor (`/api/ask`) | `EDU_MODEL_TUTOR_CLAUDE` | `EDU_MODEL_TUTOR_NORMAL` |
| quiz, fresh quiz, grading | `EDU_MODEL_ARG_CLAUDE` | `EDU_MODEL_ARG_NORMAL` |

Keys live in `provider.env` (read per call). A missing key falls back to `EDU_TUTOR_MODEL` (tutor,
Claude only), then `EDU_QUIZ_MODEL`. Code: `settings.model_for`, `main._routed`. Gate: `gates/gate-r-route.mjs`.
