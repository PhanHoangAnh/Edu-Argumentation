#!/usr/bin/env bash
# Deploy Lab (foxai-edu-lab, nn 0.0.0.0:8798 — nginx 443 + the VPN door) from the work PC. Ruling R27, plan D1/D2.
#
#   deploy-lab.sh                     deploy: preflight -> first-run setup (idempotent) ->
#                                     snapshot -> rsync -> sha256 gate -> restart ->
#                                     stability (NRestarts sampled twice) -> health -> content
#                                     ANY failed gate after the rsync rolls back automatically.
#   deploy-lab.sh --rollback [SNAP]   restore the newest snapshot BY NAME (or SNAP), restart, re-gate
#   deploy-lab.sh --list-snapshots    list retained snapshots
#
# Structure copied from app deploy/deploy-study.sh (RETAIN 5, MIN_AVAIL_MB 700, name-ordered
# snapshots, sha256 manifest compare). NOTHING is built on nn: the frontend is built here
# (`npm run build` in lab/frontend) and shipped as dist/.
#
# ⛔ Port 8798. 8793/8794 are Airflow's log servers (airflow.cfg) — the preflight refuses to
#    deploy if anything else listens on 8798 or airflow.cfg claims it.
# ⛔ The runner key goes .68 -> this pipe -> nn stdin -> a mode-600 file. It is never in
#    argv, never on this machine's disk, never printed (contract E4).
# ⛔ Local scratch is /var/tmp, never /tmp (repo law).
set -euo pipefail

HOST="${EDU_LAB_HOST:-nn}"
DN2="${EDU_LAB_RUNNER_HOST:-dn2}"
REMOTE_DIR="/srv/foxai/edu-lab"
SERVICE="foxai-edu-lab"
PORT=8798
VENV="/home/ubuntu/edu-lab-venv"
ENV_FILE="/home/ubuntu/.config/foxai/edu-lab.env"
UNIT_PATH="/etc/systemd/system/${SERVICE}.service"
RUNNER_URL="http://192.168.100.68:8790"
VPN_CIDR="10.10.100.0/24"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_BACKEND="${LAB_DIR}/backend"
LOCAL_WEB="${LAB_DIR}/frontend/dist"
LOCAL_UNIT="${SCRIPT_DIR}/${SERVICE}.service"
SCRATCH="/var/tmp/edu-lab-deploy"
RETAIN=5
MIN_AVAIL_MB=700
BASE_URL="http://127.0.0.1:${PORT}"   # curl runs ON nn (loopback = the proxy's view)
DIRECT_HOST="192.168.100.66"           # the VPN door: a non-loopback peer, plain HTTP
STUDY_PORT=8767

