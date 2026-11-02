"""Store readers AND writers for the edu-study service (:8792).

edu-replatform Phase 03 slice D (readers) + Phase 04 (writers) + Phase 06a (per-account PostgreSQL).

⚑⚑ PHASE 06a (23-09-26, ruling R25) SUPERSEDES THE PROGRESS HALF OF D-P4-1 BELOW.
   Progress is now PER ACCOUNT in PostgreSQL (``edu_study`` on nn:5432, see db.py). This
   service NO LONGER WRITES ``progress.json`` — not one byte. ``:8767`` still does, and that file
   stays the user's truth until the cutover; ``read_progress_json()`` below reads it ONLY for the
   idempotent import (admin.py import-progress), which is re-run at cutover.
   ``library-meta.json`` (book titles, shared by everyone) is unchanged and still written here.

⛔ ONE SHARED STORE, NOT A SECOND ONE (decision D-P4-1, 23-09-26). ``progress.json`` and
   ``library-meta.json`` are the SAME files the legacy ``:8767`` reads and writes. The user
   studies live on ``:8767``, so ``:8792`` must read his writes, and the Phase-04 Tier-3 oracle
   requires ``:8767`` to read ``:8792``'s. A SQLite copy beside the JSON would be a second
   source of truth that can disagree with the first; SQLite lands at Phase 06, when ``:8767``
   stops writing and there is exactly one writer left.

⛔ THE WRITE IS LOCKED AND RE-READS INSIDE THE LOCK. ``progress.json`` is read-modify-write:
   two concurrent completions each read v1 and each write v1+x, and the second silently
   erases the first (a lost update, measured as the reason this phase exists). FastAPI runs
   plain ``def`` handlers in a THREADPOOL, so ``:8792``'s own requests race each other. An
   ``fcntl`` exclusive lock on a sibling lock file serialises them, and the read happens
   AFTER the lock is held — a lock around only the write would not help.
   ⚠ It cannot fence ``:8767`` (which does not take the lock and must not be edited). That
     race already existed inside ``:8767`` alone; it ends at Phase 06.

⛔ THE BYTE FORMAT IS THE LEGACY'S, EXACTLY: ``json.dumps(store, indent=2, sort_keys=True)``
   + ``"\n"``, written to ``.<name>.tmp``, chmod 600, ``os.replace``. Gate W-FORMAT proves it:
   a probe write followed by its reset returns the file to its pre-probe sha256.

Every path comes from ``settings.store_paths()`` — the one accessor (decision D-C1). Do not
read ``os.environ`` here; that is exactly the scatter this program is unwinding.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from settings import store_path

# Ported VERBATIM from aws-quiz-app/edu_server.py. The regexes are SECURITY CONTROLS on the
# file-serving routes, not cosmetics — widening one widens what the unauthenticated :8792 will
# serve to every host on 192.168.100.0/24.
MODULE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")                # edu_server.py:161
ASSET_FILE = re.compile(r"^(fig|eq)-\d{1,3}[-.]\d{1,3}\.png$")      # edu_server.py:126
BLOCK_ID = re.compile(r"^ch\d{2}-b\d{2}$")                          # edu_server.py:153
MODULE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*\.json")       # edu_server.py:313

# ⚠ ASSET_FILE accepts BOTH caption separators on purpose: a book numbers its own figures —
# "Figure 1-1." (O'Reilly/Géron) vs "Figure 1.1:" (OpenIntro). Digits stay REQUIRED on both
# sides, so ".." can never match. Do NOT narrow this back to a hyphen.

DEFAULT_MODULE = "geron-homl3"      # edu_server.py:312
LEGACY_MODULE_ID = "geron-homl3"    # edu_server.py:164
MAX_TITLE = 160

GENERAL_DEFAULTS: dict[str, Any] = {   # edu_server.py:128
    "ai_question_count": 5,
    "fresh_quiz_size": 20,
    "require_access_token": False,
}


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


# --------------------------------------------------------------------------- general
def read_general_settings() -> dict[str, Any]:
    """The three general settings, defaults when the file is absent or corrupt."""
    values = dict(GENERAL_DEFAULTS)
    stored = _read_json(store_path("EDU_SETTINGS_PATH"))
    if isinstance(stored, dict):
        for key in GENERAL_DEFAULTS:
            if key in stored:
                values[key] = stored[key]
    return values


# --------------------------------------------------------------------------- progress (JSON, read-only)
def read_progress_json() -> dict[str, Any]:
    """The legacy ``progress.json`` as ``{"version": 2, "modules": {...}}``. READ-ONLY.

    Only the import (admin.py import-progress) calls this. A legacy top-level ``completed`` map is
    the pre-v2 single-book shape and belongs to the Géron key, exactly as edu_server.py reads it.
    """
    stored = _read_json(store_path("EDU_PROGRESS_PATH"))
    if not isinstance(stored, dict):
        return {"version": 2, "modules": {}}
    if isinstance(stored.get("modules"), dict):
        return {"version": 2, "modules": stored["modules"]}
    legacy = stored.get("completed")
    return {"version": 2, "modules": {LEGACY_MODULE_ID: {"completed": legacy}} if isinstance(legacy, dict) else {}}


def module_key(value: Any) -> str:
    key = str(value or "").strip().lower()
    return key if MODULE_ID.match(key) else LEGACY_MODULE_ID


# --------------------------------------------------------------------------- progress (PostgreSQL, per account)
def _stamp(value: datetime) -> str:
    """The legacy's own timestamp shape: ISO-8601, seconds, UTC offset (``2026-09-23T01:43:12+00:00``)."""
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def read_progress(account_id: int, module: str = LEGACY_MODULE_ID) -> dict[str, Any]:
    """{"module": id, "completed": {"ch01-b03": {"at", "score", "total", "source"}}} for ONE account.

    Same payload shape as the JSON era, so the page did not change. Block ids are POSITIONAL, so
    progress is keyed per module as well as per account.
    """
    import db

    rows = db.fetch_all(
        "SELECT block_id, completed_at, score, total, source FROM progress"
        " WHERE account_id = %s AND module_id = %s ORDER BY block_id",
        (account_id, module),
    )
    return {
        "module": module,
        "completed": {
            r["block_id"]: {"at": _stamp(r["completed_at"]), "score": r["score"], "total": r["total"], "source": r["source"]}
            for r in rows if BLOCK_ID.match(r["block_id"])
        },
    }


def record_attempt(account_id: int, module: str, block: str, score: int, total: int, source: str) -> None:
    """Every finished assessment's score, perfect or not (the Account page's "recent attempts")."""
    import db

    db.execute(
        "INSERT INTO attempts (account_id, module_id, block_id, score, total, source) VALUES (%s, %s, %s, %s, %s, %s)",
        (account_id, module, block, score, total, source),
    )


def mark_block_complete(account_id: int, module: str, block: str, score: int, total: int, source: str) -> dict[str, Any]:
    """Record a 100% result. A later perfect retake refreshes the entry, exactly as the JSON store
    overwrote it; a worse retake never reaches here (the route checks score == total)."""
    import db

    db.execute(
        "INSERT INTO progress (account_id, module_id, block_id, completed_at, score, total, source)"
        " VALUES (%s, %s, %s, now(), %s, %s, %s)"
        " ON CONFLICT (account_id, module_id, block_id) DO UPDATE SET"
        " completed_at = EXCLUDED.completed_at, score = EXCLUDED.score, total = EXCLUDED.total,"
        " source = EXCLUDED.source, imported = FALSE",
        (account_id, module, block, score, total, source),
    )
    return read_progress(account_id, module)


def reset_progress(account_id: int, module: str) -> dict[str, Any]:
    """Clears ONE module for ONE account. Never another book, never another account."""
    import db

    db.execute("DELETE FROM progress WHERE account_id = %s AND module_id = %s", (account_id, module))
    return read_progress(account_id, module)


def import_progress_json(account_id: int) -> dict[str, int]:
    """Copy every progress.json entry into ONE account. IDEMPOTENT: an entry already present is
    left alone (ON CONFLICT DO NOTHING), so a second run inserts 0 and a run after more study on
    :8767 inserts only the new blocks. progress.json itself is never written."""
    import db

    modules = read_progress_json()["modules"]
    seen = inserted = skipped = 0
    with db.connect() as conn:
        for module, entry in sorted(modules.items()):
            completed = entry.get("completed") if isinstance(entry, dict) else None
            if not isinstance(completed, dict):
                continue
            for block, item in sorted(completed.items()):
                seen += 1
                if not (MODULE_ID.match(str(module)) and BLOCK_ID.match(str(block)) and isinstance(item, dict)):
                    skipped += 1
                    continue
                try:
                    at = datetime.fromisoformat(str(item.get("at")))
                    if at.tzinfo is None:
                        at = at.replace(tzinfo=timezone.utc)
                    score, total = int(item.get("score")), int(item.get("total"))
                except (TypeError, ValueError):
                    skipped += 1
                    continue
                if total <= 0 or score < 0:
                    skipped += 1
                    continue
                cur = conn.execute(
                    "INSERT INTO progress (account_id, module_id, block_id, completed_at, score, total, source, imported)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE) ON CONFLICT DO NOTHING",
                    (account_id, module, block, at, score, total, str(item.get("source") or "written")[:16]),
                )
                inserted += cur.rowcount
    return {"entries": seen, "inserted": inserted, "already_present": seen - skipped - inserted, "skipped": skipped}


