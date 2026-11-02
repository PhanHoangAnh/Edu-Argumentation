"""Book and lesson index for Lab — READ-ONLY.

Lab lists every lesson that has code, in every book the study app serves:
  * packaged books  EDU_LIBRARY_DIR/<moduleId>/module.json   (book id = folder name)
  * legacy books    EDU_LEGACY_DATA_DIR/*.json                (book id = moduleIdFor rule)
Same enumeration as app/backend/content.py list_packaged_books / list_data_books
(test_* fixtures skipped). Files are opened "rb" and never written; Lab holds no lock
because it only reads (the chapter agents write module.json under flock, atomically).

Cache: one parsed entry per file, keyed on (mtime_ns, size). A file that fails to parse
keeps its LAST GOOD entry, so a half-written book never empties the Lab list.

⛔ THE ONE D5 DEFINITION ("does this lesson have code, and what is it"). It is mirrored,
   rule for rule, in app/frontend/src/reader/labCode.ts (the reader's Lab button). If you
   change one, change the other — gate T2-xref proves they agree.
   For each lesson (item; a plain-string item is normalised to
   {term: "Point N", blocks: [{type: "text", content: item}]} exactly like the reader's
   blocksOfChapter):
     1. the first `card` block whose title starts with "Full script": the bodies of its
        ``` fences joined with a blank line (no fence -> the card text itself);
     2. else every `code_cells` BLOCK's non-empty cell sources, in order, joined with a
        blank line (code_cells is a block type, not an item field);
     3. else every ```python fence found in `text` and `card` blocks, joined with a
        blank line.
   Whitespace-only code counts as no code. Lessons without code are not listed; a book
   with no code lesson at all is not listed.
"""

from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

LIBRARY_DIR = Path(os.environ.get("EDU_LIBRARY_DIR", "/home/ubuntu/foxai-data/edu-argumentation/library"))
LEGACY_DATA_DIR = Path(os.environ.get("EDU_LEGACY_DATA_DIR", "/srv/foxai/edu-study/web/data"))

MODULE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
LESSON_ID = re.compile(r"^ch\d{2}-b\d{2}$")
FENCE_ANY = re.compile(r"```[^\n]*\n(.*?)```", re.S)
FENCE_PY = re.compile(r"```python[^\n]*\n(.*?)```", re.S)
FULL_SCRIPT_PREFIX = "Full script"


# --------------------------------------------------------------------------- D5
def normalise_item(item: Any, index: int) -> dict[str, Any] | None:
    """reader blocksOfChapter: a string item becomes one text block titled 'Point N'."""
    if isinstance(item, str):
        return {"term": f"Point {index + 1}", "blocks": [{"type": "text", "content": item}]}
    if isinstance(item, dict):
        return item
    return None


def _blocks(item: dict[str, Any]) -> list[dict[str, Any]]:
    blocks = item.get("blocks")
    if not isinstance(blocks, list):
        return []
    return [b for b in blocks if isinstance(b, dict)]


def _join(parts: list[str]) -> str:
    return "\n\n".join(p.rstrip("\n") for p in parts)


def lesson_code(item: dict[str, Any]) -> tuple[str, str] | None:
    """(code, source) or None. source is 'full-script' | 'code_cells' | 'fenced'."""
    blocks = _blocks(item)
    for block in blocks:
        title = block.get("title")
        if block.get("type") == "card" and isinstance(title, str) and title.startswith(FULL_SCRIPT_PREFIX):
            content = block.get("content")
            if isinstance(content, str):
                bodies = FENCE_ANY.findall(content)
                code = _join(bodies) if bodies else content.strip()
                if code.strip():
                    return code, "full-script"
            break  # only the FIRST Full-script card counts
    cells: list[str] = []
    for block in blocks:
        if block.get("type") != "code_cells" or not isinstance(block.get("cells"), list):
            continue
        for cell in block["cells"]:
            source = cell.get("source") if isinstance(cell, dict) else None
            if isinstance(source, str) and source.strip():
                cells.append(source)
    if cells:
        return _join(cells), "code_cells"
    fenced: list[str] = []
    for block in blocks:
        content = block.get("content")
        if block.get("type") in ("text", "card") and isinstance(content, str):
            fenced.extend(body for body in FENCE_PY.findall(content) if body.strip())
    if fenced:
        return _join(fenced), "fenced"
    return None


