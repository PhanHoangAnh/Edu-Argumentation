"""Lab — the study add-on where a lesson's code is edited and run (ruling R27).

Separate service `foxai-edu-lab` on 0.0.0.0:8798 (VPN door; ufw 10.10.100.0/24), served publicly at /lab/ by the same
nginx 443 server as the study app. It never imports study-app modules, and it has no write
path to the book files, the progress store or PostgreSQL (the systemd unit also mounts those
read-only). Routes are mounted literally under /lab so nginx passes the prefix through.

  GET  /lab/api/health                      {ok, runner: up|down}          no sign-in
  GET  /lab/api/me                          {account_id, name}
  GET  /lab/api/books                       books -> chapters -> lessons with code
  GET  /lab/api/books/{id}/lessons/{lesson} {id, n, title, code, source}
  POST /lab/api/run        {book, lesson, code}  -> runner /run
  POST /lab/api/run/stop   {book, lesson}        -> runner /interrupt
  POST /lab/api/run/reset  {book, lesson}        -> runner /restart
  GET  /lab/assets/*                        built SPA assets
  GET  /lab/...                             SPA (signed in) or 302 /login?next=...

POST order of checks: Content-Type JSON (415) -> same origin (403) -> signed in (401/503)
-> body <= 256 KB (413) -> code <= 64 KB (413) -> 60/min/account (429) -> runner.
"""

from __future__ import annotations

import json
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

import lab_auth as auth
import runner_proxy
from library import LESSON_ID, Library, books_payload

WEB_DIR = Path(os.environ.get("EDU_LAB_WEB_DIR", str(Path(__file__).resolve().parent.parent / "web")))
MAX_BODY_BYTES = 256 * 1024
MAX_CODE_BYTES = 64 * 1024
BOOK_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")

LIBRARY = Library()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient()
    try:
        yield
    finally:
        await app.state.http.aclose()


