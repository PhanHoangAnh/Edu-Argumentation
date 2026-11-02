#!/usr/bin/env python3
"""gate-history-backend.py — G6, exam-recall-suite P2 (22-10-26): the server half of History and
mastery (GET /api/history, GET /api/mastery) and migration 006 (the ease-floor fix).

Leg 1 (always; plain python3, no service, no database) imports app/backend/store.py and reads
history.py / migration 006 as text/AST:
  A  area_spec: chapters by default; a VALID `exam` block -> domains; every invalid block ignored;
  O  area_of: an answer's own domain wins, else its chapter maps through chapterIds;
  M  mastery_from_rows: newest 200 per area, pct, unassigned, lastAt;
  N  pick_next_up: < 5 answers never "weakest"; tie -> practised longest ago, then book order;
     nobody has 5 -> least-practised;
  H  history_params: filters, chapter/domain exclusive, cursors, limits (400 on anything else);
  W  pre-v5 wrong_answers rows as history items;
  K  the rules' constants (retry runs left out, min 5, window 200, target 80);
  G  migration 006 only re-creates review_cards_ease_check as ease >= 1.29; the rollback is manual;
  S  the SRS floor still lands on 1.3 after 6 misses, and REAL(1.3) passes 1.29 but not 1.3;
  R  history.py declares exactly 2 GET routes; the account comes from the session.

Leg 2 (`--live`; run with the TEST venv) runs every History / mastery SQL statement for real against
the ISOLATED gate database `edu_study_gate` (never `edu_study`): SSH tunnel to nn:5432 (opened and
closed here if not already up) -> `admin migrate --no-backup` x2 -> two throwaway accounts + sessions
-> a gate library under /var/tmp (3 tiny books: chapters / valid exam block / invalid exam block)
-> a local uvicorn of THIS repo's backend on 127.0.0.1:$HB_PORT -> seed through the REAL routes
(POST /api/answers, /api/flags, /api/review/*), backdate / insert pre-v5 rows by SQL on the gate DB
for the throwaway accounts only -> HTTP checks -> both accounts deleted (ON DELETE CASCADE), uvicorn
and tunnel stopped.
  L  schema version = newest migration file (6) and the CHECK reads >= 1.29; a second migrate is a no-op;
  E  THE 21-10 EASE BUG: 7 consecutive "again" grades of one card all answer 200, lapses 7, Leech
     (RED without 006: the 6th answers 500 — CheckViolation review_cards_ease_check);
  Y  mastery: retry runs and pre-v5 wrong_answers left out; < 5 answers -> enough false, never Next up;
     tie -> practised longest ago; nobody with 5 -> least-practised; window 200; domain book; invalid
     exam block -> chapters; unknown book -> 400;
  Z  history: counts, All / Wrong / Flagged, chapter + domain filters (same answers the bar counts),
     paging across the pre-v5 rows with no duplicate, a post-v5 double write listed once, the run's
     ORIGINAL denominator in `runs` under the Wrong filter, AI body attached, another account sees
     nothing, bad queries -> 400, signed out -> 401.

Run:  python3 gates/gate-history-backend.py
      /var/tmp/edu-study-testvenv/bin/python3 gates/gate-history-backend.py --live
Env:  HB_BACKEND (default app/backend; point it at a /var/tmp copy to fault-inject), HB_PORT (8787),
      HB_GATE_DB_ENV (default ~/.config/foxai/edu-study-gate-db.env).
Exit 1 on any FAIL. ⚠ After a mutation run, clear __pycache__ of the mutated copy.
Fails when (red proofs, gates/README.md): 006 missing (E, L), the Wrong / Flagged filters swapped (Z),
retry runs counted (K, Y), the 5-answer rule dropped (N, Y), the tie-break dropped (N, Y), `runs`
counted over the filtered rows (Z).
"""
import ast, importlib.util, json, os, re, secrets, socket, struct, subprocess, sys, time, uuid
import urllib.error, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = Path(os.environ.get("HB_BACKEND") or REPO / "app" / "backend").resolve()
sys.path.insert(0, str(BACKEND))
spec_ = importlib.util.spec_from_file_location("store", BACKEND / "store.py")
store = importlib.util.module_from_spec(spec_); spec_.loader.exec_module(store)
results = []


def check(cid, ok, detail=""):
    results.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'}  {cid}  {detail}")


def rejects(fn, *args):
    try:
        fn(*args)
    except ValueError:
        return True
    return False


def book(chapters, exam=None, module_id="gate-book"):
    data = {"moduleId": module_id, "tutorialData": {"title": "Gate book", "sections": [
        {"title": f"Chapter {i}: Topic {i}", "items": []} for i in range(1, chapters + 1)]}, "quizData": []}
    if exam is not None:
        data["exam"] = exam
    return data


GOOD_EXAM = {"name": "GATE-EX", "domains": [
    {"id": "D1", "name": "Concepts", "weight": 50, "chapterIds": [1, 2]},
    {"id": "D2", "name": "Security", "weight": 30, "chapterIds": [3]},
    {"id": "D3", "name": "Billing", "weight": 20, "chapterIds": [4]}]}


