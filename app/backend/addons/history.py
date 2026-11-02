"""History + mastery add-on API — exam-recall-suite P2 (22-10-26). Read-only: two GET routes, no writes.

  GET /api/history?module=&filter=all|wrong|flagged&chapter=|domain=&cursor=&limit=
      -> {module, filter, items[], nextCursor|null, counts{all, wrong, flagged}, runs{runId: {answered, right}}}
  GET /api/mastery?module=
      -> {module, areaKind: "chapter"|"domain", exam{name}|null, window, minAnswers, target,
          areas[{id, name, chapters[], answered, right, pct|null, enough, lastAt|null, weight?}],
          nextUp{id, name, reason: "weakest"|"least-practised", answered, right, pct|null}|null, unassigned}

Item shapes and the rules (what counts, denominators, ties) are documented on store.history_page /
store.mastery_from_rows / store.pick_next_up (P2 block at the end of store.py).

An "area" is an exam domain when the book's module.json has a VALID optional `exam` block, else a chapter.
The book is read through ai.load_module (the app's mtime cache) — this module never writes module.json.

⛔ Signed-in: the session middleware refuses every non-public route before it reaches here; the account is
   ALWAYS the session's (core._account), never a query parameter.
⛔ GET only -> no core._gate / rate bucket (the P1 GET routes do the same).
⛔ `import main as core` and core.X at CALL time (the qna/rooms add-on rule).
"""
from __future__ import annotations

from http import HTTPStatus

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

import ai
import db
import main as core
import store

router = APIRouter()


def _spec(module: str) -> dict:
    """area_spec of one book; ValueError("Unknown book.") -> 400."""
    return store.area_spec(ai.load_module(None, module))


def _error(error: Exception) -> Response:
    if isinstance(error, db.StoreUnavailable):
        return core._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    return core._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


@router.get("/api/history")
def history_list(request: Request, module: str = Query(default=""), filter: str = Query(default="all"),
                 chapter: str = Query(default=""), domain: str = Query(default=""),
                 cursor: str = Query(default=""), limit: str = Query(default="")) -> Response:
    try:
        params = store.history_params(filter, chapter, domain, cursor, limit)
        key = store.module_key(module)
        spec = _spec(key) if params["domain"] is not None else None
        return core._json(HTTPStatus.OK, store.history_page(core._account(request).id, key, params, spec))
    except (db.StoreUnavailable, ValueError, TypeError) as error:
        return _error(error)


@router.get("/api/mastery")
def mastery_get(request: Request, module: str = Query(default="")) -> Response:
    try:
        key = store.module_key(module)
        return core._json(HTTPStatus.OK, store.mastery(core._account(request).id, key, _spec(key)))
    except (db.StoreUnavailable, ValueError, TypeError) as error:
        return _error(error)
