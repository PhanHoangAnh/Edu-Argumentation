#!/usr/bin/env python3
r"""
module_availability.py — is a module importable in the code runner? (Phase-1 D2)

THE BUG THIS REPLACES
---------------------
code_cells.py and weight_probe.py decided runnability with

    available.get(name, False)

against a fixed 45-key map measured once on the runner venv
(edu-replatform_21-09-26/r13-measurements/runner-modules.json). Any import NOT on
that list read as "missing". `tempfile` is not on it, so a cell importing tempfile
was shown to the reader as "the code runner does not have `tempfile` installed" —
a lie about the standard library.

THE RULE (three tiers, first hit wins)
--------------------------------------
  1. MEASURED  the map from the real runner venv, when one is given. It wins,
               because it is a measurement of the actual box (a stdlib module can
               genuinely be absent from a trimmed interpreter).
  2. STDLIB    the top-level name is in sys.stdlib_module_names -> present.
  3. MISSING   everything else.
Dotted names are resolved on their top-level package (`urllib.request` -> `urllib`).

⚠ Tier 2 uses the stdlib list of the interpreter running THIS script. The runner
on .68 is Python 3.10.12; the Mac is 3.12. The lists differ only at the edges
(e.g. `distutils` is 3.10-only, `tomllib` 3.11+) — run it with the runner's Python
when that edge matters.

⚠ REBUILT 23-09-26. The Phase-1 original (22-09-26) was never pushed. The D2
WIRING of this lookup into code_cells.py / weight_probe.py was lost with it and is
NOT restored by this file: those two tools still call `available.get(m, False)`.
See phase-01-tools-rebuild_REPORT_23-09-26.md.

⛔ Like census.py it EXITS 0 even when a module is missing — it reports, it does
not gate. A caller must read the printed status (or use `status()`), never the
exit code.

Usage:
    module_availability.py [--runner-modules FILE] [--compare-old] NAME [NAME ...]
    python3 -c "import module_availability as M; print(M.status('tempfile'))"
"""
import argparse
import json
import sys

STDLIB = frozenset(getattr(sys, "stdlib_module_names", ()))  # 3.10+


def top_level(name):
    return str(name).split(".", 1)[0]


def load_measured(path):
    """Read a {module: bool} map measured on the runner venv; None when no path."""
    if not path:
        return None
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError("%s: expected a JSON object {module: bool}" % path)
    return {str(k): bool(v) for k, v in data.items()}


def resolve(name, measured=None):
    """(present: bool, tier: 'measured' | 'stdlib' | 'missing')."""
    mod = top_level(name)
    if measured is not None and mod in measured:
        return measured[mod], "measured"
    if mod in STDLIB:
        return True, "stdlib"
    return False, "missing"


def is_available(name, measured=None):
    return resolve(name, measured)[0]


def status(name, measured=None):
    return "present" if is_available(name, measured) else "missing"


def main(argv=None):
    ap = argparse.ArgumentParser(description="three-tier module availability for the code runner")
    ap.add_argument("names", nargs="+")
    ap.add_argument("--runner-modules", metavar="FILE",
                    help="JSON {module: bool} measured against the real runner venv (tier 1)")
    ap.add_argument("--compare-old", action="store_true",
                    help="also print the pre-D2 answer, available.get(m, False), for contrast")
    args = ap.parse_args(argv)
    measured = load_measured(args.runner_modules)
    for n in args.names:
        present, tier = resolve(n, measured)
        print("%-22s %-9s (%s)" % (n, "present" if present else "missing", tier))
    if args.compare_old:
        old = measured or {}
        print("-- and the old broken behaviour, for contrast --")
        for n in args.names:
            print("%-22s %-9s <- OLD: available.get(m, False)" % (
                n, "present" if old.get(top_level(n), False) else "missing"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
