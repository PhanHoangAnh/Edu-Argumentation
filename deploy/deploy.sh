#!/usr/bin/env bash
# =============================================================================
# deploy.sh — the ONLY sanctioned way to deploy the Edu-Argumentation app (:8767)
#
# Written for edu-replatform Phase 01. This script exists because BOTH sibling
# deploy scripts in this repo (deploy-dev.sh / deploy-prod.sh) have two defects:
#   1. they run `rsync --delete` BEFORE the sha256 gate, so a failed verify
#      leaves NEW FILES ON DISK with the OLD PROCESS RUNNING — a silent split
#      state that reports failure and walks away; and
#   2. they have no rollback at all (`grep -c rollback` returns 0 in both).
# This script fixes both: it SNAPSHOTS first, and a failed verify AUTO-INVOKES
# the rollback rather than merely exiting.
#
# ORDERING IS LOAD-BEARING. Do not reorder these steps:
#   1 preflight (RAM/swap)   2 refuse-to-build   3 SNAPSHOT   4 rsync
#   5 sha256 verify          6 content gate      7 restart
#   8 NRestarts x2           9 health
#
# SCOPE FENCES (Phase 01 rulings):
#   - This script NEVER writes to the user's data directory. That directory is
#     a SIBLING of the deploy tree; rsync's source AND destination are both the
#     tree, so --delete structurally cannot reach it. The sha256 is the proof;
#     the path separation is the reason.
#   - This script NEVER builds anything on the target host. See step 2.
#   - --install-unit is OPT-IN and defaults OFF. Phase 01 never installs the unit.
#   - All local scratch lives under /var/tmp. NEVER /tmp or /dev/shm on the
#     workstation: there they are tmpfs, i.e. RAM, on a 15 GiB box.
# =============================================================================
set -euo pipefail

HOST="${EDU_HOST:-nn}"
REMOTE_DIR="${EDU_REMOTE_DIR:-/srv/foxai/edu-argumentation}"
SERVICE="${EDU_SERVICE:-foxai-edu-argumentation}"
HEALTH_URL="${EDU_HEALTH_URL:-http://192.168.100.66:8767}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# deploy/ is a SIBLING of aws-quiz-app/, so --delete can never reach this script.
LOCAL_DIR="${EDU_LOCAL_DIR:-${SCRIPT_DIR}/../aws-quiz-app}"
SCRATCH="${EDU_SCRATCH:-/var/tmp/p1-drill}"
RETAIN=5

# --- RAM/swap floors -------------------------------------------------------
# These are a START-A-SERVICE floor, never a build gate (see step 2).
EDU_MIN_RAM_MB="${EDU_MIN_RAM_MB:-400}"     # hard floor: abort below this
EDU_SOFT_RAM_MB="${EDU_SOFT_RAM_MB:-1000}"  # soft floor: used by the compound swap rule
EDU_MIN_SWAP_MB="${EDU_MIN_SWAP_MB:-20}"    # swap floor; compared with -lt so EXACTLY 20 PASSES

# The four excludes. IDENTICAL set is used by the rsync AND by the verify
# manifest. If they ever diverge, `sha256sum -c` reports missing files, verify
# fails, and the auto-rollback destroys a perfectly good deploy.
EXCLUDES=(
  --exclude='__pycache__/'
  --exclude='*.pyc'
  --exclude='.DS_Store'
  --exclude='data/geron_hands_on_ml_ch01_ch09.json'
)

MODE=deploy
DRY_RUN=0
INSTALL_UNIT=0          # OPT-IN, DEFAULT OFF. Phase 01 must not install the unit.
ASSUME_YES=0
ROLLBACK_ID=""

