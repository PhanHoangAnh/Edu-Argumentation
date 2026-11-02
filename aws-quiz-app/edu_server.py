"""Serve Edu-Argumentation and generate quizzes without exposing provider keys."""

from __future__ import annotations

import argparse
import base64
import dataclasses
import json
import math
import os
import re
import secrets
import time
import unicodedata
from collections import defaultdict, deque
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs
from urllib.request import Request, urlopen

MAX_REQUEST_BYTES = 8_192
MAX_QUESTIONS = 10
# A fresh quiz is written by the model from several random book sections, a few
# questions per section, with the sections requested in parallel. Free models on
# a router with fallback take 15-40 s per call, so the size is capped.
MIN_FRESH_QUESTIONS = 5
MAX_FRESH_QUESTIONS = 30
QUESTIONS_PER_SECTION = 5
FRESH_PARALLEL_CALLS = 4
SPARE_SECTIONS = 2
PROVIDER_TIMEOUT_SECONDS = 120
RATE_LIMIT_REQUESTS = 20
RATE_LIMIT_SECONDS = 3_600
REQUEST_HISTORY: dict[str, deque[float]] = defaultdict(deque)

# --- Ask the book: a tutor grounded in the lesson, then the book -------------
# The learner reads here instead of beside the paper book, so "I don't get this"
# has to be answerable in place. Sources are ranked lesson -> book -> the model's
# own knowledge, and the answer says which one it used so the reader can tell a
# quoted fact from a recalled one.
BOOK_ROOT = Path(os.getenv("EDU_BOOK_ROOT", "/home/ubuntu/foxai-data/edu-argumentation/books"))
BOOK_FILES = {"geron-homl3": "homl3.pages.json"}
ASK_MAX_QUESTION = 600
ASK_HISTORY_TURNS = 6
ASK_BOOK_PAGES = 3
ASK_EXCERPT_CHARS = 1_100
ASK_RATE_LIMIT_REQUESTS = 60
ASK_RATE_LIMIT_SECONDS = 600
ASK_HISTORY: dict[str, deque] = defaultdict(deque)
_BOOK_CACHE: dict[str, tuple[float, list[str]]] = {}
_BOOK_DF: dict[str, tuple[int, dict[str, int]]] = {}
_BOOK_CHAPTERS: dict[str, list[tuple[int, int, int]]] = {}
ASK_SAME_CHAPTER_BOOST = 2.5
ASK_NEAR_CHAPTER_BOOST = 1.4
ASK_COMMON_TERM_SHARE = 0.12

# --- The tutor can SEE the page's visuals (22-09-26) -------------------------
# Until today the tutor was blind to every figure and equation in the lesson it
# was tutoring. source_for_block() builds the lesson text from `content`, callout
# `items` and code `cells` ONLY, so a `figure` or `equation` block was dropped
# whole -- the model never even saw the caption. Asked "what does Figure 2-9
# show?" it had nothing at all and answered from general knowledge.
#
# Two layers, cheapest first:
#
# 1. ALWAYS -- put what the package already knows into the context: each visual's
#    title, caption, alt, `description` (written by the 22-09-26 backfill; still
#    absent from every figure on the box at the time of writing and handled as
#    absent), and for an equation its LaTeX. 88 of the 90 equations carry
#    `latex`, which the model reads natively, so MATH IS LARGELY SOLVED WITHOUT
#    VISION and costs a few hundred characters.
# 2. ONLY when the question is about a picture that LAYER 1 CANNOT ANSWER --
#    attach the actual PNG. See ask_wants_image() for the trigger and why it
#    cannot fire on an ordinary text question.
#
# A STORED DESCRIPTION BEATS A FRESH READING (user ruling, 22-09-26). A
# description is written once, checked, and identical on every ask; a vision
# reply is a reading, and two readings of one crop disagree -- measured on
# fig-2-10, where one run got the ordering exactly right and another called two
# bars "roughly symmetrical" when the ground truth is 6,570 against 3,620. So
# once a figure carries a usable description the picture is NOT sent, whatever
# the question. That branch shipped on 22-09-26 and could not fire until the
# backfill landed; see ask_wants_image() condition 3.
#
# Scope is the CURRENT BLOCK, never the chapter: this tutor's value is being
# cheap enough to use constantly, and a whole chapter's visual metadata on every
# ask would be several KB of prompt the reader did not ask for.
ASK_VISUAL_CHARS = 2_200          # hard cap on the whole "VISUALS ON THIS PAGE" section
ASK_VISUAL_EXPLAIN_CHARS = 400    # per-equation slice of the book's own written explanation
ASK_VISION_MAX_IMAGES = 2
ASK_VISION_MAX_BYTES = 1_200_000  # a crop this big is a page scan, not a figure; skip it
# A vision ask is a much bigger call than a text ask, so it is NOT free against
# the ask budget -- it costs this many slots out of ASK_RATE_LIMIT_REQUESTS. If
# the bucket lacks that much headroom the ask still answers, from text only:
# degrading the answer beats a 429 mid-lesson, and it can never drain the budget
# silently because the reply and the ask log both carry vision=true/false.
ASK_VISION_COST = 3

# The trigger, in two halves that must BOTH match.
# a) an explicit book reference -- "Figure 2-9", "fig. 2.9"
ASK_FIGURE_REF = re.compile(r"\b(?:figure|fig\.?)\s*(\d{1,3})[-.](\d{1,3})\b", re.I)
# b) a DEICTIC reference -- "the figure", "this chart", "that histogram". The
#    determiner is required and it is what makes the trigger tight: "how do I
#    plot a histogram in pandas?" is a code question and does NOT match, while
#    "what does the histogram show?" does. A bare visual noun never fires.
ASK_VISUAL_DEICTIC = re.compile(
    r"\b(?:the|this|that|these|those|its|it's)\s+(?:"
    r"figure|chart|graph|diagram|plot|histogram|image|picture|screenshot|"
    r"axis|axes|legend|curve|scatter\s?plot|bar\s?chart|y-axis|x-axis)\b", re.I)
# c) the "layer 1 cannot answer this" half is NO LONGER A VERB TEST. It used to
#    be a "show/see/read/where" regex, which meant a figure WITH a description
#    still escalated for "what does the y-axis read?". Retired 22-09-26 by user
#    ruling (above): the question no longer decides, the presence of a usable
#    stored description does. Conditions (a) and (b) are untouched.
# A description shorter than this is a stub ("Figure", "A chart") and is not
# allowed to suppress the picture.
ASK_DESCRIPTION_MIN_CHARS = 40

# --- End-of-chapter exercises (19-09-26) -------------------------------------
# Every chapter ends with the book's own exercises. Until now the reader could
# see them and nothing else: no input, no answer, no way to finish the block --
# and the block still demanded five multiple-choice questions that repeat five of
# the exercises already on the page.
#
# They are graded on MEANING, by the model, never by string comparison. User,
# 19-09-26: "I will answer what I'm understanding, not exact text-by-text." A
# keyword match would fail a correct answer for choosing different words, which
# is precisely the skill the exercise is testing.
#
# The page also offers a multiple-choice mode over the same exercises, whose
# options are written ONCE at import time and stored in the module. That mode
# costs no model call at all, so an exhausted free-tier quota can never lock a
# reader out of finishing a chapter (user, 19-09-26).
EXERCISE_MAX_REQUEST_BYTES = 96 * 1024   # 30 answers of ~1.5 KB plus the prompts
EXERCISE_MAX_ANSWER = 1_500
EXERCISE_MAX_ITEMS = 40
EXERCISE_BOOK_PAGES = 6
# One submit = one model call, whatever the exercise count, so this bucket is
# counted in submits rather than questions.
EXERCISE_RATE_LIMIT_REQUESTS = 30
EXERCISE_RATE_LIMIT_SECONDS = 600
EXERCISE_HISTORY: dict[str, deque] = defaultdict(deque)
ASK_STOPWORDS = frozenset("""a an the and or but if then than that this these those is are was were be been being
do does did of in on at to for from by with as it its he she they we you i what why how when which who whom can
could should would may might will just not no nor so such about into over under again further once here there all
any both each few more most other some only own same too very s t don now me my mine your yours
explain explains simply simple mean means meaning tell show shows understand difference between work works
working use used using need needs want get got make makes made thing things way ways lot really actually""".split())

# The provider env file and the general-settings file BOTH live outside
# /srv/foxai/edu-argumentation. That tree is deployed with `rsync --delete`, so
# anything stored inside it is destroyed on the next deploy and the service comes
# back up healthy and empty. Keep stores out of the deployed tree.
ENV_PATH = Path(os.getenv("EDU_ENV_PATH", "/home/ubuntu/foxai-data/edu-argumentation/provider.env"))
SETTINGS_PATH = Path(os.getenv("EDU_SETTINGS_PATH", "/home/ubuntu/foxai-data/edu-argumentation/settings.json"))
# Study progress lives out here for the same reason, plus one more: it is the
# only thing in this app the reader cannot recreate. A browser store would die
# with a cache clear and would not follow them to a phone.
PROGRESS_PATH = Path(os.getenv("EDU_PROGRESS_PATH", "/home/ubuntu/foxai-data/edu-argumentation/progress.json"))
# A book's own figures and equation pictures, written by the importer, one folder per
# module. Outside the deployed tree for the same reason as every store above, and
# never committed: they are the publisher's images.
ASSET_ROOT = Path(os.getenv("EDU_ASSET_ROOT", "/home/ubuntu/foxai-data/edu-argumentation/assets"))
# A PACKAGED book: one folder holding module.json AND its own assets/, written
# once by the importer and read as a unit. Replaces the old split where the
# JSON lived in data/ (inside the deploy tree), the crops in assets/<id>/, and
# a human copied between them. Zip one of these folders and it ships.
LIBRARY_ROOT = Path(os.getenv("EDU_LIBRARY_ROOT", "/home/ubuntu/foxai-data/edu-argumentation/library"))
# Every question the reader asks the tutor, one JSON line each. His questions are the
# best signal of WHICH LESSON FAILED -- asked in the moment, at the exact block that
# broke down -- and until 22-09-26 they were not recorded anywhere, so "which lessons
# are bad" was an audit guess instead of a ranked list written by real use.
# Beside the importer's own job logs. LOCAL ONLY, never committed: it is his study data.
ASK_LOG_PATH = Path(os.getenv("EDU_ASK_LOG_PATH", "/home/ubuntu/foxai-data/edu-argumentation/logs/ask.jsonl"))
# The asset id as module.json stores it, with no extension -- figure_bytes()
# builds BOTH crop file names from it (see there). Kept separate from
# ASSET_FILE, which guards what the BROWSER may fetch: the model crop is for the
# provider, not a route the page can ask for.
ASSET_ID = re.compile(r"^(fig|eq)-\d{1,3}[-.]\d{1,3}$")
ASSET_FILE = re.compile(r"^(fig|eq)-\d{1,3}[-.]\d{1,3}\.png$")  # both separators: a book numbers figures its own way -- "Figure 1-1." (O'Reilly/Geron) vs "Figure 1.1:" (OpenIntro). Digits stay REQUIRED on both sides, so ".." can never match; do not narrow this back to a hyphen.

