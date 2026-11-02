"""Timed mock exam — PURE rules (exam-recall-suite P3a, 22-10-26). No database, no HTTP, no clock of its own.

The router (addons/exam.py) and the SQL (store.py P3 block) call these; gates/smoke tests import this file
directly. Every function takes what it needs (the book dict, `now`, an `rng`) so a test can pin it.

What lives here
  exam_settings(data)        the OPTIONAL module.json `exam` block -> settings, or None (absent / invalid)
  question_pool(data, spec)  the book's quizData -> gradeable questions keyed by source.question
  largest_remainder(n, w)    integer counts that sum EXACTLY to n (Hamilton method)
  allocate(n, weights, caps) largest remainder that never asks an area for more than it has
  build_run(...)             pick + shuffle the questions of one run, snapshot what grading needs
  preview(data)              what the Practice dialog's Exam row shows before a run
  validate_chosen / is_right / grade_run / scaled_estimate / run_view / is_expired

The `exam` block (plan §4; NO book has one on 22-10-26 — everything must work without it):
  {"name": "CLF-C02", "questions": 65, "minutes": 90, "passScaled": 700, "scaleMax": 1000,
   "scaleMin": 100 | "scale": [100, 1000],
   "domains": [{"id": "D1", "name": "...", "weight": 24, "chapterIds": [1, 2]}, ...]}
  domains are validated by store.exam_domains (the P2 rule: weights sum 100 +/- 1, known chapters, no
  chapter twice). questions 1-500 and minutes 1-600 are REQUIRED; passScaled / scale are optional but, when
  present, must be consistent. Anything invalid -> the whole block is ignored (one warning in the log)
  and the book runs as a "practice exam" (chapter mix, editable defaults, no scaled score, no pass/fail).

⚠ The scaled score is an ESTIMATE. AWS (and most vendors) do not publish the raw -> scaled mapping, and
  the real exam carries unscored, unidentified questions. We grade every question and map linearly:
      estimate = round(scaleMin + (scaleMax - scaleMin) * right / total)     (scaleMin defaults to 0)
  The response says so: `scaledIsEstimate: true` + `scaled.method`.
"""
from __future__ import annotations

import logging
import math
import random
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

import store

_LOG = logging.getLogger("edu.exam")

# Defaults for a book WITHOUT an exam block — UI defaults, editable, NOT exam facts.
FALLBACK_QUESTIONS_DEFAULT = 40      # min(40, pool)
FALLBACK_MINUTES_DEFAULT = 60
FALLBACK_QUESTIONS_MAX = 200
FALLBACK_MINUTES_MAX = 300
BLOCK_QUESTIONS_MAX = 500
BLOCK_MINUTES_MAX = 600
# answer_log client ids of exam answers = uuid5(this, "<runId>:<key>") -> finishing twice logs once.
EXAM_LOG_NAMESPACE = uuid.UUID("6f1d3c2a-5b7e-4f0a-9c1d-2e3f4a5b6c7d")
SCALED_METHOD = "linear: scaleMin + (scaleMax - scaleMin) x right / total; the official mapping is unpublished"
CHAPTER_OF_KEY = re.compile(r"^ch(\d{1,3})-")


def _int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