def exam_with(**change):
    domains = [dict(d) for d in GOOD_EXAM["domains"]]
    for k, v in change.items():
        domains[0][k] = v
    return {"name": "GATE-EX", "domains": domains}


# ---------------------------------------------------------------------------- A: area_spec
plain = store.area_spec(book(4))
check("A1 no exam block -> one area per chapter, ids ch01..", plain["kind"] == "chapter" and [a["id"] for a in plain["areas"]] == ["ch01", "ch02", "ch03", "ch04"]
      and plain["areas"][2]["chapters"] == [3] and plain["areas"][0]["name"] == "Chapter 1: Topic 1" and plain["exam"] is None, json.dumps(plain)[:120])
dom = store.area_spec(book(4, GOOD_EXAM))
check("A2 a valid exam block -> its domains (ids, names, weights, chapters)", dom["kind"] == "domain" and dom["exam"] == {"name": "GATE-EX"}
      and [(a["id"], a["weight"], a["chapters"]) for a in dom["areas"]] == [("D1", 50, [1, 2]), ("D2", 30, [3]), ("D3", 20, [4])], json.dumps(dom)[:140])
bad_blocks = {
    "weights sum 90": exam_with(weight=40),
    "unknown chapter 9": exam_with(chapterIds=[1, 9]),
    "chapter in two domains": exam_with(chapterIds=[1, 3]),
    "repeated id": exam_with(id="D2"),
    "missing name": exam_with(name=" "),
    "weight 0": exam_with(weight=0),
    "bool chapter": exam_with(chapterIds=[True]),
    "empty domains": {"name": "X", "domains": []},
    "exam not an object": ["D1"],
}
for name, exam in bad_blocks.items():
    s = store.area_spec(book(4, exam))
    check(f"A-bad {name} -> ignored, chapters used", s["kind"] == "chapter" and len(s["areas"]) == 4, s["kind"])
check("A3 weights 100 +/- 1 accepted (99.5)", store.area_spec(book(4, exam_with(weight=49.5)))["kind"] == "domain")

# ---------------------------------------------------------------------------- O: area_of
check("O1 domain book: the answer's own domain wins over its chapter", store.area_of(1, "D3", dom) == "D3")
check("O2 domain book: no domain -> chapter mapped through chapterIds", store.area_of(2, None, dom) == "D1" and store.area_of(4, None, dom) == "D3")
check("O3 domain book: an unknown domain falls back to the chapter", store.area_of(3, "ZZ", dom) == "D2")
check("O4 unassigned: no chapter, or a chapter outside the book", store.area_of(None, None, dom) is None and store.area_of(9, None, plain) is None and store.area_of(None, None, plain) is None)
check("O5 chapter book: chapter 3 -> ch03", store.area_of(3, None, plain) == "ch03")


# ---------------------------------------------------------------------------- M: mastery_from_rows
def rows(chapter, pattern, at="2026-10-22T01:00:00+00:00"):
    return [{"chapter": chapter, "domain": None, "correct": c == "1", "at": at} for c in pattern]


newest_right = [{"chapter": 1, "domain": None, "correct": True, "at": f"2026-10-22T{h:02d}:00:00+00:00"} for h in range(23, 13, -1)]
window_rows = rows(1, "1" * 200) + rows(1, "0" * 10)          # newest first: 200 right, then 10 older wrong
m = store.mastery_from_rows(window_rows, plain)
a1 = m["areas"][0]
check("M1 window: only the newest 200 answers of an area count (200/200, not 200/210)", a1["answered"] == 200 and a1["right"] == 200 and a1["pct"] == 100, json.dumps(a1)[:120])
m = store.mastery_from_rows(newest_right[:3] + rows(2, "10") + [{"chapter": None, "domain": None, "correct": True, "at": "x"}], plain)
by = {a["id"]: a for a in m["areas"]}
check("M2 pct, enough, lastAt = newest, unassigned counted apart", by["ch01"]["pct"] == 100 and by["ch01"]["enough"] is False and by["ch01"]["lastAt"] == "2026-10-22T23:00:00+00:00"
      and by["ch02"]["pct"] == 50 and by["ch03"]["pct"] is None and by["ch03"]["answered"] == 0 and m["unassigned"] == 1, json.dumps(by["ch01"]))
check("M3 a domain area carries its weight", store.mastery_from_rows([], dom)["areas"][1].get("weight") == 30)


# ---------------------------------------------------------------------------- N: pick_next_up
def area(aid, answered, right, last=None):
    return {"id": aid, "name": aid, "answered": answered, "right": right, "pct": round(100 * right / answered) if answered else None, "lastAt": last}


