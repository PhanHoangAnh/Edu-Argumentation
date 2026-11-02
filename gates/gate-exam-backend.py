#!/usr/bin/env python3
"""gate-exam-backend.py — G8, exam-recall-suite P3 (22-10-26): the server half of the timed mock exam
(addons/exam.py, addons/exam_blueprint.py, store.py P3 block) and migration 007_exam_runs.sql.

Leg 1 (always; plain python3, no service, no database) imports exam_blueprint.py (+ store.py) and reads
exam.py / migration 007 as text/AST, with the fixture books of gates/stubs/exam_fixture.py:
  A  largest remainder: 65 x 24/30/34/12 = 16/19/22/8 (sum EXACTLY 65); any n sums to n; caps re-split;
  B  the exam block: valid -> exam mode (65 q / 90 min / scale 100-1000 / pass 700, read-only numbers);
     invalid variants ignored -> practice; NO block -> practice defaults min(40, pool) / 60, editable,
     bounds 1..pool / 1..300, no scaled score;
  P  a run's pick: per-domain counts 16/19/22/8 with the block; chapter-proportional without; 65 distinct
     keys from the book; grading snapshot (correct shape, options, area);
  G  grading: exact choose-N set, unanswered = wrong, per-area right/total/pct, answer_log rows only for
     answered questions with a stable client_id; Estimate ONLY with passScaled (linear, labelled);
  C  clock: an answer AT the deadline is late; remaining seconds never negative;
  M  migration 007: one new table + the partial UNIQUE index (WHERE finished_at IS NULL), IF NOT EXISTS,
     nothing destructive; rollback manual-only (not picked up by the runner);
  R  exam.py: exactly the 5 routes; every POST through core._gate; the account from the session only.

Leg 2 (`--live`; run with the TEST venv) runs every P3 SQL statement for real against the ISOLATED gate
database `edu_study_gate` (never `edu_study`): tunnel -> `admin migrate --no-backup` x2 -> 2 throwaway
accounts -> a gate library under /var/tmp (the 2 fixture books) -> a local uvicorn of THIS backend on
127.0.0.1:$EB_PORT -> HTTP checks -> accounts deleted (cascade), uvicorn + tunnel stopped.
  L  schema version 7, exam_runs + exam_runs_one_open (UNIQUE, partial), rerun no-op;
  S  start -> 201 (16/19/22/8, 90 min by the SERVER clock) -> Start again = the same run (200 resumed);
  K  RACE: 8 concurrent Starts of one account x book -> exactly one 201, the rest resume it, 1 open row;
  J  answers + flags round-trip through JSONB (int, sorted choose-N list, null clears); bad shapes 400;
     the exam flag also writes question_flags;
  X  another account: answer / flag / finish of A's run -> 404; its open read sees no run of A;
  D  deadline (gate DB `deadline_at` moved into the past): late answer 409 code deadline, NOT saved, run
     closed by "deadline"; Submit after that -> 200 alreadyFinished; answer_log written ONCE;
     GET open past the deadline closes the run (expiredNow) and shows it as `last`;
  F  Submit -> result; a retried Submit -> the same result, alreadyFinished true; answer after -> 409;
  E  result with the block: raw, 4 domain areas, Estimate = linear, passedEstimate, scaledIsEstimate;
     without the block: scaled null, no pass/fail, chapter areas;
  Q  restart=true submits the open run first (previous.finishedBy "restart");
  V  bad numbers / unknown book -> 400; signed out -> 401 (5 routes); cross-origin POST -> 403; no traceback.

Run:  python3 gates/gate-exam-backend.py
      /var/tmp/edu-study-testvenv/bin/python3 gates/gate-exam-backend.py --live
Env:  EB_BACKEND (default app/backend; point it at a /var/tmp copy to fault-inject), EB_PORT (8789),
      EB_GATE_DB_ENV (default ~/.config/foxai/edu-study-gate-db.env).
Exit 1 on any FAIL. ⚠ After a mutation run, clear __pycache__ of the mutated copy.
Fails when (red proofs, gates/README.md): largest remainder floors without the remainder (A1 -> 64, P1, S2);
the deadline compares with > instead of >= (C1); the run lookup is not scoped to the account (X);
the estimate is computed without passScaled (G6, E2); the lost-race fallback is removed (K).
"""
import ast, importlib.util, json, os, random, re, secrets, socket, subprocess, sys, threading, time, uuid
import urllib.error, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = Path(os.environ.get("EB_BACKEND") or REPO / "app" / "backend").resolve()
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(REPO / "gates" / "stubs"))
import logging
logging.disable(logging.WARNING)            # the ignored-block warnings are expected here
import store                                  # noqa: E402  (BACKEND's store)
_spec = importlib.util.spec_from_file_location("exam_blueprint", BACKEND / "addons" / "exam_blueprint.py")
rules = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(rules)
import exam_fixture as fx                     # noqa: E402
results = []


def check(cid, ok, detail=""):
    results.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'}  {cid}  {detail}")


def raises(fn, *args):
    try:
        fn(*args)
    except ValueError:
        return True
    return False


BOOKS = fx.books()
EXB, NOB = BOOKS[fx.EXAM_BOOK], BOOKS[fx.NOEXAM_BOOK]