usage() {
  cat <<'USAGE'
Usage:
  deploy.sh [--dry-run] [--install-unit]
  deploy.sh --rollback [<snapshot-id>] [--yes]

  --dry-run        Show what would transfer and what would be deleted. No writes.
  --install-unit   OPT-IN, DEFAULT OFF. Phase 01 does not install the systemd unit.
  --rollback       Restore a snapshot. With no <snapshot-id> it PRINTS the target
                   it would restore and EXITS WITHOUT RESTORING. "Newest wins" is
                   deliberately NOT implemented: this phase invokes --rollback
                   twice, and a deploy in between would make "newest" the wrong tree.
  --yes            Confirm a --rollback whose id was resolved rather than given.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)      DRY_RUN=1; shift ;;
    --install-unit) INSTALL_UNIT=1; shift ;;
    --yes)          ASSUME_YES=1; shift ;;
    --rollback)     MODE=rollback; shift
                    if [[ $# -gt 0 && "$1" != --* ]]; then ROLLBACK_ID="$1"; shift; fi ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "deploy.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log()  { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy] FATAL: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Step 1 — preflight: RAM and swap on the TARGET host
# ---------------------------------------------------------------------------
# READ `available`, WHICH IS COLUMN 7 OF `free -m`, NOT `free` (COLUMN 4).
# This is a one-word difference with a ~16x gap: on this host `free` reads a few
# hundred MB while `available` reads several thousand. A future reader who
# "fixes" $7 to $4 breaks this script at any sane threshold. DO NOT CHANGE IT.
preflight() {
  local avail swapfree
  read -r avail swapfree < <(ssh "$HOST" "free -m | awk '/^Mem:/{a=\$7} /^Swap:/{s=\$4} END{print a, s}'")
  log "preflight: available=${avail} MB, swap_free=${swapfree} MB (floors: hard=${EDU_MIN_RAM_MB}, soft=${EDU_SOFT_RAM_MB}, swap=${EDU_MIN_SWAP_MB})"

  if [[ "$avail" -lt "$EDU_MIN_RAM_MB" ]]; then
    fail "available RAM ${avail} MB is below the hard floor ${EDU_MIN_RAM_MB} MB. Refusing to restart a service into an OOM."
  fi
  # COMPOUND RULE (adopted from the learn-app deploy script, the better sibling):
  # an exhausted swap is only fatal when RAM is ALSO tight. Swap free on this host
  # has been measured at 20, 12, 21 and 16 MB within a single planning window --
  # it is volatile by nature. The compound rule is the protection; the constant
  # is not. DO NOT re-tune EDU_MIN_SWAP_MB to chase a measurement.
  if [[ "$swapfree" -lt "$EDU_MIN_SWAP_MB" && "$avail" -lt "$EDU_SOFT_RAM_MB" ]]; then
    fail "swap exhausted (${swapfree} MB) AND available RAM ${avail} MB is below the soft floor ${EDU_SOFT_RAM_MB} MB."
  fi
  log "preflight: PASS"
}

# ---------------------------------------------------------------------------
# Step 2 — refuse to build on the target host
# ---------------------------------------------------------------------------
# THIS SCRIPT SHIPS PREBUILT ARTIFACTS ONLY AND MUST NEVER RUN A BUNDLER,
# COMPILER OR PACKAGE MANAGER ON THE TARGET HOST.
# Rationale, not theory: on 2026-09-02 that host ran out of RAM (276 MB free,
# swap 100%) and six services had to be stopped to recover it. An out-of-memory
# event there takes a JVM with it. The floors in step 1 exist to decide whether
# it is safe to START A SERVICE -- they are NOT a licence to build.
refuse_to_build() {
  [[ -d "$LOCAL_DIR" ]] || fail "local source tree not found: $LOCAL_DIR"
  log "artifact policy: prebuilt only; no build step is invoked on ${HOST}"
}

# ---------------------------------------------------------------------------
# Step 3 — snapshot the remote tree BEFORE any transfer
# ---------------------------------------------------------------------------
# This is the half the sibling scripts are missing. Their gate aborts AFTER the
# rsync has already overwritten the tree, with nothing to go back to.
snapshot() {
  SNAP_TS="$(date -u +%Y%m%dT%H%M%SZ)"
  SNAP_DIR="foxai-backups/edu-arg-deploy-${SNAP_TS}"
  log "snapshot: ~/${SNAP_DIR}"
  ssh "$HOST" "set -e
    mkdir -p \"\$HOME/${SNAP_DIR}/tree\"
    cp -a '${REMOTE_DIR}/.' \"\$HOME/${SNAP_DIR}/tree/\"
    cd \"\$HOME/${SNAP_DIR}/tree\" && find . -type f -print0 | LC_ALL=C sort -z \
      | xargs -0 sha256sum > \"\$HOME/${SNAP_DIR}/manifest.sha256\"
    echo \"[deploy] snapshot files: \$(find \"\$HOME/${SNAP_DIR}/tree\" -type f | wc -l)\""
  log "snapshot id: edu-arg-deploy-${SNAP_TS}"
}

# ORDERING IS BY NAME, AND THAT IS DELIBERATE — do not "fix" it to `ls -t`.
# Audited 2026-09-22 against defect D-13 in the sibling deploy-study.sh, and this
# script is NOT affected: both this prune and do_rollback's no-argument resolution
# already use `LC_ALL=C sort` on the id, which is ISO-8601 basic format and
# therefore sorts chronologically. D-13 is what happens when this is mtime-based:
# snapshot() copies with `cp -a`, which preserves the SOURCE mtime, so every
# snapshot ties and an mtime sort deletes an arbitrary one. ⛔ Never switch this
# to `ls -t`, `ls -1dt` or any other mtime-derived ordering.
prune_snapshots() {
  log "retention: keeping the newest ${RETAIN} edu-arg-deploy-* snapshots (ordered BY NAME, never mtime)"
  ssh "$HOST" "cd \"\$HOME/foxai-backups\" 2>/dev/null || exit 0
    ls -1d edu-arg-deploy-* 2>/dev/null | LC_ALL=C sort | head -n -${RETAIN} \
      | while read -r d; do echo \"[deploy] pruning \$d\"; rm -rf \"\$d\"; done
    true"
}

# ---------------------------------------------------------------------------
# Step 4 — transfer
# ---------------------------------------------------------------------------
do_rsync() {
  local extra=()
  [[ "$DRY_RUN" -eq 1 ]] && extra+=(--dry-run)
  log "rsync ${LOCAL_DIR}/ -> ${HOST}:${REMOTE_DIR}/"
  # -avz, NOT -az: without -v rsync prints NO deletion lines at all, which makes
  # any deletion fence downstream VACUOUS.
  rsync -avz --delete "${extra[@]}" "${EXCLUDES[@]}" "${LOCAL_DIR}/" "${HOST}:${REMOTE_DIR}/"
}

deletion_count() {
  rsync -avz --delete --dry-run "${EXCLUDES[@]}" "${LOCAL_DIR}/" "${HOST}:${REMOTE_DIR}/" 2>&1 \
    | grep -c '^deleting ' || true
}

# ---------------------------------------------------------------------------
# Step 5 — sha256 verify; a MISMATCH AUTO-INVOKES THE ROLLBACK
# ---------------------------------------------------------------------------
# The manifest MUST apply the IDENTICAL excludes as the transfer. Building it
# from a bare `find . -type f` would list files that were deliberately NOT
# transferred; `sha256sum -c` would then report them missing, verify would fail,
# and the auto-rollback below would destroy a perfectly good deploy on this
# script's very first real run.
build_verify_manifest() {
  mkdir -p "$SCRATCH"
  ( cd "$LOCAL_DIR" && find . -type f \
      -not -path './__pycache__/*' \
      -not -name '*.pyc' \
      -not -name '.DS_Store' \
      -not -path './data/geron_hands_on_ml_ch01_ch09.json' \
      -print0 | LC_ALL=C sort -z | xargs -0 sha256sum ) > "${SCRATCH}/verify.sha256"
  log "verify manifest: $(wc -l < "${SCRATCH}/verify.sha256") lines -> ${SCRATCH}/verify.sha256"
}

verify() {
  build_verify_manifest
  scp -q "${SCRATCH}/verify.sha256" "${HOST}:${SCRATCH}/verify.sha256"
  if ssh "$HOST" "cd '${REMOTE_DIR}' && sha256sum -c --quiet '${SCRATCH}/verify.sha256'"; then
    log "verify: OK"
    return 0
  fi
  log "verify: FAILED — AUTO-INVOKING ROLLBACK (this is the fix for the siblings' split state)"
  restore_snapshot "edu-arg-deploy-${SNAP_TS}"
  restart_service
  # ASYMMETRY CLOSED 2026-09-22. Until now this path stopped at restart_service,
  # while the explicit --rollback ran nrestarts_check + content_gate + health.
  # A sha-mismatch recovery therefore brought the service back up WITHOUT EVER
  # ASSERTING THE LIBRARY WAS INTACT -- and `content_gate` is the only gate here
  # that can tell "serving" from "serving the right thing": a wrong library root
  # returns 200 with an EMPTY book list. Both rollback paths now verify identically.
  # If a gate below fails, its message is the right one to surface: it means the
  # ROLLBACK is bad, which is strictly worse news than the sha mismatch above.
  log "verify: rollback restored — now re-verifying it (stability + content + health)"
  nrestarts_check
  content_gate
  health
  log "verify: rollback VERIFIED"
  fail "sha256 verify failed; the tree was rolled back to edu-arg-deploy-${SNAP_TS} and the rollback was verified"
}

# ---------------------------------------------------------------------------
# Step 6 — content health gate
# ---------------------------------------------------------------------------
# There is NO /healthz on this service, and a status code is not enough: a wrong
# library root returns 200 with an EMPTY list. So assert CONTENT.
# The expected value is MEASURED then FROZEN -- never assumed. An earlier
# revision of this phase asserted "exactly 2 books" with a field named `id`;
# live measurement showed a DICT payload, the field `moduleId`, and 5 books.
# Two entries legitimately share one moduleId, so this compares the SORTED LIST,
# never a set -- a set would let a lost book pass silently.
EDU_EXPECT_MODULES="${EDU_EXPECT_MODULES:-5 ['geron-homl3', 'openintro-statistics-2019-1045f2f5', 't-domain-4-deep-dive-deployment-mlops', 't-sagemaker-clarify-bias-mastery', 't-sagemaker-clarify-bias-mastery']}"

# Parse a /api/modules payload on stdin into the canonical "<count> <sorted list>" form.
parse_modules() {
  python3 -c "import sys,json;b=json.load(sys.stdin)['books'];print(len(b), sorted(x['moduleId'] for x in b))"
}

# Compare a canonical form against the frozen expectation. Used by the live gate
# AND by the fault-proof, so the fault-proof exercises the REAL comparison.
compare_modules() {
  local got="$1"
  if [[ "$got" == 0\ * ]]; then
    echo "content gate RED: 0 books -- wrong library root (the 'healthy and empty' failure a status gate would pass)" >&2
    return 1
  fi
  if printf '%s' "$got" | grep -q 'geron_hands_on_ml_ch01_ch09'; then
    echo "content gate RED: the excluded 4.6 MB JSON leaked through and added a duplicate book" >&2
    return 1
  fi
  if [[ "$got" != "$EDU_EXPECT_MODULES" ]]; then
    echo "content gate RED: module list changed." >&2
    echo "  expected: ${EDU_EXPECT_MODULES}" >&2
    echo "  got:      ${got}" >&2
    return 1
  fi
  return 0
}

content_gate() {
  local out
  out="$(curl -s "${HEALTH_URL}/api/modules" | parse_modules)"
  log "content gate: ${out}"
  compare_modules "$out" || fail "content gate failed"
  log "content gate: OK (matches the frozen measured baseline)"
}


# ---------------------------------------------------------------------------
# Steps 7-9 — restart, crash-loop check, health
# ---------------------------------------------------------------------------
restart_service() {
  log "restarting ${SERVICE}"
  ssh "$HOST" "sudo systemctl restart '${SERVICE}'"
  sleep 3
}

# `systemctl is-active` is WORTHLESS for this unit: it is Restart=always with
# RestartSec=3, so a broken tree CRASH-LOOPS rather than stopping, and is-active
# keeps flickering to "active". Sample NRestarts TWICE instead.
nrestarts_check() {
  local a b
  a="$(ssh "$HOST" "systemctl show -p NRestarts --value '${SERVICE}'")"
  sleep 4
  b="$(ssh "$HOST" "systemctl show -p NRestarts --value '${SERVICE}'")"
  log "NRestarts: ${a} then ${b}"
  [[ "$a" == "$b" ]] || fail "NRestarts moved ${a} -> ${b}: the service is crash-looping"
}

health() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "${HEALTH_URL}/")"
  log "health: ${code}"
  case "$code" in 200\ *) ;; *) fail "health check returned: ${code}" ;; esac
}