# --------------------------------------------------------------------------- writers (files)
def write_atomic(path: Path, text: str) -> None:
    """edu_server.py:write_atomic, verbatim: temp file in the same directory, 600, rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(text, encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, path)


@contextmanager
def _locked(path: Path):
    """Exclusive lock on ``<path>.lock`` for the whole read-modify-write.

    A SIBLING lock file, never the data file: ``os.replace`` swaps the data file's inode, so a
    lock held on the old inode would not exclude a writer that opened the new one.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = path.with_name(f".{path.name}.lock")
    with open(lock, "a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def set_book_title(file: str, title: str) -> str:
    """Operator rename — library-meta.json, never module.json (edu_server.py:set_book_title)."""
    path = store_path("EDU_LIBRARY_META_PATH")
    with _locked(path):
        meta = read_library_meta()
        meta["titles"][file] = title
        write_atomic(path, json.dumps(meta, indent=2, sort_keys=True) + "\n")
    return title


def log_ask(entry: dict[str, Any]) -> None:
    """Append one answered question to the ask log. Best-effort and silent (edu_server.py:log_ask).

    ⚑ D-P4-5: ``dirname(EDU_PROGRESS_PATH)/logs/ask.jsonl`` — on nn that IS the file ``:8767``
    appends to, so the defect list keeps writing itself whichever port he reads on. Derived, not
    a new variable, so /api/health stays at exactly seven keys.
    """
    try:
        path = store_path("EDU_PROGRESS_PATH").parent / "logs" / "ask.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


# --------------------------------------------------------------------------- library meta
def read_library_meta() -> dict[str, Any]:
    """Operator-renamed book titles.

    ⚠ D5: ``library-meta.json`` DOES NOT EXIST IN PRODUCTION — it is a test fixture the smoke
    harness creates. No read path may depend on it. Absent file => empty titles, and every
    book keeps the title from its own module.json.
    """
    stored = _read_json(store_path("EDU_LIBRARY_META_PATH"))
    titles = stored.get("titles") if isinstance(stored, dict) else None
    return {"titles": titles if isinstance(titles, dict) else {}}


def clean_title(value: Any) -> str:
    """One line, printable, bounded. Titles render as TEXT, never as HTML."""
    text = " ".join(str(value or "").split())
    return "".join(ch for ch in text if ch.isprintable())[:MAX_TITLE].strip()


# --------------------------------------------------------------------------- book identity
def module_id_for(data: dict[str, Any]) -> str:
    """Same rule as moduleIdFor() in app.js, so the home page reads the right progress."""
    tutorial = data.get("tutorialData") if isinstance(data.get("tutorialData"), dict) else {}
    explicit = str(data.get("moduleId") or tutorial.get("moduleId") or "").strip().lower()
    if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", explicit):
        return explicit
    title = unicodedata.normalize("NFKD", str(tutorial.get("title") or "module").lower())
    slug = re.sub(r"[^a-z0-9]+", "-", title).strip("-")[:56]
    return f"t-{slug}" if re.match(r"[a-z0-9]", slug) and len(slug) >= 2 else "module"


def recency_by_module(account_id: int) -> dict[str, float]:
    """{module_id: newest completion as a unix timestamp} for ONE account, in one query — the only
    per-book activity recorded. Reading without finishing a block leaves no trace, which is honest."""
    import db

    rows = db.fetch_all(
        "SELECT module_id, max(completed_at) AS newest FROM progress WHERE account_id = %s GROUP BY module_id",
        (account_id,),
    )
    return {r["module_id"]: r["newest"].timestamp() for r in rows if r["newest"]}


def mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def wrong_answer_positions(payload: dict[str, Any], option_count: int) -> tuple[int, int, list[int] | None, list[int] | None]:
    """Validate the positions of ONE wrong answer -> (chosen, correct, chosen_set, correct_set).

    Single answer (the usual): ``chosen`` and ``correct`` are different option positions and both sets are None.
    Choose-N (21-10-26): ``correctSet`` is >= 2 distinct positions and ``chosenSet`` is 1..len(correctSet)
    distinct positions, and the two sets differ. Both are returned SORTED, and the two INTEGER columns
    are filled with each set's first position, so every existing reader of wrong_answers keeps working.
    Raises ValueError (the route answers 400) on anything else.
    """
    def positions(raw: Any, name: str, low: int, high: int) -> list[int]:
        if not isinstance(raw, list) or isinstance(raw, bool) or not low <= len(raw) <= high:
            raise ValueError(f"{name} must be a list of {low}-{high} option positions.")
        out = []
        for value in raw:
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < option_count:
                raise ValueError(f"{name} holds a position outside the options.")
            out.append(value)
        if len(set(out)) != len(out):
            raise ValueError(f"{name} repeats a position.")
        return sorted(out)

    if payload.get("correctSet") is not None or payload.get("chosenSet") is not None:
        correct_set = positions(payload.get("correctSet"), "correctSet", 2, option_count)
        chosen_set = positions(payload.get("chosenSet"), "chosenSet", 1, len(correct_set))
        if chosen_set == correct_set:
            raise ValueError("chosenSet and correctSet must differ.")
        return chosen_set[0], correct_set[0], chosen_set, correct_set
    chosen, correct = int(payload.get("chosen")), int(payload.get("correct"))
    if not (0 <= chosen < option_count and 0 <= correct < option_count) or chosen == correct:
        raise ValueError("chosen and correct must be different option positions.")
    return chosen, correct, None, None


# --------------------------------------------------------------------------- spaced repetition (21-10-26)
# SM-2-lite. One pure function decides the next schedule; the SQL helpers below only load and save.
SRS_GRADES = ("again", "hard", "good", "easy")
SRS_START_EASE = 2.5
SRS_MIN_EASE = 1.3
SRS_MAX_DAYS = 365.0
SRS_AGAIN_MINUTES = 10
REVIEW_KEY = re.compile(r"^[A-Za-z0-9._-]{3,64}$")


def srs_next(card: dict[str, Any] | None, grade: str, now: datetime) -> dict[str, Any]:
    """The next state of one card after one grade. ``card`` is None for a card never seen.

    again: back to step 0, one more lapse, ease -0.2 (not below 1.3), due in 10 minutes.
    hard : ease -0.15, interval x1.2 (at least 1 day), reps +1.
    good : 1 day, then 3 days, then interval x ease; reps +1.
    easy : ease +0.15, 4 days at first, then interval x ease x 1.3 (at least 4 days); reps +1.
    Interval is capped at one year. Returns ease, interval_days, reps, lapses, due_at (UTC).
    """
    from datetime import timedelta

    if grade not in SRS_GRADES:
        raise ValueError(f"grade must be one of {', '.join(SRS_GRADES)}.")
    ease = float(card["ease"]) if card else SRS_START_EASE
    interval = float(card["interval_days"]) if card else 0.0
    reps = int(card["reps"]) if card else 0
    lapses = int(card["lapses"]) if card else 0
    if grade == "again":
        reps, interval = 0, 0.0
        lapses += 1
        ease = max(SRS_MIN_EASE, ease - 0.2)
        due = now + timedelta(minutes=SRS_AGAIN_MINUTES)
    else:
        if grade == "hard":
            ease = max(SRS_MIN_EASE, ease - 0.15)
            interval = max(1.0, interval * 1.2) if reps else 1.0
        elif grade == "good":
            interval = 1.0 if reps == 0 else 3.0 if reps == 1 else interval * ease
        else:  # easy
            ease += 0.15
            interval = 4.0 if reps == 0 else max(4.0, interval * ease * 1.3)
        reps += 1
        interval = min(interval, SRS_MAX_DAYS)
        due = now + timedelta(days=interval)
    return {"ease": round(ease, 3), "interval_days": round(interval, 3), "reps": reps, "lapses": lapses, "due_at": due}


def review_first_seen(correct: bool, now: datetime) -> dict[str, Any]:
    """A card created by answering a question in an ordinary quiz: right -> first review in a day;
    wrong -> back in ten minutes WITHOUT counting a lapse (he had not learned it yet)."""
    state = srs_next(None, "good" if correct else "again", now)
    if not correct:
        state["lapses"] = 0
        state["ease"] = SRS_START_EASE
    return state


def review_key(value: Any) -> str:
    key = str(value or "").strip()
    if not REVIEW_KEY.match(key):
        raise ValueError("question must be a quiz question key such as ch03-b05-q2.")
    return key


def review_seen(account_id: int, module: str, key: str, correct: bool) -> str:
    """Enrol a question after an ordinary quiz answer. An existing card changes ONLY on a wrong answer
    (a lapse); a right answer in a practice quiz must not push the interval out (that is cramming)."""
    import db

    now = datetime.now(timezone.utc)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT ease, interval_days, reps, lapses FROM review_cards"
            " WHERE account_id = %s AND module_id = %s AND question_key = %s FOR UPDATE",
            (account_id, module, key),
        ).fetchone()
        if row is None:
            s = review_first_seen(correct, now)
            conn.execute(
                "INSERT INTO review_cards (account_id, module_id, question_key, ease, interval_days, reps, lapses, due_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (account_id, module, key, s["ease"], s["interval_days"], s["reps"], s["lapses"], s["due_at"]),
            )
            return "created"
        if correct:
            return "unchanged"
        s = srs_next(row, "again", now)
        conn.execute(
            "UPDATE review_cards SET ease = %s, interval_days = %s, reps = %s, lapses = %s, due_at = %s, last_reviewed_at = %s"
            " WHERE account_id = %s AND module_id = %s AND question_key = %s",
            (s["ease"], s["interval_days"], s["reps"], s["lapses"], s["due_at"], now, account_id, module, key),
        )
        return "lapsed"


