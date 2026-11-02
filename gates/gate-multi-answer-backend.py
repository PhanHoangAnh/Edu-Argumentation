#!/usr/bin/env python3
"""gate-multi-answer-backend.py — the server half of choose-N questions (21-10-26, user-approved).

No service, no database: imports app/backend/store.py (pure helper) and EXTRACTS pick_questions() from
addons/rooms_store.py by AST (that module needs fastapi, which a gate box may not have).
  W  store.wrong_answer_positions: accepts a single miss and a choose-N miss, REJECTS every malformed shape;
  R  live rooms only ever draw single-answer questions (a list `correct` is skipped, never an error);
  D  migration 003 is additive only (two ADD COLUMN IF NOT EXISTS on wrong_answers, nothing destructive).
Run: python3 gates/gate-multi-answer-backend.py      (exit 1 on any FAIL)
"""
import ast, importlib.util, random, re, sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "app" / "backend"
results = []


def check(cid, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {cid}  {detail}")


sys.path.insert(0, str(BACKEND))   # store.py imports its siblings (settings)
spec = importlib.util.spec_from_file_location("store", BACKEND / "store.py")
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)
f = store.wrong_answer_positions

check("W1 single miss", f({"chosen": 0, "correct": 2}, 4) == (0, 2, None, None))
check("W2 choose-N miss, sorted, ints filled from first positions",
      f({"chosenSet": [3, 1], "correctSet": [0, 1]}, 5) == (1, 0, [1, 3], [0, 1]))
check("W3 a choose-N miss may share its first position with the key",
      f({"chosenSet": [0, 4], "correctSet": [0, 1]}, 5)[:2] == (0, 0))
bad = {
    "same single": ({"chosen": 1, "correct": 1}, 4),
    "equal sets": ({"chosenSet": [0, 1], "correctSet": [1, 0]}, 5),
    "empty chosen": ({"chosenSet": [], "correctSet": [0, 1]}, 5),
    "more picks than N": ({"chosenSet": [0, 1, 2], "correctSet": [0, 1]}, 5),
    "out of range": ({"chosenSet": [9], "correctSet": [0, 1]}, 5),
    "key of one": ({"chosenSet": [0], "correctSet": [1]}, 5),
    "repeat": ({"chosenSet": [0, 0], "correctSet": [1, 2]}, 5),
    "not a list": ({"chosenSet": "x", "correctSet": [1, 2]}, 5),
    "bool position": ({"chosenSet": [True], "correctSet": [1, 2]}, 5),
    "only one set given": ({"chosenSet": [0], "correctSet": None}, 5),
    "negative": ({"chosenSet": [-1], "correctSet": [0, 1]}, 5),
}
for name, (payload, n) in bad.items():
    try:
        f(payload, n); check(f"W-bad {name}", False, "ACCEPTED")
    except ValueError:
        check(f"W-bad {name}", True, "rejected")

tree = ast.parse((BACKEND / "addons" / "rooms_store.py").read_text(encoding="utf-8"))
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "pick_questions")
ns = {"random": random, "Any": object}
exec(compile(ast.Module(body=[fn], type_ignores=[]), "rooms_store.pick_questions", "exec"), ns)
pool = [
    {"source": {"block": "ch01-b01"}, "question": "single", "options": ["a", "b", "c"], "correct": 1},
    {"source": {"block": "ch01-b01"}, "question": "multi", "options": ["a", "b", "c", "d"], "correct": [0, 2]},
    {"source": {"block": "ch01-b01"}, "question": "single2", "options": ["a", "b"], "correct": 0},
]
picked = [q["question"] for q in ns["pick_questions"](pool, ["ch01-b01"], 10, 1)]
check("R1 rooms keep single-answer questions only", sorted(picked) == ["single", "single2"], str(picked))

sql = (BACKEND / "migrations" / "003_multi_answer.sql").read_text(encoding="utf-8")
code = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
stmts = [s.strip() for s in code.split(";") if s.strip()]
check("D1 two ADD COLUMN IF NOT EXISTS on wrong_answers",
      len(stmts) == 2 and all(re.fullmatch(r"ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS (chosen_set|correct_set)\s+JSONB", s) for s in stmts), f"{len(stmts)} statements")
check("D2 nothing destructive", not re.search(r"\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME|TYPE)\b", code, re.I))
sys.exit(0 if all(results) else 1)