GENERAL_DEFAULTS: dict[str, Any] = {
    "ai_question_count": 5,
    "fresh_quiz_size": 20,
    "require_access_token": False,
}
ENV_FIELDS = ("EDU_QUIZ_API_URL", "EDU_QUIZ_API_KEY", "EDU_QUIZ_MODEL", "EDU_QUIZ_ACCESS_TOKEN", "EDU_QUIZ_JSON_MODE")


def valid_api_url(url: str) -> bool:
    return url.startswith("https://") or url.startswith("http://127.0.0.1") or url.startswith("http://localhost")


def read_general_settings() -> dict[str, Any]:
    values = dict(GENERAL_DEFAULTS)
    try:
        stored = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return values
    if isinstance(stored, dict):
        for key in GENERAL_DEFAULTS:
            if key in stored:
                values[key] = stored[key]
    return values


BLOCK_ID = re.compile(r"^ch\d{2}-b\d{2}$")


# Progress is kept PER MODULE. Block ids are positional ("ch01-b03"), so every
# book has a ch01-b03; keyed by block id alone, a second book's first lesson would
# share the Géron module's tick. The key is an explicit moduleId, never the title:
# the Géron title changes from "Chapters 1-9" to "1-19" when chapters are merged in,
# and a title-derived key would orphan every completion at that moment.
MODULE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
# The store was a flat {"completed": {...}} until 16-09-26, when the bundled Géron
# module was the only module anyone had studied. That flat map is read as its.
LEGACY_MODULE_ID = "geron-homl3"


def _read_store() -> dict[str, Any]:
    try:
        stored = json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 2, "modules": {}}
    if not isinstance(stored, dict):
        return {"version": 2, "modules": {}}
    if isinstance(stored.get("modules"), dict):
        return {"version": 2, "modules": stored["modules"]}
    legacy = stored.get("completed")
    return {"version": 2, "modules": {LEGACY_MODULE_ID: {"completed": legacy}} if isinstance(legacy, dict) else {}}


def module_key(value: Any) -> str:
    key = str(value or "").strip().lower()
    return key if MODULE_ID.match(key) else LEGACY_MODULE_ID


def read_progress(module: str = LEGACY_MODULE_ID) -> dict[str, Any]:
    """{"module": id, "completed": {"ch01-b03": {"at", "score", "total", "source"}}}"""
    entry = _read_store()["modules"].get(module) or {}
    completed = entry.get("completed") if isinstance(entry, dict) else None
    if not isinstance(completed, dict):
        completed = {}
    # Drop anything that is not a well-formed block id, so a corrupt or
    # hand-edited file cannot make the reader's percentages nonsense.
    return {"module": module, "completed": {k: v for k, v in completed.items() if isinstance(k, str) and BLOCK_ID.match(k)}}


def _write_store(store: dict[str, Any]) -> None:
    write_atomic(PROGRESS_PATH, json.dumps(store, indent=2, sort_keys=True) + "\n")


def mark_block_complete(module: str, block: str, score: int, total: int, source: str) -> dict[str, Any]:
    """Record a 100% result. Completion is one-way: a later worse retake keeps it."""
    store = _read_store()
    entry = store["modules"].setdefault(module, {})
    completed = entry.setdefault("completed", {})
    completed[block] = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "score": score,
        "total": total,
        "source": source,
    }
    _write_store(store)
    return read_progress(module)


def reset_progress(module: str) -> dict[str, Any]:
    """Clears ONE module. Resetting one book must never wipe another's progress."""
    store = _read_store()
    store["modules"].pop(module, None)
    _write_store(store)
    return read_progress(module)


def log_ask(book: str, chapter: int, block: int, term: str, question: str,
            reply: dict[str, Any]) -> None:
    """Append one answered question to the ask log. Best-effort and silent.

    Called AFTER the reply has already been sent, and every error is swallowed,
    so a full disk or a bad permission can never cost the reader an answer. The
    log is a study-quality signal, not part of the tutor's contract.
    """
    try:
        entry = {
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "module": book,
            "chapter": chapter,
            "block": block,
            "lesson": f"ch{chapter:02d}-b{block:02d}",
            "term": term,
            "question": question,
            # "lesson" | "book" | "general" -- the label the tutor already puts on
            # its own answer. A run of "general" on one block means that block did
            # not contain what the reader needed.
            "source": reply.get("source"),
            # 22-09-26: did this ask escalate to the vision path, and on which
            # figure. A vision ask costs ASK_VISION_COST slots of the ask budget,
            # so it is recorded rather than spent quietly.
            "vision": bool(reply.get("vision")),
            "figures": reply.get("figures") or [],
            # why the vision path did or did not run: "none" | "described" | "vision"
            "visionReason": reply.get("visionReason") or "none",
        }
        ASK_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with ASK_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