# ---------------------------------------------------------------------------- A: allocation
lr = rules.largest_remainder(65, [24, 30, 34, 12])
check("A1 65 x 24/30/34/12 -> 16/19/22/8, sum exactly 65", lr == [16, 19, 22, 8] and sum(lr) == 65, f"{lr} sum {sum(lr)}")
rng = random.Random(7)
bad = []
for _ in range(500):
    n, w = rng.randint(0, 300), [rng.randint(0, 50) for _ in range(rng.randint(1, 9))]
    out = rules.largest_remainder(n, w)
    if sum(out) != n or len(out) != len(w):
        bad.append((n, w, out))
check("A2 500 random splits: every one sums exactly to n", not bad, str(bad[:1]))
al = rules.allocate(65, [24, 30, 34, 12], [5, 40, 40, 40])
check("A3 caps: D1 has only 5 -> 5, the other 60 re-split by weight, sum 65", al[0] == 5 and sum(al) == 65 and all(a <= c for a, c in zip(al, [5, 40, 40, 40])), str(al))
check("A4 caps smaller than n: sum = all there is", sum(rules.allocate(65, [1, 1], [3, 4])) == 7)

# ---------------------------------------------------------------------------- B: the exam block
st = rules.exam_settings(EXB)
check("B1 fixture block valid -> 65 q / 90 min / 100-1000 / pass 700 / 4 domains", st and (st["questions"], st["minutes"], st["scaleMin"], st["scaleMax"], st["passScaled"], len(st["domains"]))
      == (65, 90, 100, 1000, 700, 4), json.dumps({k: st[k] for k in ("questions", "minutes", "scaleMin", "scaleMax", "passScaled")}) if st else "None")
pv = rules.preview(EXB)
check("B2 preview with block: mode exam, NOT editable (isDefault false, no max), scaled present, 4 weighted domains, pool 104",
      pv["mode"] == "exam" and pv["isDefault"] is False and pv["maxQuestions"] is None and pv["questions"] == 65 and pv["minutes"] == 90
      and pv["scaled"] == {"passScaled": 700, "scaleMin": 100, "scaleMax": 1000} and [a["weight"] for a in pv["areas"]] == [24, 30, 34, 12]
      and pv["poolSize"] == 104, json.dumps({k: pv[k] for k in ("mode", "questions", "minutes", "isDefault", "poolSize", "scaled")}))
pn = rules.preview(NOB)
check("B3 preview without block: practice, editable defaults 30 q (min(40, pool 30)) / 60 min, max 30 / 300, NO scaled, chapter areas",
      pn["mode"] == "practice" and pn["isDefault"] is True and (pn["questions"], pn["minutes"], pn["maxQuestions"], pn["maxMinutes"]) == (30, 60, 30, 300)
      and pn["scaled"] is None and pn["areaKind"] == "chapter" and len(pn["areas"]) == 5, json.dumps({k: pn[k] for k in ("mode", "questions", "minutes", "maxQuestions", "scaled")}))


def with_exam(**change):
    d = json.loads(json.dumps(EXB)); d["exam"].update(change)
    for k in [k for k, v in change.items() if v is None]:
        d["exam"].pop(k)
    return d


for name, d in (("questions 0", with_exam(questions=0)), ("minutes missing", with_exam(minutes=None)), ("passScaled > max", with_exam(passScaled=1200)),
                ("scale mixed with scaleMax", with_exam(scaleMax=1000)), ("weights sum 90", (lambda d: (d["exam"]["domains"][0].update(weight=14), d)[1])(json.loads(json.dumps(EXB))))):
    p = rules.preview(d)
    check(f"B-bad {name} -> block ignored: practice, no scaled score", p["mode"] == "practice" and p["scaled"] is None and p["isDefault"] is True, p["mode"])
nos = with_exam(passScaled=None)
check("B4 block without passScaled: exam mode, but NO scaled score", rules.preview(nos)["mode"] == "exam" and rules.preview(nos)["scaled"] is None)
check("B5 without block: 31 questions / 0 / 301 minutes / 'x' -> 400; 1 q 1 min fine", raises(rules.plan_run, NOB, 31, 10) and raises(rules.plan_run, NOB, 10, 0)
      and raises(rules.plan_run, NOB, 10, 301) and raises(rules.plan_run, NOB, "x", 10) and rules.plan_run(NOB, 1, 1)["questions"] == 1)
check("B6 with block: the request's numbers are ignored (65 / 90)", (lambda p: (p["questions"], p["minutes"], p["mode"]))(rules.plan_run(EXB, 5, 1)) == (65, 90, "exam"))

# ---------------------------------------------------------------------------- P: picking a run
run = rules.build_run(rules.plan_run(EXB), random.Random(1))
keys = run["question_keys"]
per = {}
for k in keys:
    per[run["grading"][k]["area"]] = per.get(run["grading"][k]["area"], 0) + 1
check("P1 with block: 65 distinct keys, D1/D2/D3/D4 = 16/19/22/8 (blueprint says the same)", len(keys) == 65 == len(set(keys))
      and per == {"D1": 16, "D2": 19, "D3": 22, "D4": 8} and [a["count"] for a in run["blueprint"]["areas"]] == [16, 19, 22, 8], json.dumps(per))
pool_keys = {q["source"]["question"] for q in EXB["quizData"]}
check("P2 every key is a book question; grading snapshot = the book's correct + option count", set(keys) <= pool_keys
      and all(run["grading"][k]["correct"] == fx.correct_of(k) and run["grading"][k]["options"] == (5 if k in fx.CHOOSE_N else 4) for k in keys))
