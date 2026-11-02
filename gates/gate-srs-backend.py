#!/usr/bin/env python3
"""gate-srs-backend.py — spaced repetition, server half (21-10-26).

No service, no database: imports app/backend/store.py (pure scheduling + validators) and reads the
migration and main.py as text/AST.
  S  srs_next: the schedule after every grade, floors, caps, lapse rules;
  F  review_first_seen: right -> a day, wrong -> ten minutes with no lapse counted;
  V  review_key / grade validation;
  D  migration 004 is additive (one CREATE TABLE + one CREATE INDEX, both IF NOT EXISTS);
  R  main.py registers exactly the three review routes, and the two POSTs go through the same-origin gate.
Run: python3 gates/gate-srs-backend.py      (exit 1 on any FAIL)
"""
import ast, importlib.util, re, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "app" / "backend"
sys.path.insert(0, str(BACKEND))
spec = importlib.util.spec_from_file_location("store", BACKEND / "store.py")
store = importlib.util.module_from_spec(spec); spec.loader.exec_module(store)
results = []


def check(cid, ok, detail=""):
    results.append(bool(ok)); print(f"{'PASS' if ok else 'FAIL'}  {cid}  {detail}")


NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
nx = store.srs_next
days = lambda s: (s["due_at"] - NOW) / timedelta(days=1)

s1 = nx(None, "good", NOW)
check("S1 first good = 1 day, reps 1, ease unchanged", s1["interval_days"] == 1 and s1["reps"] == 1 and s1["ease"] == 2.5 and abs(days(s1) - 1) < 1e-9, str(s1["interval_days"]))
s2 = nx(s1, "good", NOW)
check("S2 second good = 3 days", s2["interval_days"] == 3 and s2["reps"] == 2)
s3 = nx(s2, "good", NOW)
check("S3 third good = interval x ease (7.5)", abs(s3["interval_days"] - 7.5) < 1e-6, str(s3["interval_days"]))
check("S4 good intervals only grow", s1["interval_days"] < s2["interval_days"] < s3["interval_days"])
a = nx(s3, "again", NOW)
check("S5 again: reps 0, lapse +1, ease -0.2, due in 10 minutes", a["reps"] == 0 and a["lapses"] == 1 and a["ease"] == 2.3 and a["due_at"] == NOW + timedelta(minutes=10), str(a))
e = nx(s2, "easy", NOW)
check("S6 easy: ease +0.15 and longer than good", e["ease"] == 2.65 and e["interval_days"] > nx(s2, "good", NOW)["interval_days"], str(e["interval_days"]))
e0 = nx(None, "easy", NOW)
check("S7 first easy = 4 days", e0["interval_days"] == 4)
h = nx(s3, "hard", NOW)
check("S8 hard: ease -0.15, interval x1.2", h["ease"] == 2.35 and abs(h["interval_days"] - 7.5 * 1.2) < 1e-6, str(h))
c = None
for _ in range(20):
    c = nx(c, "again", NOW)
check("S9 ease never below 1.3", c["ease"] == 1.3 and c["lapses"] == 20)
c = {"ease": 2.5, "interval_days": 300, "reps": 9, "lapses": 0}
check("S10 interval capped at one year", nx(c, "easy", NOW)["interval_days"] == 365)
check("S11 due_at is UTC and in the future for non-again grades", all(nx(s1, g, NOW)["due_at"] > NOW for g in ("hard", "good", "easy")))

fr, fw = store.review_first_seen(True, NOW), store.review_first_seen(False, NOW)
check("F1 first answered right: due in a day", abs(days(fr) - 1) < 1e-9 and fr["reps"] == 1)
check("F2 first answered wrong: due in 10 minutes, no lapse counted, ease reset", fw["due_at"] == NOW + timedelta(minutes=10) and fw["lapses"] == 0 and fw["ease"] == 2.5 and fw["reps"] == 0)

for good in ("ch03-b05-q2", "ch40-b17-q10", "abc"):
    try: store.review_key(good); check(f"V-key ok {good}", True)
    except ValueError: check(f"V-key ok {good}", False)
for bad in ("", "ab", "x" * 65, "ch03 b05", "ch03/b05", None, "a;drop"):
    try: store.review_key(bad); check(f"V-key bad {bad!r}", False, "ACCEPTED")
    except ValueError: check(f"V-key bad {bad!r}", True, "rejected")
for bad in ("", "AGAIN", "ok", "bad"):
    try: nx(None, bad, NOW); check(f"V-grade bad {bad!r}", False, "ACCEPTED")
    except ValueError: check(f"V-grade bad {bad!r}", True, "rejected")

sql = (BACKEND / "migrations" / "004_review_cards.sql").read_text(encoding="utf-8")
code = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
stmts = [x.strip() for x in code.split(";") if x.strip()]
check("D1 one CREATE TABLE IF NOT EXISTS review_cards + one CREATE INDEX IF NOT EXISTS", len(stmts) == 2 and stmts[0].startswith("CREATE TABLE IF NOT EXISTS review_cards") and stmts[1].startswith("CREATE INDEX IF NOT EXISTS"), f"{len(stmts)} statements")
check("D2 nothing destructive and no existing table touched", not re.search(r"\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER|RENAME)\b", re.sub(r"ON DELETE CASCADE", "", code), re.I))
check("D3 FK to accounts with cascade", "REFERENCES accounts (id) ON DELETE CASCADE" in sql)

tree = ast.parse((BACKEND / "main.py").read_text(encoding="utf-8"))
routes = {}
for n in ast.walk(tree):
    if isinstance(n, ast.FunctionDef):
        for d in n.decorator_list:
            if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in ("get", "post") and d.args and isinstance(d.args[0], ast.Constant) and str(d.args[0].value).startswith("/api/review/"):
                routes[(d.func.attr, d.args[0].value)] = ast.get_source_segment((BACKEND / "main.py").read_text(encoding="utf-8"), n)
check("R1 exactly the three review routes", set(routes) == {("post", "/api/review/seen"), ("post", "/api/review/grade"), ("get", "/api/review/due")}, str(sorted(routes)))
check("R2 both POSTs use the same-origin gate", all("_gate(req)" in src for (m, p), src in routes.items() if m == "post"))
sys.exit(0 if all(results) else 1)