install_unit() {
  # OPT-IN ONLY. Phase 01 never calls this: the unit has zero drift today, and
  # it lives inside the rsync tree, so installing from there is how a stale repo
  # copy silently reverts the box.
  fail "--install-unit is not implemented in Phase 01 by ruling O2/O3. Pin store paths in Phase 02, which stands up a new unit anyway."
}

restore_snapshot() {
  local id="$1"
  log "restoring snapshot ${id} -> ${REMOTE_DIR}"
  ssh "$HOST" "set -e
    S=\"\$HOME/foxai-backups/${id}\"
    [ -d \"\$S/tree\" ] || { echo '[deploy] FATAL: no such snapshot tree: '\"\$S/tree\" >&2; exit 1; }
    rsync -a --delete \"\$S/tree/\" '${REMOTE_DIR}/'
    cd '${REMOTE_DIR}' && sha256sum -c --quiet \"\$S/manifest.sha256\" && echo '[deploy] snapshot manifest verified after restore'"
}

do_rollback() {
  if [[ -z "$ROLLBACK_ID" ]]; then
    local newest
    newest="$(ssh "$HOST" "cd \"\$HOME/foxai-backups\" && ls -1d edu-arg-deploy-* 2>/dev/null | LC_ALL=C sort | tail -1")"
    echo "[deploy] --rollback was called with NO snapshot id."
    echo "[deploy] The snapshot it WOULD restore is: ~/foxai-backups/${newest:-<none found>}"
    echo "[deploy] NOTHING HAS BEEN RESTORED."
    echo "[deploy] 'newest wins' is deliberately not automatic: this phase rolls back twice,"
    echo "[deploy] and a deploy in between would make 'newest' the wrong tree."
    echo "[deploy] Re-run as:  deploy.sh --rollback ${newest:-<snapshot-id>}"
    exit 3
  fi
  restore_snapshot "$ROLLBACK_ID"
  restart_service
  nrestarts_check
  content_gate
  health
  log "rollback complete: ${ROLLBACK_ID}"
}

