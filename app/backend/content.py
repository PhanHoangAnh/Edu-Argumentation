"""Book listing and GUARDED file resolution for the edu-study service (:8792).

edu-replatform Phase 03, slice D.

⛔ THE THREE CONTAINMENT RULES ARE NOT INTERCHANGEABLE (Phase 02 A4, measured).
   Applying one rule uniformly breaks book assets or widens the /assets/ allowlist:

     send_asset            edu_server.py:1042   PARENT EQUALITY   path.parent == ASSET_ROOT/<module>
     packaged_module_path  edu_server.py:338    PARENT EQUALITY   candidate.parent == book
     send_book             edu_server.py:1073   PREFIX            str(target).startswith(book + os.sep)

   ``send_book`` MUST be a prefix check because /book/<id>/assets/<file> is TWO levels deep.
   A parent-equality rule there would 404 every book figure.

⛔ THESE ARE NOT StaticFiles. StaticFiles serves ANYTHING beneath its root, which drops the
   ASSET_FILE allowlist — and ``import-report.json`` (233 KB of import internals) sits beside
   module.json in a library package. :8792 is UNAUTHENTICATED and ufw rule #1 blanket-allows
   192.168.100.0/24, so anything servable here is readable by the whole LAN.
   ⚠ Measured 21-09-26: import-report.json is present under
   ``openintro-statistics-2019-1045f2f5`` and ABSENT under ``geron-homl3``. Only the openintro
   module is a real gate for it — a 404 under geron-homl3 is a not-found, not a refusal.
   (This corrects main.py's and README's inherited "in every library package".)
"""

from __future__ import annotations

import json
import time
import shutil
import os
from pathlib import Path
from typing import Any

from settings import store_path
from store import (
    ASSET_FILE,
    DEFAULT_MODULE,
    MODULE_ID,
    MODULE_NAME,
    clean_title,
    module_key,
    recency_by_module,
    module_id_for,
    mtime,
    read_library_meta,
)


class NotAFile(Exception):
    """Resolution refused. Carries no path detail — the caller returns a flat 404."""


# --------------------------------------------------------------------------- resolution
def resolve_book_file(segments: list[str]) -> tuple[Path, str]:
    """/book/<moduleId>/module.json  or  /book/<moduleId>/assets/<fig-1-21.png>.

    ``segments`` is everything after /book/. PREFIX containment (two levels deep).
    """
    if not segments or not MODULE_ID.match(segments[0]):
        raise NotAFile
    book = (store_path("EDU_LIBRARY_ROOT") / segments[0]).resolve()
    if len(segments) == 2 and segments[1] == "module.json":
        target, ctype = book / "module.json", "application/json; charset=utf-8"
    elif len(segments) == 3 and segments[1] == "assets" and ASSET_FILE.match(segments[2]):
        target, ctype = book / "assets" / segments[2], "image/png"
    else:
        # EVERYTHING ELSE under the book folder is refused by name, including
        # import-report.json. This is the allowlist; there is no fallthrough.
        raise NotAFile
    target = target.resolve()
    if not str(target).startswith(str(book) + os.sep) or not target.is_file():
        raise NotAFile
    return target, ctype


def resolve_asset_file(module: str, name: str) -> Path:
    """/assets/<moduleId>/<fig-10-3.png>. PARENT EQUALITY containment."""
    if not MODULE_ID.match(module) or not ASSET_FILE.match(name):
        raise NotAFile
    root = store_path("EDU_ASSET_ROOT")
    path = (root / module / name).resolve()
    if path.parent != (root / module).resolve() or not path.is_file():
        raise NotAFile
    return path


def packaged_module_path(name: str | None) -> Path | None:
    """library/<moduleId>/module.json, or None. PARENT EQUALITY containment."""
    if not name or not MODULE_ID.match(name):
        return None
    root = store_path("EDU_LIBRARY_ROOT")
    candidate = (root / name / "module.json").resolve()
    if candidate.parent != (root / name).resolve() or not candidate.is_file():
        return None
    return candidate


def resolve_data_module(name: str | None) -> Path:
    """A legacy book is a JSON module in <web>/data/. Fixtures are not books."""
    from main import WEB_ROOT  # local import: WEB_ROOT is main's layout fact, not a store path

    name = name or DEFAULT_MODULE
    data_dir = (WEB_ROOT / "data").resolve()
    path = (data_dir / name).resolve()
    if (
        not MODULE_NAME.fullmatch(name)
        or name.startswith("test_")
        or path.parent != data_dir
        or not path.is_file()
    ):
        raise NotAFile
    return path


# --------------------------------------------------------------------------- listing
def _decorate(entry: dict[str, Any], source: Path, titles: dict[str, Any], recency: dict[str, float] | None = None) -> dict[str, Any]:
    override = clean_title(titles.get(entry["file"]))
    if override:
        entry["title"] = override
        entry["renamed"] = True
    entry["addedAt"] = mtime(source)
    entry["lastReadAt"] = (recency or {}).get(module_key(entry["moduleId"]), 0.0)   # per ACCOUNT (Phase 06a)
    return entry


