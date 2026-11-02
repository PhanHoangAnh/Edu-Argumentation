"""Accounts, passwords and sessions for the edu-study service (Phase 06a, ruling R25).

WHAT THIS IS: username + password sign-in, accounts created by the OWNER only, no roles beyond
"owner or not" (the user: "No RBAC, just different account for now").

⛔ PASSWORDS — CoreX's scheme, parameter for parameter (platform/console/main/dbos_service/auth.py):
   hashlib.scrypt, n=2**16, r=8, p=1, 16-byte random salt, 32-byte digest, maxmem 256 MiB (the
   OpenSSL default cap is 32 MB and n=2**16,r=8 needs 64 MiB). Stored as one self-describing string
   ``scrypt$n$r$p$salt$digest``, so a later cost bump still verifies old records. Stdlib only.
⛔ A password NEVER appears in argv, a log line, a response or an exception message. The CLI reads it
   from stdin; the API receives it in a POST body and hands it straight to scrypt.
⛔ SESSIONS — a 32-byte random token goes in the cookie; the database keeps only its SHA-256, so a
   dump of the sessions table cannot be replayed. 30-day expiry, slid forward at most once an hour
   so a busy reader does not write a row per request.
⛔ LOGIN RATE LIMIT — 5 failed attempts per client IP per 5 minutes (CoreX's numbers). Per PROCESS,
   which is one more reason this service stays single-worker (see main.py's header).
⛔ AN UNKNOWN USERNAME STILL COSTS ONE scrypt, so response time does not reveal which usernames exist.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import db

SCRYPT_N = 2**16
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAXMEM = 256 * 1024 * 1024
PASSWORD_MIN = 8          # CoreX uses 12; the user's three chosen passwords are 9-11 characters.
PASSWORD_MAX = 256
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,64}$")
DISPLAY_MAX = 80

COOKIE_NAME = "edu_session"
SESSION_DAYS = 30
SESSION_TTL = timedelta(days=SESSION_DAYS)
REFRESH_EVERY = timedelta(hours=1)

LOGIN_WINDOW_SECONDS = 300
LOGIN_MAX_FAILURES = 5

GENERIC_LOGIN_ERROR = "Username or password is incorrect."


class AuthError(Exception):
    """A caller-facing refusal. The message is safe to show; it never names a secret."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Account:
    id: int
    username: str
    display_name: str
    is_owner: bool
    # ⚑ 23-09-26 (migration 002): which 9router combos this account's AI calls use — see
    #   settings.model_for. Read from the DATABASE with the session, never from the request.
    claude_access: bool = False

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "username": self.username, "displayName": self.display_name, "isOwner": self.is_owner,
                "claudeAccess": self.claude_access}


# --------------------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                            dklen=32, maxmem=SCRYPT_MAXMEM)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def password_matches(password: str, record: str) -> bool:
    try:
        kind, n, r, p, salt, digest = record.split("$")
        if kind != "scrypt":
            return False
        got = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=int(n), r=int(r),
                             p=int(p), dklen=32, maxmem=SCRYPT_MAXMEM)
        return hmac.compare_digest(got.hex(), digest)
    except (ValueError, TypeError):
        return False


# Built once, so an unknown username pays the same scrypt as a known one.
_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    return _DUMMY_HASH


def check_new_password(password: Any) -> str:
    value = str(password or "")
    if len(value) < PASSWORD_MIN:
        raise AuthError(f"The password must be at least {PASSWORD_MIN} characters.")
    if len(value) > PASSWORD_MAX:
        raise AuthError(f"The password must be at most {PASSWORD_MAX} characters.")
    return value


def check_username(value: Any) -> str:
    username = str(value or "").strip()
    if not USERNAME_RE.fullmatch(username):
        raise AuthError("The username must be 3-64 letters, numbers, dots, dashes or underscores.")
    return username


def check_display_name(value: Any) -> str:
    name = " ".join(str(value or "").split())
    name = "".join(ch for ch in name if ch.isprintable())
    if not name or len(name) > DISPLAY_MAX:
        raise AuthError(f"The display name must be 1-{DISPLAY_MAX} characters.")
    return name


# --------------------------------------------------------------------------- accounts
def _account(row: dict[str, Any] | None) -> Account | None:
    if not row:
        return None
    return Account(int(row["id"]), str(row["username"]), str(row["display_name"]), bool(row["is_owner"]),
                   bool(row.get("claude_access", False)))


def create_account(username: Any, display_name: Any, password: Any, *, owner: bool = False) -> Account:
    """Create one account. Usernames are unique case-insensitively (a second "Daniel" for "daniel"
    is refused), and the database refuses a second owner (accounts_single_owner)."""
    name = check_username(username)
    display = check_display_name(display_name)
    secret = check_new_password(password)
    with db.connect() as conn:
        clash = conn.execute("SELECT 1 FROM accounts WHERE lower(username) = lower(%s)", (name,)).fetchone()
        if clash:
            raise AuthError("That username is already taken.", 409)
        if owner and conn.execute("SELECT 1 FROM accounts WHERE is_owner").fetchone():
            raise AuthError("An owner account already exists.", 409)
        row = conn.execute(
            "INSERT INTO accounts (username, display_name, password_hash, is_owner)"
            " VALUES (%s, %s, %s, %s) RETURNING id, username, display_name, is_owner, claude_access",
            (name, display, hash_password(secret), owner),
        ).fetchone()
    account = _account(row)
    assert account is not None
    return account


def list_accounts() -> list[dict[str, Any]]:
    rows = db.fetch_all(
        "SELECT id, username, display_name, is_owner, claude_access, created_at FROM accounts ORDER BY created_at, id"
    )
    return [{
        "id": int(r["id"]), "username": r["username"], "displayName": r["display_name"],
        "isOwner": bool(r["is_owner"]), "claudeAccess": bool(r["claude_access"]),
        "createdAt": r["created_at"].isoformat(timespec="seconds"),
    } for r in rows]