def write_atomic(path: Path, text: str) -> None:
    """Write via a temp file in the same directory, then rename.

    A half-written provider env file would leave the service unable to reach the
    provider with no clear cause, so the replace must be atomic.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(text, encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def write_env_file(values: dict[str, str]) -> None:
    lines = [
        "# Edu-Argumentation provider credentials.",
        "# Written by the in-app Settings page. Mode 600. Never commit this file.",
    ]
    lines.extend(f"{field}={values.get(field, '')}" for field in ENV_FIELDS)
    # EVERY other non-empty key already in the FILE is carried through, in file order:
    # EDU_ADMIN_TOKEN, the runner's two lines (ruling R24 stopped the runner, it did
    # not delete its key) and the model-routing keys (EDU_TUTOR_MODEL, EDU_MODEL_*,
    # 23-09-26). Until 23-09-26 only admin + runner were carried, so a Save would
    # silently have deleted any other key. The admin/runner values still fall back
    # to the process environment, as before, when the file does not hold them.
    carried = {key: value for key, value in read_env_file_keys().items()
               if key not in ENV_FIELDS and value.strip()}
    for field in ("EDU_ADMIN_TOKEN", "EDU_RUNNER_URL", "EDU_RUNNER_KEY"):
        if field not in carried and os.getenv(field, ""):
            carried[field] = os.getenv(field, "")
    lines.extend(f"{key}={value.strip()}" for key, value in carried.items())
    write_atomic(ENV_PATH, "\n".join(lines) + "\n")


def read_env_file_keys() -> dict[str, str]:
    """KEY=VALUE lines of provider.env as written by write_env_file (and read by
    systemd's EnvironmentFile=). Absent/unreadable file => {}."""
    values: dict[str, str] = {}
    try:
        text = ENV_PATH.read_text(encoding="utf-8")
    except OSError:
        return values
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def current_env_values() -> dict[str, str]:
    return {field: os.getenv(field, "") for field in ENV_FIELDS}



@dataclass(frozen=True)
class ProviderConfig:
    api_url: str
    api_key: str
    model: str
    access_token: str
    json_mode: bool

    @classmethod
    def from_environment(cls) -> "ProviderConfig | None":
        values = {
            "api_url": os.getenv("EDU_QUIZ_API_URL", "").strip(),
            "api_key": os.getenv("EDU_QUIZ_API_KEY", "").strip(),
            "model": os.getenv("EDU_QUIZ_MODEL", "").strip(),
            # Optional: an empty token means the box does not gate generation.
            # That is a deliberate choice for a LAN/VPN-only study host; the
            # require_access_token general setting decides whether it is enforced.
            "access_token": os.getenv("EDU_QUIZ_ACCESS_TOKEN", "").strip(),
        }
        if not all(values[field] for field in ("api_url", "api_key", "model")):
            return None
        # An operator who copies the template and fills in only some fields would
        # otherwise leave literal "replace-with-..." text here. That is non-empty,
        # so the check above passes and /api/provider reports ready while every
        # generation fails at the provider. Treat a placeholder as unconfigured.
        if any(value.startswith("replace-with-") for value in values.values()):
            return None
        if not valid_api_url(values["api_url"]):
            return None
        return cls(**values, json_mode=os.getenv("EDU_QUIZ_JSON_MODE", "true").lower() != "false")


def read_json(handler: SimpleHTTPRequestHandler, limit: int = MAX_REQUEST_BYTES) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0 or length > limit:
        raise ValueError(f"Request body must be a JSON object smaller than {limit // 1024} KB.")
    payload = json.loads(handler.rfile.read(length))
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")
    return payload


def strip_code_fence(text: str) -> str:
    value = text.strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[1] if "\n" in value else ""
        if value.endswith("```"):
            value = value[:-3]
    return value.strip()


# The PACKAGED book is the default now. Its legacy twin in data/ was retired on
# 18-09-26 so the library stops showing the same title twice.
DEFAULT_MODULE = "geron-homl3"
MODULE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*\.json")
_MODULE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def module_path(root: Path, name: str | None = None) -> Path:
    """A book is a JSON module in data/. Test fixtures and anything outside data/ are not books."""
    name = name or DEFAULT_MODULE
    data_dir = (root / "data").resolve()
    path = (data_dir / name).resolve()
    if not MODULE_NAME.fullmatch(name) or name.startswith("test_") or path.parent != data_dir or not path.is_file():
        raise ValueError("Unknown book.")
    return path


def packaged_module_path(name: str | None) -> Path | None:
    """library/<moduleId>/module.json, or None if this is not a packaged book.

    Everything above this -- /api/ask, /api/quiz, block lookups -- resolves a book
    by name through load_module(), and a packaged book's name is its FOLDER, not a
    file in data/. Without this the tutor answered "Unknown book." for the very
    book it was displaying."""
    if not name or not MODULE_ID.match(name):
        return None
    candidate = (LIBRARY_ROOT / name / "module.json").resolve()
    book = (LIBRARY_ROOT / name).resolve()
    if candidate.parent != book or not candidate.is_file():
        return None
    return candidate


def load_module(root: Path, name: str | None = None) -> dict[str, Any]:
    path = packaged_module_path(name) or module_path(root, name)
    mtime = path.stat().st_mtime
    cached = _MODULE_CACHE.get(str(path))
    if cached and cached[0] == mtime:
        return cached[1]
    data = json.loads(path.read_text(encoding="utf-8"))
    _MODULE_CACHE[str(path)] = (mtime, data)
    return data


def module_id_for(data: dict[str, Any]) -> str:
    """Same rule as moduleIdFor() in app.js, so the home page reads the right progress."""
    tutorial = data.get("tutorialData") if isinstance(data.get("tutorialData"), dict) else {}
    explicit = str(data.get("moduleId") or tutorial.get("moduleId") or "").strip().lower()
    if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", explicit):
        return explicit
    title = unicodedata.normalize("NFKD", str(tutorial.get("title") or "module").lower())
    slug = re.sub(r"[^a-z0-9]+", "-", title).strip("-")[:56]
    return f"t-{slug}" if re.match(r"[a-z0-9]", slug) and len(slug) >= 2 else "module"


# A reader-set title overrides the one baked into module.json. It is kept in its
# own small file on purpose: renaming must not rewrite a 5 MB import artifact, and
# the override has to outlive a re-import of the same book.
LIBRARY_META_PATH = Path(os.getenv("EDU_LIBRARY_META_PATH", str(PROGRESS_PATH.parent / "library-meta.json")))
MAX_TITLE = 160


def read_library_meta() -> dict[str, Any]:
    try:
        stored = json.loads(LIBRARY_META_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"titles": {}}
    titles = stored.get("titles") if isinstance(stored, dict) else None
    return {"titles": titles if isinstance(titles, dict) else {}}


def clean_title(value: Any) -> str:
    """One line, no control characters, bounded. Titles are rendered as text, never
    as HTML, so this is about sane display, not escaping."""
    text = " ".join(str(value or "").split())
    text = "".join(ch for ch in text if ch.isprintable())
    return text[:MAX_TITLE].strip()


def set_book_title(file: str, title: str) -> str:
    meta = read_library_meta()
    meta["titles"][file] = title
    write_atomic(LIBRARY_META_PATH, json.dumps(meta, indent=2, sort_keys=True) + "\n")
    return title


def _last_read_at(module_id: str) -> float:
    """Newest completion in this book, as a unix timestamp. Completions are the only
    per-book activity the server records, so this is the honest "worked on" signal --
    reading without finishing a block leaves no trace here."""
    completed = read_progress(module_key(module_id)).get("completed") or {}
    newest = 0.0
    for entry in completed.values():
        stamp = entry.get("at") if isinstance(entry, dict) else None
        if not isinstance(stamp, str):
            continue
        try:
            newest = max(newest, datetime.fromisoformat(stamp).timestamp())
        except ValueError:
            continue
    return newest


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def decorate_book(entry: dict[str, Any], source: Path, titles: dict[str, Any]) -> dict[str, Any]:
    override = clean_title(titles.get(entry["file"]))
    if override:
        entry["title"] = override
        entry["renamed"] = True
    entry["addedAt"] = _mtime(source)
    entry["lastReadAt"] = _last_read_at(entry["moduleId"])
    return entry


def list_modules(root: Path) -> list[dict[str, Any]]:
    books = []
    titles = read_library_meta()["titles"]
    for path in sorted((root / "data").glob("*.json")):
        try:
            data = load_module(root, path.name)
        except (ValueError, OSError, json.JSONDecodeError):
            continue
        tutorial = data.get("tutorialData")
        sections = tutorial.get("sections") if isinstance(tutorial, dict) else None
        if not isinstance(sections, list) or not isinstance(data.get("quizData"), list):
            continue
        books.append(decorate_book({
            "file": path.name,
            "moduleId": module_id_for(data),
            "title": str(tutorial.get("title") or path.stem),
            "chapters": len(sections),
            "lessons": sum(len(section.get("items") or []) for section in sections if isinstance(section, dict)),
            "questions": len(data["quizData"]),
            "default": path.name == DEFAULT_MODULE,
        }, path, titles))
    books.extend(list_packaged_books())
    return books


def list_packaged_books() -> list[dict[str, Any]]:
    """Books in library/<moduleId>/. `base` tells the page where this book's own
    assets live, so its "src" values stay relative to the book rather than to us."""
    out: list[dict[str, Any]] = []
    titles = read_library_meta()["titles"]
    if not LIBRARY_ROOT.is_dir():
        return out
    for folder in sorted(p for p in LIBRARY_ROOT.iterdir() if p.is_dir()):
        if not MODULE_ID.match(folder.name):
            continue
        try:
            data = json.loads((folder / "module.json").read_text(encoding="utf-8"))
            tutorial = data["tutorialData"]
            sections = tutorial["sections"]
            if not isinstance(sections, list) or not isinstance(data.get("quizData"), list):
                continue
        except (OSError, KeyError, TypeError, json.JSONDecodeError):
            continue
        out.append(decorate_book({
            # The folder name doubles as the entry's `file`, so every existing
            # library code path (progress key, card click, "is this the open
            # book") keeps working unchanged; `book` is what marks it packaged.
            "file": folder.name,
            "book": folder.name,
            "base": f"book/{folder.name}/",
            "moduleId": module_id_for(data),
            "title": str(tutorial.get("title") or folder.name),
            "chapters": len(sections),
            "lessons": sum(len(s.get("items") or []) for s in sections if isinstance(s, dict)),
            "questions": len(data["quizData"]),
            "default": folder.name == DEFAULT_MODULE,
        }, folder, titles))
    return out


def all_theory_blocks(root: Path, name: str | None = None) -> list[tuple[int, int]]:
    """Every (chapter, block) pair, 1-based, that a fresh quiz may draw from."""
    sections = load_module(root, name)["tutorialData"]["sections"]
    return [(chapter, block) for chapter, section in enumerate(sections, 1) for block in range(1, len(section["items"]) + 1)]


def source_for_block(root: Path, chapter_number: int, block_number: int, name: str | None = None) -> tuple[str, str]:
    module = load_module(root, name)
    chapter = module["tutorialData"]["sections"][chapter_number - 1]
    item = chapter["items"][block_number - 1]
    if isinstance(item, str):
        # Older modules store a block as one plain string.
        return chapter["title"], item
    parts: list[str] = []
    for content in item.get("blocks", []):
        if content.get("content"):
            parts.append(content["content"])
        for entry in content.get("items", []):
            # Callout items are strings; "Go deeper" items are {term, text}.
            if isinstance(entry, str):
                parts.append(entry)
            elif isinstance(entry, dict) and entry.get("text"):
                parts.append(f"{entry.get('term', '')} — {entry['text']}")
        # Interactive code cells replaced a code card; keep their code in the
        # quiz source so the lesson does not lose it for AI question generation.
        for cell in content.get("cells", []) if content.get("type") == "code_cells" else []:
            if isinstance(cell, dict) and cell.get("source"):
                parts.append(f"```python\n{cell['source']}\n```")
    source = "\n\n".join(parts)
    if not source:
        raise ValueError("That theory block has no source text for AI generation.")
    return chapter["title"], f"{item.get('term', 'Theory block')}\n\n{source}"


def response_content(raw: bytes, content_type: str) -> str:
    """Return the assistant text from a Chat Completions response.

    Requests are sent with `stream: true`, so the normal case is a server-sent
    event stream whose delta chunks are joined here. A provider that ignores the
    flag and answers with one JSON body is accepted too.
    """
    text = raw.decode("utf-8", errors="replace")
    if "text/event-stream" in content_type or text.lstrip().startswith("data:"):
        parts: list[str] = []
        for line in text.splitlines():
            line = line.strip()
            if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                continue
            try:
                chunk = json.loads(line[5:])
                parts.append(chunk["choices"][0].get("delta", {}).get("content") or "")
            except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                continue
        return drop_think("".join(parts))
    return drop_think(json.loads(text)["choices"][0]["message"]["content"] or "")


# Measured 23-09-26: Claude via 9router's `cc/` provider opens plain-text replies
# with an empty reasoning tag ("<think></think>SOURCE: lesson ..."), which pushed
# the SOURCE line off the start and mislabelled every tutor answer "general".
# Strip a LEADING tag block only, never one mid-text.
_LEADING_THINK = re.compile(r"^\s*<think>.*?</think>\s*", re.DOTALL)


def drop_think(text: str) -> str:
    return _LEADING_THINK.sub("", text, count=1)


def parse_quiz_json(content: str) -> Any:
    value = strip_code_fence(content)
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        # Free models sometimes wrap the object in a sentence. Take the outermost
        # braces rather than failing a call that did produce the quiz.
        start, end = value.find("{"), value.rfind("}")
        if start < 0 or end <= start:
            raise
        return json.loads(value[start:end + 1])


def valid_question(question: Any) -> bool:
    if not isinstance(question, dict):
        return False
    options, explanations, correct = question.get("options"), question.get("explanations"), question.get("correct")
    return (
        isinstance(question.get("question"), str) and bool(question["question"].strip())
        and isinstance(options, list) and len(options) == 4 and all(isinstance(value, str) and value.strip() for value in options)
        and isinstance(explanations, list) and len(explanations) == 4 and all(isinstance(value, str) for value in explanations)
        and isinstance(correct, int) and not isinstance(correct, bool) and correct in range(4)
    )


def provider_questions(config: ProviderConfig, chapter_title: str, source: str, count: int, exact: bool = True) -> list[dict[str, Any]]:
    """Ask the model for `count` questions on one theory block.

    exact=True (the per-block quiz) rejects the whole answer on any defect.
    exact=False (a fresh quiz, many calls) keeps the valid questions and drops the
    rest, so one malformed item does not throw away a whole paid call.
    """
    instruction = (
        f"Create exactly {count} multiple-choice study questions using only the supplied theory. "
        "Do not invent facts or refer to material outside it. Return a JSON object with a questions array. "
        "Every question needs question (string), options (exactly four strings), correct (zero-based index), "
        "and explanations (exactly four short strings; explain why each option is right or wrong)."
    )
    body: dict[str, Any] = {
        "model": config.model,
        "messages": [{"role": "system", "content": instruction}, {"role": "user", "content": f"Chapter: {chapter_title}\n\nTheory block:\n{source}"}],
        "temperature": 0.3,
        # Streamed on purpose. Measured 15-09-26 through 9router's `edu-arg` combo:
        # a non-streamed request returned HTTP 200 with `"content": ""` (the router
        # translates to the provider's responses API and loses the text), while the
        # same request streamed returned the full quiz. response_content() joins
        # the chunks, and still accepts a plain JSON body from providers that
        # ignore the flag.
        "stream": True,
    }
    if config.json_mode:
        body["response_format"] = {"type": "json_object"}
    request = Request(config.api_url, data=json.dumps(body).encode("utf-8"), headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=PROVIDER_TIMEOUT_SECONDS) as response:
            content = response_content(response.read(), response.headers.get("Content-Type", ""))
    except HTTPError as error:
        raise ValueError(f"Provider request failed ({error.code}).") from error
    except (URLError, TimeoutError, OSError) as error:
        raise ValueError("Provider could not be reached.") from error
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Provider returned an invalid quiz response.") from error
    try:
        parsed = parse_quiz_json(content)
    except json.JSONDecodeError as error:
        raise ValueError("Provider returned an invalid quiz response.") from error
    questions = parsed.get("questions") if isinstance(parsed, dict) else None
    if not isinstance(questions, list):
        raise ValueError("Provider returned an invalid quiz response.")
    if exact:
        if len(questions) != count:
            raise ValueError("Provider did not return the requested number of questions.")
        if not all(valid_question(question) for question in questions):
            raise ValueError("Provider returned a question with an invalid schema.")
    kept = [question for question in questions if valid_question(question)][:count]
    if not kept:
        raise ValueError("Provider returned no usable questions.")
    return [shuffled_question(q) for q in kept]


def shuffled_question(question: dict[str, Any]) -> dict[str, Any]:
    """Shuffle the four options, carrying each explanation and the answer with them.

    Models put the right answer first far more often than chance: a live 20-question
    run on 15-09-26 had it at option A 13 times. Unshuffled, a learner can score well
    by always picking A.
    """
    order = list(range(4))
    secrets.SystemRandom().shuffle(order)
    return {
        "question": question["question"].strip(),
        "options": [question["options"][index].strip() for index in order],
        "correct": order.index(question["correct"]),
        "explanations": [question["explanations"][index].strip() for index in order],
    }


def fresh_questions(config: ProviderConfig, root: Path, count: int,
                    blocks: set[tuple[int, int]] | None = None, name: str | None = None) -> tuple[list[dict[str, Any]], list[str]]:
    """Write a new quiz with the model from randomly chosen book sections.

    Sections are drawn without replacement; a couple of spares are held back so a
    section whose call fails is replaced instead of shrinking the quiz. Returns the
    questions (shuffled) and the error messages of any calls that failed.
    """
    pool = all_theory_blocks(root, name)
    if blocks:
        # The learner ticked chapters and blocks on the quiz setup screen (17-09-26).
        pool = [target for target in pool if target in blocks]
    rng = secrets.SystemRandom()
    needed = -(-count // QUESTIONS_PER_SECTION)
    picks = rng.sample(pool, min(len(pool), needed + SPARE_SECTIONS))
    plan = [(picks[index], min(QUESTIONS_PER_SECTION, count - index * QUESTIONS_PER_SECTION)) for index in range(min(needed, len(picks)))]
    spares = picks[len(plan):]

    def one(target: tuple[int, int], size: int) -> list[dict[str, Any]]:
        chapter_title, source = source_for_block(root, *target, name)
        return provider_questions(config, chapter_title, source, size, exact=False)

    questions: list[dict[str, Any]] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=FRESH_PARALLEL_CALLS) as pool_executor:
        pending = [(size, pool_executor.submit(one, target, size)) for target, size in plan]
        while pending:
            retry: list[tuple[int, Any]] = []
            for size, future in pending:
                try:
                    questions.extend(future.result())
                except (ValueError, IndexError, KeyError, OSError, json.JSONDecodeError) as error:
                    errors.append(str(error))
                    if spares:
                        retry.append((size, pool_executor.submit(one, spares.pop(), size)))
            pending = retry
    rng.shuffle(questions)
    return questions[:count], errors



def book_pages(module_id: str) -> list[str]:
    """The book's page text, cached by mtime. Empty list when a module has no book."""
    name = BOOK_FILES.get(module_id)
    if not name:
        return []
    path = BOOK_ROOT / name
    try:
        stamp = path.stat().st_mtime
    except OSError:
        return []
    cached = _BOOK_CACHE.get(module_id)
    if cached and cached[0] == stamp:
        return cached[1]
    try:
        pages = json.loads(path.read_text(encoding="utf-8")).get("pages") or []
    except (OSError, json.JSONDecodeError, AttributeError):
        return []
    pages = [str(p or "") for p in pages]
    _BOOK_CACHE[module_id] = (stamp, pages)
    return pages


def book_document_frequency(module_id: str) -> dict[str, int]:
    """How many pages each word appears on, cached per book."""
    cached = _BOOK_DF.get(module_id)
    pages = book_pages(module_id)
    if cached and cached[0] == len(pages):
        return cached[1]
    df: dict[str, int] = defaultdict(int)
    for text in pages:
        for word in set(re.findall(r"[a-z0-9]+", text.lower())):
            df[word] += 1
    _BOOK_DF[module_id] = (len(pages), df)
    return df


def book_chapters(module_id: str) -> list[tuple[int, int, int]]:
    """(chapter number, first page, last page) from the book's own outline.

    Used to keep the search inside the body -- the index and the table of contents
    are dense with rare words and otherwise win every query -- and to prefer the
    chapter the learner is actually reading.
    """
    cached = _BOOK_CHAPTERS.get(module_id)
    if cached is not None:
        return cached
    name = BOOK_FILES.get(module_id)
    rows: list[tuple[int, int, int]] = []
    if name:
        try:
            outline = json.loads((BOOK_ROOT / name).read_text(encoding="utf-8")).get("outline") or []
        except (OSError, json.JSONDecodeError, AttributeError):
            outline = []
        starts: list[tuple[int, int]] = []
        tail = len(book_pages(module_id))
        for entry in outline:
            if not isinstance(entry, dict):
                continue
            found = re.match(r"^\s*(\d{1,2})\.\s", str(entry.get("title") or ""))
            page = entry.get("page")
            if found and isinstance(page, int):
                starts.append((int(found.group(1)), page))
            elif isinstance(page, int) and starts and re.match(r"^\s*(Appendix|Index)\b", str(entry.get("title") or ""), re.I):
                tail = min(tail, page)
        starts.sort()
        for i, (number, start) in enumerate(starts):
            end = starts[i + 1][1] - 1 if i + 1 < len(starts) else tail - 1
            rows.append((number, start, end))
    _BOOK_CHAPTERS[module_id] = rows
    return rows


def book_search(module_id: str, query: str, limit: int = ASK_BOOK_PAGES, chapter: int | None = None) -> list[dict[str, Any]]:
    """Keyword search over the book, weighted by how rare each word is.

    Deliberately not embeddings: the book is ~1.8 MB, the lesson already pins the
    topic, and a vector store would add a dependency and a build step for recall
    this does not need.

    Plain term-frequency was measured returning pages 877/554/256 for "why is the
    error squared" -- the filler words carried the match. Weighting each term by
    1/document-frequency makes a word that appears on 40 pages outrank one that
    appears on 600, which is what puts the right chapter first.
    """
    pages = book_pages(module_id)
    terms = {w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 2 and w not in ASK_STOPWORDS}
    if not pages or not terms:
        return []
    chapters = book_chapters(module_id)
    body = (chapters[0][1], chapters[-1][2]) if chapters else (0, len(pages) - 1)
    here = next(((a, b) for n, a, b in chapters if n == chapter), None)
    df = book_document_frequency(module_id)
    total = len(pages)
    weights = {t: math.log(1 + total / (1 + df.get(t, 0))) for t in terms}
    # A term on more than this share of pages says nothing about which page to pick.
    common = {t for t in terms if df.get(t, 0) > total * ASK_COMMON_TERM_SHARE}
    useful = {t for t in terms if t not in common} or terms
    scored: list[tuple[float, int, int]] = []
    for index, text in enumerate(pages):
        if not body[0] <= index <= body[1]:
            continue                       # front matter, appendices and the index
        low = text.lower()
        score = sum(low.count(term) * weights[term] for term in useful if term in low)
        if not score:
            continue
        if here and here[0] <= index <= here[1]:
            score *= ASK_SAME_CHAPTER_BOOST          # what they are reading now
        elif here and here[0] - 40 <= index <= here[1] + 40:
            score *= ASK_NEAR_CHAPTER_BOOST
        scored.append((round(score, 4), len({t for t in useful if t in low}), index))
    scored.sort(reverse=True)
    out: list[dict[str, Any]] = []
    for _score, _distinct, index in scored[:limit]:
        text = pages[index]
        low = text.lower()
        first = min((low.find(t) for t in useful if t in low), default=0)
        start = max(0, first - ASK_EXCERPT_CHARS // 3)
        out.append({"page": index, "text": " ".join(text[start:start + ASK_EXCERPT_CHARS].split())})
    return out


def block_visuals(module: dict[str, Any], chapter: int, block: int) -> list[dict[str, Any]]:
    """Every figure and equation printed in ONE lesson, in the order it is read.

    Read straight off the module -- these are the book's own blocks, so the asset
    name is the package's, never the client's."""
    try:
        item = module["tutorialData"]["sections"][chapter - 1]["items"][block - 1]
    except (KeyError, IndexError, TypeError):
        return []
    if not isinstance(item, dict):
        return []
    out: list[dict[str, Any]] = []
    for content in item.get("blocks", []) or []:
        if isinstance(content, dict) and content.get("type") in ("figure", "equation"):
            out.append(content)
    return out


def visual_context(visuals: list[dict[str, Any]]) -> str:
    """LAYER 1. What the package already knows about the page's visuals, as text.

    Costs a few hundred characters and is sent on EVERY ask, because it is the
    difference between "I cannot see the figure" and "Figure 2-9 is a histogram
    of income categories" -- and, for an equation, between guessing and reading
    the actual LaTeX. Capped, and scoped to the open lesson only.
    """
    if not visuals:
        return ""
    lines: list[str] = []
    budget = ASK_VISUAL_CHARS
    for visual in visuals:
        title = str(visual.get("title") or "").strip() or ("Equation" if visual.get("type") == "equation" else "Figure")
        caption = str(visual.get("caption") or "").strip()
        entry = [f"[{title}] {caption}" if caption else f"[{title}]"]
        alt = str(visual.get("alt") or "").strip()
        # alt is usually just "<title>: <caption>" -- only worth sending when it
        # actually carries something the caption does not.
        if alt and alt not in (f"{title}: {caption}", caption, title):
            entry.append(f"  alt text: {alt}")
        # Written by a sibling backfill; absent from every figure today, which is
        # exactly why the vision layer below exists.
        description = str(visual.get("description") or "").strip()
        if description:
            entry.append(f"  what it shows: {description}")
        if visual.get("type") == "equation":
            latex = str(visual.get("latex") or "").strip()
            if latex:
                entry.append(f"  LaTeX (read this, it is the equation itself): {latex}")
            explain = str(visual.get("explain") or "").strip()
            if explain:
                explain = explain[:ASK_VISUAL_EXPLAIN_CHARS].rstrip()
                entry.append(f"  the lesson's own note on it: {explain}")
        elif not description:
            entry.append("  (no written description of this picture is stored)")
        text = "\n".join(entry)
        if len(text) + 1 > budget:
            break
        budget -= len(text) + 1
        lines.append(text)
    if not lines:
        return ""
    return ("VISUALS PRINTED IN THIS LESSON\nThese are the book's own figures and equations, in the order they "
            "appear on the page the reader is looking at. Refer to one by its title, e.g. \"Figure 2-9\". "
            "Unless an image is attached below you have NOT seen the picture itself -- say so plainly rather "
            "than inventing what is in it.\n\n" + "\n".join(lines))


def has_description(visual: dict[str, Any]) -> bool:
    """Does this visual carry a written description good enough to answer from?

    Length is the whole test on purpose. The backfill writes a grounded
    paragraph; anything under ASK_DESCRIPTION_MIN_CHARS is a stub or a repeated
    title, and letting a stub suppress the picture would make the tutor answer
    a figure question out of nothing at all.
    """
    return len(str(visual.get("description") or "").strip()) >= ASK_DESCRIPTION_MIN_CHARS


def ask_wants_image(question: str, visuals: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    """LAYER 2 TRIGGER. Which of this lesson's figures, if any, must actually be SEEN.

    Returns (figures to attach, why). The reason is "none" when the question was
    never about a picture on this page, "described" when it WAS but layer 1's
    stored description already answers it, and "vision" when a crop must go out.
    Only the reason tells "described" apart from "none", and the reader is shown
    the difference -- see ask_notice().

    Returns [] for an ordinary question -- and that is the point. Three conditions
    must ALL hold, so a text question cannot reach the expensive path:

      1. THIS LESSON CONTAINS A FIGURE. An equation is excluded on purpose: 88 of
         90 carry LaTeX, which layer 1 already sends, so sending a picture of one
         buys nothing. A lesson with no figure can never escalate, whatever is asked.
      2. THE QUESTION POINTS AT A PICTURE -- either a book reference ("Figure 2-9")
         or a DETERMINER plus a visual noun ("the chart", "this histogram"). The
         determiner is the tight part: "how do I plot a histogram in pandas?" has
         the noun but no determiner pointing at the page, so it does not match.
         A bare visual noun never fires.
      3. LAYER 1 CANNOT ANSWER IT -- the target figure has NO usable stored
         `description`. A figure that carries one is answered from that text and
         the picture is never sent, whatever the question is (user ruling,
         22-09-26: a written description is steady, a vision reading is not).
         Before the backfill every figure was description-less, so this condition
         was always true and every figure escalated; that is the behaviour this
         replaces, not a behaviour it breaks.
    """
    figures = [v for v in visuals if v.get("type") == "figure" and v.get("asset")]
    if not figures:
        return [], "none"                           # 1
    named = ASK_FIGURE_REF.search(question)
    if not (named or ASK_VISUAL_DEICTIC.search(question)):
        return [], "none"                           # 2
    targets: list[dict[str, Any]] = []
    if named:
        wanted = {f"fig-{named.group(1)}-{named.group(2)}", f"fig-{named.group(1)}.{named.group(2)}"}
        label = f"{named.group(1)}-{named.group(2)}"
        for figure in figures:
            title = str(figure.get("title") or "")
            if str(figure.get("asset") or "") in wanted or label in title.replace(".", "-"):
                targets.append(figure)
        # A number that is NOT on this page. Measured 22-09-26: asking "what does
        # Figure 2-9 show?" while ch02-b09 was open attached Figures 2-16 and 2-14
        # and the tutor answered off the wrong pictures. A named figure we do not
        # have is a question the images on this page cannot answer, so send none
        # and let it say so from text.
        if not targets:
            return [], "none"
    # No number given: the reader is pointing at what is in front of them.
    targets = targets or figures
    # 3. Only the figures layer 1 is BLIND to. A figure whose description the
    #    backfill wrote is answered from that description -- dropping it here is
    #    what stops the expensive, variable vision call once the text is good
    #    enough. If every target has one, nothing is sent at all.
    blind = [t for t in targets if not has_description(t)]
    if not blind:
        return [], "described"                      # 3
    return blind[:ASK_VISION_MAX_IMAGES], "vision"


def ask_notice(reason: str, images: list[tuple[str, bytes]]) -> str:
    """One line saying HOW the tutor got its answer, prepended to the reply.

    WHY THIS IS IN THE ANSWER AND NOT A NEW FIELD. The reply already carries
    `vision` and `figures`, and the page ignores both: js/app.js renders exactly
    three things -- the SOURCE badge, its page number, and `answer`. That file is
    frozen, so `answer` is the only server-controlled thing the reader ever sees.
    A new key would be true, logged, and invisible.

    WHAT THIS DOES NOT FIX. It cannot make the WAIT legible. The reply is one
    JSON at the end of the call, so nothing the server writes can reach the
    screen while the reader is waiting -- the grey "Reading the lesson..." line
    is written by the page at submit time and never changes. Reading a figure
    took 4.6-26.6 s measured 22-09-26 against 4.9 s for a text ask, and during
    that gap the page says the same thing either way. Telling the two apart
    while it happens needs a client change; this line is the honest half that
    can be done from here, and it lands the moment the answer does.
    """
    if images:
        titles = ", ".join(title for title, _ in images)
        return (f"_Read the picture — {titles}. Looking at a figure takes several times longer than "
                "a text answer, so this one was slower._")
    if reason == "vision":
        # The trigger fired but no crop went out: the budget could not pay
        # ASK_VISION_COST in full, or the file was missing/oversized. The reader
        # is owed that, because the answer is weaker than it looks.
        return "_Answered from the lesson text only — the picture itself was not attached this time._"
    if reason == "described":
        # Layer 1 had a written description of the figure, so the picture was not
        # needed. Worth saying: it is why this answer came back fast.
        return "_Answered from the book's own written description of the figure, without looking at the picture._"
    return ""


def figure_bytes(module_id: str, asset: str) -> bytes | None:
    """The PNG for one of THIS book's figures, or None.

    PREFERS `<asset>.model.png` (22-09-26). The importer writes every crop
    TWICE: `<asset>.png` is the one the PAGE displays, and `<asset>.model.png`
    is the one it makes for a model -- same picture, about a third of the bytes
    (measured: fig-2-10 25,855 vs 65,856; fig-2-11 84,447 vs 246,084). Sending
    the display crop was uploading two thirds more than the provider needs on
    the slowest call this app makes. Falls back to the display crop when a book
    has no model variant, so an older package still answers.

    Same containment rule as send_book(): the module id and the asset id are
    pattern-checked and the resolved path must stay inside this book's own
    assets/ folder. The id comes from module.json, never from the request --
    there is no client-supplied path anywhere on this route.
    """
    if not MODULE_ID.match(module_id or "") or not ASSET_ID.match(asset or ""):
        return None
    book = (LIBRARY_ROOT / module_id).resolve()
    for name in (f"{asset}.model.png", f"{asset}.png"):
        target = (book / "assets" / name).resolve()
        if not str(target).startswith(str(book) + os.sep) or not target.is_file():
            continue
        if target.stat().st_size > ASK_VISION_MAX_BYTES:
            continue
        return target.read_bytes()
    return None


ASK_SYSTEM = (
    "You are the learner's tutor inside a study app. They are a junior data engineer: strong on SQL, "
    "tables, Spark and ETL, new to machine learning, and weak on Python, pandas and NumPy.\n\n"
    "HOW TO TALK. Like a person explaining to a colleague at a desk, not like a textbook. Short "
    "sentences. One idea at a time. Answer the actual question in the first sentence, then explain. "
    "Gloss every piece of jargon the first time you use it. Use an analogy from their world - a table, "
    "a SELECT, a GROUP BY, a full refresh versus an incremental load - whenever it is genuinely "
    "accurate, and skip it when it is not. Plain words over precise-sounding ones. No preamble, no "
    "'great question', no bullet-point dumps, no emoji. If they ask something short, answer short.\n\n"
    "WHERE ANSWERS COME FROM, in this order:\n"
    "1. THE LESSON they are reading. Use it first - it is on their screen.\n"
    "2. THE BOOK EXCERPTS supplied. Use these when the lesson does not cover it. It is fine to reach "
    "ahead of where they are; say so plainly when you do.\n"
    "3. YOUR OWN KNOWLEDGE, when neither covers it. Say that is what you are doing.\n\n"
    "FIRST LINE OF YOUR REPLY must be exactly one of:\n"
    "SOURCE: lesson\n"
    "SOURCE: book p.<page number>\n"
    "SOURCE: general\n"
    "Then a blank line, then the answer. Never invent a page number, a paper, an author or a URL. "
    "If you are unsure, say you are unsure - that is more useful to them than a confident guess."
)
SOURCE_LINE = re.compile(r"^\s*SOURCE:\s*(lesson|book|general)\b[^\n]*", re.I)


def ask_tutor(config: "ProviderConfig", chapter_title: str, lesson_term: str, lesson: str,
              question: str, history: list[dict[str, str]], excerpts: list[dict[str, Any]],
              visuals: list[dict[str, Any]] | None = None,
              images: list[tuple[str, bytes]] | None = None) -> dict[str, Any]:
    context = [f"THE LESSON THEY ARE READING\nChapter: {chapter_title}\nLesson: {lesson_term}\n\n{lesson}"]
    # LAYER 1. The page's figures and equations as text. source_for_block() drops
    # those blocks when it builds `lesson`, so without this the tutor cannot even
    # name a figure that is on the reader's screen.
    seen = visual_context(visuals or [])
    if seen:
        context.append(seen)
    if excerpts:
        joined = "\n\n".join(f"[book page {e['page']}]\n{e['text']}" for e in excerpts)
        context.append("BOOK EXCERPTS THAT MAY BE RELEVANT\n\n" + joined)
    if images:
        # LAYER 2. An attached crop is the book's own figure, printed in the lesson
        # in front of them -- so it is the LESSON, and the existing SOURCE: contract
        # needs no new value. The persona above is untouched.
        titles = ", ".join(title for title, _ in images)
        context.append(f"ATTACHED IMAGE(S): {titles}. This is the book's own figure from the lesson they are "
                       "reading, so it counts as THE LESSON (answer with SOURCE: lesson). Read what is "
                       "actually in the picture -- the axes and their units, what the shapes or bars do, "
                       "where the mass sits, which parts stand out -- and answer from that, not from what "
                       "a figure with this caption usually looks like.")
    messages: list[dict[str, Any]] = [{"role": "system", "content": ASK_SYSTEM},
                                      {"role": "system", "content": "\n\n".join(context)}]
    messages.extend(history[-ASK_HISTORY_TURNS:])
    if images:
        parts: list[dict[str, Any]] = [{"type": "text", "text": question}]
        for _, raw in images:
            encoded = base64.b64encode(raw).decode("ascii")
            parts.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}})
        messages.append({"role": "user", "content": parts})
    else:
        # A text ask stays byte-identical to what it has always sent.
        messages.append({"role": "user", "content": question})
    body = {"model": config.model, "messages": messages, "temperature": 0.4, "stream": True}
    request = Request(config.api_url, data=json.dumps(body).encode("utf-8"),
                      headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
                      method="POST")
    try:
        with urlopen(request, timeout=PROVIDER_TIMEOUT_SECONDS) as response:
            content = response_content(response.read(), response.headers.get("Content-Type", ""))
    except HTTPError as error:
        raise ValueError(f"Provider request failed ({error.code}).") from error
    except (URLError, TimeoutError, OSError) as error:
        raise ValueError("Provider could not be reached.") from error
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Provider returned an invalid response.") from error
    content = (content or "").strip()
    if not content:
        raise ValueError("The model returned an empty answer.")
    source, page = "general", None
    match = SOURCE_LINE.match(content)
    if match:
        source = match.group(1).lower()
        found = re.search(r"p\.?\s*(\d{1,4})", match.group(0))
        page = int(found.group(1)) if found else None
        content = content[match.end():].lstrip("\n").strip()
    return {"answer": content, "source": source, "page": page,
            "pages": [e["page"] for e in excerpts],
            # Extra keys only -- the page ignores what it does not know. They exist
            # so a vision ask is never silent: it shows up here and in the ask log.
            "vision": bool(images),
            "figures": [title for title, _ in (images or [])]}