def _shape(data: dict[str, Any]) -> tuple[dict[str, Any], list[Any]] | None:
    tutorial = data.get("tutorialData")
    sections = tutorial.get("sections") if isinstance(tutorial, dict) else None
    if not isinstance(sections, list) or not isinstance(data.get("quizData"), list):
        return None
    return tutorial, sections


def list_packaged_books(recency: dict[str, float] | None = None) -> list[dict[str, Any]]:
    """Books in library/<moduleId>/. ``base`` tells the page where this book's own assets
    live, so its ``src`` values stay relative to the BOOK rather than to us."""
    out: list[dict[str, Any]] = []
    titles = read_library_meta()["titles"]
    root = store_path("EDU_LIBRARY_ROOT")
    if not root.is_dir():
        return out
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        if not MODULE_ID.match(folder.name):
            continue
        try:
            data = json.loads((folder / "module.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        shaped = _shape(data) if isinstance(data, dict) else None
        if shaped is None:
            continue
        tutorial, sections = shaped
        out.append(_decorate({
            # The folder name doubles as ``file`` so every existing library code path
            # (progress key, card click, "is this the open book") keeps working unchanged;
            # ``book`` is what marks it packaged.
            "file": folder.name,
            "book": folder.name,
            "base": f"book/{folder.name}/",
            "moduleId": module_id_for(data),
            "title": str(tutorial.get("title") or folder.name),
            "chapters": len(sections),
            "lessons": sum(len(s.get("items") or []) for s in sections if isinstance(s, dict)),
            "questions": len(data["quizData"]),
            "default": folder.name == DEFAULT_MODULE,
        }, folder, titles, recency))
    return out


def delete_packaged_book(folder_name: str) -> str:
    """SOFT delete (user, 25-09-26; owner only — enforced by the route): move library/<id>/ to
    <data>/deleted/<id>-<UTC stamp>/library. Restorable by moving it back. Reading progress in the
    database is keyed by the id and is left alone, so a restore brings it back too.
    Only a PACKAGED book: a legacy data/*.json book lives in the rsync'd deploy tree and would
    simply come back on the next deploy. The default book is refused."""
    if folder_name == DEFAULT_MODULE:
        raise ValueError("The default book cannot be deleted.")
    root = store_path("EDU_LIBRARY_ROOT")
    if not MODULE_ID.match(folder_name):
        raise ValueError("Unknown book.")
    book = (root / folder_name).resolve()
    if book.parent != root.resolve() or not (book / "module.json").is_file():
        raise ValueError("Unknown book.")
    target = root.parent / "deleted" / f"{folder_name}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    target.mkdir(parents=True)
    shutil.move(str(book), str(target / "library"))
    # ⚑ 25-09-26 (user): the importer's copy goes too — its modules/<name>.json (+ .report.json)
    #   and the legacy assets/<id>/ — so the book leaves "Modules on this server" as well.
    #   Matched by the SAME id rule the package was written with (module_id_for).
    modules = root.parent / "modules"
    if modules.is_dir():
        for path in sorted(modules.glob("*.json")):
            if path.name.endswith(".report.json"):
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(data, dict) and module_id_for(data) == folder_name:
                (target / "modules").mkdir(exist_ok=True)
                for item in (path, path.with_suffix(".report.json")):
                    if item.exists():
                        shutil.move(str(item), str(target / "modules" / item.name))
    assets = root.parent / "assets" / folder_name
    if assets.is_dir():
        shutil.move(str(assets), str(target / "assets"))
    return target.name


def list_data_books(recency: dict[str, float] | None = None) -> list[dict[str, Any]]:
    """The legacy data/*.json shape. Still serves; it is not the packaged shape."""
    from main import WEB_ROOT

    out: list[dict[str, Any]] = []
    titles = read_library_meta()["titles"]
    data_dir = WEB_ROOT / "data"
    if not data_dir.is_dir():
        return out
    for path in sorted(data_dir.glob("*.json")):
        if path.name.startswith("test_"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        shaped = _shape(data) if isinstance(data, dict) else None
        if shaped is None:
            continue
        tutorial, sections = shaped
        out.append(_decorate({
            "file": path.name,
            "moduleId": module_id_for(data),
            "title": str(tutorial.get("title") or path.stem),
            "chapters": len(sections),
            "lessons": sum(len(s.get("items") or []) for s in sections if isinstance(s, dict)),
            "questions": len(data["quizData"]),
            "default": path.name == DEFAULT_MODULE,
        }, path, titles, recency))
    return out


def list_modules(account_id: int | None = None) -> list[dict[str, Any]]:
    """``account_id`` only orders the library by THAT reader's last activity; the book list itself
    is the same for everyone. None (e.g. the rename check) leaves lastReadAt at 0."""
    recency = recency_by_module(account_id) if account_id is not None else {}
    return list_data_books(recency) + list_packaged_books(recency)
