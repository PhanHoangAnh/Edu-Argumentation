"""FastAPI application for the edu-study stack on :8792.

Phase 02 of the edu-replatform program: the new stack stood up EMPTY. One API route
(/api/health) plus the built SPA. None of the legacy app's 15 routes are ported yet —
that is Phases 3-4, and gates/gate-routes.mjs burns the list down.

⛔ SINGLE WORKER. THREE independent causes, all of which must be removed before a second
   worker is ever correct (decision D-C1). A reader who sees only cause (a) will "fix" it
   and then wonder why counts still diverge:
     (a) [legacy only] save_settings mutates os.environ live  edu_server.py:1153-1154 —
         :8792 reads provider.env per call instead (D-P4-2), so (a) is gone here
     (b) THREE in-process rate-limit deques keyed on client IP (RUN_HISTORY left with the
         runner, ruling R24): REQUEST_HISTORY 20/3600s · ASK_HISTORY 60/600s ·
         EXERCISE_HISTORY 30/600s
     (c) THREE in-process caches   _MODULE_CACHE L314 · _BOOK_CACHE L59
                                   · _BOOK_DF / _BOOK_CHAPTERS L60-61
   Moving settings out of the environment buys ZERO concurrency, because (b) and (c)
   survive it untouched.

⛔ AI/PROVIDER HANDLERS MUST BE PLAIN ``def``, NEVER ``async def`` (plan C3). They block on
   urlopen with a 120 s timeout. Under ``async def`` that blocks the whole event loop and
   the service stops answering everything, including health. Under plain ``def`` FastAPI
   runs them in a threadpool, which is the behaviour we want. Phase 2 has no such handler;
   the rule is recorded here before the first one is written.

⛔ /book/ AND /assets/<moduleId>/ ARE CUSTOM FileResponse ROUTES, NEVER StaticFiles
   (plan C4, landed in Phase 03 slice D). StaticFiles serves anything beneath its root,
   which would drop the ASSET_FILE allowlist — import-report.json (233 KB of import
   internals) sits beside module.json and must stay non-servable. FileResponse also streams
   instead of reading a 5.4 MB asset into RAM.
   ⚠ CORRECTED 21-09-26 (measured): import-report.json is NOT "in every library package".
   It exists under openintro-statistics-2019-1045f2f5 and is ABSENT under geron-homl3, so
   only the openintro module is a real gate for it.

⛔ PHASE 04 WRITES (23-09-26). SEVEN POST routes (ruling R24 removed the three /api/run*) of the frozen contract are ported in the
   legacy's ORDER OF CHECKS (edu_server.py:do_POST): route allowlist -> same-origin ->
   progress -> rename -> settings -> provider configured -> access token -> ask /
   grade / quiz buckets -> body. A different order changes which error a caller sees, and a
   409-vs-429 difference is a behaviour change, not a refactor.
   Progress and titles are written to the SAME files :8767 uses (store.py, decision D-P4-1),
   under a lock, in the legacy byte format.
"""

from __future__ import annotations

import dataclasses
import ipaddress
import json
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from pathlib import Path
from typing import Any

from urllib.parse import quote

from fastapi import Depends, FastAPI, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

import ai
import bookctx
import auth
import content
import db
import store
from settings import (
    admin_token,
    current_env_values,
    model_for,
    provider_config,
    store_paths,
    valid_api_url,
    write_env_file,
)

PHASE = "phase-06a-accounts"

# The deployed tree is:
#   /srv/foxai/edu-study/backend/main.py   <- this file
#   /srv/foxai/edu-study/web/index.html    <- Vite build output, shipped prebuilt
#   /srv/foxai/edu-study/web/assets/*.js
#
# Resolved from __file__ rather than from an environment variable ON PURPOSE: the unit
# pins exactly seven EDU_* variables and exit gate G8 asserts that count, so an eighth
# would fail the gate. There is nothing to configure here — the layout is fixed by the
# deploy script.
WEB_ROOT = Path(__file__).resolve().parent.parent / "web"
SPA_INDEX = WEB_ROOT / "index.html"
SPA_ASSETS = WEB_ROOT / "assets"