# ---------------------------------------------------------------------------
# ⚑ edu-replatform P6b (24-09-26): the NEW app (foxai-edu-study) owns :8767 and this script's unit
#   (foxai-edu-argumentation) is stopped + disabled. A deploy or --rollback from here would restart the
#   old unit into a port the new app holds: it cannot bind, Restart=always crash-loops it, and the
#   NRestarts gate reports a failure AFTER the tree was already swapped. Refuse up front instead.
#   To bring the old stack back, follow the rollback in
#   process/features/ml/active/edu-replatform_21-09-26/phase-06b-cutover_REPORT_24-09-26.md (move the
#   new unit back to :8792 FIRST); this guard then lets the script run again.
refuse_if_new_app_owns_8767() {
  if ssh "$HOST" "systemctl cat foxai-edu-study 2>/dev/null | grep -q -- '--port 8767'"; then
    fail "foxai-edu-study owns :8767 (P6b cutover). Refusing to deploy/restart ${SERVICE} into that port. See the P6b report for the rollback order."
  fi
}

main() {
  [[ "$DRY_RUN" -eq 1 ]] || refuse_if_new_app_owns_8767
  if [[ "$MODE" == rollback ]]; then do_rollback; exit 0; fi
  if [[ "$INSTALL_UNIT" -eq 1 ]]; then install_unit; fi

  preflight
  refuse_to_build

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY RUN — no snapshot, no transfer, no restart"
    log "files scheduled for deletion: $(deletion_count)"
    do_rsync
    build_verify_manifest
    exit 0
  fi

  log "files scheduled for deletion: $(deletion_count)"
  snapshot
  do_rsync
  verify
  restart_service
  nrestarts_check
  content_gate
  health
  prune_snapshots
  log "DEPLOY OK (snapshot: edu-arg-deploy-${SNAP_TS})"
}

# Run main only when EXECUTED, not when SOURCED. Sourcing lets the fault-proof
# probes (G6) exercise the REAL comparison function rather than a reimplementation
# of it -- a gate proven against a copy of itself proves nothing.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