EXERCISE_SYSTEM = (
    "You are marking a junior data engineer's answers to the end-of-chapter exercises of a machine "
    "learning textbook. They are strong on SQL, tables, Spark and ETL, new to machine learning.\n\n"
    "MARK THE MEANING, NOT THE WORDING. They are writing what they understood in their own words. "
    "Different words for the right idea is CORRECT. Do not require the book's phrasing, its exact "
    "terms, or its examples. Do not require completeness beyond what the exercise actually asks: if "
    "it asks for four things, four is enough; if it asks 'what is X', a sound one-sentence answer is "
    "enough.\n\n"
    "VERDICTS, use exactly one per answer:\n"
    "correct   - the idea is right. Minor imprecision, a missing synonym, or clumsy phrasing is "
    "still correct.\n"
    "partial   - part of the answer is right and part is missing or muddled.\n"
    "incorrect - the idea is wrong, or the answer is empty, or it answers a different question.\n\n"
    "FEEDBACK. One or two short sentences, speaking to them directly. For 'correct', say what they "
    "got right and add at most one sharpening detail. For 'partial' and 'incorrect', say plainly "
    "what is missing or wrong and what the book says instead - never just 'wrong, try again'. Gloss "
    "any jargon you introduce. No preamble, no praise padding, no emoji.\n\n"
    "GROUND IT. Use the book excerpts supplied. If the excerpts do not settle a point, mark on your "
    "own knowledge of machine learning and say so in the feedback. Never invent a page number, a "
    "paper or an author.\n\n"
    "Reply with JSON ONLY, no prose around it, in exactly this shape:\n"
    '{"results": [{"n": 1, "verdict": "correct", "feedback": "..."}]}\n'
    "One entry per exercise you were given, with the same n. Nothing else in the object."
)

