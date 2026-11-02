#!/usr/bin/env python3
"""gate-study-more-backend.py — G4, exam-recall-suite P1 (22-10-26): the server half of
review stats, the new-card cap, AI-question keys, study prefs, flags and the answer log.

Leg 1 (always; plain python3, no service, no database) imports app/backend/store.py and reads
migration 005, study_more.py and main.py as text/AST:
  K  ai_review_key: stable for the same question+options, different when an option changes;
  C  new_cap_due: the 21st new card of a day (default cap 20) waits for tomorrow (UTC+7 midnight);
  P  prefs bounds: sessionSize 10..50 step 5, newPerDay 0..200;
  B  stored AI body / answer-log validators;
  D  migration 005 is additive + idempotent; answer_log is deduplicated by (account, client_id);
  R  study_more.py declares exactly its 6 routes; every POST goes through core._gate first.

Leg 2 (`--live`; run with the TEST venv) does the same through the REAL routes and SQL against the
ISOLATED gate database `edu_study_gate` (never `edu_study`): SSH tunnel to nn:5432 (opened and closed
here if not already up) -> `admin migrate --no-backup` (newest file: 6 since P2; a second run applies nothing) ->
a throwaway account + session -> a local uvicorn of THIS repo's backend on 127.0.0.1:$SM_PORT ->
HTTP checks -> the account is deleted (its rows go by ON DELETE CASCADE), uvicorn and tunnel stopped.
  L  unauthenticated 401; cross-origin POST 403; 21st new card "queued"; duplicate clientId logged
     once; flag on/on/off idempotent; prefs 12 -> 400; /api/review/due clamps limit to 10..50.

Run:  python3 gates/gate-study-more-backend.py
      /var/tmp/edu-study-testvenv/bin/python3 gates/gate-study-more-backend.py --live
Env:  SM_BACKEND (default app/backend; point it at a /var/tmp copy to fault-inject), SM_PORT (8786),
      SM_GATE_DB_ENV (default ~/.config/foxai/edu-study-gate-db.env).
Exit 1 on any FAIL. ⚠ After a mutation run, clear __pycache__ of the mutated copy.
"""
import ast, importlib.util, json, os, re, secrets, socket, subprocess, sys, time, uuid
import urllib.error, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = Path(os.environ.get("SM_BACKEND") or REPO / "app" / "backend").resolve()
sys.path.insert(0, str(BACKEND))
spec = importlib.util.spec_from_file_location("store", BACKEND / "store.py")
store = importlib.util.module_from_spec(spec); spec.loader.exec_module(store)
results = []


def check(cid, ok, detail=""):
    results.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'}  {cid}  {detail}")


def rejects(fn, *args):
    try:
        fn(*args)
    except ValueError:
        return True
    return False


# ---------------------------------------------------------------------------- K: AI keys
Q = {"question": "Which split keeps class ratios?", "options": ["random", "stratified", "k-fold", "none"], "correct": 1}
k1 = store.ai_review_key(Q)
check("K1 AI key shape ai- + 12 hex", re.fullmatch(r"ai-[0-9a-f]{12}", k1) is not None, k1)
check("K2 same question+options -> same key (also with outer spaces)", k1 == store.ai_review_key(dict(Q)) == store.ai_review_key({**Q, "question": "  " + Q["question"] + " ", "options": [o + " " for o in Q["options"]]}))
check("K3 one option changed -> different key", k1 != store.ai_review_key({**Q, "options": ["random", "stratified", "k-fold", "all"]}))
check("K4 options reordered -> different key", k1 != store.ai_review_key({**Q, "options": list(reversed(Q["options"]))}))
check("K5 the correct answer is not part of the key", k1 == store.ai_review_key({**Q, "correct": 2}))
check("K6 key passes review_key()", store.review_key(k1) == k1)
qk, qb = store.question_key_and_body({"question": "ch99-x", "body": Q})
check("K7 a body wins over a client-sent key", qk == k1 and qb["options"] == Q["options"], qk)

