"""PostgreSQL access for the per-account store (edu-replatform Phase 06a, ruling R25).

⛔ ONE SHORT-LIVED CONNECTION PER CALL — the CoreX console's pattern (sql_history.py). No pool,
   no connection shared across threads: FastAPI runs the plain ``def`` handlers in a threadpool,
   and a connection object used by two threads at once is a corruption bug, not a slowdown.
   ``nn:5432`` is local to this service, so the connect cost is a few milliseconds.

⛔ THE DATABASE IS ``edu_study`` ON nn:5432 AND NOTHING ELSE. That cluster also holds
   ``polaris`` (the lake's catalog), ``airflow`` and ``dbos_console``. This module never runs a
   server-wide statement; the role it connects as owns exactly one database and cannot create
   another (NOCREATEDB, NOCREATEROLE, CONNECTION LIMIT 10).

⛔ CREDENTIALS COME FROM ``settings.db_settings()`` — a mode-600 file read on demand, never the
   process environment (D-P6a-3). A value read there never reaches a response or a log line.
"""

from __future__ import annotations

import re
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

from settings import db_settings

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
MIGRATION_NAME = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")


# ⛔ AT MOST 6 OPEN CONNECTIONS PER PROCESS, AND A 7th CALLER WAITS — IT DOES NOT FAIL.
#    Found by gate W-RACE on 23-09-26: 20 concurrent completions landed only 13/20, because each
#    request opened its own connection and the role has CONNECTION LIMIT 10 (ruling R25) — the
#    11th was refused by PostgreSQL and surfaced as a 503. The limit on the role is correct (this
#    service shares nn:5432 with polaris/airflow/dbos_console); the fix is to queue here. 6 leaves
#    headroom under 10 for the admin CLI and a deploy gate running at the same moment.
MAX_CONNECTIONS = 6
_SLOTS = threading.BoundedSemaphore(MAX_CONNECTIONS)
SLOT_WAIT_SECONDS = 20


class StoreUnavailable(Exception):
    """The account store cannot be reached or is not configured. Callers answer 503."""


def _conninfo() -> dict[str, Any]:
    values = db_settings()
    missing = [k for k in ("EDU_DB_NAME", "EDU_DB_USER", "EDU_DB_PASSWORD") if not values.get(k)]
    if missing:
        raise StoreUnavailable("the account store is not configured")
    return {
        "host": values.get("EDU_DB_HOST") or "127.0.0.1",
        "port": int(values.get("EDU_DB_PORT") or 5432),
        "dbname": values["EDU_DB_NAME"],
        "user": values["EDU_DB_USER"],
        "password": values["EDU_DB_PASSWORD"],
        "connect_timeout": 5,
        "application_name": "foxai-edu-study",
    }


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """A transaction: commits on a clean exit, rolls back on an exception, always closes."""
    if not _SLOTS.acquire(timeout=SLOT_WAIT_SECONDS):
        raise StoreUnavailable("the account store is busy")
    try:
        try:
            conn = psycopg.connect(**_conninfo(), row_factory=dict_row)
        except psycopg.OperationalError as error:
            raise StoreUnavailable("the account store is unreachable") from error
        try:
            with conn:
                yield conn
        finally:
            conn.close()
    finally:
        _SLOTS.release()


def fetch_all(sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
    with connect() as conn:
        return list(conn.execute(sql, params).fetchall())


def fetch_one(sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
    with connect() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: tuple | dict = ()) -> int:
    with connect() as conn:
        return conn.execute(sql, params).rowcount


# --------------------------------------------------------------------------- migrations
def migration_files() -> list[tuple[int, Path]]:
    out: list[tuple[int, Path]] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = MIGRATION_NAME.match(path.name)
        if match:
            out.append((int(match.group(1)), path))
    return out


def applied_versions() -> set[int]:
    with connect() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version INTEGER PRIMARY KEY, name TEXT NOT NULL,"
            " applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        return {row["version"] for row in conn.execute("SELECT version FROM schema_migrations").fetchall()}


def migrate() -> list[str]:
    """Apply every pending versioned file, each in its own transaction. Returns what ran.

    ⛔ The caller (admin.py migrate) takes a pg_dump FIRST. This function does not, because the
       gate harness also calls it against the throwaway gate database.
    """
    done = applied_versions()
    ran: list[str] = []
    for version, path in migration_files():
        if version in done:
            continue
        with connect() as conn:
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (version, name) VALUES (%s, %s)", (version, path.name))
        ran.append(path.name)
    return ran


def schema_version() -> int:
    versions = applied_versions()
    return max(versions) if versions else 0
