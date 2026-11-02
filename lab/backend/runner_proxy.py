"""Lab -> code runner on dn2 (192.168.100.68:8790). Ruling R27: Lab is the ONLY caller.

* The runner key and URL are read from EDU_LAB_ENV_FILE on EVERY call (mode 600, outside
  the deployed tree), so a key rotation needs no restart. The key is never logged, never
  returned, never put in argv.
* The runner session is derived HERE from the signed-in account id — `lab-acct-%08d` —
  and never from the request body (contract E6). The runner requires 8-64 characters, so a
  bare account id ("1") would be refused on every run; `lab-acct-00000001` keeps one
  kernel set per account.
* 60 s per cell / 80 s per request stay the runner's; this proxy waits at most 90 s.
  A timeout at any level is reported as HEAVY with the R13 sentence — never retried.
* Rate limit: a sliding window, 60 runs per rolling 60 s per account (contract E18).
  Only requests that passed the 415/403/413 checks reach it.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import httpx

ENV_FILE = Path(os.environ.get("EDU_LAB_ENV_FILE", "/home/ubuntu/.config/foxai/edu-lab.env"))
DEFAULT_RUNNER_URL = "http://192.168.100.68:8790"
RUN_TIMEOUT_SECONDS = 90.0
HEALTH_TIMEOUT_SECONDS = 3.0
RATE_LIMIT = 60
RATE_WINDOW_SECONDS = 60.0

HEAVY_MESSAGE = "This script is too heavy for the shared runner — Copy it and run it in geron-lab on your PC"
BUSY_MESSAGE = "runner busy — try again in a minute"
OFFLINE_MESSAGE = "runner offline"


class ProxyError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def session_for(account_id: int) -> str:
    return f"lab-acct-{account_id:08d}"


def _config() -> tuple[str, str]:
    """(runner url, key) from the env file. Missing/unreadable -> the runner is offline."""
    values: dict[str, str] = {}
    try:
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                name, value = line.split("=", 1)
                values[name.strip()] = value.strip()
    except OSError:
        return DEFAULT_RUNNER_URL, ""
    return values.get("EDU_LAB_RUNNER_URL", DEFAULT_RUNNER_URL).rstrip("/"), values.get("EDU_RUNNER_KEY", "")


# --------------------------------------------------------------------------- rate limit
_history: dict[int, deque[float]] = defaultdict(deque)


def rate_allow(account_id: int, now: float | None = None) -> bool:
    """Sliding window. True = this call is allowed and has been counted."""
    now = time.monotonic() if now is None else now
    history = _history[account_id]
    while history and history[0] <= now - RATE_WINDOW_SECONDS:
        history.popleft()
    if len(history) >= RATE_LIMIT:
        return False
    history.append(now)
    return True


# --------------------------------------------------------------------------- calls
async def _post(client: httpx.AsyncClient, route: str, payload: dict[str, Any], timeout: float) -> httpx.Response:
    url, key = _config()
    if not key:
        raise ProxyError(502, OFFLINE_MESSAGE)
    return await client.post(f"{url}{route}", json=payload, headers={"X-Edu-Runner-Key": key}, timeout=timeout)


async def health(client: httpx.AsyncClient) -> bool:
    url, key = _config()
    if not key:
        return False
    try:
        response = await client.get(f"{url}/health", headers={"X-Edu-Runner-Key": key}, timeout=HEALTH_TIMEOUT_SECONDS)
    except httpx.HTTPError:
        return False
    return response.status_code == 200


def _heavy(result: dict[str, Any]) -> dict[str, Any]:
    return {**result, "heavy": True, "message": HEAVY_MESSAGE}


async def run(client: httpx.AsyncClient, account_id: int, book: str, lesson: str, code: str) -> dict[str, Any]:
    payload = {
        "session": session_for(account_id),
        "module": book,
        "lesson": lesson,
        "target": "lab",
        "cells": [{"id": "lab", "source": code}],
    }
    try:
        response = await _post(client, "/run", payload, RUN_TIMEOUT_SECONDS)
    except httpx.TimeoutException:
        return _heavy({"status": "timeout", "cell": "lab", "ran": [], "outputs": [], "elapsed_ms": int(RUN_TIMEOUT_SECONDS * 1000)})
    except httpx.HTTPError:
        raise ProxyError(502, OFFLINE_MESSAGE) from None
    return _result(response)


def _result(response: httpx.Response) -> dict[str, Any]:
    if response.status_code == 503:
        raise ProxyError(503, BUSY_MESSAGE)
    if response.status_code in (401, 403):
        # The key or the caller allow-list is wrong: from the user's side the runner is offline.
        print(f"runner refused Lab: HTTP {response.status_code} (key / allow-list)", flush=True)
        raise ProxyError(502, OFFLINE_MESSAGE)
    try:
        body = response.json()
    except ValueError:
        raise ProxyError(502, OFFLINE_MESSAGE) from None
    if response.status_code == 400:
        raise ProxyError(400, str(body.get("error") or "The runner refused the request."))
    if response.status_code == 409:
        raise ProxyError(409, str(body.get("error") or "Kernel is busy."))
    if response.status_code != 200 or not isinstance(body, dict):
        raise ProxyError(502, OFFLINE_MESSAGE)
    if body.get("status") == "timeout":
        return _heavy(body)
    return body


async def control(client: httpx.AsyncClient, route: str, account_id: int, book: str, lesson: str) -> dict[str, Any]:
    """route: /interrupt (Stop) or /restart (Reset kernel). Same server-side session key."""
    payload = {"session": session_for(account_id), "module": book, "lesson": lesson}
    try:
        response = await _post(client, route, payload, 30.0)
    except httpx.HTTPError:
        raise ProxyError(502, OFFLINE_MESSAGE) from None
    return _result(response)