def set_claude_access(username: Any, on: bool) -> Account:
    """Turn Claude access on or off for one account (owner UI + admin CLI). Takes effect on that
    account's NEXT AI call — the flag is read with the session on every request."""
    row = db.fetch_one(
        "UPDATE accounts SET claude_access = %s WHERE lower(username) = lower(%s)"
        " RETURNING id, username, display_name, is_owner, claude_access",
        (bool(on), str(username or "").strip()),
    )
    account = _account(row)
    if account is None:
        raise AuthError("No such account.", 404)
    return account


def account_by_username(username: str) -> Account | None:
    return _account(db.fetch_one(
        "SELECT id, username, display_name, is_owner, claude_access FROM accounts WHERE lower(username) = lower(%s)",
        (username,),
    ))


def owner_account() -> Account | None:
    return _account(db.fetch_one("SELECT id, username, display_name, is_owner, claude_access FROM accounts WHERE is_owner"))


def set_password(account_id: int, new_password: Any, *, keep_token_hash: str | None = None) -> None:
    """Set a new password and END EVERY OTHER SESSION of that account (a password change is how a
    user throws out a session they did not start). ``keep_token_hash`` spares the caller's own."""
    secret = check_new_password(new_password)
    with db.connect() as conn:
        conn.execute("UPDATE accounts SET password_hash = %s, password_changed_at = now() WHERE id = %s",
                     (hash_password(secret), account_id))
        if keep_token_hash:
            conn.execute("DELETE FROM sessions WHERE account_id = %s AND token_hash <> %s", (account_id, keep_token_hash))
        else:
            conn.execute("DELETE FROM sessions WHERE account_id = %s", (account_id,))


def change_password(account: Account, current: Any, new_password: Any, token: str) -> None:
    row = db.fetch_one("SELECT password_hash FROM accounts WHERE id = %s", (account.id,))
    if not row or not password_matches(str(current or ""), row["password_hash"]):
        raise AuthError("The current password is incorrect.", 403)
    set_password(account.id, new_password, keep_token_hash=token_hash(token))


# --------------------------------------------------------------------------- login rate limit
_FAILURES: dict[str, deque[float]] = defaultdict(deque)
_FAILURE_LOCK = threading.Lock()


def _prune(client: str, now: float) -> deque[float]:
    history = _FAILURES[client]
    while history and history[0] <= now - LOGIN_WINDOW_SECONDS:
        history.popleft()
    return history


def login_blocked(client: str) -> bool:
    with _FAILURE_LOCK:
        return len(_prune(client, time.monotonic())) >= LOGIN_MAX_FAILURES


def _note_failure(client: str) -> None:
    with _FAILURE_LOCK:
        _prune(client, time.monotonic()).append(time.monotonic())


# --------------------------------------------------------------------------- sessions
def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_session(account_id: int, *, ttl: timedelta = SESSION_TTL, purpose: str = "browser") -> str:
    token = secrets.token_urlsafe(32)
    with db.connect() as conn:
        # Opportunistic sweep of expired rows — cheap, keeps the table small without a timer.
        conn.execute("DELETE FROM sessions WHERE expires_at < now()")
        conn.execute(
            "INSERT INTO sessions (token_hash, account_id, expires_at, purpose) VALUES (%s, %s, %s, %s)",
            (token_hash(token), account_id, _now() + ttl, purpose),
        )
    return token


def login(username: Any, password: Any, client: str) -> tuple[Account, str]:
    """Returns (account, cookie token). One generic error for every failure, so the page cannot be
    used to find out whether a username exists."""
    if login_blocked(client):
        raise AuthError("Too many sign-in attempts. Wait a few minutes and try again.", 429)
    name = str(username or "").strip()
    secret = str(password or "")
    row = None
    if USERNAME_RE.fullmatch(name) and 0 < len(secret) <= PASSWORD_MAX:
        row = db.fetch_one(
            "SELECT id, username, display_name, is_owner, claude_access, password_hash FROM accounts"
            " WHERE lower(username) = lower(%s)", (name,),
        )
    if row is None:
        password_matches(secret or "x", _dummy_hash())       # same cost as a real check
        _note_failure(client)
        raise AuthError(GENERIC_LOGIN_ERROR, 401)
    if not password_matches(secret, row["password_hash"]):
        _note_failure(client)
        raise AuthError(GENERIC_LOGIN_ERROR, 401)
    account = _account(row)
    assert account is not None
    return account, issue_session(account.id)


def session_account(token: str | None) -> tuple[Account | None, bool]:
    """(account, refreshed). ``refreshed`` tells the caller to re-send the cookie with a fresh Max-Age."""
    if not token or len(token) > 200:
        return None, False
    digest = token_hash(token)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT a.id, a.username, a.display_name, a.is_owner, a.claude_access, s.refreshed_at, s.purpose"
            " FROM sessions s JOIN accounts a ON a.id = s.account_id"
            " WHERE s.token_hash = %s AND s.expires_at > now()", (digest,),
        ).fetchone()
        if not row:
            return None, False
        refreshed = False
        if row["purpose"] == "browser" and _now() - row["refreshed_at"] >= REFRESH_EVERY:
            conn.execute("UPDATE sessions SET refreshed_at = now(), expires_at = %s WHERE token_hash = %s",
                         (_now() + SESSION_TTL, digest))
            refreshed = True
    return _account(row), refreshed


def logout(token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash(token),))


def revoke_session(token: str) -> int:
    return db.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash(token),))