def legacy_module_id(data: dict[str, Any], file_name: str) -> str:
    """app/frontend/src/data/bookPaths.ts moduleIdFor(payload, bookFile) — the id the reader
    uses for a legacy data/*.json book, so its Lab button would name the same book."""
    tutorial = data.get("tutorialData") if isinstance(data.get("tutorialData"), dict) else {}
    explicit = str(data.get("moduleId") or tutorial.get("moduleId") or "").strip().lower()
    if MODULE_ID.match(explicit):
        return explicit
    stem = re.sub(r"\.json$", "", file_name, flags=re.I).lower()
    stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")[:56]
    if len(stem) >= 2:
        return f"f-{stem}"
    return "module"


# --------------------------------------------------------------------------- index
@dataclass
class Lesson:
    id: str
    n: int
    title: str
    code: str | None
    source: str | None


@dataclass
class Book:
    id: str
    title: str
    chapters: list[dict[str, Any]] = field(default_factory=list)
    lessons: dict[str, Lesson] = field(default_factory=dict)   # every lesson, code or not

    @property
    def code_count(self) -> int:
        return sum(1 for lesson in self.lessons.values() if lesson.code)


def build_book(book_id: str, data: dict[str, Any]) -> Book | None:
    tutorial = data.get("tutorialData")
    sections = tutorial.get("sections") if isinstance(tutorial, dict) else None
    if not isinstance(sections, list):
        return None
    book = Book(id=book_id, title=str(tutorial.get("title") or book_id))
    for c_index, section in enumerate(sections):
        if not isinstance(section, dict):
            continue
        items = section.get("items") if isinstance(section.get("items"), list) else []
        listed: list[dict[str, Any]] = []
        for b_index, raw in enumerate(items):
            item = normalise_item(raw, b_index)
            if item is None:
                continue
            lesson_id = f"ch{c_index + 1:02d}-b{b_index + 1:02d}"
            term = item.get("term")
            title = term if isinstance(term, str) and term.strip() else f"Theory block {b_index + 1}"
            found = lesson_code(item)
            lesson = Lesson(lesson_id, b_index + 1, title, found[0] if found else None, found[1] if found else None)
            book.lessons[lesson_id] = lesson
            if found:
                listed.append({"id": lesson_id, "n": lesson.n, "title": title, "source": lesson.source})
        if listed:
            book.chapters.append({"n": c_index + 1, "title": str(section.get("title") or f"Chapter {c_index + 1}"), "lessons": listed})
    return book


class Library:
    def __init__(self, library_dir: Path = LIBRARY_DIR, legacy_dir: Path = LEGACY_DATA_DIR) -> None:
        self.library_dir = library_dir
        self.legacy_dir = legacy_dir
        self._entries: dict[str, tuple[tuple[int, int], Book | None]] = {}
        self._lock = threading.Lock()

    def _files(self) -> list[tuple[str, Path, str]]:
        """(cache key, path, kind) in the study app's listing order: legacy first, then packaged."""
        found: list[tuple[str, Path, str]] = []
        if self.legacy_dir.is_dir():
            for path in sorted(self.legacy_dir.glob("*.json")):
                if not path.name.startswith("test_"):
                    found.append((f"legacy:{path.name}", path, "legacy"))
        if self.library_dir.is_dir():
            for folder in sorted(p for p in self.library_dir.iterdir() if p.is_dir()):
                if MODULE_ID.match(folder.name) and (folder / "module.json").is_file():
                    found.append((f"lib:{folder.name}", folder / "module.json", "lib"))
        return found

    def _load(self, key: str, path: Path, kind: str) -> Book | None:
        try:
            stat = path.stat()
        except OSError:
            return self._entries.get(key, ((0, 0), None))[1]
        stamp = (stat.st_mtime_ns, stat.st_size)
        cached = self._entries.get(key)
        if cached and cached[0] == stamp:
            return cached[1]
        try:
            with path.open("rb") as handle:
                data = json.loads(handle.read())
            if not isinstance(data, dict):
                raise ValueError("not a JSON object")
            book_id = path.parent.name if kind == "lib" else legacy_module_id(data, path.name)
            book = build_book(book_id, data)
        except (OSError, ValueError) as error:
            # keep the last good entry; a file mid-write or broken must not empty the list
            print(f"library: {path.name}: {type(error).__name__} — keeping last good index", flush=True)
            return cached[1] if cached else None
        self._entries[key] = (stamp, book)
        return book

    def books(self) -> list[Book]:
        with self._lock:
            out = [self._load(key, path, kind) for key, path, kind in self._files()]
        return [book for book in out if book is not None and book.code_count > 0]

    def book(self, book_id: str) -> Book | None:
        return next((b for b in self.books() if b.id == book_id), None)


def books_payload(books: list[Book]) -> list[dict[str, Any]]:
    return [{"id": b.id, "title": b.title, "chapters": b.chapters} for b in books]
