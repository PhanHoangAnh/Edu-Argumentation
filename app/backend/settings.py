"""Store-path and provider resolution for the edu-study service.

⛔ THIS MODULE IS THE ONE ACCESSOR (plan C1a / decision D-C1).

Every provider/settings read goes through a function defined here. The legacy app calls
``ProviderConfig.from_environment()`` from inside individual handlers, which is why moving
settings out of the environment later means touching every call site. Phase 4 swaps the
SOURCE of these values (env -> SQLite); it must not have to find the readers.

⛔ CREDENTIALS: READ FROM THE FILE, NEVER THE ENVIRONMENT (Phase 04, decision D-P4-2).
The unit for :8792 still pins exactly seven EDU_* PATH variables and carries NO
``EnvironmentFile=``, so no credential is ever in the process environment (gates R-SEP3 /
R-SEP4 keep asserting exactly that). The provider/runner credentials are parsed from
``EDU_ENV_PATH`` (the SAME provider.env :8767 uses) on each call, by the functions below and
nowhere else. :8792 is UNAUTHENTICATED and ufw rule #1 blanket-allows the LAN, so a value read
here must never reach a response body — /api/settings reports ``*_set`` booleans only
(gate W-SECRET).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# The seven store paths, with the defaults measured from the live :8767 service on
# 2026-09-21. Two are set explicitly by :8767's unit (EDU_ENV_PATH, EDU_SETTINGS_PATH);
# the other five are unset there and fall through to the code defaults in
# aws-quiz-app/edu_server.py at L50 / L116 / L120 / L125 / L368.
#
# ⚠ EDU_LIBRARY_META_PATH is its OWN entry, never derived. edu_server.py L368 defaults it
# to ``PROGRESS_PATH.parent / "library-meta.json"``, so deriving it means moving the
# progress store silently moves the library-metadata store too. Exit gate G9 exists
# precisely to break that derivation.
_DEFAULT_ROOT = "/home/ubuntu/foxai-data/edu-argumentation"

STORE_PATH_DEFAULTS: dict[str, str] = {
    "EDU_ENV_PATH": f"{_DEFAULT_ROOT}/provider.env",
    "EDU_SETTINGS_PATH": f"{_DEFAULT_ROOT}/settings.json",
    "EDU_BOOK_ROOT": f"{_DEFAULT_ROOT}/books",
    "EDU_PROGRESS_PATH": f"{_DEFAULT_ROOT}/progress.json",
    "EDU_ASSET_ROOT": f"{_DEFAULT_ROOT}/assets",
    "EDU_LIBRARY_ROOT": f"{_DEFAULT_ROOT}/library",
    "EDU_LIBRARY_META_PATH": f"{_DEFAULT_ROOT}/library-meta.json",
}


def store_paths() -> dict[str, str]:
    """Resolve the seven store paths. THE ONLY reader of these variables.

    Returns exactly seven entries — never more. The health endpoint echoes this mapping
    verbatim, and exit gate G1 asserts the key set is EQUAL to the expected seven, so an
    eighth entry of any kind fails the gate rather than leaking quietly.
    """
    return {name: os.getenv(name, default) for name, default in STORE_PATH_DEFAULTS.items()}


def store_path(name: str) -> Path:
    """Resolve one store path as a Path. Raises on an unknown name rather than guessing."""
    if name not in STORE_PATH_DEFAULTS:
        raise KeyError(f"{name} is not one of the seven edu-study store paths")
    return Path(store_paths()[name])


# --------------------------------------------------------------------------- provider (Phase 04)
# ⚑ D-P4-2 (23-09-26): THE CREDENTIALS ARE READ FROM THE FILE, NEVER FROM os.environ.
#   The legacy loads provider.env through systemd's EnvironmentFile= and then MUTATES os.environ
#   on Save. :8792 instead parses EDU_ENV_PATH on every call and never writes its environment.
#   Two consequences, both intended:
#     · R-SEP3 (no EnvironmentFile=) and R-SEP4 (no credential in /proc/<pid>/environ) stay
#       green BY CONSTRUCTION — the key lives in the process's memory only for one request.
#     · a Save on :8767 is visible to :8792 immediately (the file is re-read), with no restart.
#   ⛔ Never echo a value read here into a response body. /api/settings reports `*_set` booleans.

ENV_FIELDS = ("EDU_QUIZ_API_URL", "EDU_QUIZ_API_KEY", "EDU_QUIZ_MODEL", "EDU_QUIZ_ACCESS_TOKEN", "EDU_QUIZ_JSON_MODE")


def read_env_file() -> dict[str, str]:
    """KEY=VALUE lines of provider.env. Comments/blank lines skipped; absent file => {}.

    Parsed the way systemd's EnvironmentFile= reads what write_env_file() writes: one
    unquoted assignment per line. A surrounding pair of quotes is stripped for safety.
    """
    values: dict[str, str] = {}
    try:
        text = store_path("EDU_ENV_PATH").read_text(encoding="utf-8")
    except OSError:
        return values
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def env_value(name: str) -> str:
    return read_env_file().get(name, "").strip()


def current_env_values() -> dict[str, str]:
    values = read_env_file()
    return {field: values.get(field, "") for field in ENV_FIELDS}


def valid_api_url(url: str) -> bool:
    return url.startswith("https://") or url.startswith("http://127.0.0.1") or url.startswith("http://localhost")


@dataclass(frozen=True)
class ProviderConfig:
    api_url: str
    api_key: str
    model: str
    access_token: str
    json_mode: bool


def provider_config() -> ProviderConfig | None:
    """ProviderConfig.from_environment(), ported rule for rule (edu_server.py:356).

    THE single seam for provider credentials — every handler asks here, none reads the file.
    """
    env = read_env_file()
    values = {
        "api_url": env.get("EDU_QUIZ_API_URL", "").strip(),
        "api_key": env.get("EDU_QUIZ_API_KEY", "").strip(),
        "model": env.get("EDU_QUIZ_MODEL", "").strip(),
        "access_token": env.get("EDU_QUIZ_ACCESS_TOKEN", "").strip(),
    }
    if not all(values[field] for field in ("api_url", "api_key", "model")):
        return None
    # A template copied and half-filled leaves literal "replace-with-..." text, which is
    # non-empty and would report ready while every generation fails at the provider.
    if any(value.startswith("replace-with-") for value in values.values()):
        return None
    if not valid_api_url(values["api_url"]):
        return None
    return ProviderConfig(**values, json_mode=env.get("EDU_QUIZ_JSON_MODE", "true").lower() != "false")


def admin_token() -> str:
    return env_value("EDU_ADMIN_TOKEN")


# --------------------------------------------------------------------------- model routing (23-09-26)
# ⚑ USER RULING 23-09-26: the 9router COMBO is chosen PER ACCOUNT and PER JOB.
#
#   job      | account with claude_access | every other account
#   ---------+----------------------------+---------------------
#   "tutor"  | EDU_MODEL_TUTOR_CLAUDE     | EDU_MODEL_TUTOR_NORMAL      (/api/ask)
#   "arg"    | EDU_MODEL_ARG_CLAUDE       | EDU_MODEL_ARG_NORMAL        (quiz, fresh quiz, grading)
#
# Values live in provider.env (read per call, like every other provider value). Live values on nn:
# edu-tutor-claude / edu-tutor-normal / edu-arg-claude / edu-arg-normal.
# ⛔ The account comes from the SESSION (server-side), never from the request body.
# Fallback when a key is absent or empty: the tutor-claude slot tries EDU_TUTOR_MODEL (the :8767 key)
# next; every slot finally falls back to EDU_QUIZ_MODEL — the single model everyone used before this
# change — so an older provider.env keeps working unchanged (and gate W-MODEL stays green).
MODEL_KEYS: dict[tuple[str, bool], tuple[str, ...]] = {
    ("tutor", True): ("EDU_MODEL_TUTOR_CLAUDE", "EDU_TUTOR_MODEL"),
    ("tutor", False): ("EDU_MODEL_TUTOR_NORMAL",),
    ("arg", True): ("EDU_MODEL_ARG_CLAUDE",),
    ("arg", False): ("EDU_MODEL_ARG_NORMAL",),
}


def model_for(job: str, claude_access: bool, env: dict[str, str] | None = None) -> str:
    """The combo name for one job and one account class. Raises on an unknown job."""
    if job not in ("tutor", "arg"):
        raise KeyError(f"unknown AI job {job!r}")
    values = read_env_file() if env is None else env
    for key in (*MODEL_KEYS[(job, bool(claude_access))], "EDU_QUIZ_MODEL"):
        value = values.get(key, "").strip()
        if value:
            return value
    return ""


def write_env_file(values: dict[str, str]) -> None:
    """edu_server.py:write_env_file, byte for byte — the same header, field order, and the
    admin + runner lines carried over, or a Save would silently disconnect the runner."""
    from store import write_atomic  # local import: store imports this module

    current = read_env_file()
    lines = [
        "# Edu-Argumentation provider credentials.",
        "# Written by the in-app Settings page. Mode 600. Never commit this file.",
    ]
    lines.extend(f"{field}={values.get(field, '')}" for field in ENV_FIELDS)
    # ⚠ The Settings page rewrites the WHOLE file. EVERY other non-empty key already in it is
    #   carried through, in file order: EDU_ADMIN_TOKEN, the runner's two lines (ruling R24 removed
    #   the runner, not its operator data) and the model-routing keys (EDU_TUTOR_MODEL,
    #   EDU_MODEL_*, 23-09-26). Until 23-09-26 only admin + runner were carried, so a Save would
    #   have silently deleted any other key — and with it the per-account routing.
    for field, value in current.items():
        if field not in ENV_FIELDS and value.strip():
            lines.append(f"{field}={value.strip()}")
    write_atomic(store_path("EDU_ENV_PATH"), "\n".join(lines) + "\n")


# --------------------------------------------------------------------------- account store (Phase 06a)
# ⚑ D-P6a-3 (23-09-26): the PostgreSQL credentials for the per-account store live in their OWN
#   mode-600 file on nn, ``~/.config/foxai/edu-study-db.env`` — outside every ``rsync --delete``
#   tree — and are READ FROM THE FILE, never from the process environment, exactly like
#   provider.env above (D-P4-2). The unit therefore still has no ``EnvironmentFile=`` and R-SEP3 /
#   R-SEP4 stay green by construction.
#   ⛔ This path is deliberately NOT one of the seven store paths: /api/health echoes those, and
#      the health gate asserts the key set is EXACTLY seven. ``EDU_DB_ENV_PATH`` exists only so the
#      gate harness can point a local server at the isolated ``edu_study_gate`` database; the live
#      unit never sets it and falls through to the default.
DB_ENV_DEFAULT = "/home/ubuntu/.config/foxai/edu-study-db.env"
DB_FIELDS = ("EDU_DB_HOST", "EDU_DB_PORT", "EDU_DB_NAME", "EDU_DB_USER", "EDU_DB_PASSWORD")


def db_env_path() -> Path:
    return Path(os.getenv("EDU_DB_ENV_PATH", DB_ENV_DEFAULT))


def db_settings() -> dict[str, str]:
    """The five EDU_DB_* values, parsed from the credentials file. Missing file => {}.

    ⛔ Never echo a value read here into a response body or a log line.
    """
    values: dict[str, str] = {}
    try:
        text = db_env_path().read_text(encoding="utf-8")
    except OSError:
        return values
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() in DB_FIELDS:
            values[key.strip()] = value.strip()
    return values