def review_grade(account_id: int, module: str, key: str, grade: str) -> dict[str, Any]:
    """Apply one review grade (creates the card if the question was never enrolled)."""
    import db

    now = datetime.now(timezone.utc)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT ease, interval_days, reps, lapses FROM review_cards"
            " WHERE account_id = %s AND module_id = %s AND question_key = %s FOR UPDATE",
            (account_id, module, key),
        ).fetchone()
        s = srs_next(row, grade, now)
        conn.execute(
            "INSERT INTO review_cards (account_id, module_id, question_key, ease, interval_days, reps, lapses, due_at, last_reviewed_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
            " ON CONFLICT (account_id, module_id, question_key) DO UPDATE SET ease = EXCLUDED.ease,"
            " interval_days = EXCLUDED.interval_days, reps = EXCLUDED.reps, lapses = EXCLUDED.lapses,"
            " due_at = EXCLUDED.due_at, last_reviewed_at = EXCLUDED.last_reviewed_at",
            (account_id, module, key, s["ease"], s["interval_days"], s["reps"], s["lapses"], s["due_at"], now),
        )
    return {"question": key, "intervalDays": s["interval_days"], "reps": s["reps"], "lapses": s["lapses"],
            "dueAt": _stamp(s["due_at"])}


def review_due(account_id: int, module: str, limit: int = 20) -> dict[str, Any]:
    """Cards due now (oldest first, at most `limit`), plus the total due and the number of cards."""
    import db

    limit = max(1, min(int(limit), 100))
    rows = db.fetch_all(
        "SELECT question_key, due_at, reps, lapses FROM review_cards"
        " WHERE account_id = %s AND module_id = %s AND due_at <= now() ORDER BY due_at LIMIT %s",
        (account_id, module, limit),
    )
    counts = db.fetch_one(
        "SELECT count(*) FILTER (WHERE due_at <= now()) AS due, count(*) AS total FROM review_cards"
        " WHERE account_id = %s AND module_id = %s",
        (account_id, module),
    ) or {"due": 0, "total": 0}
    return {
        "due": [{"question": r["question_key"], "dueAt": _stamp(r["due_at"]), "reps": r["reps"], "lapses": r["lapses"]} for r in rows],
        "dueCount": int(counts["due"]), "total": int(counts["total"]),
    }


# =========================================================================== exam-recall-suite P1 (22-10-26)
# ⚑ APPEND-ONLY BLOCK (plan exam-recall-suite_22-10-26 §7, instruction E1). Nothing above was edited:
#   review_seen / review_due stay as they were; the two main.py review handlers now call
#   review_enrol / review_due_page below (the same behaviour plus: AI-question bodies, the new-card
#   daily cap, leech tags, the 10-50 run size). Tables: migration 005_review_more.sql.
# Pure helpers first (a gate can test them without a database), then the SQL readers/writers.
import hashlib  # noqa: E402
import uuid  # noqa: E402
from datetime import timedelta  # noqa: E402

# ⚠ "Today" for the new-card cap and the stats is the learners' day: UTC+7 (Vietnam, no daylight
#   saving), a fixed offset so no tz database is needed. Change it here only.
STUDY_DAY_TZ = timezone(timedelta(hours=7))
NEW_PER_DAY_DEFAULT, NEW_PER_DAY_MAX = 20, 200
SESSION_SIZE_DEFAULT, SESSION_SIZE_MIN, SESSION_SIZE_MAX, SESSION_SIZE_STEP = 20, 10, 50, 5
LEECH_LAPSES = 6                    # a card lapsed this often is tagged "leech" (still scheduled)
MAX_BODY_BYTES = 8 * 1024           # one stored AI question (question + options + explanations)
MAX_CHOSEN_BYTES = 2 * 1024
RETENTION_DAYS = 30
RUN_KINDS = ("quiz", "practice", "review", "exam", "retry")
CONFIDENCES = ("sure", "unsure", "guess")
RUN_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
CHAPTER_OF_KEY = re.compile(r"^ch(\d{1,3})-")


