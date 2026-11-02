"""What the tutor reads besides the lesson: the whole current chapter + the rest of the book.

The importer (:8769) writes library/<moduleId>/book-index.sqlite (SQLite FTS5, stdlib). This
module only READS it (plan tutor-book-index_30-09-26):

  · the WHOLE current chapter, capped at CHAPTER_CAP_TOKENS (chars/4). A chapter over the cap
    keeps its first pages and is labelled "TRIMMED" -- the index covers the rest;
  · the top SEARCH_HITS matches from OTHER chapters (the current one is already in context);
  · every chunk carries a bracket label -- [ch4, p.196] or [ch4, lesson 3 "term"] -- which the
    tutor is told to cite. p. = the 1-based PDF page, what a PDF viewer shows.

ask_context() is THE selector. It returns ("legacy", excerpts) -- exactly today's
ai.book_search call -- when: EDU_ASK_CONTEXT=legacy (the kill switch, a systemd drop-in), no
index file, schema_version != 1, the chapter is not in the index, or ANY sqlite3 error. It never
raises from the index path: a broken index degrades to today's answer, never to a 500.

⛔ Read-only by construction: a fresh `file:...?mode=ro` connection per call, closed after (a
   connection shared across FastAPI's threadpool raises ProgrammingError). This module never
   imports importer code and never writes under library/.
⛔ Question text never reaches MATCH raw: only [a-z0-9]+ tokens (len > 2, not stopwords), each
   double-quoted, OR-joined. FTS5 query syntax ("NEAR(", "*", a lone quote) is a sqlite3 error.
"""

from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Any

import ai
from settings import store_path
from store import MODULE_ID

# The app keeps its own copy of the schema version; importer code is never imported here (E8).
SCHEMA_VERSION = 1
INDEX_NAME = "book-index.sqlite"
LIBRARY_ROOT = store_path("EDU_LIBRARY_ROOT")
CHAPTER_CAP_TOKENS = 48_000          # D2: chars/4; Géron's largest chapter (19) is ~41.9k
SEARCH_HITS = 4                      # D3
SNIPPET_CHARS = ai.ASK_EXCERPT_CHARS  # 1,100, the legacy excerpt size


def mode() -> str:
    """'legacy' only when the kill switch is set; anything else means the index (U1)."""
    return "legacy" if os.getenv("EDU_ASK_CONTEXT", "").strip().lower() == "legacy" else "index"


def index_path(module_id: str) -> Path | None:
    if not MODULE_ID.match(module_id or ""):
        return None
    root = Path(LIBRARY_ROOT)
    book = (root / module_id).resolve()
    if book.parent != root.resolve():
        return None
    target = book / INDEX_NAME
    return target if target.is_file() else None


def open_index(module_id: str) -> sqlite3.Connection | None:
    """A fresh read-only connection, or None when there is no usable index."""
    path = index_path(module_id)
    if path is None:
        return None
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        if not row or str(row[0]) != str(SCHEMA_VERSION):
            conn.close()
            return None
    except sqlite3.Error:
        conn.close()
        raise
    return conn


def label(chapter: int, page: int | None, lesson: int | None = None, term: str = "") -> str:
    if page is not None:
        return f"[ch{chapter}, p.{page}]"
    return f'[ch{chapter}, lesson {lesson} "{term}"]' if term else f"[ch{chapter}, lesson {lesson}]"


def match_query(text: str) -> str:
    """FTS5 MATCH string from safe tokens only. '' = no hits."""
    tokens = []
    for word in re.findall(r"[a-z0-9]+", str(text).lower()):
        if len(word) > 2 and word not in ai.ASK_STOPWORDS and word not in tokens:
            tokens.append(word)
    return " OR ".join(f'"{t}"' for t in tokens[:64])