# --------------------------------------------------------------------------- the exam block
def exam_settings(data: dict[str, Any]) -> dict[str, Any] | None:
    """The VALID exam block -> {name, questions, minutes, passScaled|None, scaleMin, scaleMax|None,
    domains[{id, name, weight, chapters}]}; None when absent or invalid (never raises)."""
    exam = data.get("exam")
    if exam is None:
        return None
    spec = store.area_spec(data)          # domains validated by the P2 rule (it logs its own warning)
    if spec["kind"] != "domain" or not isinstance(exam, dict):
        return None

    def bad(reason: str) -> None:
        _LOG.warning("module %s: exam block ignored (%s)", data.get("moduleId", "?"), reason)

    questions, minutes = exam.get("questions"), exam.get("minutes")
    if not _int(questions) or not 1 <= questions <= BLOCK_QUESTIONS_MAX:
        return bad(f"exam.questions must be a whole number 1-{BLOCK_QUESTIONS_MAX}")
    if not _int(minutes) or not 1 <= minutes <= BLOCK_MINUTES_MAX:
        return bad(f"exam.minutes must be a whole number 1-{BLOCK_MINUTES_MAX}")
    lo, hi = exam.get("scaleMin"), exam.get("scaleMax")
    if exam.get("scale") is not None:
        scale = exam["scale"]
        if not isinstance(scale, list) or len(scale) != 2 or (lo is not None or hi is not None):
            return bad("exam.scale must be [min, max] (and not mixed with scaleMin/scaleMax)")
        lo, hi = scale
    lo = 0 if lo is None else lo
    if not _int(lo) or lo < 0 or (hi is not None and (not _int(hi) or hi <= lo)):
        return bad("exam scale must be whole numbers with max > min >= 0")
    pass_scaled = exam.get("passScaled")
    if pass_scaled is not None:
        if hi is None or not _int(pass_scaled) or not lo < pass_scaled <= hi:
            return bad("exam.passScaled needs scaleMax and must lie in (scaleMin, scaleMax]")
    return {"name": spec["exam"]["name"], "questions": questions, "minutes": minutes, "passScaled": pass_scaled,
            "scaleMin": lo, "scaleMax": hi, "domains": spec["areas"]}


# --------------------------------------------------------------------------- the question pool
def _correct_ok(correct: Any, option_count: int) -> bool:
    """quiz/multiAnswer.ts correctSetOf: one position, or a strictly ascending list of >= 2 positions."""
    if isinstance(correct, list):
        return (len(correct) >= 2 and all(_int(c) and 0 <= c < option_count for c in correct)
                and all(correct[i] < correct[i + 1] for i in range(len(correct) - 1)))
    return _int(correct) and 0 <= correct < option_count