EXERCISE_VERDICTS = ("correct", "partial", "incorrect")


def grade_exercises(config: "ProviderConfig", chapter_title: str,
                    answers: list[dict[str, Any]], excerpts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One model call for the whole submit, not one per exercise.

    A chapter has 4-19 exercises. Nineteen calls per submit would burn a free
    tier's weekly allowance in a handful of chapters, and the model marks better
    seeing the whole set anyway -- it can tell an answer that belongs to the next
    exercise from one that is simply wrong.
    """
    lines = []
    for item in answers:
        lines.append(f"EXERCISE {item['n']}\nQuestion: {item['question']}\nTheir answer: {item['answer'] or '(left blank)'}")
    context = [f"CHAPTER\n{chapter_title}"]
    if excerpts:
        context.append("BOOK EXCERPTS FROM THIS CHAPTER\n\n" + "\n\n".join(
            f"[book page {e['page']}]\n{e['text']}" for e in excerpts))
    body = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": EXERCISE_SYSTEM},
            {"role": "system", "content": "\n\n".join(context)},
            {"role": "user", "content": "\n\n".join(lines)},
        ],
        "temperature": 0.2,
        "stream": True,
    }
    request = Request(config.api_url, data=json.dumps(body).encode("utf-8"),
                      headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
                      method="POST")
    try:
        with urlopen(request, timeout=PROVIDER_TIMEOUT_SECONDS) as response:
            content = response_content(response.read(), response.headers.get("Content-Type", ""))
    except HTTPError as error:
        raise ValueError(f"Provider request failed ({error.code}).") from error
    except (URLError, TimeoutError, OSError) as error:
        raise ValueError("Provider could not be reached.") from error
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Provider returned an invalid response.") from error

    text = strip_code_fence((content or "").strip())
    if not text:
        raise ValueError("The model returned an empty reply.")
    # Some models wrap the object in a sentence even when told not to. Take the
    # outermost braces rather than failing the whole submit on a stray prefix.
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("The model did not return JSON.")
        try:
            parsed = json.loads(text[start:end + 1])
        except json.JSONDecodeError as error:
            raise ValueError("The model returned malformed JSON.") from error

    rows = parsed.get("results") if isinstance(parsed, dict) else parsed
    if not isinstance(rows, list):
        raise ValueError("The model returned no results.")
    marked: dict[int, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            n = int(row.get("n"))
        except (TypeError, ValueError):
            continue
        verdict = str(row.get("verdict", "")).strip().lower()
        if verdict not in EXERCISE_VERDICTS:
            verdict = "partial"
        marked[n] = {"n": n, "verdict": verdict, "feedback": str(row.get("feedback", "")).strip()[:1_200]}
    # An exercise the model skipped is NOT silently passed. It comes back as
    # unmarked so the page can say so and the reader can submit again.
    return [marked.get(item["n"], {"n": item["n"], "verdict": "unmarked",
                                   "feedback": "The model did not mark this one. Submit again."})
            for item in answers]


class EduHandler(SimpleHTTPRequestHandler):
    server_version = "EduArgumentation/1.0"
    # HTTP/1.1, so keep-alive is negotiated properly. On the stdlib default of
    # HTTP/1.0 the server closes the socket after every response without saying
    # so, the browser pools it anyway, and the NEXT request on that dead socket
    # fails instantly as a bare "Failed to fetch" -- with nothing in this log,
    # because it never arrived. Measured 18-09-26: every first question failed
    # and its retry succeeded. Both response paths set Content-Length (send_json
    # and SimpleHTTPRequestHandler's own file serving), which 1.1 requires.
    protocol_version = "HTTP/1.1"
    # Reap idle keep-alive connections instead of pinning a thread for each.
    timeout = 30

    @property
    def root(self) -> Path:
        return Path(self.directory).resolve()

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        return not origin or origin.split("//", 1)[-1].rstrip("/") == self.headers.get("Host", "")

    def admin_ok(self) -> bool:
        """Settings are open unless an operator deliberately sets a lock.

        This host is single-user and reachable only over the LAN/VPN, so a
        password on the settings form is friction without a matching threat: the
        same people can already use the page. The API key is still never readable
        through this API -- it can be replaced, never retrieved -- which is the
        property that actually matters. Set EDU_ADMIN_TOKEN to turn the gate on.
        """
        expected = os.getenv("EDU_ADMIN_TOKEN", "").strip()
        if not expected:
            return True
        return secrets.compare_digest(self.headers.get("X-Edu-Admin-Token", ""), expected)

    def settings_payload(self) -> dict[str, Any]:
        values = current_env_values()
        # The API key is NEVER returned, not even partially. The page only needs
        # to know whether one is set.
        return {
            "api_url": values["EDU_QUIZ_API_URL"],
            "model": values["EDU_QUIZ_MODEL"],
            "json_mode": values["EDU_QUIZ_JSON_MODE"].lower() != "false",
            "api_key_set": bool(values["EDU_QUIZ_API_KEY"]),
            "access_token_set": bool(values["EDU_QUIZ_ACCESS_TOKEN"]),
            "ready": ProviderConfig.from_environment() is not None,
            "general": read_general_settings(),
            "admin_required": bool(os.getenv("EDU_ADMIN_TOKEN", "").strip()),
        }

    def send_asset(self, route: str) -> bool:
        """GET /assets/<moduleId>/<fig-10-3.png>. Both parts are pattern-checked and the
        resolved path must stay inside ASSET_ROOT, so no request can read outside it."""
        parts = route.split("/")
        if len(parts) != 4 or parts[1] != "assets":
            return False
        module, name = parts[2], parts[3]
        if not MODULE_ID.match(module) or not ASSET_FILE.match(name):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "No such asset."})
            return True
        path = (ASSET_ROOT / module / name).resolve()
        if path.parent != (ASSET_ROOT / module).resolve() or not path.is_file():
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "No such asset."})
            return True
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        # Crops are content-addressed by label and re-extraction rewrites them in
        # place; a short cache keeps a fix visible without a hard refresh.
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)
        return True

    def send_book(self, route: str) -> bool:
        """GET /book/<moduleId>/module.json  or  /book/<moduleId>/assets/<fig-1-21.png>.

        Same containment rule as send_asset: every segment is pattern-checked and
        the resolved path must stay inside this book's own folder."""
        parts = route.split("/")
        if len(parts) < 3 or parts[1] != "book" or not MODULE_ID.match(parts[2]):
            return False
        book = (LIBRARY_ROOT / parts[2]).resolve()
        if len(parts) == 4 and parts[3] == "module.json":
            target, ctype = book / "module.json", "application/json; charset=utf-8"
        elif len(parts) == 5 and parts[3] == "assets" and ASSET_FILE.match(parts[4]):
            target, ctype = book / "assets" / parts[4], "image/png"
        else:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "No such book file."})
            return True
        target = target.resolve()
        if not str(target).startswith(str(book) + os.sep) or not target.is_file():
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "No such book file."})
            return True
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)
        return True

    def do_GET(self) -> None:
        route = self.path.split("?", 1)[0]
        if route.startswith("/assets/") and self.send_asset(route):
            return
        if route.startswith("/book/") and self.send_book(route):
            return
        if route == "/api/provider":
            config = ProviderConfig.from_environment()
            general = read_general_settings()
            self.send_json(HTTPStatus.OK, {
                "ready": config is not None,
                "model": config.model if config else None,
                "token_required": bool(general["require_access_token"] and config and config.access_token),
                "admin_required": bool(os.getenv("EDU_ADMIN_TOKEN", "").strip()),
            })
            return
        if route == "/api/general":
            self.send_json(HTTPStatus.OK, read_general_settings())
            return
        if route == "/api/modules":
            self.send_json(HTTPStatus.OK, {"books": list_modules(self.root)})
            return
        if route == "/api/progress":
            query = parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
            self.send_json(HTTPStatus.OK, read_progress(module_key((query.get("module") or [""])[0])))
            return
        if route == "/api/settings":
            if not self.admin_ok():
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "A valid admin token is required."})
                return
            self.send_json(HTTPStatus.OK, self.settings_payload())
            return
        super().do_GET()

    def save_settings(self) -> None:
        payload = read_json(self)
        values = current_env_values()
        general = read_general_settings()

        if "api_url" in payload:
            url = str(payload["api_url"]).strip()
            if url and not valid_api_url(url):
                raise ValueError("The endpoint must be https://, or http:// on localhost.")
            values["EDU_QUIZ_API_URL"] = url
        if "model" in payload:
            values["EDU_QUIZ_MODEL"] = str(payload["model"]).strip()
        if "json_mode" in payload:
            values["EDU_QUIZ_JSON_MODE"] = "true" if payload["json_mode"] else "false"
        # An omitted api_key keeps the stored one; an explicit empty string clears
        # it. Without that distinction, saving any other field would wipe the key.
        if "api_key" in payload:
            values["EDU_QUIZ_API_KEY"] = str(payload["api_key"]).strip()
        if "access_token" in payload:
            values["EDU_QUIZ_ACCESS_TOKEN"] = str(payload["access_token"]).strip()

        for key, caster, low, high in (("ai_question_count", int, 3, MAX_QUESTIONS), ("fresh_quiz_size", int, MIN_FRESH_QUESTIONS, MAX_FRESH_QUESTIONS)):
            if key in payload:
                number = caster(payload[key])
                if not low <= number <= high:
                    raise ValueError(f"{key.replace('_', ' ')} must be between {low} and {high}.")
                general[key] = number
        if "require_access_token" in payload:
            general["require_access_token"] = bool(payload["require_access_token"])

        write_env_file(values)
        write_atomic(SETTINGS_PATH, json.dumps(general, indent=2) + "\n")
        # Apply to the live process too, so the operator does not have to restart
        # the service for the change to take effect.
        for field, value in values.items():
            os.environ[field] = value
        self.send_json(HTTPStatus.OK, self.settings_payload())

    def rename_book(self) -> None:
        """Give a book a different name in the library. It does NOT touch module.json:
        the override lives in library-meta.json, keyed by the same `file` the listing
        uses, so a re-import keeps the reader's name and a 5 MB artifact is never
        rewritten to change one string."""
        payload = read_json(self)
        file = str(payload.get("file") or "")
        title = clean_title(payload.get("title"))
        if not title:
            raise ValueError("A title is required.")
        # Only a book this server already lists may be renamed -- never an arbitrary
        # key, which would let a caller grow the file without bound.
        if not any(book["file"] == file for book in list_modules(self.root)):
            raise ValueError("Unknown book.")
        set_book_title(file, title)
        self.send_json(HTTPStatus.OK, {"file": file, "title": title})

    def save_progress(self) -> None:
        """Record a completed block, or reset everything.

        A block counts as complete only on a perfect score, which is what the
        reader asked for: 100% or it does not count. The server re-checks that
        rather than trusting a `complete: true` flag from the page, so a stray
        client cannot mark a block it did not pass.
        """
        payload = read_json(self)
        module = module_key(payload.get("module"))
        if payload.get("reset") is True:
            self.send_json(HTTPStatus.OK, reset_progress(module))
            return

        block = str(payload.get("block", "")).strip()
        if not BLOCK_ID.match(block):
            raise ValueError("block must look like ch01-b07.")
        try:
            score = int(payload.get("score"))
            total = int(payload.get("total"))
        except (TypeError, ValueError):
            raise ValueError("score and total must be whole numbers.")
        if total <= 0 or score < 0 or score > total:
            raise ValueError("score must be between 0 and total, and total must be positive.")
        source = str(payload.get("source", "written")).strip()[:16] or "written"

        if score != total:
            # Not an error -- an honest "not yet". Return the unchanged store so
            # the page can repaint from one shape either way.
            self.send_json(HTTPStatus.OK, {**read_progress(module), "marked": False})
            return
        self.send_json(HTTPStatus.OK, {**mark_block_complete(module, block, score, total, source), "marked": True})

    def do_POST(self) -> None:
        route = self.path.split("?", 1)[0]
        if route not in ("/api/quiz", "/api/quiz/fresh", "/api/ask", "/api/exercise/grade",
                         "/api/settings", "/api/progress", "/api/book/rename"):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown API route."})
            return
        if not self.same_origin():
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "Cross-origin requests are not allowed."})
            return

        if route == "/api/progress":
            try:
                self.save_progress()
            except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        if route == "/api/book/rename":
            try:
                self.rename_book()
            except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        if route == "/api/settings":
            if not self.admin_ok():
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "A valid admin token is required."})
                return
            try:
                self.save_settings()
            except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        config = ProviderConfig.from_environment()
        if config is None:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "The AI quiz provider is not configured."})
            return
        general = read_general_settings()
        if general["require_access_token"] and config.access_token:
            if not secrets.compare_digest(self.headers.get("X-Edu-Quiz-Token", ""), config.access_token):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "A valid generation access token is required."})
                return
        if route == "/api/ask":
            # Its own budget: asking a follow-up is a normal part of reading, so it
            # must not burn the hourly quiz allowance.
            moment = time.monotonic()
            asked = ASK_HISTORY[self.client_address[0]]
            while asked and asked[0] <= moment - ASK_RATE_LIMIT_SECONDS:
                asked.popleft()
            if len(asked) >= ASK_RATE_LIMIT_REQUESTS:
                self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many questions just now. Try again shortly."})
                return
            try:
                payload = read_json(self)
                book = str(payload.get("module") or DEFAULT_MODULE)
                chapter, block = int(payload.get("chapter")), int(payload.get("block"))
                question = str(payload.get("question") or "").strip()
                if not question:
                    raise ValueError("Ask a question first.")
                if len(question) > ASK_MAX_QUESTION:
                    raise ValueError(f"Keep the question under {ASK_MAX_QUESTION} characters.")
                if chapter < 1 or block < 1:
                    raise ValueError("Chapter or lesson is invalid.")
                turns: list[dict[str, str]] = []
                for entry in (payload.get("history") or [])[-ASK_HISTORY_TURNS:]:
                    role = str((entry or {}).get("role") or "")
                    text = str((entry or {}).get("content") or "").strip()
                    if role in ("user", "assistant") and text:
                        turns.append({"role": role, "content": text[:2_000]})
                chapter_title, lesson = source_for_block(self.root, chapter, block, book)
                module = load_module(self.root, book)
                term = module["tutorialData"]["sections"][chapter - 1]["items"][block - 1].get("term", "")
                module_id = module_id_for(module)
                excerpts = book_search(module_id, f"{question} {term}", chapter=chapter)
                # The figures and equations printed in THIS lesson. Always sent as
                # text (layer 1); the pictures themselves only on the tight trigger.
                visuals = block_visuals(module, chapter, block)
            except (ValueError, TypeError, IndexError, KeyError, AttributeError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            images: list[tuple[str, bytes]] = []
            wanted, vision_reason = ask_wants_image(question, visuals)
            # A vision ask costs ASK_VISION_COST slots of this reader's ask budget,
            # and it is only taken when the budget can pay for it in full. Short of
            # headroom, the ask still answers from text -- degraded, never silent.
            if wanted and len(asked) + ASK_VISION_COST <= ASK_RATE_LIMIT_REQUESTS:
                for figure in wanted:
                    raw = figure_bytes(module_id, str(figure.get("asset") or ""))
                    if raw:
                        images.append((str(figure.get("title") or figure.get("asset")), raw))
            asked.append(moment)
            if images:
                for _ in range(ASK_VISION_COST - 1):
                    asked.append(moment)
            # 23-09-26 (user ruling): the tutor has its OWN 9router combo. EDU_TUTOR_MODEL
            # (provider.env, loaded at startup) when set, else EDU_QUIZ_MODEL as before.
            # Quiz generation, fresh quiz and grading keep EDU_QUIZ_MODEL.
            tutor_model = os.getenv("EDU_TUTOR_MODEL", "").strip()
            if tutor_model:
                config = dataclasses.replace(config, model=tutor_model)
            try:
                reply = ask_tutor(config, chapter_title, term, lesson, question, turns, excerpts,
                                  visuals=visuals, images=images)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                return
            # FIX 3 (22-09-26): say how the answer was got. `vision`/`figures`
            # are already on the reply and already logged, but the page renders
            # only `answer`, so this is the one place the reader can see it.
            # "none" | "described" | "vision" -- see ask_wants_image(). Logged so
            # the backfill can be judged by use: a block whose figure questions
            # stop escalating is a description that worked.
            reply["visionReason"] = vision_reason
            notice = ask_notice(vision_reason, images)
            if notice:
                reply["notice"] = notice
                reply["answer"] = f"{notice}\n\n{reply.get('answer') or ''}".strip()
            self.send_json(HTTPStatus.OK, reply)
            log_ask(book, chapter, block, term, question, reply)
            return

        if route == "/api/exercise/grade":
            # Its own budget, like /api/ask: finishing a chapter's exercises must
            # not eat the hourly quiz-generation allowance.
            moment = time.monotonic()
            graded = EXERCISE_HISTORY[self.client_address[0]]
            while graded and graded[0] <= moment - EXERCISE_RATE_LIMIT_SECONDS:
                graded.popleft()
            if len(graded) >= EXERCISE_RATE_LIMIT_REQUESTS:
                self.send_json(HTTPStatus.TOO_MANY_REQUESTS,
                               {"error": "Too many submissions just now. Try again shortly, or switch to multiple choice."})
                return
            try:
                payload = read_json(self, EXERCISE_MAX_REQUEST_BYTES)
                book = str(payload.get("module") or DEFAULT_MODULE)
                chapter = int(payload.get("chapter"))
                if chapter < 1:
                    raise ValueError("Chapter is invalid.")
                submitted = payload.get("answers")
                if not isinstance(submitted, list) or not submitted:
                    raise ValueError("Answer at least one exercise first.")
                if len(submitted) > EXERCISE_MAX_ITEMS:
                    raise ValueError(f"At most {EXERCISE_MAX_ITEMS} exercises can be marked at once.")
                answers: list[dict[str, Any]] = []
                for entry in submitted:
                    n = int((entry or {}).get("n"))
                    question = str((entry or {}).get("question") or "").strip()
                    answer = str((entry or {}).get("answer") or "").strip()
                    if not question:
                        raise ValueError("An exercise arrived without its question.")
                    answers.append({"n": n, "question": question[:800], "answer": answer[:EXERCISE_MAX_ANSWER]})
                module = load_module(self.root, book)
                section = module["tutorialData"]["sections"][chapter - 1]
                chapter_title = str(section.get("title") or f"Chapter {chapter}")
                # Retrieve on the questions, not on the reader's answers: a wrong
                # answer must not drag the excerpts away from what the exercise is
                # actually about.
                query = " ".join(item["question"] for item in answers)
                excerpts = book_search(module_id_for(module), query, limit=EXERCISE_BOOK_PAGES, chapter=chapter)
            except (ValueError, TypeError, IndexError, KeyError, AttributeError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            graded.append(moment)
            try:
                results = grade_exercises(config, chapter_title, answers, excerpts)
            except ValueError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                return
            correct = sum(1 for r in results if r["verdict"] == "correct")
            self.send_json(HTTPStatus.OK, {"results": results, "correct": correct, "total": len(results),
                                           "pages": [e["page"] for e in excerpts]})
            return

        now = time.monotonic()
        history = REQUEST_HISTORY[self.client_address[0]]
        while history and history[0] <= now - RATE_LIMIT_SECONDS:
            history.popleft()
        if len(history) >= RATE_LIMIT_REQUESTS:
            self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Generation limit reached. Try again later."})
            return
        if route == "/api/quiz/fresh":
            try:
                payload = read_json(self)
                book = str(payload.get("module") or DEFAULT_MODULE)
                # load_module(), not module_path(): module_path only knows data/<file>,
                # so a PACKAGED book failed this existence check and Generate Quiz
                # answered "Unknown book." for a book it was happily displaying.
                load_module(self.root, book)
                count = int(payload.get("count", general["fresh_quiz_size"]))
                if not MIN_FRESH_QUESTIONS <= count <= MAX_FRESH_QUESTIONS:
                    raise ValueError(f"A fresh quiz must have between {MIN_FRESH_QUESTIONS} and {MAX_FRESH_QUESTIONS} questions.")
                blocks = None
                if payload.get("blocks") is not None:
                    raw = payload["blocks"]
                    valid = set(all_theory_blocks(self.root, book))
                    if not isinstance(raw, list) or not raw or len(raw) > len(valid):
                        raise ValueError("Blocks must be a non-empty list.")
                    blocks = {(int(pair[0]), int(pair[1])) for pair in raw}
                    if not blocks <= valid:
                        raise ValueError("A selected block does not exist.")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            # One fresh quiz is one learner action, so it takes one rate-limit slot
            # even though it fans out into several provider calls.
            history.append(now)
            questions, errors = fresh_questions(config, self.root, count, blocks, book)
            if not questions:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"error": errors[0] if errors else "The model returned no questions."})
                return
            self.send_json(HTTPStatus.OK, {"questions": questions, "requested": count, "failed_calls": len(errors)})
            return

        try:
            payload = read_json(self)
            book = str(payload.get("module") or DEFAULT_MODULE)
            chapter, block = int(payload.get("chapter")), int(payload.get("block"))
            count = int(payload.get("count", general["ai_question_count"]))
            if chapter < 1 or block < 1 or not 3 <= count <= MAX_QUESTIONS:
                raise ValueError("Chapter, block, or question count is invalid.")
            chapter_title, source = source_for_block(self.root, chapter, block, book)
            questions = provider_questions(config, chapter_title, source, count)
        except (ValueError, IndexError, KeyError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        history.append(now)
        self.send_json(HTTPStatus.OK, {"questions": questions})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", default=8767, type=int)
    parser.add_argument("--directory", default=Path(__file__).parent)
    args = parser.parse_args()
    handler = lambda *values, **kwargs: EduHandler(*values, directory=str(args.directory), **kwargs)
    ThreadingHTTPServer((args.bind, args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