T1, T2 = "2026-10-21T01:00:00+00:00", "2026-10-22T01:00:00+00:00"
n = store.pick_next_up([area("a", 10, 9, T2), area("b", 4, 0, T2), area("c", 10, 6, T2)])
check("N1 an area with 4 answers (0%) is NEVER weakest; weakest among >= 5 wins", n["id"] == "c" and n["reason"] == "weakest", json.dumps(n))
n = store.pick_next_up([area("a", 6, 2, T2), area("b", 6, 2, T1)])
check("N2 tie on ratio -> the area practised longest ago", n["id"] == "b", json.dumps(n))
n = store.pick_next_up([area("a", 6, 2, T2), area("b", 9, 3, T2)])
check("N3 tie on ratio and time -> book order", n["id"] == "a", json.dumps(n))
n = store.pick_next_up([area("a", 4, 0, T2), area("b", 1, 0, T2), area("c", 0, 0)])
check("N4 nobody has 5 answers -> least-practised (fewest answers)", n["id"] == "c" and n["reason"] == "least-practised", json.dumps(n))
n = store.pick_next_up([area("a", 2, 0, T2), area("b", 2, 2, T2)])
check("N5 least-practised tie -> book order", n["id"] == "a" and n["reason"] == "least-practised", json.dumps(n))
check("N6 a book with no areas -> no Next up", store.pick_next_up([]) is None)

# ---------------------------------------------------------------------------- H: history_params
p = store.history_params("", "", "", "", "")
check("H1 defaults: all, no area, no cursor, 50 a page", p == {"filter": "all", "chapter": None, "domain": None, "cursor": None, "limit": 50}, json.dumps(p))
check("H2 a good query parses", store.history_params("Wrong", "7", "", "a:123", "100") == {"filter": "wrong", "chapter": 7, "domain": None, "cursor": ("a", 123), "limit": 100})
for name, args in (("filter bogus", ("right", "", "", "", "")), ("chapter abc", ("all", "abc", "", "", "")), ("chapter 1000", ("all", "1000", "", "", "")),
                   ("chapter -1", ("all", "-1", "", "", "")), ("domain 65 chars", ("all", "", "D" * 65, "", "")), ("chapter + domain", ("all", "3", "D1", "", "")),
                   ("cursor x:1", ("all", "", "", "x:1", "")), ("cursor a:abc", ("all", "", "", "a:abc", "")), ("cursor on flagged", ("flagged", "", "", "a:1", "")),
                   ("limit 0", ("all", "", "", "", "0")), ("limit 101", ("all", "", "", "", "101"))):
    check(f"H-bad {name} -> ValueError (400)", rejects(store.history_params, *args))

# ---------------------------------------------------------------------------- W: pre-v5 rows
ts = datetime(2026, 10, 1, tzinfo=timezone.utc)
w = store.legacy_wrong_item({"id": 9, "block_id": "ch05-b02", "quiz_kind": "bank", "question": "Q?", "options": ["a", "b", "c"], "chosen": 1, "correct": 2,
                             "chosen_set": None, "correct_set": None, "attempt": "r1", "created_at": ts})
check("W1 a pre-v5 wrong row -> item w:9, chapter 5 from the block, body to ask it again", w["id"] == "w:9" and w["chapter"] == 5 and w["correct"] is False and w["source"] == "legacy"
      and w["body"] == {"question": "Q?", "options": ["a", "b", "c"], "correct": 2} and w["question"] is None, json.dumps(w, default=str)[:140])
w2 = store.legacy_wrong_item({"id": 10, "block_id": "x", "quiz_kind": "bank", "question": "Q", "options": ["a", "b", "c"], "chosen": None, "correct": None,
                              "chosen_set": [0], "correct_set": [0, 2], "attempt": None, "created_at": ts})
check("W2 a choose-N row keeps its sets; an unknown block -> chapter None", w2["body"]["correct"] == [0, 2] and w2["chosen"] == [0] and w2["chapter"] is None)

# ---------------------------------------------------------------------------- K: the rules' constants
check("K1 retry runs are NOT counted in mastery (quiz/practice/review/exam only)", tuple(store.MASTERY_RUN_KINDS) == ("quiz", "practice", "review", "exam"), str(store.MASTERY_RUN_KINDS))
check("K2 min answers 5 · window 200 · target 80", (store.MASTERY_MIN_ANSWERS, store.MASTERY_WINDOW, store.MASTERY_TARGET) == (5, 200, 80))

# ---------------------------------------------------------------------------- G: migration 006
mdir = BACKEND / "migrations"
mig6 = mdir / "006_ease_floor.sql"
sql6 = mig6.read_text(encoding="utf-8") if mig6.is_file() else ""
code6 = "\n".join(l for l in sql6.splitlines() if not l.strip().startswith("--"))
stmts6 = [re.sub(r"\s+", " ", x.strip()) for x in code6.split(";") if x.strip()]
check("G1 006 = drop the ease check IF EXISTS, then add it back as ease >= 1.29 (two statements)", stmts6 == [
    "ALTER TABLE review_cards DROP CONSTRAINT IF EXISTS review_cards_ease_check",
    "ALTER TABLE review_cards ADD CONSTRAINT review_cards_ease_check CHECK (ease >= 1.29)"], " | ".join(stmts6) or "006 missing")