check("P3 blueprint snapshot: mode exam, 90 min, pass 700, scale 100-1000, areaKind domain", (run["blueprint"]["mode"], run["blueprint"]["minutes"], run["blueprint"]["passScaled"],
      run["blueprint"]["scaleMin"], run["blueprint"]["scaleMax"], run["blueprint"]["areaKind"]) == ("exam", 90, 700, 100, 1000, "domain"))
rn = rules.build_run(rules.plan_run(NOB, 10, 5), random.Random(2))
cper = {}
for k in rn["question_keys"]:
    cper[rn["grading"][k]["area"]] = cper.get(rn["grading"][k]["area"], 0) + 1
check("P4 without block: chapter-proportional (5 chapters x 6 -> 10 q = 2 each), areaKind chapter, no scale",
      cper == {f"ch0{c}": 2 for c in range(1, 6)} and rn["blueprint"]["areaKind"] == "chapter" and rn["blueprint"]["passScaled"] is None, json.dumps(cper))
check("P5 two runs pick differently (random sample + shuffle)", rules.build_run(rules.plan_run(EXB), random.Random(3))["question_keys"] != keys)

# ---------------------------------------------------------------------------- G: grading + estimate
now = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)
row = {"id": str(uuid.uuid4()), "account_id": 1, "module_id": fx.EXAM_BOOK, "started_at": now, "deadline_at": now + timedelta(minutes=90),
       "question_keys": keys, "grading": run["grading"], "blueprint": run["blueprint"], "answers": {}, "flags": [keys[0]]}
right_keys = keys[:48]
for k in right_keys:
    row["answers"][k] = fx.correct_of(k)
wrong_k = keys[48]
c = fx.correct_of(wrong_k)
row["answers"][wrong_k] = [0, 1] if isinstance(c, list) and c != [0, 1] else ([0, 3] if isinstance(c, list) else (c + 1) % 4)
g = rules.grade_run(row)
check("G1 48 right + 1 wrong + 16 unanswered -> 48/65; unanswered count as wrong", g["right"] == 48 and g["total"] == 65
      and sum(1 for q in g["questions"] if q["chosen"] is None) == 16, f"{g['right']}/{g['total']}")
check("G2 per-area totals 16/19/22/8 and right sums to 48", [a["total"] for a in g["areas"]] == [16, 19, 22, 8] and sum(a["right"] for a in g["areas"]) == 48
      and all(a["pct"] == round(100 * a["right"] / a["total"]) for a in g["areas"]), json.dumps([(a["id"], a["right"], a["total"]) for a in g["areas"]]))
exp = round(100 + 900 * 48 / 65)
check(f"G3 Estimate = linear 100 + 900 x 48/65 = {exp}, pass 700 -> passedEstimate true, method says unpublished",
      g["scaled"] and g["scaled"]["estimate"] == exp and g["scaled"]["passedEstimate"] is True and "unpublished" in g["scaled"]["method"], json.dumps(g["scaled"]))
check("G4 answer_log rows: answered only (49), client_id = uuid5(run:key) (stable), domain = the area",
      len(g["log"]) == 49 and g["log"][0]["client_id"] == rules.grade_run(row)["log"][0]["client_id"] and all(e["domain"] in ("D1", "D2", "D3", "D4") for e in g["log"]))
check("G5 choose-N EXACT set: [0,2] right · [0] / [0,1,2] / [2,0,0] wrong · int wrong", rules.is_right([0, 2], [2, 0]) and not rules.is_right([0, 2], [0])
      and not rules.is_right([0, 2], [0, 1, 2]) and not rules.is_right([0, 2], [2, 0, 0]) and not rules.is_right([0, 2], 0) and not rules.is_right(1, None))
gn = rules.grade_run({**row, "question_keys": rn["question_keys"], "grading": rn["grading"], "blueprint": rn["blueprint"],
                      "answers": {k: fx.correct_of(k) for k in rn["question_keys"]}})
check("G6 without the block: all right -> 10/10 but scaled None (no Estimate, no pass/fail)", gn["right"] == 10 and gn["scaled"] is None, json.dumps(gn["scaled"]))
lo = rules.scaled_estimate(0, 65, run["blueprint"]); hi = rules.scaled_estimate(65, 65, run["blueprint"])
check("G7 0 right -> 100 below pass; 65 right -> 1000 pass", lo["estimate"] == 100 and lo["passedEstimate"] is False and hi["estimate"] == 1000 and hi["passedEstimate"] is True)
snap1, snapn = run["grading"][next(k for k in keys if k not in fx.CHOOSE_N)], {"correct": [0, 2], "options": 5}
check("G8 validate_chosen: 0..3 ok; 4 / -1 / True / [1] -> 400; choose-N [2,0] -> [0,2]; [0,0] / [] / 1 -> 400; null clears",
      rules.validate_chosen(3, snap1) == 3 and raises(rules.validate_chosen, 4, snap1) and raises(rules.validate_chosen, -1, snap1) and raises(rules.validate_chosen, True, snap1)
      and raises(rules.validate_chosen, [1], snap1) and rules.validate_chosen([2, 0], snapn) == [0, 2] and raises(rules.validate_chosen, [0, 0], snapn)
      and raises(rules.validate_chosen, [], snapn) and raises(rules.validate_chosen, 1, snapn) and rules.validate_chosen(None, snap1) is None)
rv = rules.result_view({**row, "result": {k: g[k] for k in ("right", "total", "scaled", "areas", "questions")}, "finished_at": now, "finished_by": "submit"})
check("G9 result view: rawPct 74, unanswered 16, scaledIsEstimate true", rv["rawPct"] == 74 and rv["unanswered"] == 16 and rv["scaledIsEstimate"] is True)