# ---------------------------------------------------------------------------- C: new-card cap
NOW = datetime(2026, 10, 22, 10, 0, tzinfo=timezone.utc)             # 17:00 at UTC+7
natural = NOW + timedelta(days=1)
tomorrow = datetime(2026, 10, 23, 0, 0, tzinfo=timezone(timedelta(hours=7)))
check("C0 default cap is 20 new cards a day", store.NEW_PER_DAY_DEFAULT == 20, str(store.NEW_PER_DAY_DEFAULT))
check("C1 the 20th new card today keeps its own schedule", store.new_cap_due(NOW + timedelta(minutes=10), 19, store.NEW_PER_DAY_DEFAULT, NOW) == NOW + timedelta(minutes=10))
c21 = store.new_cap_due(NOW + timedelta(minutes=10), 20, store.NEW_PER_DAY_DEFAULT, NOW)
check("C2 the 21st new card waits for tomorrow 00:00 UTC+7", c21 == tomorrow, str(c21))
check("C3 the 41st waits a day longer", store.new_cap_due(NOW, 40, 20, NOW) == tomorrow + timedelta(days=1))
check("C4 cap 0 -> every new card waits for tomorrow", store.new_cap_due(NOW, 0, 0, NOW) == tomorrow)
check("C5 never earlier than its own schedule", store.new_cap_due(NOW + timedelta(days=3), 20, 20, NOW) == NOW + timedelta(days=3))
late = datetime(2026, 10, 22, 18, 30, tzinfo=timezone.utc)            # 01:30 next day at UTC+7
check("C6 the study day starts at UTC+7 midnight", store.study_day_start(late) == tomorrow, str(store.study_day_start(late)))

# ---------------------------------------------------------------------------- P: prefs bounds
for good, want in (({"sessionSize": 10}, {"session_size": 10}), ({"sessionSize": 50}, {"session_size": 50}),
                   ({"sessionSize": 35, "newPerDay": 0}, {"session_size": 35, "new_per_day": 0}), ({"newPerDay": 200}, {"new_per_day": 200})):
    check(f"P-ok {good}", store.prefs_update(good) == want)
for bad in ({"sessionSize": 5}, {"sessionSize": 55}, {"sessionSize": 12}, {"sessionSize": 20.0}, {"sessionSize": True},
            {"sessionSize": "20"}, {"newPerDay": -1}, {"newPerDay": 201}, {}):
    check(f"P-bad {bad}", rejects(store.prefs_update, bad), "rejected")

# ---------------------------------------------------------------------------- B: body + log validators
check("B1 a choose-N body keeps its sorted list", store.review_body({**Q, "correct": [0, 2]})["correct"] == [0, 2])
for name, bad in (("unsorted list", {**Q, "correct": [2, 0]}), ("1-item list", {**Q, "correct": [1]}), ("out of range", {**Q, "correct": 4}),
                  ("bool correct", {**Q, "correct": True}), ("1 option", {**Q, "options": ["a"]}), ("empty question", {**Q, "question": " "}),
                  ("over 8 KB", {**Q, "options": ["x" * 3000] * 4})):
    check(f"B-bad body {name}", rejects(store.review_body, bad), "rejected")
cid = str(uuid.uuid4())
e = store.answer_entry({"question": "ch07-b02-q3", "runKind": "review", "correct": True, "clientId": cid, "confidence": "guess", "chosen": 1})
check("B2 log entry: chapter read from the key, uuid kept", e["chapter"] == 7 and e["client_id"] == cid and e["confidence"] == "guess", json.dumps(e))
for name, bad in (("runKind", {"runKind": "drill"}), ("confidence", {"confidence": "maybe"}), ("clientId", {"clientId": "123"}),
                  ("correct", {"correct": "yes"}), ("runId", {"runId": "a b"})):
    base = {"question": "ch07-b02-q3", "runKind": "quiz", "correct": False, "clientId": cid}
    check(f"B-bad log {name}", rejects(store.answer_entry, {**base, **bad}), "rejected")

# ---------------------------------------------------------------------------- D: migration 005
mig = BACKEND / "migrations" / "005_review_more.sql"
sql = mig.read_text(encoding="utf-8")
code = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
stmts = [re.sub(r"\s+", " ", x.strip()) for x in code.split(";") if x.strip()]
heads = [re.match(r"^(ALTER TABLE \w+ ADD COLUMN|CREATE TABLE|CREATE INDEX)", s) for s in stmts]
check("D1 five statements: one ADD COLUMN, three CREATE TABLE, one CREATE INDEX", [h.group(1) if h else s[:30] for h, s in zip(heads, stmts)] ==
      ["ALTER TABLE review_cards ADD COLUMN", "CREATE TABLE", "CREATE TABLE", "CREATE TABLE", "CREATE INDEX"], f"{len(stmts)} statements")
check("D2 every statement is IF NOT EXISTS (a second run is a no-op)", all("IF NOT EXISTS" in s.split("(")[0] for s in stmts),
      "; ".join(s[:60] for s in stmts if "IF NOT EXISTS" not in s.split("(")[0]))