check("G2 006 changes no data and no other object", not re.search(r"\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|RENAME|ALTER COLUMN|DROP TABLE|DROP COLUMN)\b", code6, re.I) and bool(code6))
names = [p.name for p in mdir.glob("*.sql") if re.match(r"^\d{3}_[a-z0-9_]+\.sql$", p.name)]
check("G3 version 6 is the ease fix and the newest file (exam_runs is 007 for P3)", sorted(names)[-1:] == ["006_ease_floor.sql"] or "007_exam_runs.sql" in names, ",".join(sorted(names)))
down6 = mdir / "rollback" / "006_ease_floor.down.sql"
dtext = down6.read_text(encoding="utf-8") if down6.is_file() else ""
check("G4 manual rollback exists, not picked by the runner, puts >= 1.3 back NOT VALID and forgets version 6",
      down6.is_file() and not list(mdir.glob("*down*.sql")) and "CHECK (ease >= 1.3) NOT VALID" in dtext and "DELETE FROM schema_migrations WHERE version = 6" in dtext)

# ---------------------------------------------------------------------------- S: the floor, as a REAL
real = lambda x: struct.unpack("f", struct.pack("f", x))[0]    # what a PostgreSQL REAL hands back
card = None
for _ in range(6):
    s = store.srs_next(card, "again", datetime(2026, 10, 22, tzinfo=timezone.utc))
    card = {**s, "ease": real(s["ease"])}
check("S1 six misses: lapses 6 (Leech), ease floored at 1.3 by the code", card["lapses"] == 6 and s["ease"] == store.SRS_MIN_EASE == 1.3, f"ease {s['ease']} stored {card['ease']!r}")
check("S2 REAL(1.3) < 1.3 (why v4/v5 failed) and >= 1.29 (why v6 passes)", card["ease"] < 1.3 and card["ease"] >= 1.29, repr(card["ease"]))

# ---------------------------------------------------------------------------- R: routes
hsrc = (BACKEND / "addons" / "history.py").read_text(encoding="utf-8")
htree = ast.parse(hsrc)
hroutes = {}
for fn in [x for x in ast.walk(htree) if isinstance(x, ast.FunctionDef)]:
    for d in fn.decorator_list:
        if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.args:
            hroutes[(d.func.attr, d.args[0].value)] = fn.name
check("R1 history.py declares exactly GET /api/history and GET /api/mastery", set(hroutes) == {("get", "/api/history"), ("get", "/api/mastery")}, str(sorted(hroutes)))
check("R2 the account always comes from the session (core._account), never the query", hsrc.count("core._account(request).id") == 2 and "account" not in "".join(
    a.arg for fn in ast.walk(htree) if isinstance(fn, ast.FunctionDef) for a in fn.args.args))