app = FastAPI(title="Lab", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


def log(message: str) -> None:
    # journald picks this up. Never code, never cookies, never the runner key.
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {message}", flush=True)


def _json(status: int, payload: Any) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store"})


def _error(status: int, message: str) -> JSONResponse:
    return _json(status, {"error": message})


async def _account(request: Request):
    return await auth.check(request.cookies.get(auth.COOKIE_NAME), request.app.state.http)


async def _api_account(request: Request):
    """(account, None) or (None, error response)."""
    account = await _account(request)
    if account is auth.UNAVAILABLE:
        log("auth: sign-in service unavailable")
        return None, _error(503, "sign-in service unavailable")
    if account is None:
        return None, _error(401, "Sign in required.")
    return account, None


def _same_origin(request: Request) -> bool:
    """Mirror of app/backend/main.py _same_origin: no Origin, or Origin's host == Host."""
    origin = request.headers.get("origin")
    return not origin or origin.split("//", 1)[-1].rstrip("/") == request.headers.get("host", "")


async def _read_body(request: Request) -> bytes | None:
    """The body, or None when it is over 256 KB (checked on the header AND while streaming)."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_BODY_BYTES:
                return None
        except ValueError:
            return None
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


async def _post_guard(request: Request, need_code: bool):
    """All POST preconditions. Returns (account, book, lesson, code) or an error response."""
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        return _error(415, "Content-Type must be application/json.")
    if not _same_origin(request):
        return _error(403, "Cross-origin requests are not allowed.")
    account, failure = await _api_account(request)
    if failure is not None:
        return failure
    raw = await _read_body(request)
    if raw is None:
        return _error(413, "The request is over 256 KB.")
    try:
        payload = json.loads(raw)
    except ValueError:
        return _error(400, "The request body must be JSON.")
    if not isinstance(payload, dict):
        return _error(400, "The request body must be a JSON object.")
    book, lesson = payload.get("book"), payload.get("lesson")
    if not isinstance(book, str) or not BOOK_ID.match(book) or not isinstance(lesson, str) or not LESSON_ID.match(lesson):
        return _error(400, "book or lesson is invalid.")
    code = payload.get("code")
    if need_code:
        if not isinstance(code, str):
            return _error(400, "code must be a string.")
        if len(code.encode("utf-8")) > MAX_CODE_BYTES:
            return _error(413, "Code is over 64 KB — the shared runner takes at most 64 KB per run.")
    found = LIBRARY.book(book)
    if found is None or lesson not in found.lessons:
        return _error(404, "Unknown book or lesson.")
    # ⚠ any `session` field in the payload is IGNORED: the runner session is derived from
    #   the signed-in account in runner_proxy.session_for (contract E6).
    return account, book, lesson, code


def _proxy_error(error: runner_proxy.ProxyError) -> JSONResponse:
    return _error(error.status, error.message)


# --------------------------------------------------------------------------- API
@app.get("/lab/api/health")
async def health(request: Request) -> JSONResponse:
    up = await runner_proxy.health(request.app.state.http)
    return _json(200, {"ok": True, "runner": "up" if up else "down"})


@app.get("/lab/api/me")
async def me(request: Request) -> JSONResponse:
    account, failure = await _api_account(request)
    if failure is not None:
        return failure
    return _json(200, {"account_id": account.id, "name": account.name})


@app.get("/lab/api/books")
async def books(request: Request) -> JSONResponse:
    _account_, failure = await _api_account(request)
    if failure is not None:
        return failure
    return _json(200, books_payload(LIBRARY.books()))


@app.get("/lab/api/books/{book_id}/lessons/{lesson_id}")
async def lesson(request: Request, book_id: str, lesson_id: str) -> JSONResponse:
    _account_, failure = await _api_account(request)
    if failure is not None:
        return failure
    found = LIBRARY.book(book_id) if BOOK_ID.match(book_id) else None
    item = found.lessons.get(lesson_id) if found else None
    if item is None or not item.code:
        return _error(404, "No code lesson with that id.")
    return _json(200, {"id": item.id, "n": item.n, "title": item.title, "code": item.code, "source": item.source})


@app.post("/lab/api/run")
async def run(request: Request) -> JSONResponse:
    guarded = await _post_guard(request, need_code=True)
    if isinstance(guarded, Response):
        return guarded
    account, book, lesson_id, code = guarded
    if not runner_proxy.rate_allow(account.id):
        log(f"run account={account.id} book={book} lesson={lesson_id} status=rate-limited")
        return _error(429, "Too many runs — at most 60 a minute. Wait a moment and try again.")
    started = time.monotonic()
    try:
        result = await runner_proxy.run(request.app.state.http, account.id, book, lesson_id, code)
    except runner_proxy.ProxyError as error:
        log(f"run account={account.id} book={book} lesson={lesson_id} status=http-{error.status} ms={int((time.monotonic() - started) * 1000)}")
        return _proxy_error(error)
    log(f"run account={account.id} book={book} lesson={lesson_id} status={result.get('status')} ms={int((time.monotonic() - started) * 1000)}")
    return _json(200, result)


async def _control(request: Request, route: str) -> JSONResponse:
    guarded = await _post_guard(request, need_code=False)
    if isinstance(guarded, Response):
        return guarded
    account, book, lesson_id, _code = guarded
    try:
        result = await runner_proxy.control(request.app.state.http, route, account.id, book, lesson_id)
    except runner_proxy.ProxyError as error:
        return _proxy_error(error)
    log(f"{route.strip('/')} account={account.id} book={book} lesson={lesson_id}")
    return _json(200, result)


@app.post("/lab/api/run/stop")
async def stop(request: Request) -> JSONResponse:
    return await _control(request, "/interrupt")


@app.post("/lab/api/run/reset")
async def reset(request: Request) -> JSONResponse:
    return await _control(request, "/restart")


@app.api_route("/lab/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def api_unknown(rest: str) -> JSONResponse:
    return _error(404, "Unknown route.")


# --------------------------------------------------------------------------- SPA
if (WEB_DIR / "assets").is_dir():
    app.mount("/lab/assets", StaticFiles(directory=WEB_DIR / "assets"), name="assets")


@app.get("/lab")
async def lab_bare() -> RedirectResponse:
    return RedirectResponse("/lab/", status_code=301)


@app.get("/lab/favicon.svg")
async def favicon() -> Response:
    path = WEB_DIR / "favicon.svg"
    return FileResponse(path) if path.is_file() else Response(status_code=404)


# ⚑ 24-09-26 (user report "Lab button opens the platform page"): Lab is reachable two ways —
#   through the public nginx on 443 (same origin as the study app; /login is relative) and
#   DIRECTLY on the VPN/LAN door http://<host>:8798 (ufw: 8798 from 10.10.100.0/24 only). On the
#   direct door the study app's /login lives on another port, so the sign-in redirect names it.
#   "Direct" = plain HTTP from a non-loopback peer: uvicorn trusts X-Forwarded-* only from
#   127.0.0.1, so a request through nginx arrives with scheme https, and the nn-local gates
#   (curl 127.0.0.1:8798) keep the relative redirect they assert.
STUDY_PORT = int(os.environ.get("EDU_LAB_STUDY_PORT", "8767"))
LOOPBACK = frozenset({"127.0.0.1", "::1"})
HOSTNAME = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")


def _direct_host(request: Request) -> str | None:
    """The bare host name when the request came in on the direct VPN door, else None."""
    peer = request.client.host if request.client else ""
    if request.url.scheme == "https" or peer in LOOPBACK:
        return None
    host = request.headers.get("host", "").rsplit(":", 1)[0]   # "192.168.100.66:8798" -> "192.168.100.66"
    return host if HOSTNAME.match(host) else None


def _login_base(request: Request) -> str:
    host = _direct_host(request)
    return f"http://{host}:{STUDY_PORT}" if host else ""


# ⚑ 25-09-26 (user): the study app shows Lab in a panel beside the lesson (app/frontend
#   reader/LabDock.tsx). Only the study app may frame Lab: its own origin (public door, nginx) and,
#   on the direct VPN door, the study app on the same host at :STUDY_PORT. Nobody else (clickjacking).
@app.middleware("http")
async def frame_policy(request: Request, call_next):
    response = await call_next(request)
    host = _direct_host(request)
    parents = "'self'" + (f" http://{host}:{STUDY_PORT}" if host else "")
    response.headers["Content-Security-Policy"] = f"frame-ancestors {parents}"
    return response


UNAVAILABLE_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lab</title></head>
<body style="background:#111827;color:#cbd5e1;font-family:sans-serif;padding:3rem">
<h1>Lab</h1><p>The sign-in service is unavailable right now. Try again in a minute.</p></body></html>"""


@app.get("/lab/{rest:path}")
async def spa(request: Request, rest: str) -> Response:
    account = await _account(request)
    if account is auth.UNAVAILABLE:
        log("auth: sign-in service unavailable (page)")
        return HTMLResponse(UNAVAILABLE_PAGE, status_code=503, headers={"Cache-Control": "no-store"})
    if account is None:
        target = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        return RedirectResponse(f"{_login_base(request)}/login?next={quote(target, safe='')}", status_code=302)
    index = WEB_DIR / "index.html"
    if not index.is_file():
        return HTMLResponse("Lab is not built.", status_code=500)
    return FileResponse(index, headers={"Cache-Control": "no-store"})
