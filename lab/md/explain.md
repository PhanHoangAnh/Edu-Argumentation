# Lab — explain

Lab is where a lesson's code is **edited and run**. It is a separate add-on to the study app
(ruling R10) and the only place the shared code runner is used (ruling R27, 24-09-26). The reading
pages stay static + Copy (R24): the reader only links here.

- **Service:** `foxai-edu-lab` on nn, `0.0.0.0:8798` (since 24-09-26; was loopback), single uvicorn worker.
- **Two doors:** public `https://<ip>/lab/` via nginx, and VPN `http://<host>:8798/lab/` — **the VPN
  door works with the public port closed.**
  - **Public:** `https://160.30.252.66/lab/` — a `location /lab/` in the study app's 443 server
    (`deploy/nginx-edu-study-public.conf`). `/lab` → 301 `/lab/`.
  - **VPN door:** `http://192.168.100.66:8798/lab/` — ufw admits 8798 only from `10.10.100.0/24`
    (plus the cluster LAN's blanket `192.168.100.0/24` rule, same as `:8767`). Added after the user
    report *"i press the lab button, and it open the platform page"*: on the VPN study origin
    `http://<host>:8767` the reader's relative `/lab/...` link hit the STUDY app, which served its
    own SPA. Now the study app bounces any plain-HTTP `/lab[/...]` GET to `http://<host>:8798/lab/...`
    (`app/backend/main.py` `_lab_redirect`, before sign-in), and Lab's direct door sends an anonymous
    page to `http://<host>:8767/login?next=/lab/...` (`lab_server.py` `_login_base`); after sign-in
    the study app lands on `/lab/...` and bounces back. The `edu_session` cookie is host-scoped (ports
    are ignored by cookies) and not `Secure` on the HTTP door, so the browser sends it to `:8798`.
    Nothing on this path touches nginx/443: the SPA's assets and `/lab/api` are same-origin relative
    paths, the header's "Back to study" link targets `:8767` when opened on `:8798`, and the sign-in
    check stays loopback (`127.0.0.1:8767/api/auth/me`). Gates: `bind_gate` in `deploy-lab.sh`,
    `S-vpn-lab` / `S-vpn-no-443` / `S-public-lab` in `gates/gate-lab-doors.mjs`.
  - "Direct" = plain HTTP from a non-loopback peer. Through nginx uvicorn sees `https` (it trusts
    `X-Forwarded-*` only from 127.0.0.1), and nn-local curls to `127.0.0.1:8798` keep the relative
    `/login` redirect.
- **Sign-in:** the study app's account. Lab has no accounts of its own.
- **Runs on:** `foxai-edu-runner` on dn2 `192.168.100.68:8790` (re-enabled 24-09-26 for Lab only).

⛔ Port **8798**, never 8793/8794 — those are Airflow's worker/trigger log servers (`airflow.cfg`).

## Request flow

```
browser  https://160.30.252.66/lab/...   (edu_session cookie, Path=/)
  -> nginx 443  location /lab/  -> 127.0.0.1:8798   (Host, X-Forwarded-*; no inner add_header)
browser  http://192.168.100.66:8798/lab/...   (VPN door, same cookie; no nginx)
     -> lab_server.py
          sign-in:  GET http://127.0.0.1:8767/api/auth/me   (ONLY the edu_session cookie forwarded,
                    2 s timeout, 200/401 cached 30 s by sha256(cookie))
          listing:  library/*/module.json + /srv/foxai/edu-study/web/data/*.json  (read-only, "rb")
          run:      POST http://192.168.100.68:8790/run  X-Edu-Runner-Key  (key read per call from
                    ~/.config/foxai/edu-lab.env, 600)  session = lab-acct-%08d(account id)
```

## Measured contracts this depends on (24-09-26)

| What | Where | Shape |
|---|---|---|
| Sign-in check | `app/backend/main.py` `require_session` + `/api/auth/me` | 200 `{"account":{"id":int,"displayName":…}}` · 401 not signed in · 503 store down. Lab: anything but 200 + int id = not signed in; 503/timeout/refused = Lab **503** (never 401, never a login loop). |
| Book enumeration | `app/backend/content.py` `list_packaged_books` / `list_data_books` | packaged `library/<id>/module.json` (id = folder, matches `^[a-z0-9][a-z0-9-]{1,63}$`), legacy `web/data/*.json` minus `test_*`. |
| Same-origin | `app/backend/main.py` `_same_origin` | no `Origin`, or `Origin`'s host == `Host`. Lab copies it exactly. |
| Runner | `ml/study/edu-runner/runner.py` | `SESSION ^[A-Za-z0-9_-]{8,64}$` (so a bare account id "1" is refused — hence `lab-acct-00000001`), `MODULE ^[a-z0-9][a-z0-9-]{1,63}$`, `LESSON ^ch\d{2}-b\d{2}$`, 64 KB per cell source, 60 s per cell, 80 s per request, all kernels busy → HTTP 503. |

## What counts as "a lesson with code" — the ONE D5 rule

Defined in `backend/library.py` (`lesson_code`) and mirrored **rule for rule** in the reader's
`app/frontend/src/reader/labCode.ts` (which decides whether the reader shows the Lab button).
Gate T2-xref runs the reader's own `labCode.ts` against Lab's list; they must be equal sets.

1. the first `card` block titled `Full script…` — its ``` fence bodies (no fence → the card text);
2. else every non-blank cell of every `code_cells` **block** (a block type, not an item field);
3. else every non-blank ` ```python ` fence in `text` and `card` blocks.

A plain-string item is normalised first like the reader's `blocksOfChapter`
(`{term: "Point N", blocks: [{type: "text", content}]}`). Lesson id = `chNN-bMM` by position; the
lesson number shown (`13. Title`) is `MM`. Lessons without code are not listed; a book with no code
lesson is not listed (today: all three legacy `data/*.json` books). Baseline 24-09-26: geron-homl3
**245**, openintro **4** (grows as chapter scripts are added — the index re-reads a file when its
mtime/size changes; a file that fails to parse keeps its last good entry).

## Files

| File | Purpose | Input | Output | How |
|---|---|---|---|---|
| `backend/lab_server.py` | the FastAPI app | HTTP under `/lab/` | JSON API + the built SPA | routes mounted literally at `/lab/...`. POST order: `Content-Type: application/json` (415) → same-origin (403) → signed in (401/503) → body ≤ 256 KB (413, header AND stream) → `book`/`lesson` valid (400/404) → code ≤ 64 KB (413) → 60 runs / rolling 60 s / account (429) → runner. Any `session` in the body is ignored. Pages: signed in → `index.html`; not → 302 `/login?next=<path>`; sign-in service down → a plain 503 page. One journald line per run: account, book, lesson, status, ms (never code). |
| `backend/lab_auth.py` | sign-in check | `edu_session` cookie | Account / None / UNAVAILABLE | see flow above. Named `lab_auth`, not `auth`, so it can never be mistaken for the study app's `auth` module (gate T1-ro greps for study imports). Drops the study app's refreshed `Set-Cookie`. |
| `backend/library.py` | book + lesson index | module JSON files (read-only) | books → chapters → lessons with code | the D5 rule above; mtime cache; legacy book id = `moduleIdFor` rule (explicit `moduleId`, else `f-<file stem>`) |
| `backend/runner_proxy.py` | the only runner caller | account id, book, lesson, code | runner JSON (+ `heavy`) | key + URL read from `EDU_LAB_ENV_FILE` per call; session `lab-acct-%08d`; 90 s timeout; runner `status:"timeout"` or our timeout → `heavy:true` + the R13 sentence *"This script is too heavy for the shared runner — Copy it and run it in geron-lab on your PC"*; runner 503 → Lab 503 "runner busy — try again in a minute"; network error / 401 / 403 → 502 "runner offline"; sliding-window rate limit. |
| `backend/requirements.txt` | pins | — | venv | fastapi/uvicorn/starlette/pydantic = the study venv's versions; httpx 0.28.1 (not in the study venv) |
| `frontend/` | React 19 + TS + Vite + Tailwind **build** (R8) | — | `dist/` | `base: '/lab/'`; `tailwind.config.js` theme copied verbatim from `app/frontend` (gate T1-tokens diffs them); no Tailwind CDN (T1-cdn). `src/App.tsx` routing `/lab/<book>/<lesson>`, `components/` Header · BookPicker · LessonList · CodeEditor (textarea, Tab = 4 spaces, Ctrl+Enter runs) · ResultPanel (ported from `geron-lab/viewer/page.html`: stdout, stderr red, traceback, PNG inline, HTML tables in `<iframe srcdoc sandbox="">`) · LayoutToggle. Edits: `localStorage["lab:code:<book>:<lesson>"]` until Reset; layout: `localStorage["lab:layout"]`. |
| `deploy/foxai-edu-lab.service` | systemd unit | `~/.config/foxai/edu-lab.env` | running service | `0.0.0.0:8798` (nginx + VPN door), 1 worker, `MemoryMax=256M`, `ProtectSystem=strict`, `ReadOnlyPaths=/home/ubuntu/foxai-data /srv/foxai/edu-study`, `PrivateTmp`, `NoNewPrivileges`, `StartLimitIntervalSec=60`/`Burst=5` |
| `deploy/deploy-lab.sh` | deploy / rollback from the work PC | this tree (frontend prebuilt) | `/srv/foxai/edu-lab/{backend,web}` | preflight (memory ≥ 700 MB; nothing but Lab on 8798; Airflow does not claim it) → first-run setup (env file via the key pipe, venv, unit, ufw — each idempotent) → snapshot → rsync `--delete` → sha256 manifest gate → restart → NRestarts sampled twice + health + content gates → **any** failure rolls back. `--rollback [SNAP]`, `--list-snapshots`. RETAIN 5, name-ordered. |

## Where things live on nn

| Path | What |
|---|---|
| `/srv/foxai/edu-lab/{backend,web}` | deployed code (rsync `--delete` target — never put state here) |
| `/srv/foxai/edu-lab.snapshots/` | deploy snapshots (5 kept) |
| `/home/ubuntu/edu-lab-venv/` | Python 3.10 venv (outside the rsync tree) |
| `/home/ubuntu/.config/foxai/edu-lab.env` | `EDU_RUNNER_KEY`, `EDU_LAB_RUNNER_URL` — ubuntu, **600** |
| `/etc/systemd/system/foxai-edu-lab.service` | unit (enabled) |
| ufw | `8798/tcp ALLOW 10.10.100.0/24` (sibling shape; the service binds loopback, so it is inert) |

⛔ The runner key lives in **exactly two** places: dn2 `/etc/edu-runner/runner.env` and nn
`edu-lab.env` (R27 rule 6). The R24-era copies in nn `provider.env` and `provider.import.env` were
removed 24-09-26 (backups `~/backups/provider-env-lab-*`, `~/backups/provider-import-env-lab-*`).
Never run `deploy-runner.sh --push-key-nn` again — it writes the key back into `provider.env`.

## Accepted risk (R27)

The runner has **open network egress** (lessons download their datasets). Anyone signed in can make
dn2 fetch from the internet or reach LAN hosts the `edu-runner` user can reach. Accepted because
access is sign-in-only and there are 3 known accounts — revisit before any account outside that set
is created.

## Operate

```bash
bash ml/study/Edu-Argumentation/lab/deploy/deploy-lab.sh              # deploy (build lab/frontend first)
bash ml/study/Edu-Argumentation/lab/deploy/deploy-lab.sh --rollback   # newest snapshot
ssh nn 'sudo systemctl disable --now foxai-edu-lab'                   # take Lab away entirely
ssh nn 'journalctl -u foxai-edu-lab -n 50 --no-pager'                 # who ran what (no code logged)
bash ml/study/Edu-Argumentation/gates/run-gates-lab.sh                # G-lab (needs ≥ 6000 MB free locally)
```