app = FastAPI(
    title="FoxAI Edu Study",
    version="0.1.0",
    description="Phase 04: the fifteen legacy routes plus guarded file serving.",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


# ---------------------------------------------------------------------------
# ⚑ PHASE 06a — SIGN-IN IS REQUIRED FOR EVERYTHING EXCEPT FIVE THINGS (ruling R25).
# ---------------------------------------------------------------------------
# Public: the login page itself (/login), its Vite build assets (/assets/<one file> — hashed
# bundles, no data in them), the favicon, /api/health (the deploy gate's liveness probe; it echoes
# only the seven store PATHS), and the login POST. Everything else needs a live session:
#   · an API or data request without one      -> 401 JSON  (a fetch cannot follow a login page)
#   · a PAGE request without one              -> 302 /login?next=<the page>
# ⛔ Book files (/book/, /data/) and book figures (/assets/<moduleId>/<file>, TWO segments) are
#    DATA, not the login page's assets: they are behind sign-in like the API.
# ⛔ The :8769 importer is a different service and stays outside auth (R25) — nothing here reaches it.
PUBLIC_PATHS = {"/login", "/api/health", "/api/auth/login", "/favicon.svg"}
DATA_PREFIXES = ("/api/", "/book/", "/data/")


def _is_public(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    # /assets/index-XXXX.js — exactly one segment after /assets/. /assets/<module>/<fig> is data.
    return path.startswith("/assets/") and path.count("/") == 2


def _wants_json(request: Request) -> bool:
    path = request.url.path
    if request.method not in ("GET", "HEAD"):
        return True
    return path.startswith(DATA_PREFIXES) or (path.startswith("/assets/") and path.count("/") > 2)


# ⚑ 23-09-26 — PUBLIC ACCESS through nginx at https://160.30.252.66/ (report
#   public-ip-access_REPORT_23-09-26.md). nginx on the SAME host proxies to 127.0.0.1:8792 and sets
#   X-Real-IP / X-Forwarded-For / X-Forwarded-Proto. Those headers are believed ONLY when the TCP peer
#   is loopback — any other peer (the LAN/VPN door on 0.0.0.0:8792) sends them and is ignored.
#   Robust to uvicorn's own --proxy-headers (on by default, trusting 127.0.0.1): when uvicorn has
#   already rewritten the peer to the forwarded address, the peer is no longer loopback and is used
#   as-is; when it has not, the headers are read here. Either way an untrusted peer cannot spoof.
TRUSTED_PROXIES = frozenset({"127.0.0.1", "::1"})


def _valid_ip(value: str) -> str:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return ""


def client_ip(headers: Any, peer: str) -> str:
    """The client IP used for rate limiting and login throttling."""
    if peer in TRUSTED_PROXIES:
        real = _valid_ip(headers.get("X-Real-IP", ""))
        if not real:
            hops = [h for h in headers.get("X-Forwarded-For", "").split(",") if h.strip()]
            real = _valid_ip(hops[-1]) if hops else ""
        if real:
            return real
    return peer


def _via_https(request_scheme: str, headers: Any, peer: str) -> bool:
    """True when the browser spoke HTTPS: uvicorn already set the scheme from a trusted proxy, or
    the loopback proxy says so. X-Forwarded-Proto from any other peer is ignored."""
    if request_scheme == "https":
        return True
    return peer in TRUSTED_PROXIES and headers.get("X-Forwarded-Proto", "").strip().lower() == "https"


def _request_https(request: Request) -> bool:
    return _via_https(request.url.scheme, request.headers, request.client.host if request.client else "")


def _set_session_cookie(response: Response, token: str, secure: bool = False) -> None:
    """HttpOnly (no script can read it), SameSite=Lax (not sent on a cross-site POST), Path=/.
    Secure ONLY when the request reached us over HTTPS through the trusted local proxy: the plain
    HTTP VPN/LAN door on :8792 would otherwise never get the cookie back."""
    response.set_cookie(auth.COOKIE_NAME, token, max_age=auth.SESSION_DAYS * 86_400, path="/",
                        httponly=True, samesite="lax", secure=secure)


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(auth.COOKIE_NAME, path="/", httponly=True, samesite="lax")


# ⚑ 24-09-26 (user report: "i press the lab button, and it open the platform page"). The reader's
#   Lab button is a relative /lab/<book>/<lesson>. Through the public nginx (443) /lab/ is routed to
#   Lab and never reaches this app. On the VPN door http://<host>:8767 it DID reach this app, which
#   served its own SPA. So a /lab request that arrives here without the trusted proxy's HTTPS is sent
#   to Lab's own door on the same host, port 8798 — before sign-in, because Lab checks the session
#   itself (the host-scoped edu_session cookie travels to :8798; cookies ignore ports). The same
#   bounce finishes the sign-in round trip: Lab's direct door sends an anonymous page to
#   /login?next=/lab/..., and after sign-in the browser lands here and is bounced back to Lab.
LAB_PORT = 8798
_LAB_HOST = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")


# ⚑ 25-09-26: the importer (VPN door only, owner-gated) uses the same bounce: its sign-in redirect
#   sends ?next=/importer/, and after sign-in this sends the browser back to http://<host>:8769/.
IMPORTER_PORT = 8769


def _lab_redirect(request: Request) -> Response | None:
    path = request.url.path
    if path in ("/lab", "/importer") or path.startswith(("/lab/", "/importer/")):
        pass
    else:
        return None
    if request.method not in ("GET", "HEAD") or _request_https(request):
        return None
    host = request.headers.get("host", "").rsplit(":", 1)[0]
    if not _LAB_HOST.match(host):
        return None
    query = f"?{request.url.query}" if request.url.query else ""
    if path == "/importer" or path.startswith("/importer/"):
        return RedirectResponse(f"http://{host}:{IMPORTER_PORT}/", status_code=302, headers={"Cache-Control": "no-store"})
    rest = path[len("/lab"):].lstrip("/")
    target = f"http://{host}:{LAB_PORT}/lab/{rest}" + query
    return RedirectResponse(target, status_code=302, headers={"Cache-Control": "no-store"})


async def session_lookup(token: str | None) -> tuple[auth.Account | None, bool]:
    """THE session lookup — shared by require_session (HTTP) and the live-rooms WebSocket
    (study-rooms-qna P3; the middleware never runs for a WS scope). Off the event loop. May raise
    db.StoreUnavailable; each caller maps it (HTTP 503 / WS close 1011)."""
    return await run_in_threadpool(auth.session_account, token)


@app.middleware("http")
async def require_session(request: Request, call_next):
    path = request.url.path
    bounced = _lab_redirect(request)
    if bounced is not None:
        return bounced
    if _is_public(path):
        return await call_next(request)
    token = request.cookies.get(auth.COOKIE_NAME)
    try:
        account, refreshed = await session_lookup(token)
    except db.StoreUnavailable:
        return JSONResponse({"error": "The account store is unavailable. Try again shortly."},
                            status_code=503, headers={"Cache-Control": "no-store"})
    if account is None:
        if _wants_json(request):
            response: Response = JSONResponse({"error": "Sign in required."}, status_code=401,
                                              headers={"Cache-Control": "no-store"})
        else:
            target = path + (f"?{request.url.query}" if request.url.query else "")
            response = RedirectResponse(f"/login?next={quote(target, safe='')}", status_code=302)
        if token:
            _clear_session_cookie(response)       # a stale cookie is dropped, not re-sent forever
        return response
    request.state.account = account
    request.state.session_token = token
    response = await call_next(request)
    if refreshed and token:
        _set_session_cookie(response, token, _request_https(request))   # sliding 30-day expiry
    return response


def _account(request: Request) -> auth.Account:
    """The signed-in account. The middleware guarantees it for every non-public route."""
    return request.state.account


# ---------------------------------------------------------------------------
# API routes. Registered FIRST — see the mount-order note at the bottom.
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> Response:
    """Echo the seven RESOLVED store paths, and nothing else.

    ⛔ SEVEN, NEVER NINE. :8767's live process environment holds nine EDU_* variables, but
    only seven are paths — the other two are EDU_QUIZ_API_KEY (the 9router key) and
    EDU_RUNNER_KEY (the .68:8790 runner key), both LIVE SECRETS arriving via
    EnvironmentFile=. :8792 has no authentication and ufw rule #1 blanket-allows the whole
    LAN, so echoing nine would publish both keys to every host on 192.168.100.0/24.

    Status alone is not evidence: Phase 01 measured a wrong library root returning 200 with
    an empty list. The gate asserts CONTENT — key-set EQUALITY against the expected seven,
    which admits no extra key under any name.
    """
    return JSONResponse(
        {
            "status": "ok",
            "service": "foxai-edu-study",
            "phase": PHASE,
            "paths": store_paths(),
        }
    )


# ---------------------------------------------------------------------------
# Phase 03 slice D — the FIVE READ routes of the frozen 15-route contract.
# The remaining ten are POST and belong to Phase 04. Nothing here writes.
# ---------------------------------------------------------------------------
@app.get("/api/general")
def api_general() -> Response:
    """The three general settings. Defaults when the file is absent or corrupt."""
    return JSONResponse(store.read_general_settings())


@app.get("/api/modules")
def api_modules(request: Request) -> Response:
    """The library list: legacy data/*.json books first, then packaged library/<id>/ books.
    ⚑ Phase 06a: ``lastReadAt`` is the SIGNED-IN reader's, so each account's library is ordered
      by its own recent activity."""
    return JSONResponse({"books": content.list_modules(_account(request).id)})


@app.get("/api/progress")
def api_progress(request: Request, module: str = Query(default="")) -> Response:
    """Read one module's completed blocks FOR THE SIGNED-IN ACCOUNT (Phase 06a — PostgreSQL, not
    progress.json). An unknown/invalid module falls back to the legacy key, exactly as
    edu_server.py:module_key does — never a 400, so a stale bookmark degrades to the default book."""
    return _json(HTTPStatus.OK, store.read_progress(_account(request).id, store.module_key(module)))


def _admin_required() -> bool:
    return bool(admin_token())


def _admin_ok(request: Request) -> bool:
    """edu_server.py:admin_ok — OPEN unless EDU_ADMIN_TOKEN is set in provider.env."""
    expected = admin_token()
    if not expected:
        return True
    return secrets.compare_digest(request.headers.get("X-Edu-Admin-Token", ""), expected)


def _settings_payload() -> dict[str, Any]:
    """edu_server.py:settings_payload. ⛔ THE API KEY IS NEVER RETURNED, not even partially."""
    values = current_env_values()
    return {
        "api_url": values["EDU_QUIZ_API_URL"],
        "model": values["EDU_QUIZ_MODEL"],
        "json_mode": values["EDU_QUIZ_JSON_MODE"].lower() != "false",
        "api_key_set": bool(values["EDU_QUIZ_API_KEY"]),
        "access_token_set": bool(values["EDU_QUIZ_ACCESS_TOKEN"]),
        "ready": provider_config() is not None,
        "general": store.read_general_settings(),
        "admin_required": _admin_required(),
    }


@app.get("/api/provider")
def api_provider() -> Response:
    """Provider READINESS — never the credential (edu_server.py do_GET /api/provider).

    ⚑ Phase 04: real. provider.env is read from EDU_ENV_PATH per call (D-P4-2); the booleans
    and the model name leave this process, the key and the tokens never do.
    """
    config = provider_config()
    general = store.read_general_settings()
    return JSONResponse({
        "ready": config is not None,
        "model": config.model if config else None,
        "token_required": bool(general["require_access_token"] and config and config.access_token),
        "admin_required": _admin_required(),
    })


@app.get("/api/settings")
def api_settings(request: Request) -> Response:
    """The settings page payload. Gated by admin_ok() exactly like the legacy route."""
    if not _admin_ok(request):
        return _json(HTTPStatus.UNAUTHORIZED, {"error": "A valid admin token is required."})
    return _json(HTTPStatus.OK, _settings_payload())


# ---------------------------------------------------------------------------
# Phase 04 — THE TEN POST ROUTES.
# ---------------------------------------------------------------------------
MAX_REQUEST_BYTES = 8_192
# ⚑ RULING R24 (23-09-26): THE CODE RUNNER IS REMOVED. /api/run, /api/run/stop and
#   /api/run/reset-kernel are NOT ported (they were, earlier the same day, and were taken out):
#   code renders as a static listing with a Copy button, and practice moves to the local
#   geron-lab viewer. No RUN_HISTORY bucket, no 256 KB cap, no runner credential read.
#   A POST to any of the three is now the flat 404 below — gate W-NORUN asserts it.

# ⛔ THE FOUR BUCKETS ARE PER-PROCESS, keyed on client IP — one of the three reasons this
#    service must stay single-worker (see the module docstring). Each check-then-append runs
#    under one lock so two threads cannot both take the last slot.
RATE = {
    "quiz": (20, 3_600),       # REQUEST_HISTORY
    "ask": (60, 600),          # ASK_HISTORY
    "exercise": (30, 600),     # EXERCISE_HISTORY
}
_BUCKETS: dict[str, dict[str, deque[float]]] = {name: defaultdict(deque) for name in RATE}
_BUCKET_LOCK = threading.Lock()

# The largest body any route accepts (/api/exercise/grade, 96 KB), plus one byte so "too big" is
# still detectable. Read_json refuses anything over its route's cap on Content-Length anyway.
_BODY_CEILING = 96 * 1024 + 1


def _json(status: HTTPStatus, payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(payload, status_code=int(status), headers={"Cache-Control": "no-store"})


@dataclass
class Posted:
    """The request, reduced to what the legacy handlers read. Built by an ASYNC dependency so
    the handlers themselves stay plain ``def`` and run in the threadpool (plan C1)."""
    headers: Any
    client: str
    raw: bytes
    # ⚑ Phase 06a: the signed-in account (the middleware refuses the request before this exists
    #   otherwise), and the raw cookie token — needed only to spare the caller's own session on a
    #   password change.
    account: Any = None
    token: str | None = None
    https: bool = False

    def read_json(self, limit: int = MAX_REQUEST_BYTES) -> dict[str, Any]:
        """edu_server.py:read_json — Content-Length decides, exactly as the legacy does."""
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > limit:
            raise ValueError(f"Request body must be a JSON object smaller than {limit // 1024} KB.")
        payload = json.loads(self.raw[:length])
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload


async def posted(request: Request) -> Posted:
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) >= _BODY_CEILING:
            break                      # oversize: read_json refuses it on Content-Length anyway
    peer = request.client.host if request.client else ""
    return Posted(request.headers, client_ip(request.headers, peer), body,
                  getattr(request.state, "account", None), getattr(request.state, "session_token", None),
                  _via_https(request.url.scheme, request.headers, peer))


def origin_ok(headers: Any) -> bool:
    """THE same-origin rule, headers only — shared by _gate (every POST) and the live-rooms
    WebSocket (study-rooms-qna P3), which the HTTP middleware never sees. A MISSING Origin passes
    (browsers always send one on these requests; the session cookie is still required)."""
    origin = headers.get("Origin")
    return not origin or origin.split("//", 1)[-1].rstrip("/") == headers.get("Host", "")


def _same_origin(req: Posted) -> bool:
    return origin_ok(req.headers)


def _bucket_prune(name: str, client: str, now: float) -> deque[float]:
    limit, window = RATE[name]
    history = _BUCKETS[name][client]
    while history and history[0] <= now - window:
        history.popleft()
    return history


def _admin_ok_posted(req: Posted) -> bool:
    expected = admin_token()
    if not expected:
        return True
    return secrets.compare_digest(req.headers.get("X-Edu-Admin-Token", ""), expected)


def _gate(req: Posted) -> JSONResponse | None:
    """The two checks every POST passes first: same-origin (403)."""
    if not _same_origin(req):
        return _json(HTTPStatus.FORBIDDEN, {"error": "Cross-origin requests are not allowed."})
    return None


def _provider_gate(req: Posted):
    """provider configured (503) -> access token (401). Returns (config, general) or a response."""
    config = provider_config()
    if config is None:
        return _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "The AI quiz provider is not configured."})
    general = store.read_general_settings()
    if general["require_access_token"] and config.access_token:
        if not secrets.compare_digest(req.headers.get("X-Edu-Quiz-Token", ""), config.access_token):
            return _json(HTTPStatus.UNAUTHORIZED, {"error": "A valid generation access token is required."})
    return config, general