check("D3 nothing destructive, no existing column changed", not re.search(r"\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME|ALTER COLUMN|SET DEFAULT)\b", re.sub(r"ON DELETE CASCADE", "", code), re.I))
check("D4 the only ALTER adds a nullable column to review_cards", re.findall(r"\bALTER TABLE\b[^;]*", code) == ["ALTER TABLE review_cards ADD COLUMN IF NOT EXISTS body JSONB"])
check("D5 answer_log UNIQUE (account_id, client_id)", re.search(r"CREATE TABLE IF NOT EXISTS answer_log[\s\S]*UNIQUE \(account_id, client_id\)", code) is not None)
check("D6 log_answer inserts ON CONFLICT (account_id, client_id) DO NOTHING", "ON CONFLICT (account_id, client_id) DO NOTHING" in (BACKEND / "store.py").read_text(encoding="utf-8"))
check("D7 the rollback file is NOT picked up by the migration runner", not list((BACKEND / "migrations").glob("*down*.sql")) and (BACKEND / "migrations" / "rollback" / "005_review_more.down.sql").is_file())
check("D8 new tables cascade from accounts (a deleted account leaves no rows)", code.count("REFERENCES accounts (id) ON DELETE CASCADE") == 3)

# ---------------------------------------------------------------------------- R: routes
src = (BACKEND / "addons" / "study_more.py").read_text(encoding="utf-8")
tree = ast.parse(src)
routes, funcs = {}, {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
for n in funcs.values():
    for d in n.decorator_list:
        if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in ("get", "post") and d.args:
            routes[(d.func.attr, d.args[0].value)] = n
want = {("get", "/api/review/stats"), ("get", "/api/study/prefs"), ("post", "/api/study/prefs"), ("get", "/api/flags"), ("post", "/api/flags"), ("post", "/api/answers")}
check("R1 study_more declares exactly its six routes", set(routes) == want, str(sorted(routes)))
first_call = lambda fn: next((ast.unparse(s.value.func) for s in fn.body if isinstance(s, ast.Assign) and isinstance(s.value, ast.Call)), "")
check("R2 every POST starts with _limited(req)", all(first_call(f) == "_limited" for (m, _), f in routes.items() if m == "post"), str({p: first_call(f) for (m, p), f in routes.items() if m == "post"}))
lim = funcs.get("_limited")
check("R3 _limited calls core._gate(req) before the rate bucket", lim is not None and first_call(lim) == "core._gate" and "return blocked" in ast.unparse(lim))
check("R4 the account always comes from the session, never the body", "payload.get(\"account" not in src and "payload['account" not in src and src.count("req.account.id") == 3)
check("R5 the router is registered", "study_more.router" in (BACKEND / "addons" / "__init__.py").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------- L: live (gate DB)
def live() -> None:
    env_path = Path(os.environ.get("SM_GATE_DB_ENV") or Path.home() / ".config/foxai/edu-study-gate-db.env")
    env_text = env_path.read_text(encoding="utf-8")
    if "EDU_DB_NAME=edu_study_gate" not in env_text.splitlines():
        check("L0 gate DB env points at edu_study_gate", False, str(env_path)); return
    db_port = int(re.search(r"^EDU_DB_PORT=(\d+)", env_text, re.M).group(1))
    port = int(os.environ.get("SM_PORT", "8786"))
    py = sys.executable
    run_env = {**os.environ, "EDU_DB_ENV_PATH": str(env_path)}
    tunnel = None
    open_port = lambda p: socket.socket().connect_ex(("127.0.0.1", p)) == 0
    if not open_port(db_port):
        tunnel = subprocess.Popen(["ssh", "-N", "-o", "ExitOnForwardFailure=yes", "-L", f"127.0.0.1:{db_port}:127.0.0.1:5432", "nn"])
        for _ in range(40):
            if open_port(db_port): break
            time.sleep(0.25)
    stores = Path("/var/tmp/p1c-sm-stores"); stores.mkdir(parents=True, exist_ok=True)
    (stores / "settings.json").write_text('{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n')
    (stores / "progress.json").write_text('{"version":2,"modules":{}}\n')
    admin = lambda *a, stdin=None: subprocess.run([py, "-m", "admin", *a], cwd=BACKEND, env=run_env, input=stdin, capture_output=True, text=True)
    user, server = f"gate-sm-{secrets.token_hex(3)}", None
    try:
        m1, m2 = admin("migrate", "--no-backup"), admin("migrate", "--no-backup")
        # ⚑ 22-10-26 (exam-recall-suite P2c): was a literal "schema version: 5"; 006 (ease floor) moved it
        #   to 6. The expectation is now the newest NNN_*.sql in THIS backend's migrations/ (>= 5 = 005 present).
        newest = max(int(p.name[:3]) for p in (BACKEND / "migrations").glob("*.sql") if re.match(r"^\d{3}_[a-z0-9_]+\.sql$", p.name))
        check(f"L1 migrate on the gate DB -> schema version {newest} (newest migration file, >= 5)", newest >= 5 and m1.returncode == 0
              and f"schema version: {newest}" in m1.stdout, (m1.stdout + m1.stderr).strip().replace("\n", " | "))
        check("L2 a second migrate applies nothing (rerun safe)", m2.returncode == 0 and "nothing (up to date)" in m2.stdout, m2.stdout.strip().replace("\n", " | "))
        made = admin("create-user", "--username", user, "--display-name", "Gate SM", stdin=secrets.token_urlsafe(18) + "\n")
        token = admin("mint-session", "--username", user, "--ttl", "900").stdout.strip()
        check("L3 throwaway account + session", made.returncode == 0 and len(token) > 20, (made.stdout + made.stderr).strip()[:120])
        server = subprocess.Popen([py, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=BACKEND,
                                  env={**run_env, "EDU_LIBRARY_ROOT": "/var/tmp/edu-smoke/lib", "EDU_SETTINGS_PATH": str(stores / "settings.json"),
                                       "EDU_PROGRESS_PATH": str(stores / "progress.json"), "EDU_LIBRARY_META_PATH": str(stores / "library-meta.json"),
                                       "EDU_BOOK_ROOT": str(stores / "books"), "EDU_ENV_PATH": str(stores / "provider.env"), "EDU_ASSET_ROOT": str(stores / "assets")},
                                  stdout=open("/var/tmp/p1c-sm-uvicorn.log", "w"), stderr=subprocess.STDOUT)
        base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            if open_port(port): break
            time.sleep(0.25)

        def call(method, path, body=None, cookie=True, origin=None):
            req = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode())
            req.add_header("Content-Type", "application/json")
            if cookie: req.add_header("Cookie", f"edu_session={token}")
            if origin: req.add_header("Origin", origin)
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    return r.status, json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as err:
                raw = err.read()
                try: return err.code, json.loads(raw or b"{}")
                except ValueError: return err.code, {"raw": raw[:80].decode(errors="replace")}

        mod = "gate-sm-book"
        st, _ = call("GET", f"/api/review/stats?module={mod}", cookie=False)
        check("L4 signed out: GET /api/review/stats -> 401", st == 401, str(st))
        st, _ = call("POST", "/api/flags", {"module": mod, "question": "ch01-b01-q1", "flagged": True}, cookie=False)
        check("L5 signed out: POST /api/flags -> 401", st == 401, str(st))
        st, _ = call("POST", "/api/flags", {"module": mod, "question": "ch01-b01-q1", "flagged": True}, origin="http://evil.example")
        check("L6 cross-origin POST /api/flags -> 403 (same-origin gate)", st == 403, str(st))
        st, _ = call("POST", "/api/answers", {"module": mod, "question": "ch01-b01-q1", "runKind": "quiz", "correct": True, "clientId": str(uuid.uuid4())}, origin="http://evil.example")
        check("L7 cross-origin POST /api/answers -> 403", st == 403, str(st))
        st, p = call("GET", f"/api/study/prefs?module={mod}")
        check("L8 prefs default 20 / 20", st == 200 and p.get("newPerDay") == 20 and p.get("sessionSize") == 20, json.dumps(p))
        st, _ = call("POST", "/api/study/prefs", {"module": mod, "sessionSize": 12})
        check("L9 prefs sessionSize 12 -> 400", st == 400, str(st))
        st, p = call("POST", "/api/study/prefs", {"module": mod, "sessionSize": 35})
        st2, p2 = call("POST", "/api/study/prefs", {"module": mod, "sessionSize": 35})
        check("L10 prefs save 35, twice -> same state, newPerDay untouched", st == st2 == 200 and p == p2 and p.get("sessionSize") == 35 and p.get("newPerDay") == 20, json.dumps(p2))
        # Wrong answers: a new card missed is due in 10 minutes, so the cap is what moves the 21st to
        # tomorrow (a RIGHT answer is due in a day anyway — past tomorrow's start — and stays "created").
        outs = [call("POST", "/api/review/seen", {"module": mod, "question": f"ch01-b01-q{i}", "correct": False})[1] for i in range(1, 22)]
        kinds = [o.get("outcome") for o in outs]
        check("L11 default cap: 20 new cards created, the 21st queued", kinds[:20] == ["created"] * 20 and kinds[20] == "queued", ",".join(f"{i+1}:{k}" for i, k in enumerate(kinds) if k != "created" or i >= 18) or "all created")
        due21 = datetime.fromisoformat(str(outs[20].get("dueAt", "")).replace("Z", "+00:00")) if outs[20].get("dueAt") else None
        check("L12 the queued card is due at the next UTC+7 midnight or later", due21 is not None and due21 >= store.study_day_start(datetime.now(timezone.utc)) + timedelta(days=1), str(outs[20]))
        st, body_out = call("POST", "/api/review/seen", {"module": mod, "body": Q, "correct": False})
        check("L13 an AI question enrols under its server-made key", st == 200 and body_out.get("question") == k1, json.dumps(body_out))
        cid1 = str(uuid.uuid4())
        a1 = call("POST", "/api/answers", {"module": mod, "question": "ch01-b01-q1", "runKind": "review", "correct": True, "clientId": cid1, "confidence": "sure", "chosen": 0})
        a2 = call("POST", "/api/answers", {"module": mod, "question": "ch01-b01-q1", "runKind": "review", "correct": True, "clientId": cid1, "confidence": "sure", "chosen": 0})
        check("L14 the same clientId twice -> logged once, then duplicate", a1 == (201, {"outcome": "logged", "question": "ch01-b01-q1"}) and a2[1].get("outcome") == "duplicate", f"{a1} {a2}")
        f1 = call("POST", "/api/flags", {"module": mod, "body": Q, "flagged": True})
        f2 = call("POST", "/api/flags", {"module": mod, "body": Q, "flagged": True})
        fl = call("GET", f"/api/flags?module={mod}")[1]
        check("L15 flag on twice -> one flag, AI body kept", f1[0] == f2[0] == 200 and fl.get("count") == 1 and fl["flags"][0]["question"] == k1 and fl["flags"][0].get("body", {}).get("options") == Q["options"], json.dumps(fl)[:160])
        call("POST", "/api/flags", {"module": mod, "body": Q, "flagged": False})
        f4 = call("POST", "/api/flags", {"module": mod, "body": Q, "flagged": False})
        check("L16 flag off twice -> no flag, no error", f4[0] == 200 and call("GET", f"/api/flags?module={mod}")[1].get("count") == 0)
        st, s = call("GET", f"/api/review/stats?module={mod}")
        check("L17 stats: 22 cards, 22 new today, retention 100 from 1 review, cap 20, size 35", st == 200 and s.get("total") == 22 and s.get("newToday") == 22
              and s.get("retention") == 100 and s.get("reviews30") == 1 and s.get("newPerDay") == 20 and s.get("sessionSize") == 35 and len(s.get("next7", [])) == 7, json.dumps({k: s.get(k) for k in ("total", "newToday", "dueNow", "dueToday", "retention", "next7Total")}))
        many = f"{mod}-2"
        for i in range(1, 15):
            call("POST", "/api/review/seen", {"module": many, "question": f"ch02-b01-q{i}", "correct": False})
        # New cards are due in 10 min / 1 day / tomorrow — backdate THIS throwaway account's cards (gate DB
        # only) so the due-list legs have cards due now.
        back = subprocess.run([py, "-c", "import db,sys; print(db.execute(\"UPDATE review_cards SET due_at = now() - interval '1 minute'"
                               " WHERE account_id = (SELECT id FROM accounts WHERE username = %s)\", (sys.argv[1],)))", user],
                              cwd=BACKEND, env=run_env, capture_output=True, text=True)
        check("L17b backdate the throwaway account's 36 cards (gate DB)", back.stdout.strip() == "36", (back.stdout + back.stderr).strip()[-120:])
        st, d = call("GET", f"/api/review/due?module={mod}&limit=50")
        ai_due = [c for c in d.get("due", []) if c["question"] == k1]
        check("L18 /api/review/due: AI card due now with its body + leech flag", st == 200 and ai_due and ai_due[0].get("body", {}).get("question") == Q["question"] and ai_due[0].get("leech") is False, json.dumps(ai_due)[:160])
        n5 = len(call("GET", f"/api/review/due?module={many}&limit=5")[1].get("due", []))
        check("L19 limit=5 is clamped up to 10 (14 cards due now)", n5 == 10, str(n5))
    finally:
        if server is not None:
            server.terminate(); server.wait(timeout=10)
        gone = admin("delete-user", "--username", user, "--yes")
        check("L20 throwaway account deleted (cascade)", gone.returncode == 0 and user in gone.stdout, (gone.stdout + gone.stderr).strip()[:120])
        if tunnel is not None:
            tunnel.terminate(); tunnel.wait(timeout=10)


if "--live" in sys.argv:
    live()
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