log()  { printf '[deploy-lab] %s\n' "$*"; }
fail() { printf '[deploy-lab] FAIL: %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ preflight
preflight() {
  log "preflight against ${HOST}"
  ssh "$HOST" true || fail "cannot reach ${HOST}"
  local avail
  avail="$(ssh "$HOST" "free -m | awk '/^Mem:/{print \$7}'")"
  [[ -n "$avail" ]] || fail "could not read available memory on ${HOST}"
  log "available memory on ${HOST}: ${avail} MB (floor ${MIN_AVAIL_MB} MB)"
  (( avail >= MIN_AVAIL_MB )) || fail "available memory ${avail} MB is below the ${MIN_AVAIL_MB} MB floor"

  # T1-port: nothing but Lab itself may listen on 8798, and Airflow must not claim it.
  local claim listener lab_pid
  claim="$(ssh "$HOST" "grep -nE '= *${PORT}\\b' ~/airflow/airflow.cfg || true")"
  [[ -z "$claim" ]] || fail "airflow.cfg claims port ${PORT}: ${claim}"
  listener="$(ssh "$HOST" "sudo -n ss -ltnpH 'sport = :${PORT}' || true")"
  if [[ -n "$listener" ]]; then
    lab_pid="$(ssh "$HOST" "systemctl show -p MainPID --value ${SERVICE} 2>/dev/null || echo 0")"
    grep -q "pid=${lab_pid}," <<<"$listener" && [[ "$lab_pid" != "0" ]] \
      || fail "something other than ${SERVICE} listens on ${PORT}: ${listener}"
    log "port ${PORT}: held by ${SERVICE} (pid ${lab_pid}) — redeploy"
  else
    log "port ${PORT}: free"
  fi
}

artifact_policy() {
  [[ -f "${LOCAL_BACKEND}/lab_server.py" ]] || fail "backend not found: ${LOCAL_BACKEND}"
  [[ -f "${LOCAL_WEB}/index.html" ]] || fail "no ${LOCAL_WEB}/index.html — run 'npm run build' in lab/frontend first"
  ls "${LOCAL_WEB}"/assets/*.js >/dev/null 2>&1 || fail "no hashed bundle in ${LOCAL_WEB}/assets"
  ! grep -q 'cdn.tailwindcss' "${LOCAL_WEB}/index.html" || fail "the built index.html references the Tailwind CDN (ruling R8)"
  log "artifact policy: prebuilt only"
}

# ------------------------------------------------------------------ first-run setup (idempotent)
setup_env_file() {
  if ssh "$HOST" "test -f '${ENV_FILE}' && grep -qE '^EDU_RUNNER_KEY=.{32,}\$' '${ENV_FILE}'"; then
    log "env file: runner key present"
  else
    log "env file: copying the runner key from ${DN2} over a pipe (never argv, never printed)"
    ssh "$DN2" "sudo -n grep '^EDU_RUNNER_KEY=' /etc/edu-runner/runner.env" \
      | ssh "$HOST" "umask 077; mkdir -p ~/.config/foxai; cat > '${ENV_FILE}.new' && mv '${ENV_FILE}.new' '${ENV_FILE}'"
    ssh "$HOST" "grep -qE '^EDU_RUNNER_KEY=.{32,}\$' '${ENV_FILE}'" || fail "the runner key did not arrive in ${ENV_FILE}"
  fi
  ssh "$HOST" "grep -q '^EDU_LAB_RUNNER_URL=' '${ENV_FILE}' || printf 'EDU_LAB_RUNNER_URL=%s\n' '${RUNNER_URL}' >> '${ENV_FILE}'; chmod 600 '${ENV_FILE}'"
  log "env file: $(ssh "$HOST" "stat -c '%a %U' '${ENV_FILE}'") ${ENV_FILE}"
}

setup_venv() {
  ssh "$HOST" "test -x '${VENV}/bin/python' || /usr/bin/python3 -m venv '${VENV}'"
  local want have
  want="$(sha256sum "${LOCAL_BACKEND}/requirements.txt" | cut -c1-64)"
  have="$(ssh "$HOST" "cat '${VENV}/.lab-requirements.sha' 2>/dev/null || true")"
  if [[ "$want" != "$have" ]]; then
    log "venv: installing pinned requirements"
    rsync -a "${LOCAL_BACKEND}/requirements.txt" "${HOST}:/var/tmp/edu-lab-requirements.txt"
    ssh "$HOST" "'${VENV}/bin/pip' install --quiet --upgrade pip >/dev/null && '${VENV}/bin/pip' install --quiet -r /var/tmp/edu-lab-requirements.txt && printf '%s' '${want}' > '${VENV}/.lab-requirements.sha' && rm -f /var/tmp/edu-lab-requirements.txt"
  else
    log "venv: requirements unchanged"
  fi
  ssh "$HOST" "'${VENV}/bin/python' -c 'import fastapi,uvicorn,httpx;print(\"venv:\",fastapi.__version__,uvicorn.__version__,httpx.__version__)'"
}

setup_unit() {
  if ssh "$HOST" "cmp -s - '${UNIT_PATH}'" < "$LOCAL_UNIT"; then
    log "unit: unchanged"
  else
    ssh "$HOST" "sudo -n tee '${UNIT_PATH}' >/dev/null" < "$LOCAL_UNIT"
    ssh "$HOST" "sudo -n systemctl daemon-reload && sudo -n systemctl enable '${SERVICE}' >/dev/null 2>&1"
    log "unit: installed + enabled"
  fi
}

setup_ufw() {
  if ssh "$HOST" "sudo -n ufw status | grep -qE '^${PORT}/tcp +ALLOW +${VPN_CIDR//./\\.}'"; then
    log "ufw: ${PORT}/tcp from ${VPN_CIDR} already allowed"
  else
    ssh "$HOST" "sudo -n ufw allow from '${VPN_CIDR}' to any port ${PORT} proto tcp >/dev/null"
    log "ufw: ${PORT}/tcp ALLOW from ${VPN_CIDR} added (same rule shape as its siblings)"
  fi
}

# ------------------------------------------------------------------ snapshot / transfer / sha
snapshot() {
  SNAP_TS="$(date -u +%Y%m%dT%H%M%SZ)"
  SNAP_DIR="${REMOTE_DIR}.snapshots/${SNAP_TS}"
  if ssh "$HOST" "test -d '${REMOTE_DIR}/backend'"; then
    ssh "$HOST" "sudo -n mkdir -p '$(dirname "$SNAP_DIR")' && sudo -n cp -a '${REMOTE_DIR}' '${SNAP_DIR}'"
    log "snapshot: ${SNAP_DIR}"
  else
    SNAP_DIR=""
    log "first deploy — nothing to snapshot"
  fi
  ssh "$HOST" "ls -1d '${REMOTE_DIR}.snapshots'/* 2>/dev/null | LC_ALL=C sort | head -n -${RETAIN} | while read -r d; do echo '[deploy-lab] pruning '\"\$d\"; sudo -n rm -rf \"\$d\"; done; true" || true
}

newest_snapshot() {
  ssh "$HOST" "ls -1d '${REMOTE_DIR}.snapshots'/* 2>/dev/null | LC_ALL=C sort | tail -1"
}

transfer() {
  ssh "$HOST" "sudo -n install -d -o ubuntu -g ubuntu -m 755 '${REMOTE_DIR}' '${REMOTE_DIR}/backend' '${REMOTE_DIR}/web'"
  rsync -az --delete --exclude '__pycache__' --exclude '*.pyc' "${LOCAL_BACKEND}/" "${HOST}:${REMOTE_DIR}/backend/"
  rsync -az --delete "${LOCAL_WEB}/" "${HOST}:${REMOTE_DIR}/web/"
  log "transferred backend/ and web/"
}

verify_sha() {
  mkdir -p "$SCRATCH"
  { ( cd "$LOCAL_BACKEND" && find . -type f ! -name '*.pyc' ! -path './__pycache__/*' -exec sha256sum {} + | sed 's|\./|backend/|' )
    ( cd "$LOCAL_WEB" && find . -type f -exec sha256sum {} + | sed 's|\./|web/|' ); } | LC_ALL=C sort -k2 > "${SCRATCH}/local.sha"
  ssh "$HOST" "cd '${REMOTE_DIR}' && find backend web -type f ! -name '*.pyc' ! -path 'backend/__pycache__/*' -exec sha256sum {} +" \
    | LC_ALL=C sort -k2 > "${SCRATCH}/remote.sha"
  if diff -u "${SCRATCH}/local.sha" "${SCRATCH}/remote.sha" > "${SCRATCH}/sha.diff"; then
    log "sha256 gate PASS ($(wc -l < "${SCRATCH}/local.sha") files identical)"
    return 0
  fi
  cat "${SCRATCH}/sha.diff" >&2
  return 1
}

# ------------------------------------------------------------------ service gates
restart_service() {
  ssh "$HOST" "sudo -n systemctl restart '${SERVICE}'"
  sleep 3
  log "restarted ${SERVICE}"
}

stability_gate() {
  local a b pid
  a="$(ssh "$HOST" "systemctl show -p NRestarts --value '${SERVICE}'")"
  sleep 10
  b="$(ssh "$HOST" "systemctl show -p NRestarts --value '${SERVICE}'")"
  log "NRestarts: ${a} then ${b}"
  [[ "$a" == "$b" ]] || { echo "stability RED: restarted between samples (${a} -> ${b})" >&2; return 1; }
  [[ "$(ssh "$HOST" "systemctl is-active '${SERVICE}'")" == "active" ]] || { echo "stability RED: not active" >&2; return 1; }
  pid="$(ssh "$HOST" "systemctl show -p MainPID --value '${SERVICE}'")"
  [[ -n "$pid" && "$pid" != "0" ]] || { echo "stability RED: MainPID 0" >&2; return 1; }
  log "MainPID ${pid}"
}

health_gate() {
  local body
  body="$(ssh "$HOST" "curl -s --max-time 10 -w '\n%{http_code}' '${BASE_URL}/lab/api/health'" || true)"
  [[ "$(tail -1 <<<"$body")" == "200" ]] || { echo "health RED: $(tail -1 <<<"$body")" >&2; return 1; }
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["ok"] is True and d["runner"] in ("up","down"), d; print("[deploy-lab] health:", d)' "$(head -n -1 <<<"$body")" \
    || { echo "health RED: payload" >&2; return 1; }
}

content_gate() {
  # Anonymous page -> 302 to sign-in with next=/lab/ ; the built index + every asset served byte-exact.
  local line ref served disk
  line="$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code} %{redirect_url}' '${BASE_URL}/lab/'")"
  [[ "$line" == "302 ${BASE_URL}/login?next=%2Flab%2F" ]] || { echo "content RED: anonymous /lab/ -> ${line}" >&2; return 1; }
  while read -r ref; do
    [[ -n "$ref" ]] || continue
    served="$(ssh -n "$HOST" "curl -s --max-time 10 '${BASE_URL}${ref}' | sha256sum | cut -c1-64")"
    disk="$(sha256sum "${LOCAL_WEB}${ref#/lab}" | cut -c1-64)"
    [[ "$served" == "$disk" ]] || { echo "content RED: ${ref} served bytes differ" >&2; return 1; }
  done < <(grep -oE '/lab/assets/[A-Za-z0-9._-]+' "${LOCAL_WEB}/index.html" | LC_ALL=C sort -u)
  log "content gate PASS (anonymous 302 -> /login?next=%2Flab%2F; assets byte-exact)"
}

bind_gate() {
  # The VPN door: the listener is on 0.0.0.0 and owned by Lab; ufw's ONLY 8798 rule is the VPN's;
  # a direct anonymous page is sent to the STUDY app's login on its own port, next=/lab/...
  local pid listener rules line
  pid="$(ssh "$HOST" "systemctl show -p MainPID --value '${SERVICE}'")"
  listener="$(ssh "$HOST" "sudo -n ss -ltnpH 'sport = :${PORT}'")"
  grep -qE "^LISTEN .* 0\.0\.0\.0:${PORT} .*pid=${pid}," <<<"$listener" || { echo "bind RED: ${listener}" >&2; return 1; }
  rules="$(ssh "$HOST" "sudo -n ufw status | grep -E '^${PORT}(/tcp)? '" || true)"
  [[ "$(wc -l <<<"$rules")" == "1" ]] && grep -qE "ALLOW( IN)? +${VPN_CIDR//./\\.}" <<<"$rules" || { echo "bind RED: ufw rules for ${PORT}: ${rules}" >&2; return 1; }
  line="$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code} %{redirect_url}' 'http://${DIRECT_HOST}:${PORT}/lab/geron-homl3/ch02-b05'")"
  [[ "$line" == "302 http://${DIRECT_HOST}:${STUDY_PORT}/login?next=%2Flab%2Fgeron-homl3%2Fch02-b05" ]] || { echo "bind RED: direct anonymous page -> ${line}" >&2; return 1; }
  log "bind gate PASS (0.0.0.0:${PORT} pid ${pid}; ufw ${PORT} = VPN only; direct anonymous -> :${STUDY_PORT}/login)"
}

gates() { stability_gate && health_gate && content_gate && bind_gate; }

do_rollback() {
  local snap="${1:-}"
  [[ -n "$snap" ]] || snap="$(newest_snapshot)"
  if [[ -z "$snap" ]]; then
    log "no snapshot exists (first deploy) — stopping ${SERVICE} so nothing half-deployed serves"
    ssh "$HOST" "sudo -n systemctl stop '${SERVICE}' || true"
    return 0
  fi
  ssh "$HOST" "test -d '$snap'" || fail "snapshot not found: $snap"
  ssh "$HOST" "sudo -n rm -rf '${REMOTE_DIR}.rollback-tmp' && sudo -n cp -a '$snap' '${REMOTE_DIR}.rollback-tmp' && sudo -n rm -rf '${REMOTE_DIR}' && sudo -n mv '${REMOTE_DIR}.rollback-tmp' '${REMOTE_DIR}'"
  log "rolled back to ${snap}"
  ssh "$HOST" "sudo -n systemctl restart '${SERVICE}'"
  sleep 3
  stability_gate && health_gate && log "rollback VERIFIED (stability + health)" || log "rollback restored the tree but its gates are RED — investigate"
}

main() {
  local mode="deploy" snap_arg=""
  while (( $# )); do
    case "$1" in
      --rollback) mode="rollback"; [[ "${2:-}" == --* || -z "${2:-}" ]] || { snap_arg="$2"; shift; } ;;
      --list-snapshots) mode="list" ;;
      *) fail "unknown argument: $1" ;;
    esac
    shift
  done
  case "$mode" in
    list) ssh "$HOST" "ls -1d '${REMOTE_DIR}.snapshots'/* 2>/dev/null | LC_ALL=C sort || true"; exit 0 ;;
    rollback) do_rollback "$snap_arg"; exit 0 ;;
  esac

  mkdir -p "$SCRATCH"
  preflight
  artifact_policy
  setup_env_file
  setup_venv
  setup_unit
  setup_ufw
  snapshot
  transfer
  if ! verify_sha; then do_rollback "${SNAP_DIR:-}"; fail "sha256 mismatch; rolled back"; fi
  restart_service
  if ! gates; then do_rollback "${SNAP_DIR:-}"; fail "post-restart gates failed; rolled back"; fi
  log "DEPLOY OK — ${SERVICE} on 0.0.0.0:${PORT}"
}

main "$@"