def _plain_int(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be a whole number {low}-{high}.")
    return value


def review_body(raw: Any) -> dict[str, Any]:
    """Validate ONE AI-written question -> the body stored with its card / flag.

    Shape = the frontend QuizQuestion: question, options (2-12 strings), correct (one position, or a
    strictly ascending list of >= 2 positions for choose-N), optional per-option `explanations`,
    optional `explanation`. Serialised size <= 8 KB. Raises ValueError (the route answers 400).
    """
    if not isinstance(raw, dict):
        raise ValueError("body must be an object with question, options and correct.")
    question = raw.get("question")
    if not isinstance(question, str) or not question.strip() or len(question) > 4_000:
        raise ValueError("body.question must be 1-4000 characters.")
    options = raw.get("options")
    if not isinstance(options, list) or not 2 <= len(options) <= 12 or not all(isinstance(o, str) for o in options):
        raise ValueError("body.options must be a list of 2-12 strings.")
    correct = raw.get("correct")
    if isinstance(correct, list):
        if (len(correct) < 2 or any(isinstance(c, bool) or not isinstance(c, int) or not 0 <= c < len(options) for c in correct)
                or correct != sorted(set(correct))):
            raise ValueError("body.correct must be one option position or an ascending list of 2+ positions.")
    elif isinstance(correct, bool) or not isinstance(correct, int) or not 0 <= correct < len(options):
        raise ValueError("body.correct must be one option position or an ascending list of 2+ positions.")
    body: dict[str, Any] = {"question": question.strip(), "options": list(options), "correct": correct}
    explanations = raw.get("explanations")
    if isinstance(explanations, list) and len(explanations) == len(options) \
            and all(e is None or isinstance(e, str) for e in explanations):
        body["explanations"] = explanations
    if isinstance(raw.get("explanation"), str) and raw["explanation"].strip():
        body["explanation"] = raw["explanation"]
    if len(json.dumps(body, ensure_ascii=False).encode("utf-8")) > MAX_BODY_BYTES:
        raise ValueError(f"body must be smaller than {MAX_BODY_BYTES // 1024} KB.")
    return body


def ai_review_key(body: dict[str, Any]) -> str:
    """The content key of an AI-written question: ``ai-`` + the first 12 hex of
    sha1(question.strip() + "\\n" + "\\n".join(option.strip() for each option)), UTF-8.

    Same question + same options (same order) -> same key; any option change -> a new key. 15
    characters, so it passes review_key(). The SERVER computes it — a client-sent key is ignored
    whenever a body is sent.
    """
    text = body["question"].strip() + "\n" + "\n".join(str(o).strip() for o in body["options"])
    return "ai-" + hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def question_key_and_body(payload: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    """{body: {...}} -> (ai key, body); otherwise {question: "ch03-b05-q2"} -> (key, None)."""
    if payload.get("body") is not None:
        body = review_body(payload["body"])
        return ai_review_key(body), body
    return review_key(payload.get("question")), None


def study_day_start(now: datetime) -> datetime:
    """Midnight that began the learners' current day (STUDY_DAY_TZ), as an aware datetime."""
    local = now.astimezone(STUDY_DAY_TZ)
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


def new_cap_due(natural_due: datetime, new_today: int, cap: int, now: datetime) -> datetime:
    """When a NEW card first comes due, given the daily cap.

    ``new_today`` = cards this learner already created in this book today (before this one). Under
    the cap -> the card's own schedule. At or over it -> it waits in a queue: the cap-th..(2cap-1)-th
    overflow card is released at the start of tomorrow, the next cap the day after, and so on (cap 0
    -> tomorrow). Never earlier than its own schedule.
    """
    if new_today < cap:
        return natural_due
    days_out = 1 + ((new_today - cap) // cap if cap > 0 else 0)
    return max(natural_due, study_day_start(now) + timedelta(days=days_out))


def prefs_update(payload: dict[str, Any]) -> dict[str, int]:
    """{newPerDay?, sessionSize?} -> the validated fields that were sent (at least one)."""
    out: dict[str, int] = {}
    if payload.get("newPerDay") is not None:
        out["new_per_day"] = _plain_int(payload["newPerDay"], "newPerDay", 0, NEW_PER_DAY_MAX)
    if payload.get("sessionSize") is not None:
        size = _plain_int(payload["sessionSize"], "sessionSize", SESSION_SIZE_MIN, SESSION_SIZE_MAX)
        if size % SESSION_SIZE_STEP:
            raise ValueError(f"sessionSize must be a multiple of {SESSION_SIZE_STEP}.")
        out["session_size"] = size
    if not out:
        raise ValueError("send newPerDay and/or sessionSize.")
    return out


def answer_entry(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate ONE answered question for answer_log. The body of an AI question is used only to
    derive its key; the log never stores question text."""
    key, _ = question_key_and_body(payload)
    run_kind = payload.get("runKind")
    if run_kind not in RUN_KINDS:
        raise ValueError(f"runKind must be one of {', '.join(RUN_KINDS)}.")
    if not isinstance(payload.get("correct"), bool):
        raise ValueError("correct must be true or false.")
    confidence = payload.get("confidence")
    if confidence is not None and confidence not in CONFIDENCES:
        raise ValueError(f"confidence must be one of {', '.join(CONFIDENCES)}.")
    try:
        client_id = str(uuid.UUID(str(payload.get("clientId") or "")))
    except ValueError:
        raise ValueError("clientId must be a uuid.") from None
    chapter = payload.get("chapter")
    if chapter is None:
        found = CHAPTER_OF_KEY.match(key)
        chapter = int(found.group(1)) if found else None
    else:
        chapter = _plain_int(chapter, "chapter", 0, 999)
    domain = payload.get("domain")
    if domain is not None:
        if not isinstance(domain, str) or not 1 <= len(domain.strip()) <= 64:
            raise ValueError("domain must be 1-64 characters.")
        domain = domain.strip()
    run_id = payload.get("runId")
    if run_id is not None and (not isinstance(run_id, str) or not RUN_ID.match(run_id)):
        raise ValueError("runId must be 1-64 letters, digits, '.', '_' or '-'.")
    chosen = payload.get("chosen")
    chosen_json = None
    if chosen is not None:
        chosen_json = json.dumps(chosen, ensure_ascii=False)
        if len(chosen_json.encode("utf-8")) > MAX_CHOSEN_BYTES:
            raise ValueError(f"chosen must be smaller than {MAX_CHOSEN_BYTES // 1024} KB.")
    return {"question_key": key, "chapter": chapter, "domain": domain, "run_kind": run_kind, "run_id": run_id,
            "correct": payload["correct"], "confidence": confidence, "chosen": chosen_json, "client_id": client_id}


# --------------------------------------------------------------------------- P1 SQL: review cards
def review_enrol(account_id: int, module: str, key: str, correct: bool, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """review_seen plus P1: stores an AI question's body, and a NEW card obeys the daily cap
    (study_prefs.new_per_day, default 20) -> outcome "queued" with a later dueAt. An existing card
    still changes only on a wrong answer (a lapse); a missing body is filled in, never replaced."""
    import db

    now = datetime.now(timezone.utc)
    body_json = json.dumps(body, ensure_ascii=False) if body is not None else None
    with db.connect() as conn:
        row = conn.execute(
            "SELECT ease, interval_days, reps, lapses FROM review_cards"
            " WHERE account_id = %s AND module_id = %s AND question_key = %s FOR UPDATE",
            (account_id, module, key),
        ).fetchone()
        if row is None:
            s = review_first_seen(correct, now)
            pref = conn.execute(
                "SELECT new_per_day FROM study_prefs WHERE account_id = %s AND module_id = %s", (account_id, module),
            ).fetchone()
            cap = int(pref["new_per_day"]) if pref else NEW_PER_DAY_DEFAULT
            made = conn.execute(
                "SELECT count(*) AS n FROM review_cards WHERE account_id = %s AND module_id = %s AND created_at >= %s",
                (account_id, module, study_day_start(now)),
            ).fetchone()
            due = new_cap_due(s["due_at"], int(made["n"]), cap, now)
            conn.execute(
                "INSERT INTO review_cards (account_id, module_id, question_key, ease, interval_days, reps, lapses, due_at, body)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
                (account_id, module, key, s["ease"], s["interval_days"], s["reps"], s["lapses"], due, body_json),
            )
            return {"outcome": "created" if due == s["due_at"] else "queued", "question": key, "dueAt": _stamp(due)}
        if body_json is not None:
            conn.execute(
                "UPDATE review_cards SET body = %s::jsonb"
                " WHERE account_id = %s AND module_id = %s AND question_key = %s AND body IS NULL",
                (body_json, account_id, module, key),
            )
        if correct:
            return {"outcome": "unchanged", "question": key}
        s = srs_next(row, "again", now)
        conn.execute(
            "UPDATE review_cards SET ease = %s, interval_days = %s, reps = %s, lapses = %s, due_at = %s, last_reviewed_at = %s"
            " WHERE account_id = %s AND module_id = %s AND question_key = %s",
            (s["ease"], s["interval_days"], s["reps"], s["lapses"], s["due_at"], now, account_id, module, key),
        )
        return {"outcome": "lapsed", "question": key, "dueAt": _stamp(s["due_at"])}


def review_due_page(account_id: int, module: str, limit: int = SESSION_SIZE_DEFAULT) -> dict[str, Any]:
    """review_due plus P1: limit clamped to the run size 10-50, each card tagged `leech`, and an
    AI-written card carries its `body` (the only copy of the question)."""
    import db

    limit = max(SESSION_SIZE_MIN, min(int(limit), SESSION_SIZE_MAX))
    rows = db.fetch_all(
        "SELECT question_key, due_at, reps, lapses, body FROM review_cards"
        " WHERE account_id = %s AND module_id = %s AND due_at <= now() ORDER BY due_at LIMIT %s",
        (account_id, module, limit),
    )
    counts = db.fetch_one(
        "SELECT count(*) FILTER (WHERE due_at <= now()) AS due, count(*) AS total FROM review_cards"
        " WHERE account_id = %s AND module_id = %s",
        (account_id, module),
    ) or {"due": 0, "total": 0}
    due = []
    for r in rows:
        item: dict[str, Any] = {"question": r["question_key"], "dueAt": _stamp(r["due_at"]), "reps": r["reps"],
                                "lapses": r["lapses"], "leech": r["lapses"] >= LEECH_LAPSES}
        if r["body"] is not None:
            item["body"] = r["body"]
        due.append(item)
    return {"due": due, "dueCount": int(counts["due"]), "total": int(counts["total"])}


def read_prefs(account_id: int, module: str, conn: Any = None) -> dict[str, int]:
    """{newPerDay, sessionSize} for one account x book (defaults 20 / 20 when never saved)."""
    import db

    sql = "SELECT new_per_day, session_size FROM study_prefs WHERE account_id = %s AND module_id = %s"
    row = conn.execute(sql, (account_id, module)).fetchone() if conn is not None else db.fetch_one(sql, (account_id, module))
    return {"newPerDay": int(row["new_per_day"]) if row else NEW_PER_DAY_DEFAULT,
            "sessionSize": int(row["session_size"]) if row else SESSION_SIZE_DEFAULT}


def save_prefs(account_id: int, module: str, update: dict[str, int]) -> dict[str, int]:
    """Upsert only the fields sent (validated by prefs_update). A second identical call changes nothing."""
    import db

    nd, ss = update.get("new_per_day"), update.get("session_size")
    db.execute(
        "INSERT INTO study_prefs (account_id, module_id, new_per_day, session_size)"
        " VALUES (%s, %s, COALESCE(%s::int, %s), COALESCE(%s::int, %s))"
        " ON CONFLICT (account_id, module_id) DO UPDATE SET"
        " new_per_day = COALESCE(%s::int, study_prefs.new_per_day),"
        " session_size = COALESCE(%s::int, study_prefs.session_size), updated_at = now()",
        (account_id, module, nd, NEW_PER_DAY_DEFAULT, ss, SESSION_SIZE_DEFAULT, nd, ss),
    )
    return read_prefs(account_id, module)


def review_stats(account_id: int, module: str) -> dict[str, Any]:
    """The Practice dialog's Stats row for one account x book.

    dueNow · dueToday (due before the learners' midnight) · next7 = one count per day for the 7 days
    after today · total cards · leeches (lapses >= 6) + up to 50 leech keys · newToday + the cap ·
    retention = % of REVIEW answers right in the last 30 days (answer_log; null before any).
    """
    import db

    now = datetime.now(timezone.utc)
    day0 = study_day_start(now)
    edges = [day0 + timedelta(days=i) for i in range(1, 9)]     # end of today, end of day 1 .. end of day 7
    params: dict[str, Any] = {"a": account_id, "m": module, "end0": edges[0], "leech": LEECH_LAPSES, "day0": day0}
    windows = []
    for i in range(1, 8):
        params[f"lo{i}"], params[f"hi{i}"] = edges[i - 1], edges[i]
        windows.append(f"count(*) FILTER (WHERE due_at >= %(lo{i})s AND due_at < %(hi{i})s) AS d{i}")
    with db.connect() as conn:
        c = conn.execute(
            "SELECT count(*) AS total, count(*) FILTER (WHERE due_at <= now()) AS due_now,"
            " count(*) FILTER (WHERE due_at < %(end0)s) AS due_today,"
            " count(*) FILTER (WHERE lapses >= %(leech)s) AS leeches,"
            " count(*) FILTER (WHERE created_at >= %(day0)s) AS new_today, "
            + ", ".join(windows) +
            " FROM review_cards WHERE account_id = %(a)s AND module_id = %(m)s",
            params,
        ).fetchone()
        leech_keys = [r["question_key"] for r in conn.execute(
            "SELECT question_key FROM review_cards WHERE account_id = %s AND module_id = %s AND lapses >= %s"
            " ORDER BY lapses DESC, question_key LIMIT 50",
            (account_id, module, LEECH_LAPSES),
        ).fetchall()]
        ret = conn.execute(
            "SELECT count(*) AS n, count(*) FILTER (WHERE correct) AS ok FROM answer_log"
            " WHERE account_id = %s AND module_id = %s AND run_kind = 'review' AND answered_at >= %s",
            (account_id, module, now - timedelta(days=RETENTION_DAYS)),
        ).fetchone()
        prefs = read_prefs(account_id, module, conn)
    next7 = [{"day": edges[i - 1].date().isoformat(), "count": int(c[f"d{i}"])} for i in range(1, 8)]
    reviews = int(ret["n"])
    return {
        "module": module, "dueNow": int(c["due_now"]), "dueToday": int(c["due_today"]),
        "next7": next7, "next7Total": sum(d["count"] for d in next7), "total": int(c["total"]),
        "leeches": int(c["leeches"]), "leechKeys": leech_keys, "newToday": int(c["new_today"]),
        "newPerDay": prefs["newPerDay"], "sessionSize": prefs["sessionSize"],
        "retention": round(100 * int(ret["ok"]) / reviews) if reviews else None, "reviews30": reviews,
        "retentionDays": RETENTION_DAYS,
    }


# --------------------------------------------------------------------------- P1 SQL: flags + answer log
def set_flag(account_id: int, module: str, key: str, flagged: bool, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """flagged=true -> upsert (keeps the first flagged_at; fills a missing body); false -> delete.
    Idempotent both ways: a retried call leaves the same state."""
    import db

    if flagged:
        db.execute(
            "INSERT INTO question_flags (account_id, module_id, question_key, body) VALUES (%s, %s, %s, %s::jsonb)"
            " ON CONFLICT (account_id, module_id, question_key) DO UPDATE SET"
            " body = COALESCE(question_flags.body, EXCLUDED.body)",
            (account_id, module, key, json.dumps(body, ensure_ascii=False) if body is not None else None),
        )
    else:
        db.execute(
            "DELETE FROM question_flags WHERE account_id = %s AND module_id = %s AND question_key = %s",
            (account_id, module, key),
        )
    return {"question": key, "flagged": flagged}


def list_flags(account_id: int, module: str, limit: int = 500) -> dict[str, Any]:
    """Flagged questions in one book, newest first (AI ones carry their body)."""
    import db

    rows = db.fetch_all(
        "SELECT question_key, flagged_at, body FROM question_flags WHERE account_id = %s AND module_id = %s"
        " ORDER BY flagged_at DESC, question_key LIMIT %s",
        (account_id, module, max(1, min(int(limit), 500))),
    )
    flags = []
    for r in rows:
        item: dict[str, Any] = {"question": r["question_key"], "flaggedAt": _stamp(r["flagged_at"])}
        if r["body"] is not None:
            item["body"] = r["body"]
        flags.append(item)
    return {"module": module, "flags": flags, "count": len(flags)}


def log_answer(account_id: int, module: str, entry: dict[str, Any]) -> str:
    """Append one answer (validated by answer_entry). "logged", or "duplicate" when this account
    already logged that clientId (a retried POST)."""
    import db

    added = db.execute(
        "INSERT INTO answer_log (account_id, module_id, question_key, chapter, domain, run_kind, run_id, correct,"
        " confidence, chosen, client_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::uuid)"
        " ON CONFLICT (account_id, client_id) DO NOTHING",
        (account_id, module, entry["question_key"], entry["chapter"], entry["domain"], entry["run_kind"], entry["run_id"],
         entry["correct"], entry["confidence"], entry["chosen"], entry["client_id"]),
    )
    return "logged" if added else "duplicate"
# =========================================================================== /exam-recall-suite P1


# =========================================================================== exam-recall-suite P2 (22-10-26)
# ⚑ APPEND-ONLY BLOCK (plan exam-recall-suite_22-10-26 §7 P2a, instruction E1). Nothing above was edited.
#   History (GET /api/history) and mastery (GET /api/mastery), router addons/history.py. No migration:
#   reads answer_log + question_flags (v5), review_cards.body (AI questions) and the pre-v5 wrong_answers.
# Pure helpers first (a gate can test them without a database), then the SQL readers.
import logging  # noqa: E402

_P2_LOG = logging.getLogger("edu.history")

HISTORY_FILTERS = ("all", "wrong", "flagged")
HISTORY_PAGE_DEFAULT, HISTORY_PAGE_MAX = 50, 100
HISTORY_CURSOR = re.compile(r"^([aw]):(\d{1,18})$")      # a:<answer_log.id> | w:<wrong_answers.id>
BLOCK_OF_CHAPTER = re.compile(r"^ch(\d{1,3})-")          # wrong_answers.block_id "ch07-b03" -> 7
MASTERY_WINDOW = 200            # the last N answers per area count
MASTERY_MIN_ANSWERS = 5         # fewer answers in an area -> "not enough yet", never ranked weakest
MASTERY_TARGET = 80             # % shown as the target next to each bar
# Retry runs re-ask what was JUST shown wrong (the right answer is still fresh) -> left out of mastery.
MASTERY_RUN_KINDS = ("quiz", "practice", "review", "exam")
EXAM_WEIGHT_TOLERANCE = 1.0     # domain weights must sum to 100 +/- 1


def chapter_area_id(chapter: int) -> str:
    return f"ch{chapter:02d}"


def exam_domains(data: dict[str, Any], chapter_count: int) -> list[dict[str, Any]] | None:
    """The OPTIONAL module.json `exam.domains`, validated -> [{id, name, weight, chapters}] or None.

    Absent -> None (silent). Present but invalid -> None plus ONE warning in the service log (plan §4):
    domains must be a non-empty list; each has a unique id (1-64 chars), a name, a weight > 0 and
    chapterIds = chapters of this book (1..chapter_count), no chapter in two domains; the weights sum
    to 100 +/- 1. Never raises — a bad block must not break the page.
    """
    exam = data.get("exam")
    if exam is None:
        return None

    def bad(reason: str) -> None:
        _P2_LOG.warning("module %s: exam block ignored (%s)", data.get("moduleId", "?"), reason)

    domains = exam.get("domains") if isinstance(exam, dict) else None
    if not isinstance(domains, list) or not domains:
        return bad("exam.domains must be a non-empty list")
    out, seen_ids, seen_chapters, total = [], set(), set(), 0.0
    for d in domains:
        if not isinstance(d, dict):
            return bad("a domain is not an object")
        did, name, weight, chapters = d.get("id"), d.get("name"), d.get("weight"), d.get("chapterIds")
        if not isinstance(did, str) or not 1 <= len(did.strip()) <= 64 or did.strip() in seen_ids:
            return bad("domain id missing, too long or repeated")
        if not isinstance(name, str) or not name.strip():
            return bad(f"domain {did}: name missing")
        if isinstance(weight, bool) or not isinstance(weight, (int, float)) or weight <= 0:
            return bad(f"domain {did}: weight must be a number > 0")
        if not isinstance(chapters, list) or not chapters:
            return bad(f"domain {did}: chapterIds must be a non-empty list")
        for c in chapters:
            if isinstance(c, bool) or not isinstance(c, int) or not 1 <= c <= chapter_count:
                return bad(f"domain {did}: unknown chapter {c!r}")
            if c in seen_chapters:
                return bad(f"chapter {c} is in two domains")
            seen_chapters.add(c)
        seen_ids.add(did.strip())
        total += float(weight)
        out.append({"id": did.strip(), "name": name.strip(), "weight": weight, "chapters": sorted(set(chapters))})
    if abs(total - 100.0) > EXAM_WEIGHT_TOLERANCE:
        return bad(f"weights sum to {total:g}, not 100")
    return out


def area_spec(data: dict[str, Any]) -> dict[str, Any]:
    """What an "area" is for one book: the exam domains when the book has a VALID `exam` block, else
    its chapters. -> {kind: "domain"|"chapter", exam: {name}|None, areas: [{id, name, chapters[, weight]}]}.
    Chapter n = tutorialData.sections[n-1] (the app's own numbering), area id "ch07"."""
    tutorial = data.get("tutorialData") if isinstance(data.get("tutorialData"), dict) else {}
    sections = tutorial.get("sections") if isinstance(tutorial.get("sections"), list) else []
    domains = exam_domains(data, len(sections))
    if domains:
        exam = data["exam"]
        name = exam.get("name") if isinstance(exam.get("name"), str) and exam.get("name").strip() else None
        return {"kind": "domain", "exam": {"name": name}, "areas": domains}
    areas = []
    for i, section in enumerate(sections, start=1):
        title = section.get("title") if isinstance(section, dict) else None
        areas.append({"id": chapter_area_id(i), "name": title.strip() if isinstance(title, str) and title.strip()
                      else f"Chapter {i}", "chapters": [i]})
    return {"kind": "chapter", "exam": None, "areas": areas}


def area_of(chapter: int | None, domain: str | None, spec: dict[str, Any]) -> str | None:
    """The area id one answer counts under, or None (unassigned: e.g. an AI question with no chapter).
    Domain books: an answer's own `domain` wins when it names a domain of the block; else its chapter
    is mapped through chapterIds. Chapter books: the chapter."""
    if spec["kind"] == "domain":
        if domain and any(a["id"] == domain for a in spec["areas"]):
            return domain
        for a in spec["areas"]:
            if chapter is not None and chapter in a["chapters"]:
                return a["id"]
        return None
    if chapter is None:
        return None
    wanted = chapter_area_id(chapter)
    return wanted if any(a["id"] == wanted for a in spec["areas"]) else None


def pick_next_up(areas: list[dict[str, Any]], min_answers: int = MASTERY_MIN_ANSWERS) -> dict[str, Any] | None:
    """"Next up". Among areas with >= min_answers answers: the lowest right/answered ("weakest"); a tie
    goes to the area practised longest ago, then to book order. If NO area has enough answers: the
    least-practised area (fewest answers, then book order) — so 1 wrong answer never makes an area
    "weakest". None only for a book with no areas."""
    if not areas:
        return None
    ranked = [(i, a) for i, a in enumerate(areas) if a["answered"] >= min_answers]
    if ranked:
        i, best = min(ranked, key=lambda p: (p[1]["right"] / p[1]["answered"], p[1]["lastAt"] or "", p[0]))
        reason = "weakest"
    else:
        i, best = min(enumerate(areas), key=lambda p: (p[1]["answered"], p[0]))
        reason = "least-practised"
    return {"id": best["id"], "name": best["name"], "reason": reason, "answered": best["answered"],
            "right": best["right"], "pct": best["pct"]}


def mastery_from_rows(rows: list[dict[str, Any]], spec: dict[str, Any], window: int = MASTERY_WINDOW,
                      min_answers: int = MASTERY_MIN_ANSWERS) -> dict[str, Any]:
    """Mastery per area from answer rows ({chapter, domain, correct, at}) NEWEST FIRST.

    Per area: the newest `window` answers count; pct = round(100 x right / answered) (None at 0
    answers); enough = answered >= min_answers. `unassigned` = rows that fit no area.
    """
    stats = {a["id"]: {"answered": 0, "right": 0, "lastAt": None} for a in spec["areas"]}
    unassigned = 0
    for r in rows:
        aid = area_of(r.get("chapter"), r.get("domain"), spec)
        if aid is None:
            unassigned += 1
            continue
        s = stats[aid]
        if s["answered"] >= window:
            continue
        s["answered"] += 1
        s["right"] += 1 if r.get("correct") else 0
        if s["lastAt"] is None:
            s["lastAt"] = r.get("at")
    areas = []
    for a in spec["areas"]:
        s = stats[a["id"]]
        item = {"id": a["id"], "name": a["name"], "chapters": a["chapters"], "answered": s["answered"],
                "right": s["right"], "pct": round(100 * s["right"] / s["answered"]) if s["answered"] else None,
                "enough": s["answered"] >= min_answers, "lastAt": s["lastAt"]}
        if "weight" in a:
            item["weight"] = a["weight"]
        areas.append(item)
    return {"areas": areas, "nextUp": pick_next_up(areas, min_answers), "unassigned": unassigned}


def history_params(filter_: Any, chapter: Any, domain: Any, cursor: Any, limit: Any) -> dict[str, Any]:
    """Validate the GET /api/history query (all strings from the URL; "" = not sent). ValueError -> 400.
    chapter and domain are exclusive."""
    f = str(filter_ or "all").strip().lower()
    if f not in HISTORY_FILTERS:
        raise ValueError(f"filter must be one of {', '.join(HISTORY_FILTERS)}.")
    ch = None
    if str(chapter or "").strip():
        text = str(chapter).strip()
        if not text.isdigit() or not 0 <= int(text) <= 999:
            raise ValueError("chapter must be a whole number 0-999.")
        ch = int(text)
    dom = str(domain or "").strip() or None
    if dom is not None and len(dom) > 64:
        raise ValueError("domain must be 1-64 characters.")
    if ch is not None and dom is not None:
        raise ValueError("send chapter or domain, not both.")
    cur = None
    if str(cursor or "").strip():
        found = HISTORY_CURSOR.match(str(cursor).strip())
        if not found or f == "flagged":
            raise ValueError("cursor is not one this server gave out.")
        cur = (found.group(1), int(found.group(2)))
    lim = HISTORY_PAGE_DEFAULT
    if str(limit or "").strip():
        text = str(limit).strip()
        if not text.isdigit() or not 1 <= int(text) <= HISTORY_PAGE_MAX:
            raise ValueError(f"limit must be 1-{HISTORY_PAGE_MAX}.")
        lim = int(text)
    return {"filter": f, "chapter": ch, "domain": dom, "cursor": cur, "limit": lim}


def legacy_wrong_item(r: dict[str, Any]) -> dict[str, Any]:
    """One pre-v5 wrong_answers row as a history item. It has no question key, so it carries the
    question itself as `body` ({question, options, correct}) — enough to ask it again."""
    found = BLOCK_OF_CHAPTER.match(r.get("block_id") or "")
    correct = r["correct_set"] if r.get("correct_set") is not None else r["correct"]
    chosen = r["chosen_set"] if r.get("chosen_set") is not None else r["chosen"]
    return {"id": f"w:{r['id']}", "source": "legacy", "question": None,
            "chapter": int(found.group(1)) if found else None, "domain": None, "runKind": None,
            "runId": r.get("attempt"), "correct": False, "confidence": None, "chosen": chosen,
            "at": _stamp(r["created_at"]), "block": r.get("block_id"), "quizKind": r.get("quiz_kind"),
            "body": {"question": r["question"], "options": r["options"], "correct": correct}}


# --------------------------------------------------------------------------- P2 SQL: history + mastery
def _area_filter(params: dict[str, Any], spec: dict[str, Any] | None) -> tuple[list[int] | None, str | None]:
    """chapter/domain query -> (chapters to match, domain id to match). ValueError on an unknown domain."""
    if params["chapter"] is not None:
        return [params["chapter"]], None
    if params["domain"] is not None:
        if not spec or spec["kind"] != "domain":
            raise ValueError("this book has no exam domains; filter by chapter.")
        for a in spec["areas"]:
            if a["id"] == params["domain"]:
                return a["chapters"], a["id"]
        raise ValueError("unknown domain for this book.")
    return None, None


def history_page(account_id: int, module: str, params: dict[str, Any], spec: dict[str, Any] | None = None) -> dict[str, Any]:
    """One page of the History list, newest first. `params` from history_params; `spec` (area_spec) is
    needed only for a domain filter.

    all     answer_log rows, then (older) pre-v5 wrong_answers rows
    wrong   the same, wrong only
    flagged question_flags (one row per flagged question, newest flag first, up to 500, no paging),
            each with its last logged answer
    Pre-v5 rows are shown only when older than this account's first answer_log row in this book, so an
    answer written to both tables after v5 is listed once. `nextCursor` is null on the last page.
    `runs` = {runId: {answered, right}} over every logged answer of the runs on this page.
    """
    import db

    chapters, domain_id = _area_filter(params, spec)
    where_log, args_log = ["l.account_id = %s", "l.module_id = %s"], [account_id, module]
    if chapters is not None and domain_id:
        # P2c fix (22-10-26, gate Z11): the SAME rule as area_of — an answer's own domain wins; only an
        # answer with no (known) domain is placed by its chapter. Before, an answer tagged D3 in a D1
        # chapter was listed under D1 while the D1 bar did not count it.
        all_ids = [a["id"] for a in spec["areas"]]
        where_log.append("(l.domain = %s OR ((l.domain IS NULL OR NOT l.domain = ANY(%s)) AND l.chapter = ANY(%s)))")
        args_log += [domain_id, all_ids, chapters]
    elif chapters is not None:
        where_log.append("l.chapter = ANY(%s)")
        args_log.append(chapters)
    legacy_chapter = "substring(w.block_id from '^ch([0-9]{1,3})-')::int"
    where_old = ["w.account_id = %s", "w.module_id = %s",
                 "w.created_at < COALESCE((SELECT min(answered_at) FROM answer_log"
                 " WHERE account_id = %s AND module_id = %s), 'infinity'::timestamptz)"]
    args_old: list[Any] = [account_id, module, account_id, module]
    if chapters is not None:
        where_old.append(f"{legacy_chapter} = ANY(%s)")
        args_old.append(chapters)

    with db.connect() as conn:
        counts = conn.execute(
            "SELECT count(*) AS n, count(*) FILTER (WHERE NOT l.correct) AS wrong FROM answer_log l WHERE "
            + " AND ".join(where_log), args_log).fetchone()
        old_n = conn.execute("SELECT count(*) AS n FROM wrong_answers w WHERE " + " AND ".join(where_old),
                             args_old).fetchone()["n"]
        flag_where, flag_args = ["f.account_id = %s", "f.module_id = %s"], [account_id, module]
        if chapters is not None:
            flag_where.append("substring(f.question_key from '^ch([0-9]{1,3})-')::int = ANY(%s)")
            flag_args.append(chapters)
        flag_n = conn.execute("SELECT count(*) AS n FROM question_flags f WHERE " + " AND ".join(flag_where),
                              flag_args).fetchone()["n"]
        count_block = {"all": int(counts["n"]) + int(old_n), "wrong": int(counts["wrong"]) + int(old_n),
                       "flagged": int(flag_n)}

        if params["filter"] == "flagged":
            rows = conn.execute(
                "SELECT f.question_key, f.flagged_at, f.body, last.correct AS last_correct, last.answered_at AS last_at"
                " FROM question_flags f LEFT JOIN LATERAL (SELECT correct, answered_at FROM answer_log l"
                "  WHERE l.account_id = f.account_id AND l.module_id = f.module_id AND l.question_key = f.question_key"
                "  ORDER BY l.id DESC LIMIT 1) last ON true WHERE " + " AND ".join(flag_where)
                + " ORDER BY f.flagged_at DESC, f.question_key LIMIT 500", flag_args).fetchall()
            items = []
            for r in rows:
                found = CHAPTER_OF_KEY.match(r["question_key"])
                item: dict[str, Any] = {"id": f"f:{r['question_key']}", "source": "flag", "question": r["question_key"],
                                        "chapter": int(found.group(1)) if found else None,
                                        "flaggedAt": _stamp(r["flagged_at"]), "lastCorrect": r["last_correct"],
                                        "lastAt": _stamp(r["last_at"]) if r["last_at"] else None}
                if r["body"] is not None:
                    item["body"] = r["body"]
                items.append(item)
            return {"module": module, "filter": "flagged", "items": items, "nextCursor": None, "counts": count_block,
                    "runs": {}}

        wrong_only = params["filter"] == "wrong"
        limit, cursor = params["limit"], params["cursor"]
        items, next_cursor = [], None
        if cursor is None or cursor[0] == "a":
            where = list(where_log) + (["NOT l.correct"] if wrong_only else [])
            args = list(args_log)
            if cursor is not None:
                where.append("l.id < %s")
                args.append(cursor[1])
            rows = conn.execute(
                "SELECT l.id, l.question_key, l.chapter, l.domain, l.run_kind, l.run_id, l.correct, l.confidence,"
                " l.chosen, l.answered_at, rc.body FROM answer_log l LEFT JOIN review_cards rc"
                " ON rc.account_id = l.account_id AND rc.module_id = l.module_id AND rc.question_key = l.question_key"
                " WHERE " + " AND ".join(where) + " ORDER BY l.id DESC LIMIT %s", args + [limit + 1]).fetchall()
            for r in rows[:limit]:
                item = {"id": f"a:{r['id']}", "source": "log", "question": r["question_key"], "chapter": r["chapter"],
                        "domain": r["domain"], "runKind": r["run_kind"], "runId": r["run_id"], "correct": r["correct"],
                        "confidence": r["confidence"], "chosen": r["chosen"], "at": _stamp(r["answered_at"])}
                if r["body"] is not None:
                    item["body"] = r["body"]
                items.append(item)
            if len(rows) > limit:
                next_cursor = f"a:{rows[limit - 1]['id']}"
        room = limit - len(items)
        if next_cursor is None:     # log exhausted -> older rows; room 0 = only "is there more?" (LIMIT 1)
            where, args = list(where_old), list(args_old)
            if cursor is not None and cursor[0] == "w":
                where.append("w.id < %s")
                args.append(cursor[1])
            rows = conn.execute(
                "SELECT w.id, w.block_id, w.quiz_kind, w.question, w.options, w.chosen, w.correct, w.chosen_set,"
                " w.correct_set, w.attempt, w.created_at FROM wrong_answers w WHERE " + " AND ".join(where)
                + " ORDER BY w.id DESC LIMIT %s", args + [room + 1]).fetchall()
            items += [legacy_wrong_item(r) for r in rows[:room]]
            if len(rows) > room:    # cursor = "older than this id"; with room 0, one above the newest
                next_cursor = f"w:{rows[room - 1]['id']}" if room else f"w:{rows[0]['id'] + 1}"

        run_ids = sorted({i["runId"] for i in items if i["source"] == "log" and i["runId"]})
        runs = {}
        if run_ids:
            for r in conn.execute(
                    "SELECT run_id, count(*) AS answered, count(*) FILTER (WHERE correct) AS right_n FROM answer_log"
                    " WHERE account_id = %s AND module_id = %s AND run_id = ANY(%s) GROUP BY run_id",
                    (account_id, module, run_ids)).fetchall():
                runs[r["run_id"]] = {"answered": int(r["answered"]), "right": int(r["right_n"])}
    return {"module": module, "filter": params["filter"], "items": items, "nextCursor": next_cursor,
            "counts": count_block, "runs": runs}


def mastery(account_id: int, module: str, spec: dict[str, Any]) -> dict[str, Any]:
    """Mastery per area for one account x book (see mastery_from_rows / pick_next_up). Reads at most
    MASTERY_WINDOW answers per (chapter, domain) pair — a superset of the newest MASTERY_WINDOW per
    area — of the run kinds in MASTERY_RUN_KINDS. Pre-v5 wrong_answers are NOT counted (wrongs only,
    no rights: they would drag every area down)."""
    import db

    rows = db.fetch_all(
        "SELECT chapter, domain, correct, answered_at FROM (SELECT id, chapter, domain, correct, answered_at,"
        " row_number() OVER (PARTITION BY chapter, domain ORDER BY id DESC) AS rn FROM answer_log"
        " WHERE account_id = %s AND module_id = %s AND run_kind = ANY(%s)) t WHERE rn <= %s ORDER BY id DESC",
        (account_id, module, list(MASTERY_RUN_KINDS), MASTERY_WINDOW),
    )
    shaped = [{"chapter": r["chapter"], "domain": r["domain"], "correct": r["correct"], "at": _stamp(r["answered_at"])}
              for r in rows]
    result = mastery_from_rows(shaped, spec)
    return {"module": module, "areaKind": spec["kind"], "exam": spec["exam"], "window": MASTERY_WINDOW,
            "minAnswers": MASTERY_MIN_ANSWERS, "target": MASTERY_TARGET, **result}
# =========================================================================== /exam-recall-suite P2


# =========================================================================== exam-recall-suite P3 (22-10-26)
# ⚑ APPEND-ONLY BLOCK (plan exam-recall-suite_22-10-26 §7 P3a, instruction E1). Nothing above was edited.
#   Timed mock exam: the SQL of exam_runs (migration 007_exam_runs.sql), router addons/exam.py. The RULES
#   (pick, clock, grading, scaled estimate) live in addons/exam_blueprint.py and are passed in as `rules`
#   (store must not import the addons package: it imports main). `now` is always passed in -> one clock,
#   the server's, and a test can pin it.
# ⛔ Every statement is scoped by account_id (from the session, never the body): another account's run id
#   is "not found", exactly like a run that does not exist.
EXAM_COLS = ("id, account_id, module_id, started_at, deadline_at, question_keys, grading, answers, flags, blueprint,"
             " finished_at, finished_by, raw_right, total, scaled_estimate, result")


class ExamNotFound(LookupError):
    """No run with that id for this account (-> 404)."""


def _exam_finish_locked(conn: Any, row: dict[str, Any], now: datetime, reason: str, rules: Any) -> dict[str, Any]:
    """Grade an OPEN run (row already locked FOR UPDATE), close it, and append its answers to answer_log
    (run_kind 'exam'; client_id = uuid5(run, key) -> a second finish logs nothing twice). -> the closed row."""
    graded = rules.grade_run(row)
    for entry in graded["log"]:
        conn.execute(
            "INSERT INTO answer_log (account_id, module_id, question_key, chapter, domain, run_kind, run_id, correct,"
            " confidence, chosen, client_id) VALUES (%s, %s, %s, %s, %s, 'exam', %s, %s, NULL, %s::jsonb, %s::uuid)"
            " ON CONFLICT (account_id, client_id) DO NOTHING",
            (row["account_id"], row["module_id"], entry["question_key"], entry["chapter"], entry["domain"], row["id"],
             entry["correct"], json.dumps(entry["chosen"]), entry["client_id"]),
        )
    result = {k: graded[k] for k in ("right", "total", "scaled", "areas", "questions")}
    scaled = graded["scaled"]["estimate"] if graded["scaled"] else None
    return conn.execute(
        "UPDATE exam_runs SET finished_at = %s, finished_by = %s, raw_right = %s, total = %s, scaled_estimate = %s,"
        " result = %s::jsonb WHERE id = %s AND finished_at IS NULL RETURNING " + EXAM_COLS,
        (now, reason, graded["right"], graded["total"], scaled, json.dumps(result, ensure_ascii=False), row["id"]),
    ).fetchone()


def _exam_open_locked(conn: Any, account_id: int, module: str) -> dict[str, Any] | None:
    return conn.execute(
        "SELECT " + EXAM_COLS + " FROM exam_runs WHERE account_id = %s AND module_id = %s AND finished_at IS NULL"
        " FOR UPDATE", (account_id, module)).fetchone()


def _exam_run_locked(conn: Any, account_id: int, run_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT " + EXAM_COLS + " FROM exam_runs WHERE id = %s AND account_id = %s FOR UPDATE",
                       (run_id, account_id)).fetchone()
    if row is None:
        raise ExamNotFound("No such exam run.")
    return row


def exam_open(account_id: int, module: str, now: datetime, rules: Any) -> dict[str, Any]:
    """The open run of one account x book, or None. A run found PAST its deadline is finished here
    (finished_by 'deadline') — the first read after the deadline closes it. `last` = the newest finished
    run (so a reload after the deadline can show the result). -> {run, last, expiredNow}."""
    import db

    expired_now = False
    with db.connect() as conn:
        row = _exam_open_locked(conn, account_id, module)
        if row is not None and rules.is_expired(row["deadline_at"], now):
            _exam_finish_locked(conn, row, now, "deadline", rules)
            row, expired_now = None, True
        last = conn.execute(
            "SELECT " + EXAM_COLS + " FROM exam_runs WHERE account_id = %s AND module_id = %s AND finished_at IS NOT NULL"
            " ORDER BY finished_at DESC, id LIMIT 1", (account_id, module)).fetchone()
    return {"run": row, "last": last, "expiredNow": expired_now}


def exam_start(account_id: int, module: str, now: datetime, restart: bool, make: Any, rules: Any) -> tuple[str, dict[str, Any], dict[str, Any] | None]:
    """Start (or resume) this account's run in one book. -> (outcome, run row, previous finished row|None).

    outcome "resumed": an open run in time and no restart -> it comes back unchanged (reload / second Start).
    outcome "created": a new run from make() -> {question_keys, grading, blueprint}; an open run that was
    past its deadline (finished_by 'deadline') or replaced by restart=true (finished_by 'restart') is
    graded and closed FIRST, in the same transaction, and returned as `previous`.
    Two concurrent Starts: the partial unique index lets one INSERT win; the other resumes it."""
    import db

    with db.connect() as conn:
        row = _exam_open_locked(conn, account_id, module)
        decision = rules.start_decision(row, now, restart)
        if decision == "resume":
            return "resumed", row, None
        previous = None
        if row is not None:
            reason = "deadline" if rules.is_expired(row["deadline_at"], now) else "restart"
            previous = _exam_finish_locked(conn, row, now, reason, rules)
        built = make()
        created = conn.execute(
            "INSERT INTO exam_runs (id, account_id, module_id, started_at, deadline_at, question_keys, grading, blueprint)"
            " VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)"
            " ON CONFLICT (account_id, module_id) WHERE finished_at IS NULL DO NOTHING RETURNING " + EXAM_COLS,
            (str(uuid.uuid4()), account_id, module, now, rules.deadline_for(now, built["blueprint"]["minutes"]),
             json.dumps(built["question_keys"]), json.dumps(built["grading"]),
             json.dumps(built["blueprint"], ensure_ascii=False)),
        ).fetchone()
        if created is not None:
            return "created", created, previous
    with db.connect() as conn:          # lost the race: the other Start's run is the open one
        row = conn.execute("SELECT " + EXAM_COLS + " FROM exam_runs WHERE account_id = %s AND module_id = %s"
                           " AND finished_at IS NULL", (account_id, module)).fetchone()
    if row is None:
        raise db.StoreUnavailable("the exam could not be started; try again")
    return "resumed", row, previous


def exam_answer(account_id: int, run_id: str, key: str, raw_chosen: Any, now: datetime, rules: Any) -> tuple[str, dict[str, Any]]:
    """Save (or clear, chosen=null) one answer of an OPEN run. -> ("ok", row) · ("closed", finished row)
    when the run was already finished · ("late", row) when it is past the deadline — then the run is
    finished here (finished_by 'deadline') and the answer is NOT saved. ValueError: a key not in the run,
    or a chosen shape that does not fit the question. ExamNotFound: not this account's run."""
    import db

    with db.connect() as conn:
        row = _exam_run_locked(conn, account_id, run_id)
        if row["finished_at"] is not None:
            return "closed", row
        if rules.is_expired(row["deadline_at"], now):
            return "late", _exam_finish_locked(conn, row, now, "deadline", rules)
        if key not in row["grading"]:
            raise ValueError("question is not part of this exam run.")
        chosen = rules.validate_chosen(raw_chosen, row["grading"][key])
        answers = dict(row["answers"] or {})
        if chosen is None:
            answers.pop(key, None)
        else:
            answers[key] = chosen
        updated = conn.execute("UPDATE exam_runs SET answers = %s::jsonb WHERE id = %s RETURNING " + EXAM_COLS,
                               (json.dumps(answers), run_id)).fetchone()
    return "ok", updated


def exam_flag(account_id: int, run_id: str, key: str, flagged: bool, now: datetime, rules: Any) -> tuple[str, dict[str, Any]]:
    """Flag / unflag one question of an OPEN run: the run's own `flags` (the navigator) AND the learner's
    question_flags (the P1 "Flagged (N)" list, same upsert/delete as POST /api/flags). Same outcomes as
    exam_answer ("ok" | "closed" | "late")."""
    import db

    with db.connect() as conn:
        row = _exam_run_locked(conn, account_id, run_id)
        if row["finished_at"] is not None:
            return "closed", row
        if rules.is_expired(row["deadline_at"], now):
            return "late", _exam_finish_locked(conn, row, now, "deadline", rules)
        if key not in row["grading"]:
            raise ValueError("question is not part of this exam run.")
        flags = [f for f in (row["flags"] or []) if f != key] + ([key] if flagged else [])
        if flagged:
            conn.execute(
                "INSERT INTO question_flags (account_id, module_id, question_key) VALUES (%s, %s, %s)"
                " ON CONFLICT (account_id, module_id, question_key) DO NOTHING",
                (account_id, row["module_id"], key))
        else:
            conn.execute("DELETE FROM question_flags WHERE account_id = %s AND module_id = %s AND question_key = %s",
                         (account_id, row["module_id"], key))
        updated = conn.execute("UPDATE exam_runs SET flags = %s::jsonb WHERE id = %s RETURNING " + EXAM_COLS,
                               (json.dumps(flags), run_id)).fetchone()
    return "ok", updated


def exam_finish(account_id: int, run_id: str, now: datetime, rules: Any) -> tuple[str, dict[str, Any]]:
    """Submit. -> ("finished", row) (finished_by 'submit', or 'deadline' if it was already past it) ·
    ("already", row) when it was finished before — a retried Submit returns the same result."""
    import db

    with db.connect() as conn:
        row = _exam_run_locked(conn, account_id, run_id)
        if row["finished_at"] is not None:
            return "already", row
        reason = "deadline" if rules.is_expired(row["deadline_at"], now) else "submit"
        return "finished", _exam_finish_locked(conn, row, now, reason, rules)
# =========================================================================== /exam-recall-suite P3


# =========================================================================== review by chapter (01-11-26)
# The floating review reminder splits a large due pile by chapter (user: "the review would be very large,
# so divide per chapter"). The server knows question keys, not chapters: it groups by BLOCK — the key
# minus its "-qN" — and the client maps blocks to chapters with the book it already holds. A card whose
# key is not a book key ("ai-…") is in the block "other". Reads only; no schema change.
REVIEW_BOOK_KEY = r"^.+-b[0-9]+-q[0-9]+$"
REVIEW_BLOCK_SQL = f"CASE WHEN question_key ~ '{REVIEW_BOOK_KEY}' THEN regexp_replace(question_key, '-q[0-9]+$', '') ELSE 'other' END"
REVIEW_BLOCK = re.compile(r"^[A-Za-z0-9._-]{1,48}$")
REVIEW_BLOCKS_MAX = 200


def review_blocks(value: Any) -> list[str]:
    """`blocks` query value "ch05-b01,ch05-b02" -> a validated, de-duplicated list (1..200)."""
    blocks = list(dict.fromkeys(b.strip() for b in str(value or "").split(",") if b.strip()))
    if not blocks or len(blocks) > REVIEW_BLOCKS_MAX or not all(REVIEW_BLOCK.match(b) for b in blocks):
        raise ValueError("blocks must be 1-200 block ids such as ch05-b01, comma separated.")
    return blocks


def review_due_by_block(account_id: int, module: str) -> dict[str, Any]:
    """{blocks: [{block, due}] (due > 0 only), dueCount, total} — one row per block, so a chapter is
    counted once however many of its cards fell due, on whatever days."""
    import db

    rows = db.fetch_all(
        f"SELECT {REVIEW_BLOCK_SQL} AS block, count(*) AS due FROM review_cards"
        " WHERE account_id = %s AND module_id = %s AND due_at <= now() GROUP BY 1 ORDER BY 1",
        (account_id, module),
    )
    total = db.fetch_one("SELECT count(*) AS total FROM review_cards WHERE account_id = %s AND module_id = %s",
                         (account_id, module)) or {"total": 0}
    blocks = [{"block": r["block"], "due": int(r["due"])} for r in rows]
    return {"blocks": blocks, "dueCount": sum(b["due"] for b in blocks), "total": int(total["total"])}


REVIEW_PICK_MAX = 500   # the reminder lets him type how many to review; a chapter never holds this many


def review_due_in_blocks(account_id: int, module: str, blocks: list[str], limit: int = SESSION_SIZE_DEFAULT) -> dict[str, Any]:
    """review_due_page limited to the cards of `blocks` (oldest due first). dueCount is for those blocks.
    `limit` is his own number (1..500), not the 10-50 run size: "a chapter has 35, I write 99 -> 35"."""
    import db

    limit = max(1, min(int(limit), REVIEW_PICK_MAX))
    rows = db.fetch_all(
        "SELECT question_key, due_at, reps, lapses, body FROM review_cards"
        f" WHERE account_id = %s AND module_id = %s AND due_at <= now() AND {REVIEW_BLOCK_SQL} = ANY(%s)"
        " ORDER BY due_at LIMIT %s",
        (account_id, module, blocks, limit),
    )
    count = db.fetch_one(
        "SELECT count(*) AS due FROM review_cards"
        f" WHERE account_id = %s AND module_id = %s AND due_at <= now() AND {REVIEW_BLOCK_SQL} = ANY(%s)",
        (account_id, module, blocks),
    ) or {"due": 0}
    due = []
    for r in rows:
        item: dict[str, Any] = {"question": r["question_key"], "dueAt": _stamp(r["due_at"]), "reps": r["reps"],
                                "lapses": r["lapses"], "leech": r["lapses"] >= LEECH_LAPSES}
        if r["body"] is not None:
            item["body"] = r["body"]
        due.append(item)
    return {"due": due, "dueCount": int(count["due"])}
# =========================================================================== /review by chapter