check("R3 the router is registered", "history.router" in (BACKEND / "addons" / "__init__.py").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------- L/E/Y/Z: live (gate DB)
def live() -> None:
    env_path = Path(os.environ.get("HB_GATE_DB_ENV") or Path.home() / ".config/foxai/edu-study-gate-db.env")
    env_text = env_path.read_text(encoding="utf-8")
    if "EDU_DB_NAME=edu_study_gate" not in env_text.splitlines():
        check("L0 gate DB env points at edu_study_gate", False, str(env_path)); return
    os.environ["EDU_DB_ENV_PATH"] = str(env_path)
    import db                                       # BACKEND's db, reading the GATE env above
    db_port = int(re.search(r"^EDU_DB_PORT=(\d+)", env_text, re.M).group(1))
    port = int(os.environ.get("HB_PORT", "8787"))
    py = sys.executable
    run_env = {**os.environ, "EDU_DB_ENV_PATH": str(env_path)}
    tunnel = None
    open_port = lambda p: socket.socket().connect_ex(("127.0.0.1", p)) == 0
    if not open_port(db_port):
        tunnel = subprocess.Popen(["ssh", "-N", "-o", "ExitOnForwardFailure=yes", "-L", f"127.0.0.1:{db_port}:127.0.0.1:5432", "nn"])
        for _ in range(40):
            if open_port(db_port): break
            time.sleep(0.25)
    work = Path("/var/tmp/p2c-hb"); lib = work / "lib"
    for mid, data in (("gate-hist-book", book(6, module_id="gate-hist-book")), ("gate-exam-book", book(4, GOOD_EXAM, "gate-exam-book")),
                      ("gate-badexam-book", book(4, exam_with(weight=40), "gate-badexam-book"))):
        (lib / mid).mkdir(parents=True, exist_ok=True)
        (lib / mid / "module.json").write_text(json.dumps(data), encoding="utf-8")
    (work / "settings.json").write_text('{"ai_question_count":5,"fresh_quiz_size":20,"require_access_token":false}\n')
    (work / "progress.json").write_text('{"version":2,"modules":{}}\n')
    admin = lambda *a, stdin=None: subprocess.run([py, "-m", "admin", *a], cwd=BACKEND, env=run_env, input=stdin, capture_output=True, text=True)
    users = [f"gate-hb-{secrets.token_hex(3)}", f"gate-hb-{secrets.token_hex(3)}"]
    server = None
    try:
        # ---- L: migration 006 ------------------------------------------------------------------
        newest = max(int(p.name[:3]) for p in (BACKEND / "migrations").glob("*.sql") if re.match(r"^\d{3}_[a-z0-9_]+\.sql$", p.name))
        m1, m2 = admin("migrate", "--no-backup"), admin("migrate", "--no-backup")
        # ⚑ P3c (22-10-26): 007_exam_runs.sql now exists -> expect the newest file (>= 6 = 006 present), not a literal 6.
        check(f"L1 migrate on the gate DB -> schema version {newest} (newest migration file, >= 6)", m1.returncode == 0 and newest >= 6 and f"schema version: {newest}" in m1.stdout,
              (m1.stdout + m1.stderr).strip().replace("\n", " | "))
        check("L2 a second migrate applies nothing (rerun safe)", m2.returncode == 0 and "nothing (up to date)" in m2.stdout, m2.stdout.strip().replace("\n", " | "))
        cdef = db.fetch_all("SELECT pg_get_constraintdef(oid) AS d, convalidated AS v FROM pg_constraint WHERE conname = 'review_cards_ease_check'")
        check("L3 the CHECK now reads ease >= 1.29, validated", len(cdef) == 1 and "1.29" in cdef[0]["d"] and cdef[0]["v"] is True, json.dumps(cdef))

        tokens = []
        for u in users:
            made = admin("create-user", "--username", u, "--display-name", "Gate HB", stdin=secrets.token_urlsafe(18) + "\n")
            tokens.append(admin("mint-session", "--username", u, "--ttl", "900").stdout.strip())
            check(f"L4 throwaway account {u} + session", made.returncode == 0 and len(tokens[-1]) > 20, (made.stdout + made.stderr).strip()[:100])
        ida, idb = [db.fetch_all("SELECT id FROM accounts WHERE username = %s", (u,))[0]["id"] for u in users]
        server = subprocess.Popen([py, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=BACKEND,
                                  env={**run_env, "EDU_LIBRARY_ROOT": str(lib), "EDU_SETTINGS_PATH": str(work / "settings.json"),
                                       "EDU_PROGRESS_PATH": str(work / "progress.json"), "EDU_LIBRARY_META_PATH": str(work / "library-meta.json"),
                                       "EDU_BOOK_ROOT": str(work / "books"), "EDU_ENV_PATH": str(work / "provider.env"), "EDU_ASSET_ROOT": str(work / "assets")},
                                  stdout=open("/var/tmp/p2c-hb-uvicorn.log", "w"), stderr=subprocess.STDOUT)
        base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            if open_port(port): break
            time.sleep(0.25)

        def call(method, path, body=None, who=0):
            req = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode())
            req.add_header("Content-Type", "application/json")
            if who is not None: req.add_header("Cookie", f"edu_session={tokens[who]}")
            try:
                with urllib.request.urlopen(req, timeout=15) as r:
                    return r.status, json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as err:
                raw = err.read()
                try: return err.code, json.loads(raw or b"{}")
                except ValueError: return err.code, {"raw": raw[:120].decode(errors="replace")}

        def answer(mod, key, correct, run, kind, who=0, **extra):
            st, _ = call("POST", "/api/answers", {"module": mod, "question": key, "runKind": kind, "correct": correct, "runId": run,
                                                   "clientId": str(uuid.uuid4()), "chosen": 0, **extra}, who)
            return st

        def pages(mod, flt, extra="", limit=5, who=0):
            items, cursor, runs, seen_pages = [], "", {}, 0
            while True:
                st, pg = call("GET", f"/api/history?module={mod}&filter={flt}&limit={limit}{extra}" + (f"&cursor={cursor}" if cursor else ""), who=who)
                if st != 200: return st, items, runs, pg
                items += pg["items"]; runs.update(pg["runs"]); seen_pages += 1
                cursor = pg["nextCursor"]
                if not cursor or seen_pages > 50: return st, items, runs, pg

        # ---- E: the 21-10 ease bug (6th consecutive miss of one card) -------------------------------
        HB = "gate-hist-book"
        grades = [call("POST", "/api/review/grade", {"module": HB, "question": "ch06-b09-q9", "grade": "again"})[0] for _ in range(7)]
        check("E1 seven consecutive 'again' grades of one card: every one 200 (v5: the 6th was 500)", grades == [200] * 7,
              ",".join(f"{i + 1}:{g}" for i, g in enumerate(grades)))
        db.execute("UPDATE review_cards SET due_at = now() - interval '1 minute' WHERE account_id = %s AND module_id = %s AND question_key = 'ch06-b09-q9'", (ida, HB))
        st, due = call("GET", f"/api/review/due?module={HB}&limit=10")
        card9 = [c for c in due.get("due", []) if c["question"] == "ch06-b09-q9"]
        check("E2 the card was rescheduled each time: lapses 7, tagged Leech", st == 200 and card9 and card9[0]["lapses"] == 7 and card9[0]["leech"] is True, json.dumps(card9))
        ease = db.fetch_all("SELECT ease FROM review_cards WHERE account_id = %s AND question_key = 'ch06-b09-q9'", (ida,))
        check("E3 its ease sits at the floor (REAL 1.3)", ease and abs(ease[0]["ease"] - 1.3) < 1e-4, json.dumps(ease))
        st, stats = call("GET", f"/api/review/stats?module={HB}")
        check("E4 the Stats row counts it: leeches 1", st == 200 and stats.get("leeches") == 1, str(stats.get("leeches")))

        # ---- seed (account A, gate-hist-book) through the real routes --------------------------------
        R = {k: f"gate-{k}-{secrets.token_hex(3)}" for k in ("r1", "r2", "r3", "r4", "r5")}
        sts = []
        sts += [answer(HB, f"ch01-b01-q{i}", i != 6, R["r1"], "practice") for i in range(1, 7)]       # ch1 5/6
        sts += [answer(HB, f"ch02-b01-q{i}", i <= 2, R["r2"], "practice") for i in range(1, 7)]       # ch2 2/6
        sts += [answer(HB, f"ch03-b01-q{i}", i <= 2, R["r3"], "review", confidence="sure") for i in range(1, 7)]  # ch3 2/6
        sts += [answer(HB, f"ch04-b01-q{i}", False, R["r4"], "practice") for i in range(1, 5)]        # ch4 0/4
        sts += [answer(HB, f"ch01-b01-q{i}", False, R["r5"], "retry") for i in range(1, 4)]           # retry: ch1 0/3
        ai_q = {"question": "Gate AI: which split keeps class ratios?", "options": ["random", "stratified", "k-fold"], "correct": 1}
        ai_key = store.ai_review_key(ai_q)
        st_ai, _ = call("POST", "/api/review/seen", {"module": HB, "body": ai_q, "correct": False})
        sts.append(answer(HB, ai_key, False, R["r1"], "practice"))                                     # AI: no chapter
        fl = [call("POST", "/api/flags", {"module": HB, "question": q, "flagged": True})[0] for q in ("ch02-b01-q3", "ch06-b01-q1")]
        check("Y0 seeding through the real routes: 26 answers 201, AI card 200, 2 flags 200", sts == [201] * 26 and st_ai == 200 and fl == [200, 200], f"{sts.count(201)} logged, ai {st_ai}, flags {fl}")
        # backdate run 3 a day (ties ch2 on ratio but practised longer ago); pre-v5 rows by SQL (throwaway account only)
        db.execute("UPDATE answer_log SET answered_at = answered_at - interval '1 day' WHERE account_id = %s AND run_id = %s", (ida, R["r3"]))
        for i in range(1, 4):
            db.execute("INSERT INTO wrong_answers (account_id, module_id, block_id, quiz_kind, question, options, chosen, correct, attempt, created_at)"
                       " VALUES (%s, %s, 'ch05-b01', 'bank', %s, %s::jsonb, 0, 1, 'old-run', now() - interval '3 days' + %s * interval '1 minute')",
                       (ida, HB, f"Old question {i}?", json.dumps(["a", "b", "c"]), i))
        db.execute("INSERT INTO wrong_answers (account_id, module_id, block_id, quiz_kind, question, options, chosen, correct, attempt)"
                   " VALUES (%s, %s, 'ch02-b01', 'bank', 'Written to both tables after v5', %s::jsonb, 0, 1, %s)", (ida, HB, json.dumps(["a", "b"]), R["r2"]))

        # ---- Y: mastery -------------------------------------------------------------------------------
        st, ms = call("GET", f"/api/mastery?module={HB}")
        by = {a["id"]: a for a in ms.get("areas", [])}
        brief = {k: (v["right"], v["answered"], v["pct"], v["enough"]) for k, v in by.items()}
        check("Y1 chapter book: 6 areas, kind chapter, window 200, min 5, target 80", st == 200 and ms.get("areaKind") == "chapter" and len(by) == 6
              and (ms.get("window"), ms.get("minAnswers"), ms.get("target")) == (200, 5, 80), json.dumps(brief))
        check("Y2 retry run left out: ch1 = 5/6 (83%), not 5/9", by.get("ch01", {}).get("answered") == 6 and by["ch01"]["right"] == 5 and by["ch01"]["pct"] == 83, json.dumps(brief.get("ch01")))
        check("Y3 pre-v5 wrong_answers left out: ch5 = 0 answers, pct null", by.get("ch05", {}).get("answered") == 0 and by["ch05"]["pct"] is None, json.dumps(brief.get("ch05")))
        check("Y4 4 answers (0%): enough false", by.get("ch04", {}).get("answered") == 4 and by["ch04"]["enough"] is False, json.dumps(brief.get("ch04")))
        nu = ms.get("nextUp") or {}
        check("Y5 Next up = ch3 (weakest 33%, tied with ch2, practised a day earlier) — never ch4", nu.get("id") == "ch03" and nu.get("reason") == "weakest", json.dumps(nu))
        check("Y6 the AI answer (no chapter) is unassigned, not in any bar", ms.get("unassigned") == 1, str(ms.get("unassigned")))
        st, mb = call("GET", f"/api/mastery?module={HB}", who=1)
        check("Y7 account B, no answers: every area 0, Next up = ch1 least-practised", st == 200 and all(a["answered"] == 0 for a in mb["areas"])
              and (mb.get("nextUp") or {}).get("id") == "ch01" and mb["nextUp"]["reason"] == "least-practised", json.dumps(mb.get("nextUp")))
        answer(HB, "ch01-b01-q1", True, "gate-b1", "practice", who=1); answer(HB, "ch01-b01-q2", True, "gate-b1", "practice", who=1)
        nb = call("GET", f"/api/mastery?module={HB}", who=1)[1].get("nextUp") or {}
        check("Y8 account B with 2 answers in ch1: nobody has 5 -> Next up = ch2 (fewest answers, book order)", nb.get("id") == "ch02" and nb.get("reason") == "least-practised", json.dumps(nb))
        BAD = "gate-badexam-book"
        db.execute("INSERT INTO answer_log (account_id, module_id, question_key, chapter, run_kind, run_id, correct, client_id, answered_at)"
                   " SELECT %s, %s, 'ch01-b01-q1', 1, 'practice', 'gate-bulk', g > 10, gen_random_uuid(), now() - interval '2 days' + g * interval '1 second'"
                   " FROM generate_series(1, 210) g", (ida, BAD))
        st, mw = call("GET", f"/api/mastery?module={BAD}")
        w1 = (mw.get("areas") or [{}])[0]
        check("Y9 invalid exam block -> chapters; window: 210 answers (10 oldest wrong) -> 200/200", st == 200 and mw.get("areaKind") == "chapter"
              and w1.get("answered") == 200 and w1.get("right") == 200 and w1.get("pct") == 100, json.dumps({k: w1.get(k) for k in ("id", "right", "answered", "pct")}))
        EX = "gate-exam-book"
        ex_sts = [answer(EX, f"ch01-b01-q{i}", True, "gate-ex1", "practice") for i in range(1, 4)]        # D1 3/3
        ex_sts += [answer(EX, f"ch03-b01-q{i}", i == 1, "gate-ex1", "exam") for i in range(1, 6)]        # D2 1/5
        ex_sts.append(answer(EX, "ch02-b01-q1", False, "gate-ex1", "practice", domain="D3"))              # own domain D3 wins over ch2 (D1)
        st, me = call("GET", f"/api/mastery?module={EX}")
        bd = {a["id"]: (a["right"], a["answered"], a.get("weight"), a["chapters"]) for a in me.get("areas", [])}
        check("Y10 domain book: areas D1/D2/D3 with weights; D1 3/3, D2 1/5, D3 0/1 (own domain); Next up D2", ex_sts == [201] * 9 and st == 200 and me.get("areaKind") == "domain"
              and me.get("exam") == {"name": "GATE-EX"} and bd == {"D1": (3, 3, 50, [1, 2]), "D2": (1, 5, 30, [3]), "D3": (0, 1, 20, [4])}
              and (me.get("nextUp") or {}).get("id") == "D2", json.dumps(bd))
        st, _ = call("GET", "/api/mastery?module=gate-no-such-book")
        check("Y11 unknown book -> 400 (not 500)", st == 400, str(st))

        # ---- Z: history --------------------------------------------------------------------------------
        st, first = call("GET", f"/api/history?module={HB}")
        c = first.get("counts", {})
        check("Z1 counts: all 29 (26 logged + 3 pre-v5), wrong 20 (17 + 3), flagged 2 — the post-v5 double write not counted", st == 200 and c == {"all": 29, "wrong": 20, "flagged": 2}, json.dumps(c))
        st, items, runs, _ = pages(HB, "all")
        ids = [i["id"] for i in items]
        legacy = [i for i in items if i["source"] == "legacy"]
        check("Z2 All, paged 5 at a time across the pre-v5 rows: 29 items, no duplicate, newest first, pre-v5 last",
              st == 200 and len(ids) == 29 and len(set(ids)) == 29 and [i["source"] for i in items[-3:]] == ["legacy"] * 3 and all(i["source"] == "log" for i in items[:26]),
              f"{len(ids)} items, {len(set(ids))} distinct, last sources {[i['source'] for i in items[-4:]]}")
        check("Z3 the post-v5 double write is listed once (only the answer_log row)", not any(i.get("body", {}).get("question") == "Written to both tables after v5" for i in legacy) and len(legacy) == 3)
        check("Z4 a pre-v5 row carries chapter 5 + its question to ask again", all(i["chapter"] == 5 and i["body"]["question"].startswith("Old question") for i in legacy), json.dumps(legacy[:1])[:140])
        ai_items = [i for i in items if i["question"] == ai_key]
        check("Z5 the AI answer carries its stored body", ai_items and ai_items[0].get("body", {}).get("question") == ai_q["question"], json.dumps(ai_items)[:120])
        st, witems, wruns, _ = pages(HB, "wrong", limit=4)
        check("Z6 Wrong: 20 items, every one wrong", st == 200 and len(witems) == 20 and all(i.get("correct") is False for i in witems), f"{len(witems)} items, sources {sorted({i.get('source') for i in witems})}, correct values {sorted({str(i.get('correct')) for i in witems})}")
        check("Z7 Retry denominator: under Wrong, run 2 still reads 6 answered / 2 right (not 4/0); retry run 3/0",
              wruns.get(R["r2"]) == {"answered": 6, "right": 2} and wruns.get(R["r5"]) == {"answered": 3, "right": 0}, json.dumps({k: wruns.get(R[k]) for k in ("r2", "r5")}))
        st, fp = call("GET", f"/api/history?module={HB}&filter=flagged")
        fby = {i.get("question"): i for i in fp.get("items", [])}
        check("Z8 Flagged: the 2 flags, ch2 q3 last answered wrong, ch6 q1 never answered", st == 200 and set(fby) == {"ch02-b01-q3", "ch06-b01-q1"}
              and fby["ch02-b01-q3"].get("lastCorrect") is False and "lastCorrect" in fby["ch06-b01-q1"] and fby["ch06-b01-q1"]["lastCorrect"] is None and fp.get("nextCursor") is None, json.dumps(list(fby.values()))[:180])
        st, citems, _, cpg = pages(HB, "all", "&chapter=2")
        check("Z9 chapter 2 filter: its 6 answers only; counts follow the filter", st == 200 and len(citems) == 6 and all(i["chapter"] == 2 for i in citems)
              and cpg["counts"] == {"all": 6, "wrong": 4, "flagged": 1}, f"{len(citems)} {cpg.get('counts')}")
        st, c5, _, _ = pages(HB, "wrong", "&chapter=5")
        check("Z10 chapter 5 filter, Wrong: the 3 pre-v5 rows", st == 200 and len(c5) == 3 and all(i["source"] == "legacy" for i in c5), str(len(c5)))
        st, d1, _, dpg = pages(EX, "all", "&domain=D1")
        check("Z11 domain D1 filter = the same answers the D1 bar counts (3, not the ch2 answer tagged D3)", st == 200 and len(d1) == 3 == bd["D1"][1]
              and all(i["chapter"] == 1 for i in d1), f"{len(d1)} items {[(i['question'], i['domain']) for i in d1]}")
        st, d3, _, _ = pages(EX, "all", "&domain=D3")
        check("Z12 domain D3 filter: the answer tagged D3", st == 200 and [i["question"] for i in d3] == ["ch02-b01-q1"], str([i["question"] for i in d3]))
        st, ob = call("GET", f"/api/history?module={HB}", who=1)
        check("Z13 account B sees none of A's rows", st == 200 and ob["counts"] == {"all": 2, "wrong": 0, "flagged": 0} and all(i["runId"] == "gate-b1" for i in ob["items"]), json.dumps(ob.get("counts")))
        for name, q in (("filter=right", "filter=right"), ("cursor=x:1", "cursor=x:1"), ("flagged + cursor", "filter=flagged&cursor=a:5"),
                        ("chapter + domain", "chapter=1&domain=D1"), ("domain on a chapter book", "domain=D1"), ("limit=101", "limit=101")):
            st, _ = call("GET", f"/api/history?module={HB}&{q}")
            check(f"Z-bad {name} -> 400", st == 400, str(st))
        st, _ = call("GET", f"/api/history?module={EX}&domain=ZZ")
        check("Z-bad unknown domain -> 400", st == 400, str(st))
        for path in (f"/api/history?module={HB}", f"/api/mastery?module={HB}"):
            st, _ = call("GET", path, who=None)
            check(f"Z-auth signed out {path.split('?')[0]} -> 401", st == 401, str(st))
        log500 = Path("/var/tmp/p2c-hb-uvicorn.log").read_text(errors="replace")
        check("Z14 the server log has no traceback", "Traceback" not in log500, (log500[log500.find("Traceback"):][:200] if "Traceback" in log500 else ""))
    finally:
        if server is not None:
            server.terminate(); server.wait(timeout=10)
        for u in users:
            gone = admin("delete-user", "--username", u, "--yes")
            check(f"L9 throwaway account {u} deleted (cascade)", gone.returncode == 0 and u in gone.stdout, (gone.stdout + gone.stderr).strip()[:100])
        left = db.fetch_all("SELECT (SELECT count(*) FROM answer_log WHERE module_id LIKE 'gate-%%-book') a, (SELECT count(*) FROM wrong_answers WHERE module_id LIKE 'gate-%%-book') w,"
                            " (SELECT count(*) FROM review_cards WHERE module_id LIKE 'gate-%%-book') r, (SELECT count(*) FROM question_flags WHERE module_id LIKE 'gate-%%-book') f")
        check("L10 no gate rows left behind", left and all(v == 0 for v in left[0].values()), json.dumps(left))
        if tunnel is not None:
            tunnel.terminate(); tunnel.wait(timeout=10)


if "--live" in sys.argv:
    live()
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
