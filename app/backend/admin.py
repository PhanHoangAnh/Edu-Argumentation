"""Owner/operator CLI for the edu-study account store (Phase 06a, ruling R25).

Run ON nn, from the deployed backend directory, with the service's own venv:

    cd /srv/foxai/edu-study/backend
    /home/ubuntu/edu-study-venv/bin/python -m admin migrate
    printf '%s\\n' "$PASSWORD" | /home/ubuntu/edu-study-venv/bin/python -m admin create-user \\
        --username ha1dtd --display-name Daniel --owner          # password read from STDIN
    /home/ubuntu/edu-study-venv/bin/python -m admin list-users
    /home/ubuntu/edu-study-venv/bin/python -m admin import-progress --username ha1dtd
    /home/ubuntu/edu-study-venv/bin/python -m admin set-claude-access --username chipl --on   # or --off

⛔ A PASSWORD IS NEVER AN ARGUMENT. It is read from stdin (one line), so it cannot land in
   ``ps``, shell history or a transcript. There is deliberately no --password flag.
⛔ ``migrate`` takes a ``pg_dump`` of edu_study into ~/foxai-snapshots/ BEFORE applying anything,
   and refuses to migrate if the dump fails (ruling R25: "Backup (pg_dump) before every migration").
⛔ ``import-progress`` only READS progress.json and is idempotent — re-run it at cutover.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import auth
import db
import store
from settings import db_settings

SNAPSHOT_DIR = Path(os.getenv("EDU_DB_SNAPSHOT_DIR", str(Path.home() / "foxai-snapshots")))


def _read_password(confirm: bool = False) -> str:
    if sys.stdin.isatty():
        first = getpass.getpass("Password: ")
        if confirm and getpass.getpass("Again: ") != first:
            raise SystemExit("passwords differ")
        return first
    line = sys.stdin.readline()
    return line.rstrip("\r\n")


def backup() -> Path | None:
    """pg_dump -Fc of the configured database. The password goes through the environment of the
    child process only (PGPASSWORD), never argv. Returns the dump path."""
    values = db_settings()
    if not values.get("EDU_DB_NAME"):
        raise SystemExit("no database configured")
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = SNAPSHOT_DIR / f"{values['EDU_DB_NAME']}-{stamp}.dump"
    env = {**os.environ, "PGPASSWORD": values.get("EDU_DB_PASSWORD", "")}
    result = subprocess.run(
        ["pg_dump", "-Fc", "-h", values.get("EDU_DB_HOST") or "127.0.0.1", "-p", values.get("EDU_DB_PORT") or "5432",
         "-U", values["EDU_DB_USER"], "-d", values["EDU_DB_NAME"], "-f", str(target)],
        env=env, capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"pg_dump FAILED, nothing migrated: {result.stderr.strip()[:400]}")
    os.chmod(target, 0o600)
    return target


def cmd_migrate(args: argparse.Namespace) -> None:
    if not args.no_backup:
        dumped = backup()
        print(f"backup: {dumped} ({dumped.stat().st_size} bytes)")
    ran = db.migrate()
    print(f"applied: {', '.join(ran) if ran else 'nothing (up to date)'}")
    print(f"schema version: {db.schema_version()}")


def cmd_create_user(args: argparse.Namespace) -> None:
    password = _read_password(confirm=True)
    try:
        account = auth.create_account(args.username, args.display_name, password, owner=args.owner)
    except auth.AuthError as error:
        raise SystemExit(f"refused: {error}")
    print(json.dumps({"created": account.public()}))


def cmd_set_password(args: argparse.Namespace) -> None:
    account = auth.account_by_username(args.username)
    if account is None:
        raise SystemExit("no such account")
    try:
        auth.set_password(account.id, _read_password(confirm=True))
    except auth.AuthError as error:
        raise SystemExit(f"refused: {error}")
    print(json.dumps({"passwordSet": account.username, "sessionsEnded": True}))


def cmd_check_password(args: argparse.Namespace) -> None:
    """Exit 0 if the stdin password matches — for verifying an account WITHOUT printing anything."""
    row = db.fetch_one("SELECT password_hash FROM accounts WHERE lower(username) = lower(%s)", (args.username,))
    ok = bool(row) and auth.password_matches(_read_password(), row["password_hash"])
    print(json.dumps({"username": args.username, "matches": ok}))
    raise SystemExit(0 if ok else 1)


def cmd_set_claude_access(args: argparse.Namespace) -> None:
    """Which 9router combos this account's AI calls use (settings.model_for). Effective on its next call."""
    try:
        account = auth.set_claude_access(args.username, args.on)
    except auth.AuthError as error:
        raise SystemExit(f"refused: {error}")
    print(json.dumps({"username": account.username, "claudeAccess": account.claude_access}))