def _routed(config, account: auth.Account, job: str):
    """⚑ 23-09-26 (user ruling): the SAME provider credentials, with the COMBO chosen by job
    ("tutor" = /api/ask, "arg" = quiz / fresh quiz / grading) and by the signed-in account's
    claude_access flag — read from the database with the session, never from the request body.
    Table and fallbacks: settings.model_for."""
    return dataclasses.replace(config, model=model_for(job, account.claude_access) or config.model)


# ---- progress (edu_server.py:save_progress) ----------------------------------------------
@app.post("/api/progress")
def api_progress_post(req: Posted = Depends(posted)) -> Response:
    """Record a completed block, or reset ONE module.

    A block counts only on a perfect score, re-checked here rather than trusting a flag from
    the page, so a stray client cannot mark a block it did not pass.
    """
    blocked = _gate(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json()
        module = store.module_key(payload.get("module"))
        account_id = req.account.id
        if payload.get("reset") is True:
            return _json(HTTPStatus.OK, store.reset_progress(account_id, module))
        block = str(payload.get("block", "")).strip()
        if not store.BLOCK_ID.match(block):
            raise ValueError("block must look like ch01-b07.")
        try:
            score = int(payload.get("score"))
            total = int(payload.get("total"))
        except (TypeError, ValueError):
            raise ValueError("score and total must be whole numbers.")
        if total <= 0 or score < 0 or score > total:
            raise ValueError("score must be between 0 and total, and total must be positive.")
        source = str(payload.get("source", "written")).strip()[:16] or "written"
        # ⚑ Phase 06a: every finished assessment's SCORE is kept (the Account page's recent
        #   attempts); right answers are not stored one by one (ruling R25).
        store.record_attempt(account_id, module, block, score, total, source)
        if score != total:
            # Not an error -- an honest "not yet". The unchanged store, so the page can repaint
            # from one shape either way.
            return _json(HTTPStatus.OK, {**store.read_progress(account_id, module), "marked": False})
        return _json(HTTPStatus.OK, {**store.mark_block_complete(account_id, module, block, score, total, source), "marked": True})
    except db.StoreUnavailable as error:
        return _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


# ---- rename (edu_server.py:rename_book) --------------------------------------------------
@app.post("/api/book/rename")
def api_book_rename(req: Posted = Depends(posted)) -> Response:
    """A reader-set title, kept in library-meta.json — module.json is never rewritten."""
    blocked = _gate(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json()
        file = str(payload.get("file") or "")
        title = store.clean_title(payload.get("title"))
        if not title:
            raise ValueError("A title is required.")
        # Only a book this server lists may be renamed, never an arbitrary key.
        if not any(book["file"] == file for book in content.list_modules()):
            raise ValueError("Unknown book.")
        store.set_book_title(file, title)
        return _json(HTTPStatus.OK, {"file": file, "title": title})
    except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


# ---- delete (25-09-26, user: OWNER ONLY, from the home page's selected book) -------------------
@app.post("/api/book/delete")
def api_book_delete(req: Posted = Depends(posted)) -> Response:
    """Soft-delete a packaged book (moved to deleted/, restorable). The importer has NO sign-in,
    so deleting lives HERE, behind the session and the owner flag — never on the importer."""
    blocked = _gate(req)
    if blocked:
        return blocked
    if not req.account.is_owner:
        return _json(HTTPStatus.FORBIDDEN, {"error": "Only the owner account can delete a book."})
    try:
        file = str(req.read_json().get("file") or "")
        book = next((b for b in content.list_modules() if b["file"] == file), None)
        if book is None or not book.get("book"):
            raise ValueError("Only an imported (packaged) book can be deleted.")
        moved_to = content.delete_packaged_book(str(book["book"]))
        print(f"book deleted by owner {req.account.username}: {book['book']} -> deleted/{moved_to}", flush=True)
        return _json(HTTPStatus.OK, {"deleted": book["book"], "movedTo": moved_to})
    except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


# ---- settings (edu_server.py:save_settings) ----------------------------------------------
MAX_QUESTIONS = 10
MIN_FRESH_QUESTIONS = 5
MAX_FRESH_QUESTIONS = 30


@app.post("/api/settings")
def api_settings_post(req: Posted = Depends(posted)) -> Response:
    """⛔ D-P4-2: writes provider.env + settings.json and does NOT touch os.environ — the next
    request re-reads the file, which is the legacy's "no restart needed" by a different route."""
    blocked = _gate(req)
    if blocked:
        return blocked
    # ⚑ Phase 06a (D-P6a-5b): the provider credentials are SHARED by every account, so only the
    #   owner may change them. Reading the page (booleans only) stays open to any signed-in reader.
    if not req.account.is_owner:
        return _json(HTTPStatus.FORBIDDEN, {"error": "Only the owner account can change these settings."})
    if not _admin_ok_posted(req):
        return _json(HTTPStatus.UNAUTHORIZED, {"error": "A valid admin token is required."})
    try:
        payload = req.read_json()
        values = current_env_values()
        general = store.read_general_settings()
        if "api_url" in payload:
            url = str(payload["api_url"]).strip()
            if url and not valid_api_url(url):
                raise ValueError("The endpoint must be https://, or http:// on localhost.")
            values["EDU_QUIZ_API_URL"] = url
        if "model" in payload:
            values["EDU_QUIZ_MODEL"] = str(payload["model"]).strip()
        if "json_mode" in payload:
            values["EDU_QUIZ_JSON_MODE"] = "true" if payload["json_mode"] else "false"
        # An omitted api_key keeps the stored one; an explicit empty string clears it.
        if "api_key" in payload:
            values["EDU_QUIZ_API_KEY"] = str(payload["api_key"]).strip()
        if "access_token" in payload:
            values["EDU_QUIZ_ACCESS_TOKEN"] = str(payload["access_token"]).strip()
        for key, low, high in (("ai_question_count", 3, MAX_QUESTIONS), ("fresh_quiz_size", MIN_FRESH_QUESTIONS, MAX_FRESH_QUESTIONS)):
            if key in payload:
                number = int(payload[key])
                if not low <= number <= high:
                    raise ValueError(f"{key.replace('_', ' ')} must be between {low} and {high}.")
                general[key] = number
        if "require_access_token" in payload:
            general["require_access_token"] = bool(payload["require_access_token"])
        write_env_file(values)
        store.write_atomic(store_paths_path("EDU_SETTINGS_PATH"), json.dumps(general, indent=2) + "\n")
        return _json(HTTPStatus.OK, _settings_payload())
    except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


def store_paths_path(name: str) -> Path:
    return Path(store_paths()[name])


# ---- ask (edu_server.py do_POST /api/ask) ------------------------------------------------
@app.post("/api/ask")
def api_ask(req: Posted = Depends(posted)) -> Response:
    blocked = _gate(req)
    if blocked:
        return blocked
    gated = _provider_gate(req)
    if isinstance(gated, JSONResponse):
        return gated
    config, _general = gated
    moment = time.monotonic()
    with _BUCKET_LOCK:
        asked = _bucket_prune("ask", req.client, moment)
        if len(asked) >= RATE["ask"][0]:
            return _json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many questions just now. Try again shortly."})
    try:
        payload = req.read_json()
        book = str(payload.get("module") or ai_default_module())
        chapter, block = int(payload.get("chapter")), int(payload.get("block"))
        question = str(payload.get("question") or "").strip()
        if not question:
            raise ValueError("Ask a question first.")
        if len(question) > ai.ASK_MAX_QUESTION:
            raise ValueError(f"Keep the question under {ai.ASK_MAX_QUESTION} characters.")
        if chapter < 1 or block < 1:
            raise ValueError("Chapter or lesson is invalid.")
        turns: list[dict[str, str]] = []
        for entry in (payload.get("history") or [])[-ai.ASK_HISTORY_TURNS:]:
            role = str((entry or {}).get("role") or "")
            text = str((entry or {}).get("content") or "").strip()
            if role in ("user", "assistant") and text:
                turns.append({"role": role, "content": text[:2_000]})
        chapter_title, lesson = ai.source_for_block(None, chapter, block, book)
        module = ai.load_module(None, book)
        term = module["tutorialData"]["sections"][chapter - 1]["items"][block - 1].get("term", "")
        module_id = store.module_id_for(module)
        # tutor-book-index (30-09-26): the whole chapter + other-chapter index hits, or -- kill
        # switch EDU_ASK_CONTEXT=legacy, or no usable index -- exactly today's book_search.
        context = bookctx.ask_context(module_id, question, term, chapter)
        visuals = ai.block_visuals(module, chapter, block)
    except (ValueError, TypeError, IndexError, KeyError, AttributeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    images: list[tuple[str, bytes]] = []
    wanted, vision_reason = ai.ask_wants_image(question, visuals)
    with _BUCKET_LOCK:
        asked = _bucket_prune("ask", req.client, moment)
        # A vision ask costs ASK_VISION_COST slots and is only taken when the budget can pay
        # for it in full; short of headroom it still answers, from text.
        if wanted and len(asked) + ai.ASK_VISION_COST <= RATE["ask"][0]:
            for figure in wanted:
                raw = ai.figure_bytes(module_id, str(figure.get("asset") or ""))
                if raw:
                    images.append((str(figure.get("title") or figure.get("asset")), raw))
        asked.append(moment)
        if images:
            for _ in range(ai.ASK_VISION_COST - 1):
                asked.append(moment)
    config = _routed(config, req.account, "tutor")
    try:
        reply = bookctx.tutor_reply(config, context, chapter_title, term, lesson, question, turns,
                                    visuals, images, block=block)
    except ValueError as error:
        return _json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
    reply["visionReason"] = vision_reason
    notice = ai.ask_notice(vision_reason, images)
    if notice:
        reply["notice"] = notice
        reply["answer"] = f"{notice}\n\n{reply.get('answer') or ''}".strip()
    store.log_ask({
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "module": book, "chapter": chapter, "block": block,
        "lesson": f"ch{chapter:02d}-b{block:02d}", "term": term, "question": question,
        "source": reply.get("source"), "vision": bool(reply.get("vision")),
        "figures": reply.get("figures") or [], "visionReason": reply.get("visionReason") or "none",
        "via": "8792",
        # ⚑ Phase 06a: whose question it was. The log file itself is unchanged and shared.
        "account": req.account.id, "username": req.account.username,
        "model": config.model,             # ⚑ 23-09-26: the combo this account's ask was routed to
        "context": context[0],             # ⚑ 30-09-26 tutor-book-index: "index" | "legacy"
        "chapterTokens": context[1]["tokens"] if context[0] == "index" else 0,
    })
    return _json(HTTPStatus.OK, reply)


def ai_default_module() -> str:
    return store.DEFAULT_MODULE


# ---- exercise grading (edu_server.py do_POST /api/exercise/grade) ------------------------
@app.post("/api/exercise/grade")
def api_exercise_grade(req: Posted = Depends(posted)) -> Response:
    blocked = _gate(req)
    if blocked:
        return blocked
    gated = _provider_gate(req)
    if isinstance(gated, JSONResponse):
        return gated
    config, _general = gated
    moment = time.monotonic()
    with _BUCKET_LOCK:
        graded = _bucket_prune("exercise", req.client, moment)
        if len(graded) >= RATE["exercise"][0]:
            return _json(HTTPStatus.TOO_MANY_REQUESTS,
                         {"error": "Too many submissions just now. Try again shortly, or switch to multiple choice."})
    try:
        payload = req.read_json(ai.EXERCISE_MAX_REQUEST_BYTES)
        book = str(payload.get("module") or store.DEFAULT_MODULE)
        chapter = int(payload.get("chapter"))
        if chapter < 1:
            raise ValueError("Chapter is invalid.")
        submitted = payload.get("answers")
        if not isinstance(submitted, list) or not submitted:
            raise ValueError("Answer at least one exercise first.")
        if len(submitted) > ai.EXERCISE_MAX_ITEMS:
            raise ValueError(f"At most {ai.EXERCISE_MAX_ITEMS} exercises can be marked at once.")
        answers: list[dict[str, Any]] = []
        for entry in submitted:
            n = int((entry or {}).get("n"))
            question = str((entry or {}).get("question") or "").strip()
            answer = str((entry or {}).get("answer") or "").strip()
            if not question:
                raise ValueError("An exercise arrived without its question.")
            answers.append({"n": n, "question": question[:800], "answer": answer[:ai.EXERCISE_MAX_ANSWER]})
        module = ai.load_module(None, book)
        section = module["tutorialData"]["sections"][chapter - 1]
        chapter_title = str(section.get("title") or f"Chapter {chapter}")
        query = " ".join(item["question"] for item in answers)
        excerpts = ai.book_search(store.module_id_for(module), query, limit=ai.EXERCISE_BOOK_PAGES, chapter=chapter)
    except (ValueError, TypeError, IndexError, KeyError, AttributeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    with _BUCKET_LOCK:
        _bucket_prune("exercise", req.client, moment).append(moment)
    try:
        results = ai.grade_exercises(_routed(config, req.account, "arg"), chapter_title, answers, excerpts)
    except ValueError as error:
        return _json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
    correct = sum(1 for r in results if r["verdict"] == "correct")
    return _json(HTTPStatus.OK, {"results": results, "correct": correct, "total": len(results),
                                 "pages": [e["page"] for e in excerpts]})


# ---- quiz generation (edu_server.py do_POST /api/quiz, /api/quiz/fresh) ------------------
def _quiz_bucket(req: Posted, now: float) -> JSONResponse | None:
    with _BUCKET_LOCK:
        history = _bucket_prune("quiz", req.client, now)
        if len(history) >= RATE["quiz"][0]:
            return _json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Generation limit reached. Try again later."})
    return None


def _quiz_take(req: Posted, now: float) -> None:
    with _BUCKET_LOCK:
        _bucket_prune("quiz", req.client, now).append(now)


@app.post("/api/quiz/fresh")
def api_quiz_fresh(req: Posted = Depends(posted)) -> Response:
    blocked = _gate(req)
    if blocked:
        return blocked
    gated = _provider_gate(req)
    if isinstance(gated, JSONResponse):
        return gated
    config, general = gated
    now = time.monotonic()
    limited = _quiz_bucket(req, now)
    if limited:
        return limited
    try:
        payload = req.read_json()
        book = str(payload.get("module") or store.DEFAULT_MODULE)
        ai.load_module(None, book)
        count = int(payload.get("count", general["fresh_quiz_size"]))
        if not MIN_FRESH_QUESTIONS <= count <= MAX_FRESH_QUESTIONS:
            raise ValueError(f"A fresh quiz must have between {MIN_FRESH_QUESTIONS} and {MAX_FRESH_QUESTIONS} questions.")
        blocks = None
        if payload.get("blocks") is not None:
            raw = payload["blocks"]
            valid = set(ai.all_theory_blocks(None, book))
            if not isinstance(raw, list) or not raw or len(raw) > len(valid):
                raise ValueError("Blocks must be a non-empty list.")
            blocks = {(int(pair[0]), int(pair[1])) for pair in raw}
            if not blocks <= valid:
                raise ValueError("A selected block does not exist.")
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    # One fresh quiz is one learner action: one slot, however many provider calls it fans into.
    _quiz_take(req, now)
    questions, errors = ai.fresh_questions(_routed(config, req.account, "arg"), None, count, blocks, book)
    if not questions:
        return _json(HTTPStatus.BAD_GATEWAY, {"error": errors[0] if errors else "The model returned no questions."})
    return _json(HTTPStatus.OK, {"questions": questions, "requested": count, "failed_calls": len(errors)})


@app.post("/api/quiz")
def api_quiz(req: Posted = Depends(posted)) -> Response:
    blocked = _gate(req)
    if blocked:
        return blocked
    gated = _provider_gate(req)
    if isinstance(gated, JSONResponse):
        return gated
    config, general = gated
    now = time.monotonic()
    limited = _quiz_bucket(req, now)
    if limited:
        return limited
    try:
        payload = req.read_json()
        book = str(payload.get("module") or store.DEFAULT_MODULE)
        chapter, block = int(payload.get("chapter")), int(payload.get("block"))
        count = int(payload.get("count", general["ai_question_count"]))
        if chapter < 1 or block < 1 or not 3 <= count <= MAX_QUESTIONS:
            raise ValueError("Chapter, block, or question count is invalid.")
        chapter_title, source = ai.source_for_block(None, chapter, block, book)
        questions = ai.provider_questions(_routed(config, req.account, "arg"), chapter_title, source, count)
    except (ValueError, IndexError, KeyError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    _quiz_take(req, now)
    return _json(HTTPStatus.OK, {"questions": questions})


# ---------------------------------------------------------------------------
# ⚑ PHASE 06a — sign-in, the account page, the owner's account admin, wrong answers.
# ---------------------------------------------------------------------------
RATE["wrong"] = (600, 600)             # wrong-answer records: generous, it is one row per miss
_BUCKETS["wrong"] = defaultdict(deque)
MAX_WRONG_BYTES = 64 * 1024
QUIZ_KINDS = ("bank", "ai", "fresh", "exercise")


def _auth_error(error: auth.AuthError) -> JSONResponse:
    return _json(HTTPStatus(error.status), {"error": str(error)})


@app.post("/api/auth/login")
def api_login(req: Posted = Depends(posted)) -> Response:
    """Username + password -> a session cookie. ONE generic message for every wrong combination.
    ⛔ The password is read from the body and handed to scrypt; it is never logged or echoed."""
    blocked = _gate(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json()
        account, token = auth.login(payload.get("username"), payload.get("password"), req.client)
    except auth.AuthError as error:
        return _auth_error(error)
    except db.StoreUnavailable as error:
        return _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    except (ValueError, TypeError, json.JSONDecodeError):
        return _json(HTTPStatus.BAD_REQUEST, {"error": auth.GENERIC_LOGIN_ERROR})
    response = _json(HTTPStatus.OK, {"account": account.public()})
    _set_session_cookie(response, token, req.https)
    return response


@app.post("/api/auth/logout")
def api_logout(req: Posted = Depends(posted)) -> Response:
    blocked = _gate(req)
    if blocked:
        return blocked
    auth.logout(req.token)
    response = _json(HTTPStatus.OK, {"signedOut": True})
    _clear_session_cookie(response)
    return response


@app.get("/api/auth/me")
def api_me(request: Request) -> Response:
    return _json(HTTPStatus.OK, {"account": _account(request).public()})


@app.post("/api/account/password")
def api_change_password(req: Posted = Depends(posted)) -> Response:
    """Change your own password. Every OTHER session of the account is signed out; this one stays."""
    blocked = _gate(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json()
        auth.change_password(req.account, payload.get("current"), payload.get("new"), req.token or "")
    except auth.AuthError as error:
        return _auth_error(error)
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    return _json(HTTPStatus.OK, {"changed": True})


@app.get("/api/account/stats")
def api_account_stats(request: Request) -> Response:
    """Your own numbers only: completed lessons per book, recent assessment scores, and how many
    wrong answers have been recorded per book. Module ids are returned raw; the page maps them to
    titles with the same moduleIdFor() the library cards use."""
    account_id = _account(request).id
    completed = db.fetch_all(
        "SELECT module_id, count(*) AS n, max(completed_at) AS newest FROM progress WHERE account_id = %s"
        " GROUP BY module_id ORDER BY module_id", (account_id,))
    attempts = db.fetch_all(
        "SELECT module_id, block_id, score, total, source, created_at FROM attempts WHERE account_id = %s"
        " ORDER BY created_at DESC, id DESC LIMIT 10", (account_id,))
    wrong = db.fetch_all(
        "SELECT module_id, count(*) AS n FROM wrong_answers WHERE account_id = %s GROUP BY module_id ORDER BY module_id",
        (account_id,))
    return _json(HTTPStatus.OK, {
        "completed": [{"module": r["module_id"], "lessons": r["n"],
                       "lastAt": r["newest"].isoformat(timespec="seconds")} for r in completed],
        "attempts": [{"module": r["module_id"], "block": r["block_id"], "score": r["score"], "total": r["total"],
                      "source": r["source"], "at": r["created_at"].isoformat(timespec="seconds")} for r in attempts],
        "wrongAnswers": [{"module": r["module_id"], "count": r["n"]} for r in wrong],
        "wrongTotal": sum(int(r["n"]) for r in wrong),
    })


@app.get("/api/accounts")
def api_accounts(request: Request) -> Response:
    """OWNER ONLY. The one privilege there is (ruling R25: "currently only i can create")."""
    if not _account(request).is_owner:
        return _json(HTTPStatus.FORBIDDEN, {"error": "Only the owner account can manage accounts."})
    return _json(HTTPStatus.OK, {"accounts": auth.list_accounts()})


@app.post("/api/accounts")
def api_create_account(req: Posted = Depends(posted)) -> Response:
    """OWNER ONLY. Create an account. There is no sign-up anywhere else."""
    blocked = _gate(req)
    if blocked:
        return blocked
    if not req.account.is_owner:
        return _json(HTTPStatus.FORBIDDEN, {"error": "Only the owner account can manage accounts."})
    try:
        payload = req.read_json()
        created = auth.create_account(payload.get("username"), payload.get("displayName"), payload.get("password"))
    except auth.AuthError as error:
        return _auth_error(error)
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    return _json(HTTPStatus.CREATED, {"account": created.public()})


@app.post("/api/accounts/claude-access")
def api_claude_access(req: Posted = Depends(posted)) -> Response:
    """OWNER ONLY. Turn one account's Claude access on or off: {"username": "...", "on": true|false}.
    Takes effect on that account's next AI call (the flag is read with the session per request)."""
    blocked = _gate(req)
    if blocked:
        return blocked
    if not req.account.is_owner:
        return _json(HTTPStatus.FORBIDDEN, {"error": "Only the owner account can manage accounts."})
    try:
        payload = req.read_json()
        if not isinstance(payload.get("on"), bool):
            raise ValueError("on must be true or false.")
        account = auth.set_claude_access(payload.get("username"), payload["on"])
    except auth.AuthError as error:
        return _auth_error(error)
    except db.StoreUnavailable as error:
        return _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    return _json(HTTPStatus.OK, {"account": account.public()})


@app.post("/api/wrong-answers")
def api_wrong_answer(req: Posted = Depends(posted)) -> Response:
    """Record ONE wrong answer, with the full question and options (AI questions exist nowhere
    else once the screen is closed). Right answers are never sent here (ruling R25)."""
    blocked = _gate(req)
    if blocked:
        return blocked
    moment = time.monotonic()
    with _BUCKET_LOCK:
        recent = _bucket_prune("wrong", req.client, moment)
        if len(recent) >= RATE["wrong"][0]:
            return _json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many answers just now."})
        recent.append(moment)
    try:
        payload = req.read_json(MAX_WRONG_BYTES)
        module = store.module_key(payload.get("module"))
        block = str(payload.get("block") or "").strip() or None
        if block is not None and not store.BLOCK_ID.match(block):
            raise ValueError("block must look like ch01-b07.")
        kind = str(payload.get("kind") or "")
        if kind not in QUIZ_KINDS:
            raise ValueError(f"kind must be one of {', '.join(QUIZ_KINDS)}.")
        question = str(payload.get("question") or "").strip()
        if not question or len(question) > 8_000:
            raise ValueError("question must be 1-8000 characters.")
        options = payload.get("options")
        if not isinstance(options, list) or not 2 <= len(options) <= 12:
            raise ValueError("options must be a list of 2-12 strings.")
        options = [str(o)[:4_000] for o in options]
        chosen, correct, chosen_set, correct_set = store.wrong_answer_positions(payload, len(options))
        attempt = str(payload.get("attempt") or "")[:64] or None
        db.execute(
            "INSERT INTO wrong_answers (account_id, module_id, block_id, quiz_kind, question, options, chosen, correct,"
            " chosen_set, correct_set, attempt)"
            " VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb, %s::jsonb, %s)",
            (req.account.id, module, block, kind, question, json.dumps(options, ensure_ascii=False), chosen, correct,
             json.dumps(chosen_set) if chosen_set is not None else None,
             json.dumps(correct_set) if correct_set is not None else None, attempt),
        )
    except db.StoreUnavailable as error:
        return _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    return _json(HTTPStatus.CREATED, {"recorded": True})


# ---------------------------------------------------------------------------
# Spaced repetition (21-10-26). One card per account x module x question key; the question text lives
# in the book's quizData, never here. Scheduling is store.srs_next (pure, gated).
# ---------------------------------------------------------------------------
RATE["review"] = (1200, 600)           # generous: one call per answered question
_BUCKETS["review"] = defaultdict(deque)
MAX_REVIEW_BYTES = 4 * 1024


def _review_rate(req: Posted) -> JSONResponse | None:
    moment = time.monotonic()
    with _BUCKET_LOCK:
        recent = _bucket_prune("review", req.client, moment)
        if len(recent) >= RATE["review"][0]:
            return _json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many review calls just now."})
        recent.append(moment)
    return None


@app.post("/api/review/seen")
def api_review_seen(req: Posted = Depends(posted)) -> Response:
    """Enrol a question after an ORDINARY quiz answer ({module, question, correct}).

    ⚑ 22-10-26 (exam-recall-suite P1): an AI-written question sends {module, body, correct} instead of a
      key — the server derives its key ("ai-…") and stores the body. A new card obeys the daily cap
      (outcome "queued"). Reply {outcome, question[, dueAt]} — `outcome` unchanged for old callers."""
    blocked = _gate(req) or _review_rate(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_REVIEW_BYTES + store.MAX_BODY_BYTES)
        if not isinstance(payload.get("correct"), bool):
            raise ValueError("correct must be true or false.")
        key, body = store.question_key_and_body(payload)
        reply = store.review_enrol(req.account.id, store.module_key(payload.get("module")), key, payload["correct"], body)
    except db.StoreUnavailable as error:
        return _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    return _json(HTTPStatus.OK, reply)


@app.post("/api/review/grade")
def api_review_grade(req: Posted = Depends(posted)) -> Response:
    """Grade one card in a review run ({module, question, grade: again|hard|good|easy})."""
    blocked = _gate(req) or _review_rate(req)
    if blocked:
        return blocked
    try:
        payload = req.read_json(MAX_REVIEW_BYTES)
        reply = store.review_grade(req.account.id, store.module_key(payload.get("module")),
                                   store.review_key(payload.get("question")), str(payload.get("grade") or ""))
    except db.StoreUnavailable as error:
        return _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        return _json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
    return _json(HTTPStatus.OK, reply)


@app.get("/api/review/due")
def api_review_due(request: Request, module: str = Query(default=""), limit: int = Query(default=20)) -> Response:
    """The cards due now for the signed-in account in one module (oldest first).

    ⚑ 22-10-26 (exam-recall-suite P1): `limit` is the run size, clamped 10..50 (default still 20); each
      card carries `leech`, and an AI-written card its `body` (the only copy of the question)."""
    limit = max(store.SESSION_SIZE_MIN, min(limit, store.SESSION_SIZE_MAX))
    try:
        return _json(HTTPStatus.OK, store.review_due_page(_account(request).id, store.module_key(module), limit))
    except db.StoreUnavailable as error:
        return _json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})


# ⚑ study-rooms-qna P1 (29-09-26): add-on routers. After every core API route, before the
#   exception handler and the SPA catch-all `/{full_path:path}` (so it never shadows them).
from addons import ADDON_ROUTERS  # noqa: E402
for _addon_router in ADDON_ROUTERS:
    app.include_router(_addon_router)


@app.exception_handler(StarletteHTTPException)
async def _unknown_route(request: Request, exc: StarletteHTTPException) -> Response:
    """A POST to anything outside the ten is the legacy's flat 404 JSON, never a 405 that
    tells a caller which paths exist for other verbs. GET keeps Starlette's own 404."""
    if request.method == "POST" and exc.status_code in (404, 405):
        return _json(HTTPStatus.NOT_FOUND, {"error": "Unknown API route."})
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


# ---------------------------------------------------------------------------
# Guarded file serving. ⛔ REGISTERED BEFORE THE StaticFiles MOUNT — see the note below.
# ---------------------------------------------------------------------------
_NOT_FOUND_BOOK = JSONResponse({"error": "No such book file."}, status_code=404)
_NOT_FOUND_ASSET = JSONResponse({"error": "No such asset."}, status_code=404)

# A refusal and a genuine not-found return the SAME flat body on purpose. Distinguishing them
# tells an unauthenticated caller which paths exist, which is the information disclosure this
# whole guard exists to prevent.


@app.get("/book/{rest:path}")
def book_file(rest: str) -> Response:
    """/book/<moduleId>/module.json and /book/<moduleId>/assets/<fig-N-N.png>. Nothing else.

    ⚠ ``rest:path`` receives the URL-DECODED path, so %2e%2e%2f arrives here as ``..`` and is
    rejected by MODULE_ID / the two-name allowlist. A raw ``../`` (curl --path-as-is) arrives
    intact and is rejected the same way. Neither is normalised away before this function.
    """
    try:
        target, ctype = content.resolve_book_file([p for p in rest.split("/") if p != ""])
    except content.NotAFile:
        return _NOT_FOUND_BOOK
    # module.json changes on re-import: revalidate every time (ETag -> cheap 304); assets stay cached.
    cache = "no-cache" if target.name == "module.json" else "public, max-age=3600"
    return FileResponse(target, media_type=ctype, headers={"Cache-Control": cache})


@app.get("/favicon.svg")
def favicon() -> Response:
    """index.html's icon (copied into the build from aws-quiz-app/favicon.svg)."""
    target = WEB_ROOT / "favicon.svg"
    if not target.is_file():
        return JSONResponse({"error": "No favicon."}, status_code=404)
    return FileResponse(target, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/data/{name}")
def data_book(name: str) -> Response:
    """/data/<name>.json — the legacy book shape (3 books on nn: the SageMaker / MLOps sets).

    ⚑ Phase 04 parity: :8767 lists FIVE books, :8792 listed TWO, because data/*.json was never
    shipped here nor served. Same guard as the legacy module_path(): MODULE_NAME, no test_
    fixtures, parent-equality containment in <web>/data. deploy-study.sh ships the files.
    """
    try:
        target = content.resolve_data_module(name)
    except content.NotAFile:
        return _NOT_FOUND_BOOK
    return FileResponse(target, media_type="application/json; charset=utf-8",
                        headers={"Cache-Control": "no-store"})


@app.get("/assets/{module_id}/{name}")
def asset_file(module_id: str, name: str) -> Response:
    """/assets/<moduleId>/<fig-10-3.png>. TWO segments — Vite's own one-segment build assets
    fall through to the StaticFiles mount below, which is why the order is load-bearing."""
    try:
        target = content.resolve_asset_file(module_id, name)
    except content.NotAFile:
        return _NOT_FOUND_ASSET
    return FileResponse(target, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


# ---------------------------------------------------------------------------
# SPA serving (plan C2a).
# ---------------------------------------------------------------------------
@app.get("/")
# Annotated ``-> Response`` rather than ``-> FileResponse | JSONResponse``: FastAPI builds a
# Pydantic response model from the return annotation, and a union of two Response classes is
# not a valid field type — the app raised FastAPIError at import and never started. Measured
# locally before deploy, which is the whole reason the app is run rather than just compiled.
def spa_index() -> Response:
    """Serve the built SPA shell.

    Without this route a backend-only deploy passes every other exit gate and the phase's
    own headline — "if the new stack cannot serve hello reliably, nothing later is worth
    porting" — is unproven by construction. Exit gate G17 asserts this returns a document
    containing the React root div.
    """
    if not SPA_INDEX.is_file():
        return JSONResponse(
            {"error": "SPA bundle is not deployed", "expected": str(SPA_INDEX)},
            status_code=503,
        )
    return FileResponse(SPA_INDEX, media_type="text/html")


def _safe_next(value: str | None) -> str:
    """Only a same-site PATH may be a post-login target — never ``//evil.host`` or a full URL."""
    target = str(value or "/")
    if not target.startswith("/") or target.startswith("//") or "\\" in target or target.startswith("/login"):
        return "/"
    return target


@app.get("/login")
def login_page(request: Request, next: str = Query(default="/")) -> Response:
    """The sign-in page — the SAME SPA document; the app renders the login form on this path.
    A reader who is already signed in is sent straight on."""
    token = request.cookies.get(auth.COOKIE_NAME)
    if token:
        try:
            account, _ = auth.session_account(token)
        except db.StoreUnavailable:
            account = None
        if account is not None:
            return RedirectResponse(_safe_next(next), status_code=302)
    return spa_index()


# ⛔ MOUNT ORDER IS LOAD-BEARING (execute instruction E17 / concern C12).
#
# The SPA's hashed bundles are served from the prefix "/assets" — Vite's default, kept
# deliberately and NAMED here rather than left for Phase 3 to rediscover. That prefix is
# SHARED with the guarded per-module route Phase 3 adds at /assets/<moduleId>/<file>.
#
# They stay separate because Starlette matches in REGISTRATION ORDER: the API routes and
# (from Phase 3) the two guarded file routes are registered BEFORE this mount, so the
# 2-segment guarded route claims module assets, 1-segment build assets fall through to the
# mount, and a guarded 403 does NOT fall through to the mount. Registering the mount first
# would shadow every guarded route and silently remove the ASSET_FILE allowlist.
#
# ⛔ StaticFiles is mounted over /srv/foxai/edu-study/web/ ONLY — a directory that contains
# nothing but Vite build output. NEVER over the web root, NEVER over ~/foxai-data/, and
# NEVER over the book or asset stores, where import-report.json sits beside module.json.
if SPA_ASSETS.is_dir():
    app.mount("/assets", StaticFiles(directory=SPA_ASSETS), name="spa-assets")


# ---------------------------------------------------------------------------
# ⚑ PHASE 06a — HISTORY FALLBACK. Registered AFTER the /assets mount on purpose: the mount claims
# every /assets/... path first, then any other GET is a page of the app (/<book>/<unit>-<n>/...,
# /account, /settings) and gets the SPA document — so a refresh on a deep path loads the app
# instead of a 404. The middleware has already demanded a session for it.
# ⛔ An unknown /api (or /book, /data) path is NOT a page: flat 404 JSON, never the SPA document,
#    or a typo in a fetch would parse HTML as JSON and fail somewhere far from the cause.
# ---------------------------------------------------------------------------
@app.get("/{full_path:path}")
def spa_fallback(full_path: str) -> Response:
    head = full_path.split("/", 1)[0]
    if head in ("api", "book", "data", "assets"):
        return JSONResponse({"error": "Unknown API route."}, status_code=404, headers={"Cache-Control": "no-store"})
    return spa_index()
