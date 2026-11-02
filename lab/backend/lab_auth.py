"""Sign-in check for Lab: every request is validated against the study app.

Lab has no accounts of its own (ruling R27 rule 2). It asks the study app on :8767
``GET /api/auth/me`` whether the browser's ``edu_session`` cookie is a live session.

Contract (measured 24-09-26, app/backend/main.py require_session + auth.py):
  200 {"account": {"id": <int>, "displayName": ..., ...}}  -> signed in
  401                                                       -> not signed in
  503 / timeout / connection refused                        -> the study app cannot say

Rules that make this safe (plan D3, contract E5):
  * ONLY the edu_session cookie value is forwarded, never the whole Cookie header.
  * Fail closed: anything but 200 with an INT account.id is "not signed in".
  * "Cannot say" is never "not signed in": Lab answers 503, never 401, never a login loop.
  * Results are cached <= 30 s, keyed on sha256(cookie value) — never on IP. Only 200 and
    401 answers are cached; an outage is re-asked on the next request.
  * The study app may answer with a refreshed Set-Cookie. Lab drops it: Lab never writes
    the study app's cookie.
"""

from __future__ import annotations

import hashlib
import os
import re
import time
from collections import OrderedDict
from dataclasses import dataclass

import httpx

COOKIE_NAME = "edu_session"
AUTH_URL = os.environ.get("EDU_LAB_AUTH_URL", "http://127.0.0.1:8767/api/auth/me")
TIMEOUT_SECONDS = 2.0
CACHE_SECONDS = 30.0
CACHE_MAX = 256
# A session token is url-safe base64 from secrets.token_urlsafe. Anything else is not a
# session and is never forwarded (it could smuggle a header break otherwise).
TOKEN = re.compile(r"^[A-Za-z0-9_\-]{16,256}$")


@dataclass(frozen=True)
class Account:
    id: int
    name: str


class _Unavailable:
    """The study app could not answer. Distinct from 'not signed in' on purpose."""

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return "UNAVAILABLE"


UNAVAILABLE = _Unavailable()

_cache: "OrderedDict[str, tuple[float, Account | None]]" = OrderedDict()


def _cache_get(key: str) -> tuple[bool, Account | None]:
    hit = _cache.get(key)
    if hit is None:
        return False, None
    expires, value = hit
    if expires < time.monotonic():
        _cache.pop(key, None)
        return False, None
    _cache.move_to_end(key)
    return True, value


def _cache_put(key: str, value: Account | None) -> None:
    _cache[key] = (time.monotonic() + CACHE_SECONDS, value)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_MAX:
        _cache.popitem(last=False)


def parse_me(payload: object) -> Account | None:
    """200 body -> Account, or None when the shape is anything unexpected (fail closed)."""
    if not isinstance(payload, dict):
        return None
    account = payload.get("account")
    if not isinstance(account, dict):
        return None
    account_id = account.get("id")
    # bool is a subclass of int; a JSON true is not an account id.
    if not isinstance(account_id, int) or isinstance(account_id, bool) or account_id <= 0:
        return None
    name = account.get("displayName")
    return Account(id=account_id, name=name if isinstance(name, str) else "")


async def check(cookie_value: str | None, client: httpx.AsyncClient) -> Account | None | _Unavailable:
    """Account when signed in, None when not, UNAVAILABLE when the study app cannot say."""
    if not cookie_value or not TOKEN.match(cookie_value):
        return None
    key = hashlib.sha256(cookie_value.encode("utf-8")).hexdigest()
    found, cached = _cache_get(key)
    if found:
        return cached
    try:
        response = await client.get(
            AUTH_URL,
            headers={"Cookie": f"{COOKIE_NAME}={cookie_value}", "Accept": "application/json"},
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
        )
    except httpx.HTTPError:
        return UNAVAILABLE
    if response.status_code == 200:
        try:
            account = parse_me(response.json())
        except ValueError:
            account = None
        _cache_put(key, account)
        return account
    if response.status_code == 401:
        _cache_put(key, None)
        return None
    if response.status_code >= 500:
        return UNAVAILABLE
    # 3xx/4xx other than 401: not a session we can trust. Not cached.
    return None