def chapter_context(conn: sqlite3.Connection, chapter: int) -> dict[str, Any] | None:
    """The whole chapter as one labelled block, capped at CHAPTER_CAP_TOKENS.

    Lessons carry no page, so there is no page hint to centre on: an over-cap chapter keeps
    its FIRST pages (or lessons) and says so in its header."""
    row = conn.execute("SELECT title, first_page, last_page FROM chapters WHERE chapter = ?", (chapter,)).fetchone()
    if row is None:
        return None
    title, first, last = row
    cap = CHAPTER_CAP_TOKENS * 4
    if first is not None:
        docs = conn.execute("SELECT page, text FROM docs WHERE kind = 'page' AND chapter = ? ORDER BY page",
                            (chapter,)).fetchall()
        chunks = [(page, f"{label(chapter, page)}\n{text.strip()}") for page, text in docs]
    else:
        docs = conn.execute("SELECT lesson, term, text FROM docs WHERE kind = 'lesson' AND chapter = ? ORDER BY lesson",
                            (chapter,)).fetchall()
        chunks = [(lesson, f"{label(chapter, None, lesson, term)}\n{text.strip()}") for lesson, term, text in docs]
    if not chunks:
        return None
    kept: list[str] = []
    used = 0
    for _key, chunk in chunks:
        if used + len(chunk) + 2 > cap and kept:
            break
        kept.append(chunk[:cap] if not kept else chunk)
        used += len(kept[-1]) + 2
    trimmed = len(kept) < len(chunks)
    unit = "pages" if first is not None else "lessons"
    span_all = f"{chunks[0][0]}–{chunks[-1][0]}"
    span_kept = f"{chunks[0][0]}–{chunks[len(kept) - 1][0]}"
    if trimmed:
        header = (f"THE CURRENT CHAPTER (TRIMMED: {unit} {span_kept} of {span_all}) [ch{chapter}] {title}\n"
                  "Only the first part of this chapter fits here; the excerpts below cover the rest of the book.")
    elif first is not None:
        header = f"THE WHOLE CHAPTER [ch{chapter}, pp. {span_all}] {title}"
    else:
        header = f"THE WHOLE CHAPTER [ch{chapter}, lessons {span_all}] {title}"
    text = "\n\n".join(kept)
    return {"chapter": chapter, "header": header, "text": text, "trimmed": trimmed,
            "tokens": (len(header) + len(text)) // 4}


def search_other(conn: sqlite3.Connection, query: str, chapter: int, k: int = SEARCH_HITS) -> list[dict[str, Any]]:
    """Top-k bm25 matches outside the current chapter and outside the book body (chapter 0)."""
    expression = match_query(query)
    if not expression:
        return []
    rows = conn.execute(
        "SELECT d.kind, d.chapter, d.lesson, d.page, d.term, d.text "
        "FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid "
        "WHERE docs_fts MATCH ? AND d.chapter > 0 AND d.chapter != ? "
        "ORDER BY bm25(docs_fts), CASE d.kind WHEN 'page' THEN 0 ELSE 1 END, d.id LIMIT ?",
        (expression, chapter, k)).fetchall()
    words = [t.strip('"') for t in expression.split(" OR ")]
    out = []
    for kind, ch, lesson, page, term, text in rows:
        low = text.lower()
        first = min((low.find(w) for w in words if w in low), default=0)
        start = max(0, first - SNIPPET_CHARS // 3)
        out.append({"label": label(ch, page, lesson, term), "chapter": ch, "page": page, "lesson": lesson,
                    "kind": kind, "text": " ".join(text[start:start + SNIPPET_CHARS].split())})
    return out


def ask_context(module_id: str, question: str, term: str, chapter: int):
    """("index", chapter_block, hits) or ("legacy", excerpts). See the module docstring."""
    if mode() == "index":
        conn = None
        try:
            conn = open_index(module_id)
            if conn is not None:
                block = chapter_context(conn, chapter)
                if block is not None:
                    return "index", block, search_other(conn, f"{question} {term}", chapter)
        except Exception:  # noqa: BLE001 - sqlite3.Error above all; any index fault -> today's answer
            pass
        finally:
            if conn is not None:
                conn.close()
    return "legacy", ai.book_search(module_id, f"{question} {term}", chapter=chapter)


def tutor_reply(config, context, chapter_title: str, term: str, lesson: str, question: str,
                turns: list[dict[str, str]], visuals, images, block: int | None = None) -> dict[str, Any]:
    """The one call site of ai.ask_tutor for /api/ask. The legacy branch passes exactly the
    arguments the route has always passed, so its request body is byte-identical (gate G6)."""
    if context[0] == "legacy":
        return ai.ask_tutor(config, chapter_title, term, lesson, question, turns, context[1],
                            visuals=visuals, images=images)
    chapter_block = dict(context[1])
    if block:
        chapter_block["lesson_label"] = label(chapter_block["chapter"], None, block, term)
    return ai.ask_tutor(config, chapter_title, term, lesson, question, turns, [],
                        visuals=visuals, images=images, chapter_block=chapter_block, hits=context[2])