def cmd_delete_user(args: argparse.Namespace) -> None:
    """Delete ONE non-owner account and everything it owns (sessions, progress, attempts, wrong
    answers — ON DELETE CASCADE). Refuses the owner. Needs --yes, so it is never a slip."""
    if not args.yes:
        raise SystemExit("refused: deleting an account removes its progress too; add --yes")
    account = auth.account_by_username(args.username)
    if account is None:
        raise SystemExit("no such account")
    if account.is_owner:
        raise SystemExit("refused: the owner account cannot be deleted")
    removed = db.execute("DELETE FROM accounts WHERE id = %s AND NOT is_owner", (account.id,))
    print(json.dumps({"deleted": account.username, "rows": removed}))


def cmd_list_users(_args: argparse.Namespace) -> None:
    print(json.dumps(auth.list_accounts(), indent=2))


def cmd_import_progress(args: argparse.Namespace) -> None:
    account = auth.account_by_username(args.username) if args.username else auth.owner_account()
    if account is None:
        raise SystemExit("no such account (create the owner first)")
    result = store.import_progress_json(account.id)
    count = db.fetch_one("SELECT count(*) AS n FROM progress WHERE account_id = %s", (account.id,))
    print(json.dumps({"account": account.username, **result, "rows_for_account": count["n"] if count else 0}))


def cmd_mint_session(args: argparse.Namespace) -> None:
    """A SHORT-LIVED session for a machine check (the deploy script's library gate). Prints the
    token ONCE on stdout for the caller to use and then revoke. Marked purpose='gate' so it is never
    slid forward and is easy to find."""
    account = auth.account_by_username(args.username) if args.username else auth.owner_account()
    if account is None:
        raise SystemExit("no such account")
    print(auth.issue_session(account.id, ttl=timedelta(seconds=args.ttl), purpose="gate"))


def cmd_revoke_session(_args: argparse.Namespace) -> None:
    token = sys.stdin.readline().strip()
    print(json.dumps({"revoked": auth.revoke_session(token)}))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m admin", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("migrate", help="pg_dump, then apply pending migrations")
    p.add_argument("--no-backup", action="store_true", help="gate database only — never on edu_study")
    p.set_defaults(fn=cmd_migrate)
    p = sub.add_parser("create-user", help="create an account; password on stdin")
    p.add_argument("--username", required=True)
    p.add_argument("--display-name", required=True)
    p.add_argument("--owner", action="store_true")
    p.set_defaults(fn=cmd_create_user)
    p = sub.add_parser("set-password", help="replace a password; stdin; ends that account's sessions")
    p.add_argument("--username", required=True)
    p.set_defaults(fn=cmd_set_password)
    p = sub.add_parser("check-password", help="exit 0 if the stdin password matches")
    p.add_argument("--username", required=True)
    p.set_defaults(fn=cmd_check_password)
    p = sub.add_parser("set-claude-access", help="turn an account's Claude combos on or off")
    p.add_argument("--username", required=True)
    toggle = p.add_mutually_exclusive_group(required=True)
    toggle.add_argument("--on", dest="on", action="store_true")
    toggle.add_argument("--off", dest="on", action="store_false")
    p.set_defaults(fn=cmd_set_claude_access)
    p = sub.add_parser("delete-user", help="delete one NON-owner account and its data (--yes)")
    p.add_argument("--username", required=True)
    p.add_argument("--yes", action="store_true")
    p.set_defaults(fn=cmd_delete_user)
    p = sub.add_parser("list-users")
    p.set_defaults(fn=cmd_list_users)
    p = sub.add_parser("import-progress", help="copy progress.json into one account (idempotent)")
    p.add_argument("--username", help="default: the owner")
    p.set_defaults(fn=cmd_import_progress)
    p = sub.add_parser("mint-session", help="short-lived machine session; prints the token")
    p.add_argument("--username", help="default: the owner")
    p.add_argument("--ttl", type=int, default=300)
    p.set_defaults(fn=cmd_mint_session)
    p = sub.add_parser("revoke-session", help="token on stdin")
    p.set_defaults(fn=cmd_revoke_session)
    args = parser.parse_args(argv)
    try:
        args.fn(args)
    except db.StoreUnavailable as error:
        raise SystemExit(f"store unavailable: {error}")


if __name__ == "__main__":
    main()