# ---------------------------------------------------------------------------- C: clock
d0 = now + timedelta(minutes=1)
check("C1 an answer AT the deadline is late; 1 ms before is not", rules.is_expired(d0, d0) and not rules.is_expired(d0, d0 - timedelta(milliseconds=1)))
check("C2 remaining seconds: 90 min = 5400, past = 0 (never negative)", rules.remaining_seconds(now + timedelta(minutes=90), now) == 5400 and rules.remaining_seconds(now, d0) == 0)
check("C3 start decision: none -> create · open in time -> resume · expired or restart -> finish-then-create",
      rules.start_decision(None, now, False) == "create" and rules.start_decision(row, now, False) == "resume"
      and rules.start_decision(row, now, True) == "finish-then-create" and rules.start_decision(row, now + timedelta(minutes=90), False) == "finish-then-create")

# ---------------------------------------------------------------------------- M: migration 007
mdir = BACKEND / "migrations"
m7 = mdir / "007_exam_runs.sql"
sql7 = m7.read_text(encoding="utf-8") if m7.is_file() else ""
code7 = "\n".join(l for l in sql7.splitlines() if not l.strip().startswith("--"))
stm = [re.sub(r"\s+", " ", x.strip()) for x in code7.split(";") if x.strip()]
check("M1 007 = CREATE TABLE IF NOT EXISTS exam_runs + 2 CREATE INDEX IF NOT EXISTS", len(stm) == 3 and stm[0].startswith("CREATE TABLE IF NOT EXISTS exam_runs (")
      and all(s.startswith(("CREATE UNIQUE INDEX IF NOT EXISTS", "CREATE INDEX IF NOT EXISTS")) for s in stm[1:]), " | ".join(s[:60] for s in stm))
check("M2 one open run per account x book: UNIQUE (account_id, module_id) WHERE finished_at IS NULL",
      any(s == "CREATE UNIQUE INDEX IF NOT EXISTS exam_runs_one_open ON exam_runs (account_id, module_id) WHERE finished_at IS NULL" for s in stm))
check("M3 nothing destructive, no other table touched (the FK's ON DELETE CASCADE aside)", not re.search(r"\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE|INSERT|RENAME)\b",
      code7.replace("ON DELETE CASCADE", ""), re.I) and "REFERENCES accounts (id) ON DELETE CASCADE" in code7)
names = sorted(p.name for p in mdir.glob("*.sql") if re.match(r"^\d{3}_[a-z0-9_]+\.sql$", p.name))
check("M4 007 is the newest migration (006 = ease floor)", names[-2:] == ["006_ease_floor.sql", "007_exam_runs.sql"], ",".join(names[-3:]))
down7 = mdir / "rollback" / "007_exam_runs.down.sql"
dt = down7.read_text(encoding="utf-8") if down7.is_file() else ""
check("M5 manual rollback in rollback/ (not run by the runner): drops exam_runs, forgets version 7", down7.is_file() and not list(mdir.glob("*down*.sql"))
      and "DROP TABLE IF EXISTS exam_runs" in dt and "DELETE FROM schema_migrations WHERE version = 7" in dt)

# ---------------------------------------------------------------------------- R: routes
esrc = (BACKEND / "addons" / "exam.py").read_text(encoding="utf-8")
etree = ast.parse(esrc)
eroutes = {}
for fn in [x for x in ast.walk(etree) if isinstance(x, ast.FunctionDef)]:
    for d in fn.decorator_list:
        if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.args:
            eroutes[(d.func.attr, d.args[0].value)] = fn.name
check("R1 exam.py declares exactly the 5 exam routes", set(eroutes) == {("get", "/api/exam/open"), ("post", "/api/exam/start"), ("post", "/api/exam/answer"),
      ("post", "/api/exam/flag"), ("post", "/api/exam/finish")}, str(sorted(eroutes)))
posts = [fn for fn in ast.walk(etree) if isinstance(fn, ast.FunctionDef) and any(isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "post" for d in fn.decorator_list)]
check("R2 every POST calls _limited first, and _limited calls core._gate", len(posts) == 4 and all(ast.unparse(p.body[0]).startswith("blocked = _limited(req)") for p in posts)
      and "blocked = core._gate(req)" in esrc)
check("R3 the account is the session's (req.account / core._account), never a body field", esrc.count("req.account.id") == 4 and "core._account(request).id" in esrc
      and not re.search(r"payload\.get\(['\"]account", esrc))