def question_pool(data: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    """quizData -> {"questions": [{key, chapter, area, correct, options}], "skipped": n}, book order.

    A question counts when it has a key (source.question, the same key review cards use), 2-12 options
    and a valid `correct`, and fits an area of `spec` (store.area_spec). First copy of a key wins."""
    out, seen, skipped = [], set(), 0
    quiz = data.get("quizData") if isinstance(data.get("quizData"), list) else []
    for q in quiz:
        src = q.get("source") if isinstance(q, dict) and isinstance(q.get("source"), dict) else {}
        key = src.get("question")
        options = q.get("options") if isinstance(q, dict) else None
        if (not isinstance(key, str) or not store.REVIEW_KEY.match(key) or key in seen
                or not isinstance(options, list) or not 2 <= len(options) <= 12
                or not _correct_ok(q.get("correct"), len(options))):
            skipped += 1
            continue
        chapter = src.get("chapter")
        if not _int(chapter):
            found = CHAPTER_OF_KEY.match(key)
            chapter = int(found.group(1)) if found else None
        domain = src.get("domain") if isinstance(src.get("domain"), str) else None
        area = store.area_of(chapter, domain, spec)
        if area is None:
            skipped += 1
            continue
        seen.add(key)
        correct = q["correct"]
        out.append({"key": key, "chapter": chapter, "area": area,
                    "correct": list(correct) if isinstance(correct, list) else correct, "options": len(options)})
    return {"questions": out, "skipped": skipped}


# --------------------------------------------------------------------------- allocation
def largest_remainder(n: int, weights: list[float]) -> list[int]:
    """Split n into integer counts proportional to `weights` that sum EXACTLY to n (Hamilton): floor of
    each quota, then +1 to the largest fractional parts; a tie goes to the larger weight, then the
    earlier position. 65 x [24, 30, 34, 12] -> [16, 19, 22, 8]. All-zero weights -> an even split."""
    if n < 0 or any(w < 0 for w in weights):
        raise ValueError("n and the weights must not be negative.")
    if not weights:
        if n:
            raise ValueError("cannot split a count over no areas.")
        return []
    total = float(sum(weights))
    if total <= 0:
        weights, total = [1.0] * len(weights), float(len(weights))
    quotas = [n * w / total for w in weights]
    counts = [math.floor(q) for q in quotas]
    order = sorted(range(len(weights)), key=lambda i: (-(quotas[i] - counts[i]), -weights[i], i))
    for i in order[: n - sum(counts)]:
        counts[i] += 1
    return counts


def allocate(n: int, weights: list[float], caps: list[int]) -> list[int]:
    """largest_remainder, but no area gets more than its cap (the questions it has): a capped area is
    fixed at its cap and the rest is re-split over the others by weight. Sums to min(n, sum(caps))."""
    if len(weights) != len(caps):
        raise ValueError("weights and caps must have the same length.")
    left = min(n, sum(caps))
    counts = [0] * len(caps)
    active = [i for i in range(len(caps)) if caps[i] > 0]
    while left > 0 and active:
        share = largest_remainder(left, [weights[i] for i in active])
        over = [i for i, k in zip(active, share) if k > caps[i]]
        if not over:
            for i, k in zip(active, share):
                counts[i] = k
            return counts
        for i in over:
            counts[i] = caps[i]
            left -= caps[i]
        active = [i for i in active if i not in over]
    return counts


# --------------------------------------------------------------------------- one run
def plan_run(data: dict[str, Any], questions: Any = None, minutes: Any = None) -> dict[str, Any]:
    """Validated settings of a NEW run -> {mode, name, questions, minutes, settings|None, spec, pool}.
    With a valid exam block its numbers win (the request's are ignored); without one the request's
    numbers are used (defaults min(40, pool) / 60). ValueError -> 400."""
    settings = exam_settings(data)
    spec = store.area_spec(data)
    pool = question_pool(data, spec)["questions"]
    if not pool:
        raise ValueError("this book has no questions an exam can use.")
    if settings:
        return {"mode": "exam", "name": settings["name"], "questions": min(settings["questions"], len(pool)),
                "minutes": settings["minutes"], "settings": settings, "spec": spec, "pool": pool}
    top = min(len(pool), FALLBACK_QUESTIONS_MAX)
    n = min(FALLBACK_QUESTIONS_DEFAULT, top) if questions is None else questions
    m = FALLBACK_MINUTES_DEFAULT if minutes is None else minutes
    if not _int(n) or not 1 <= n <= top:
        raise ValueError(f"questions must be a whole number 1-{top}.")
    if not _int(m) or not 1 <= m <= FALLBACK_MINUTES_MAX:
        raise ValueError(f"minutes must be a whole number 1-{FALLBACK_MINUTES_MAX}.")
    return {"mode": "practice", "name": None, "questions": n, "minutes": m, "settings": None, "spec": spec,
            "pool": pool}


def build_run(plan: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """Pick the questions: per area by allocate() (domain weights, or each chapter's question count),
    a random sample inside each area, then the whole list shuffled. -> {question_keys, grading,
    blueprint} — exactly what exam_runs stores; grading never re-reads the book."""
    spec, pool = plan["spec"], plan["pool"]
    by_area: dict[str, list[dict[str, Any]]] = {}
    for q in pool:
        by_area.setdefault(q["area"], []).append(q)
    areas = [a for a in spec["areas"] if by_area.get(a["id"])]
    caps = [len(by_area[a["id"]]) for a in areas]
    weights = [float(a["weight"]) for a in areas] if plan["settings"] else [float(c) for c in caps]
    counts = allocate(plan["questions"], weights, caps)
    chosen: list[dict[str, Any]] = []
    for a, k in zip(areas, counts):
        chosen += rng.sample(by_area[a["id"]], k)
    rng.shuffle(chosen)
    s = plan["settings"] or {}
    blueprint = {
        "mode": plan["mode"], "name": plan["name"], "questions": len(chosen), "minutes": plan["minutes"],
        "areaKind": spec["kind"], "passScaled": s.get("passScaled"), "scaleMin": s.get("scaleMin"),
        "scaleMax": s.get("scaleMax"),
        "areas": [{"id": a["id"], "name": a["name"], "count": k, **({"weight": a["weight"]} if "weight" in a else {})}
                  for a, k in zip(areas, counts) if k],
    }
    grading = {q["key"]: {"chapter": q["chapter"], "area": q["area"], "correct": q["correct"], "options": q["options"]}
               for q in chosen}
    return {"question_keys": [q["key"] for q in chosen], "grading": grading, "blueprint": blueprint}


def preview(data: dict[str, Any]) -> dict[str, Any]:
    """The Exam row before a run. `isDefault: true` = the numbers are editable UI defaults, not exam facts."""
    settings = exam_settings(data)
    spec = store.area_spec(data)
    pool = question_pool(data, spec)["questions"]
    available: dict[str, int] = {}
    for q in pool:
        available[q["area"]] = available.get(q["area"], 0) + 1
    areas = [{"id": a["id"], "name": a["name"], "available": available.get(a["id"], 0),
              **({"weight": a["weight"]} if "weight" in a else {})} for a in spec["areas"]]
    if settings:
        scaled = None if settings["passScaled"] is None else {
            "passScaled": settings["passScaled"], "scaleMin": settings["scaleMin"], "scaleMax": settings["scaleMax"]}
        return {"mode": "exam", "name": settings["name"], "questions": min(settings["questions"], len(pool)),
                "minutes": settings["minutes"], "isDefault": False, "poolSize": len(pool), "areaKind": "domain",
                "areas": areas, "scaled": scaled, "maxQuestions": None, "maxMinutes": None}
    return {"mode": "practice", "name": None, "questions": min(FALLBACK_QUESTIONS_DEFAULT, len(pool)),
            "minutes": FALLBACK_MINUTES_DEFAULT, "isDefault": True, "poolSize": len(pool), "areaKind": "chapter",
            "areas": areas, "scaled": None, "maxQuestions": min(len(pool), FALLBACK_QUESTIONS_MAX),
            "maxMinutes": FALLBACK_MINUTES_MAX}


# --------------------------------------------------------------------------- answers, clock, grading
def validate_chosen(raw: Any, snap: dict[str, Any]) -> int | list[int] | None:
    """One answer for one run question. null = clear it. Single-answer question -> one position;
    choose-N question -> a list of 1..options DISTINCT positions (returned sorted). ValueError -> 400."""
    if raw is None:
        return None
    n = snap["options"]
    if isinstance(snap["correct"], list):
        if (not isinstance(raw, list) or not 1 <= len(raw) <= n or len(set(raw)) != len(raw)
                or not all(_int(c) and 0 <= c < n for c in raw)):
            raise ValueError(f"chosen must be a list of 1-{n} different option positions for this question.")
        return sorted(raw)
    if not _int(raw) or not 0 <= raw < n:
        raise ValueError(f"chosen must be one option position 0-{n - 1} for this question.")
    return raw


def is_right(correct: Any, chosen: Any) -> bool:
    """Exactly multiAnswer.ts: a list = EXACT set (no partial credit); else the one position. Unanswered = wrong."""
    if chosen is None:
        return False
    if isinstance(correct, list):
        return isinstance(chosen, list) and len(chosen) == len(set(chosen)) and sorted(chosen) == sorted(correct)
    return _int(chosen) and chosen == correct


def is_expired(deadline_at: datetime, now: datetime) -> bool:
    """The server is the clock: an answer AT or after the deadline is late."""
    return now >= deadline_at


def remaining_seconds(deadline_at: datetime, now: datetime) -> int:
    return max(0, math.ceil((deadline_at - now).total_seconds()))


def deadline_for(started_at: datetime, minutes: int) -> datetime:
    return started_at + timedelta(minutes=minutes)


def scaled_estimate(right: int, total: int, blueprint: dict[str, Any]) -> dict[str, Any] | None:
    """Only when the book's exam block gives passScaled + scaleMax; else None (no scaled score, no pass/fail)."""
    if blueprint.get("passScaled") is None or blueprint.get("scaleMax") is None or total <= 0:
        return None
    lo, hi = blueprint.get("scaleMin") or 0, blueprint["scaleMax"]
    estimate = round(lo + (hi - lo) * right / total)
    return {"estimate": estimate, "scaleMin": lo, "scaleMax": hi, "passScaled": blueprint["passScaled"],
            "passedEstimate": estimate >= blueprint["passScaled"], "method": SCALED_METHOD}


def grade_run(row: dict[str, Any]) -> dict[str, Any]:
    """Grade one stored run (exam_runs row: question_keys, grading, answers, flags, blueprint).
    -> {right, total, scaled|None, areas[], questions[], log[]}; `log` = the answer_log rows to append
    (answered questions only, client_id stable per run x question)."""
    bp, grading = row["blueprint"], row["grading"]
    answers, flags = row.get("answers") or {}, set(row.get("flags") or [])
    names = {a["id"]: a["name"] for a in bp.get("areas", [])}
    per_area: dict[str, dict[str, int]] = {}
    questions, log, right = [], [], 0
    for n, key in enumerate(row["question_keys"], start=1):
        snap = grading[key]
        chosen = answers.get(key)
        ok = is_right(snap["correct"], chosen)
        right += ok
        a = per_area.setdefault(snap["area"], {"total": 0, "right": 0})
        a["total"] += 1
        a["right"] += ok
        questions.append({"n": n, "key": key, "chapter": snap["chapter"], "area": snap["area"], "chosen": chosen,
                          "correct": snap["correct"], "right": ok, "flagged": key in flags})
        if chosen is not None:
            log.append({"question_key": key, "chapter": snap["chapter"],
                        "domain": snap["area"] if bp.get("areaKind") == "domain" else None,
                        "correct": ok, "chosen": chosen,
                        "client_id": str(uuid.uuid5(EXAM_LOG_NAMESPACE, f"{row['id']}:{key}"))})
    total = len(row["question_keys"])
    areas = [{"id": aid, "name": names.get(aid, aid), "total": s["total"], "right": s["right"],
              "pct": round(100 * s["right"] / s["total"])} for aid, s in per_area.items()]
    order = {a["id"]: i for i, a in enumerate(bp.get("areas", []))}
    areas.sort(key=lambda a: order.get(a["id"], len(order)))
    return {"right": right, "total": total, "scaled": scaled_estimate(right, total, bp), "areas": areas,
            "questions": questions, "log": log}


def _iso(value: datetime | None) -> str | None:
    return store._stamp(value) if value is not None else None


def run_view(row: dict[str, Any], now: datetime) -> dict[str, Any]:
    """An OPEN run for the client: keys in order, answers, flags, the server's clock. No grading data
    beyond `choose` (how many options to pick — the book shows that anyway)."""
    bp, grading, answers = row["blueprint"], row["grading"], row.get("answers") or {}
    return {
        "id": row["id"], "module": row["module_id"], "status": "open", "mode": bp["mode"], "name": bp.get("name"),
        "startedAt": _iso(row["started_at"]), "deadlineAt": _iso(row["deadline_at"]), "serverNow": _iso(now),
        "remainingSeconds": remaining_seconds(row["deadline_at"], now), "minutes": bp["minutes"],
        "total": len(row["question_keys"]), "areaKind": bp["areaKind"],
        "questions": [{"n": n, "key": k, "chapter": grading[k]["chapter"], "area": grading[k]["area"],
                       "choose": len(grading[k]["correct"]) if isinstance(grading[k]["correct"], list) else 1}
                      for n, k in enumerate(row["question_keys"], start=1)],
        "answers": answers, "answeredCount": sum(1 for v in answers.values() if v is not None),
        "flags": list(row.get("flags") or []),
    }


def result_view(row: dict[str, Any]) -> dict[str, Any]:
    """A FINISHED run (its stored result + the row's times)."""
    res = row["result"]
    scaled = res.get("scaled")
    answered = sum(1 for q in res["questions"] if q["chosen"] is not None)
    return {
        "id": row["id"], "module": row["module_id"], "status": "finished", "mode": row["blueprint"]["mode"],
        "name": row["blueprint"].get("name"), "startedAt": _iso(row["started_at"]),
        "deadlineAt": _iso(row["deadline_at"]), "finishedAt": _iso(row["finished_at"]),
        "finishedBy": row["finished_by"], "areaKind": row["blueprint"]["areaKind"],
        "total": res["total"], "right": res["right"], "answered": answered, "unanswered": res["total"] - answered,
        "rawPct": round(100 * res["right"] / res["total"]) if res["total"] else 0,
        "areas": res["areas"], "scaled": scaled, "scaledIsEstimate": scaled is not None,
        "questions": res["questions"],
    }


def start_decision(open_row: dict[str, Any] | None, now: datetime, restart: bool) -> str:
    """What POST /api/exam/start does with this account x book's open run:
    "create" (none) · "resume" (open, in time, no restart) · "finish-then-create" (expired, or restart)."""
    if open_row is None:
        return "create"
    if restart or is_expired(open_row["deadline_at"], now):
        return "finish-then-create"
    return "resume"