check("R4 the router is registered", "exam.router" in (BACKEND / "addons" / "__init__.py").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------- live (gate DB)
def live() -> None:
    env_path = Path(os.environ.get("EB_GATE_DB_ENV") or Path.home() / ".config/foxai/edu-study-gate-db.env")
    env_text = env_path.read_text(encoding="utf-8")
    if "EDU_DB_NAME=edu_study_gate" not in env_text.splitlines():
        check("L0 gate DB env points at edu_study_gate", False, str(env_path)); return
    os.environ["EDU_DB_ENV_PATH"] = str(env_path)
    import db                                       # BACKEND's db, reading the GATE env above
    db_port = int(re.search(r"^EDU_DB_PORT=(\d+)", env_text, re.M).group(1))
    port = int(os.environ.get("EB_PORT", "8789"))
    py = sys.executable
    run_env = {**os.environ, "EDU_DB_ENV_PATH": str(env_path)}
    tunnel = None
    open_port = lambda p: socket.socket().connect_ex(("127.0.0.1", p)) == 0
    if not open_port(db_port):
        tunnel = subprocess.Popen(["ssh", "-N", "-o", "ExitOnForwardFailure=yes", "-L", f"127.0.0.1:{db_port}:127.0.0.1:5432", "nn"])
        for _ in range(40):
            if open_port(db_port): break
            time.sleep(0.25)
    work = Path("/var/tmp/p3c-eb")
    fx.write_library(work / "lib")
    (work / "settings.json").write_text('{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n')
    (work / "progress.json").write_text('{"version":2,"modules":{}}\n')
    admin = lambda *a, stdin=None: subprocess.run([py, "-m", "admin", *a], cwd=BACKEND, env=run_env, input=stdin, capture_output=True, text=True)
    users = [f"gate-eb-{secrets.token_hex(3)}", f"gate-eb-{secrets.token_hex(3)}"]
    server = None
    logp = Path("/var/tmp/p3c-eb-uvicorn.log")
    EX, NO = fx.EXAM_BOOK, fx.NOEXAM_BOOK
    try:
        newest = max(int(p.name[:3]) for p in (BACKEND / "migrations").glob("*.sql") if re.match(r"^\d{3}_[a-z0-9_]+\.sql$", p.name))
        m1, m2 = admin("migrate", "--no-backup"), admin("migrate", "--no-backup")
        check(f"L1 migrate on the gate DB -> schema version 7 (newest file here: {newest})", m1.returncode == 0 and newest == 7 and "schema version: 7" in m1.stdout,
              (m1.stdout + m1.stderr).strip().replace("\n", " | "))
        check("L2 a second migrate applies nothing (rerun safe)", m2.returncode == 0 and "nothing (up to date)" in m2.stdout, m2.stdout.strip().replace("\n", " | "))
        idx = db.fetch_all("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'exam_runs' ORDER BY indexname")
        one = [i["indexdef"] for i in idx if i["indexname"] == "exam_runs_one_open"]
        check("L3 exam_runs exists; exam_runs_one_open is UNIQUE and partial (finished_at IS NULL)", one and "UNIQUE" in one[0] and "WHERE (finished_at IS NULL)" in one[0],
              " | ".join(i["indexname"] for i in idx))

        tokens = []
        for u in users:
            made = admin("create-user", "--username", u, "--display-name", "Gate EB", stdin=secrets.token_urlsafe(18) + "\n")
            tokens.append(admin("mint-session", "--username", u, "--ttl", "900").stdout.strip())
            check(f"L4 throwaway account {u} + session", made.returncode == 0 and len(tokens[-1]) > 20, (made.stdout + made.stderr).strip()[:100])
        ida, idb = [db.fetch_all("SELECT id FROM accounts WHERE username = %s", (u,))[0]["id"] for u in users]
        server = subprocess.Popen([py, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=BACKEND,
                                  env={**run_env, "EDU_LIBRARY_ROOT": str(work / "lib"), "EDU_SETTINGS_PATH": str(work / "settings.json"),
                                       "EDU_PROGRESS_PATH": str(work / "progress.json"), "EDU_LIBRARY_META_PATH": str(work / "library-meta.json"),
                                       "EDU_BOOK_ROOT": str(work / "books"), "EDU_ENV_PATH": str(work / "provider.env"), "EDU_ASSET_ROOT": str(work / "assets")},
                                  stdout=open(logp, "w"), stderr=subprocess.STDOUT)
        base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            if open_port(port): break
            time.sleep(0.25)

        def call(method, path, body=None, who=0, origin=None):
            req = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode())
            req.add_header("Content-Type", "application/json")
            if origin: req.add_header("Origin", origin)
            if who is not None: req.add_header("Cookie", f"edu_session={tokens[who]}")
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    return r.status, json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as err:
                raw = err.read()
                try: return err.code, json.loads(raw or b"{}")
                except ValueError: return err.code, {"raw": raw[:120].decode(errors="replace")}

        dbrun = lambda rid: db.fetch_all("SELECT answers, flags, finished_at, finished_by, raw_right, total, scaled_estimate FROM exam_runs WHERE id = %s", (rid,))[0]
        logged = lambda rid: db.fetch_all("SELECT count(*) AS n FROM answer_log WHERE run_id = %s AND run_kind = 'exam'", (rid,))[0]["n"]

        # ---- S: start / resume (book WITH the block) -----------------------------------------------
        st, op = call("GET", f"/api/exam/open?module={EX}")
        check("S1 open, block book: preview exam 65 q / 90 min / scaled pass 700, no run, no last", st == 200 and op["preview"]["mode"] == "exam" and op["preview"]["questions"] == 65
              and op["preview"]["scaled"] == {"passScaled": 700, "scaleMin": 100, "scaleMax": 1000} and op["run"] is None and op["last"] is None, json.dumps(op.get("preview"))[:160])
        st, s1 = call("POST", "/api/exam/start", {"module": EX, "questions": 5, "minutes": 1})
        r1 = s1.get("run") or {}
        per = {}
        for q in r1.get("questions", []):
            per[q["area"]] = per.get(q["area"], 0) + 1
        span = (datetime.fromisoformat(r1["deadlineAt"]) - datetime.fromisoformat(r1["startedAt"])).total_seconds() if r1 else 0
        check("S2 start -> 201, 65 questions 16/19/22/8 (request's 5 q / 1 min ignored), deadline = start + 90 min, ~5400 s left",
              st == 201 and s1.get("resumed") is False and r1.get("total") == 65 and per == {"D1": 16, "D2": 19, "D3": 22, "D4": 8} and span == 5400
              and 5390 <= r1.get("remainingSeconds", 0) <= 5400, f"{st} {json.dumps(per)} span {span} left {r1.get('remainingSeconds')}")
        st, s2 = call("POST", "/api/exam/start", {"module": EX})
        check("S3 Start again (reload / 2nd Start) -> 200 resumed, the SAME run, no second row", st == 200 and s2.get("resumed") is True and s2["run"]["id"] == r1["id"]
              and db.fetch_all("SELECT count(*) AS n FROM exam_runs WHERE account_id = %s AND module_id = %s", (ida, EX))[0]["n"] == 1, f"{st} {s2.get('resumed')}")
        st, o2 = call("GET", f"/api/exam/open?module={EX}")
        check("S4 open read returns the same run, deadline unchanged (the server's clock)", st == 200 and o2["run"]["id"] == r1["id"] and o2["run"]["deadlineAt"] == r1["deadlineAt"])

        # ---- J: answers + flags (JSONB round trips) --------------------------------------------------
        rid, qs = r1["id"], [q["key"] for q in r1["questions"]]
        multi = [q["key"] for q in r1["questions"] if q["choose"] > 1]
        single = [k for k in qs if k not in fx.CHOOSE_N]
        sts = [call("POST", "/api/exam/answer", {"runId": rid, "question": k, "chosen": fx.correct_of(k)})[0] for k in single[:40]]
        wrong_k = single[40]
        sts.append(call("POST", "/api/exam/answer", {"runId": rid, "question": wrong_k, "chosen": (fx.correct_of(wrong_k) + 1) % 4})[0])
        check("J1 41 single answers saved (40 right, 1 wrong) -> 200 each", sts == [200] * 41, f"{sts.count(200)} x 200")
        mres = []
        for k in multi:
            c = fx.correct_of(k)
            mres.append(call("POST", "/api/exam/answer", {"runId": rid, "question": k, "chosen": list(reversed(c))}))
        check("J2 choose-N answer sent reversed -> saved as the sorted list" + (" (no choose-N picked this run)" if not multi else ""),
              all(s == 200 and b["chosen"] == fx.correct_of(k) for (s, b), k in zip(mres, multi)), json.dumps([b.get("chosen") for _, b in mres]))
        st, cl = call("POST", "/api/exam/answer", {"runId": rid, "question": single[39], "chosen": None})
        dbr = dbrun(rid)
        expect = {k: fx.correct_of(k) for k in single[:39]} | {wrong_k: (fx.correct_of(wrong_k) + 1) % 4} | {k: fx.correct_of(k) for k in multi}
        check("J3 null clears an answer; DB answers JSONB == exactly what was sent (ints + sorted lists)", st == 200 and dbr["answers"] == expect
              and cl["answeredCount"] == len(expect), f"db {len(dbr['answers'])} expected {len(expect)} count {cl.get('answeredCount')}")
        bads = [call("POST", "/api/exam/answer", body)[0] for body in (
            {"runId": rid, "question": "ch99-b01-q1", "chosen": 0}, {"runId": rid, "question": single[0], "chosen": 9},
            {"runId": rid, "question": single[0], "chosen": [0, 1]}, {"runId": rid, "question": single[0]}, {"runId": "nope", "question": single[0], "chosen": 0},
            *([{"runId": rid, "question": multi[0], "chosen": 0}] if multi else []))]
        check("J4 bad answers -> 400 (key not in run · option 9 · list for single · no chosen · bad runId · int for choose-N)", all(s == 400 for s in bads), str(bads))
        f1 = call("POST", "/api/exam/flag", {"runId": rid, "question": qs[0], "flagged": True})
        f2 = call("POST", "/api/exam/flag", {"runId": rid, "question": qs[1], "flagged": True})
        f3 = call("POST", "/api/exam/flag", {"runId": rid, "question": qs[1], "flagged": False})
        qf = db.fetch_all("SELECT question_key FROM question_flags WHERE account_id = %s AND module_id = %s", (ida, EX))
        check("J5 flag / flag / unflag -> run flags [q1]; question_flags (the Flagged list) holds q1 only", f1[0] == f2[0] == f3[0] == 200 and f3[1]["flags"] == [qs[0]]
              and dbrun(rid)["flags"] == [qs[0]] and [r["question_key"] for r in qf] == [qs[0]], json.dumps(f3[1].get("flags")))
        check("J6 flag needs a boolean -> 400", call("POST", "/api/exam/flag", {"runId": rid, "question": qs[0], "flagged": "yes"})[0] == 400)

        # ---- X: another account ----------------------------------------------------------------------
        xs = [call("POST", "/api/exam/answer", {"runId": rid, "question": qs[2], "chosen": 0}, who=1)[0],
              call("POST", "/api/exam/flag", {"runId": rid, "question": qs[2], "flagged": True}, who=1)[0],
              call("POST", "/api/exam/finish", {"runId": rid}, who=1)[0]]
        st, ob = call("GET", f"/api/exam/open?module={EX}", who=1)
        check("X1 account B on A's run: answer / flag / finish -> 404; B's open read shows no run", xs == [404, 404, 404] and st == 200 and ob["run"] is None and ob["last"] is None, str(xs))
        check("X2 A's run untouched by B (still open, same answers)", dbrun(rid)["finished_at"] is None and dbrun(rid)["answers"] == expect)

        # ---- D: deadline (moved into the past on the gate DB, this run only) ---------------------------
        db.execute("UPDATE exam_runs SET started_at = now() - interval '91 minutes', deadline_at = now() - interval '1 second' WHERE id = %s AND account_id = %s", (rid, ida))
        st, late = call("POST", "/api/exam/answer", {"runId": rid, "question": single[39], "chosen": fx.correct_of(single[39])})
        dl = dbrun(rid)
        check("D1 late answer -> 409 code deadline with the result; NOT saved; run closed by 'deadline'", st == 409 and late.get("code") == "deadline" and late.get("result", {}).get("finishedBy") == "deadline"
              and single[39] not in dl["answers"] and dl["finished_by"] == "deadline" and dl["finished_at"] is not None, f"{st} {late.get('code')} {dl['finished_by']}")
        n1 = logged(rid)
        st, fin = call("POST", "/api/exam/finish", {"runId": rid})
        st2, fin2 = call("POST", "/api/exam/finish", {"runId": rid})
        check("D2 Submit after the deadline closed it -> 200 alreadyFinished, same result twice", st == st2 == 200 and fin["alreadyFinished"] is True and fin2["alreadyFinished"] is True
              and fin["result"] == fin2["result"] == late["result"])
        check(f"D3 answer_log: one row per ANSWERED question ({len(expect)}), written once (late reply + 2 Submits add nothing)", n1 == len(expect) == logged(rid)
              and db.fetch_all("SELECT count(DISTINCT question_key) AS n FROM answer_log WHERE run_id = %s", (rid,))[0]["n"] == len(expect), f"{n1} -> {logged(rid)}")
        st, again = call("POST", "/api/exam/answer", {"runId": rid, "question": single[0], "chosen": 0})
        check("D4 any answer after that -> 409 code finished", st == 409 and again.get("code") == "finished", f"{st} {again.get('code')}")

        # ---- E: the result WITH the block -----------------------------------------------------------
        res = late["result"]
        right = 39 + len(multi)
        est = round(100 + 900 * right / 65)
        check(f"E1 raw {right}/65, answered {len(expect)}, 4 domain areas whose totals are 16/19/22/8", res["right"] == right and res["total"] == 65 and res["answered"] == len(expect)
              and [a["id"] for a in res["areas"]] == ["D1", "D2", "D3", "D4"] and [a["total"] for a in res["areas"]] == [16, 19, 22, 8], f"{res['right']}/{res['total']} areas {[(a['id'], a['right'], a['total']) for a in res['areas']]}")
        sc = res.get("scaled") or {}
        check(f"E2 Estimate = {est} (linear), pass 700 -> passedEstimate {est >= 700}; scaledIsEstimate true; stored scaled_estimate matches",
              sc.get("estimate") == est and sc.get("passedEstimate") is (est >= 700) and sc.get("passScaled") == 700 and res["scaledIsEstimate"] is True
              and dl["scaled_estimate"] == est and dl["raw_right"] == right, json.dumps(sc)[:140])
        al = db.fetch_all("SELECT DISTINCT domain FROM answer_log WHERE run_id = %s ORDER BY 1", (rid,))
        check("E3 the exam's answer_log rows carry their domain (mastery reads them)", [r["domain"] for r in al] and set(r["domain"] for r in al) <= {"D1", "D2", "D3", "D4"}, json.dumps(al))
        st, o3 = call("GET", f"/api/exam/open?module={EX}")
        check("E4 open after finishing: no run, last = that result (Result button)", st == 200 and o3["run"] is None and o3["last"]["id"] == rid)

        # ---- K: the race (book WITHOUT the block, account B) ------------------------------------------
        outs, lock = [], threading.Lock()

        def racer():
            r = call("POST", "/api/exam/start", {"module": NO, "questions": 10, "minutes": 30}, who=1)
            with lock: outs.append(r)
        th = [threading.Thread(target=racer) for _ in range(8)]
        for t in th: t.start()
        for t in th: t.join()
        codes = sorted(o[0] for o in outs)
        ids = {o[1].get("run", {}).get("id") for o in outs}
        nopen = db.fetch_all("SELECT count(*) AS n FROM exam_runs WHERE account_id = %s AND module_id = %s AND finished_at IS NULL", (idb, NO))[0]["n"]
        check("K1 8 concurrent Starts -> exactly one 201, seven 200 resumed, ONE run id, ONE open row", codes == [200] * 7 + [201] and len(ids) == 1 and nopen == 1,
              f"codes {codes} ids {len(ids)} open rows {nopen}")
        rb = next(o[1]["run"] for o in outs if o[0] == 201)
        check("K2 without the block: 10 q / 30 min as asked, chapter areas 2 each, practice mode", rb["total"] == 10 and rb["minutes"] == 30 and rb["mode"] == "practice"
              and rb["areaKind"] == "chapter" and sorted({q["area"] for q in rb["questions"]}) == [f"ch0{c}" for c in range(1, 6)])

        # ---- F: Submit / retried Submit (no-block run) --------------------------------------------------
        bq = [q["key"] for q in rb["questions"]]
        for k in bq[:6]:
            call("POST", "/api/exam/answer", {"runId": rb["id"], "question": k, "chosen": fx.correct_of(k)}, who=1)
        call("POST", "/api/exam/answer", {"runId": rb["id"], "question": bq[6], "chosen": (fx.correct_of(bq[6]) + 1) % 4}, who=1)
        st, sb = call("POST", "/api/exam/finish", {"runId": rb["id"]}, who=1)
        st2, sb2 = call("POST", "/api/exam/finish", {"runId": rb["id"]}, who=1)
        rr = sb.get("result", {})
        check("F1 Submit -> 200 finishedBy submit 6/10; retried Submit -> 200 alreadyFinished, identical result", st == st2 == 200 and sb["alreadyFinished"] is False
              and sb2["alreadyFinished"] is True and rr.get("finishedBy") == "submit" and rr.get("right") == 6 and rr.get("total") == 10 and sb2["result"] == rr, f"{st} {st2} {rr.get('right')}/{rr.get('total')}")
        check("F2 answer_log for that run: 7 rows (answered only), once", logged(rb["id"]) == 7)
        check("F3 answer after Submit -> 409 finished", call("POST", "/api/exam/answer", {"runId": rb["id"], "question": bq[0], "chosen": 0}, who=1)[0] == 409)
        check("E5 WITHOUT the block: scaled null, scaledIsEstimate false (no Estimate, no pass/fail); areas are chapters",
              rr.get("scaled") is None and rr.get("scaledIsEstimate") is False and all(a["id"].startswith("ch") for a in rr.get("areas", [])), json.dumps(rr.get("scaled")))

        # ---- G: the open read past the deadline closes it -------------------------------------------
        st, s5 = call("POST", "/api/exam/start", {"module": NO, "questions": 5, "minutes": 1}, who=1)
        call("POST", "/api/exam/answer", {"runId": s5["run"]["id"], "question": s5["run"]["questions"][0]["key"], "chosen": 0}, who=1)
        db.execute("UPDATE exam_runs SET started_at = now() - interval '2 minutes', deadline_at = now() - interval '1 second' WHERE id = %s AND account_id = %s", (s5["run"]["id"], idb))
        st, og = call("GET", f"/api/exam/open?module={NO}", who=1)
        check("D5 GET open past the deadline closes the run: run null, expiredNow true, last = it (finishedBy deadline)", st == 200 and og["run"] is None and og["expiredNow"] is True
              and og["last"]["id"] == s5["run"]["id"] and og["last"]["finishedBy"] == "deadline" and logged(s5["run"]["id"]) == 1)

        # ---- Q: restart ---------------------------------------------------------------------------------
        st, q1 = call("POST", "/api/exam/start", {"module": NO, "questions": 5, "minutes": 10}, who=1)
        st2, q2 = call("POST", "/api/exam/start", {"module": NO, "restart": True, "questions": 5, "minutes": 10}, who=1)
        check("Q1 restart=true: the open run is submitted first (previous.finishedBy restart), a new run 201", st == 201 and st2 == 201 and q2["previous"]["id"] == q1["run"]["id"]
              and q2["previous"]["finishedBy"] == "restart" and q2["run"]["id"] != q1["run"]["id"])
        check("Q2 restart must be a boolean -> 400", call("POST", "/api/exam/start", {"module": NO, "restart": "yes"}, who=1)[0] == 400)

        # ---- V: validation, auth, origin, log -------------------------------------------------------
        vb = [call("POST", "/api/exam/start", b, who=0)[0] for b in ({"module": NO, "questions": 31}, {"module": NO, "minutes": 0}, {"module": NO, "minutes": 301},
                                                                       {"module": "gate-no-such-book"}, {"module": "../etc"})]
        check("V1 bad numbers / unknown book -> 400 (31 q · 0 min · 301 min · unknown · traversal)", vb == [400] * 5, str(vb))
        check("V2 GET open of an unknown book -> 400", call("GET", "/api/exam/open?module=gate-no-such-book")[0] == 400)
        unauth = [call("GET", f"/api/exam/open?module={NO}", who=None)[0]] + [call("POST", p, {"module": NO}, who=None)[0]
                                                                                for p in ("/api/exam/start", "/api/exam/answer", "/api/exam/flag", "/api/exam/finish")]
        check("V3 signed out: the 5 routes -> 401", unauth == [401] * 5, str(unauth))
        xo = call("POST", "/api/exam/start", {"module": NO}, origin="http://evil.example")[0]
        check("V4 cross-origin POST -> 403 (core._gate)", xo == 403, str(xo))
        lg = logp.read_text(errors="replace")
        check("V5 the server log has no traceback", "Traceback" not in lg, lg[lg.find("Traceback"):][:240] if "Traceback" in lg else "")
    finally:
        if server is not None:
            server.terminate(); server.wait(timeout=10)
        for u in users:
            gone = admin("delete-user", "--username", u, "--yes")
            check(f"L9 throwaway account {u} deleted (cascade)", gone.returncode == 0 and u in gone.stdout, (gone.stdout + gone.stderr).strip()[:100])
        left = db.fetch_all("SELECT (SELECT count(*) FROM exam_runs WHERE module_id LIKE 'gate-%%-book') e, (SELECT count(*) FROM answer_log WHERE module_id LIKE 'gate-%%-book') a,"
                            " (SELECT count(*) FROM question_flags WHERE module_id LIKE 'gate-%%-book') f")
        check("L10 no gate rows left behind (exam_runs, answer_log, question_flags)", left and all(v == 0 for v in left[0].values()), json.dumps(left))
        if tunnel is not None:
            tunnel.terminate(); tunnel.wait(timeout=10)


if "--live" in sys.argv:
    live()
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
