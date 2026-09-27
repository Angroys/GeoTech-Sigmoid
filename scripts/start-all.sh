#!/usr/bin/env bash
# Start the whole stack: route-algo FastAPI backend (POST /plan + /api/surveys)
# and the vineyard-front Bun dev server, wired together. Ctrl+C stops both services.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/start-all.sh [--no-install] [--no-model] [--fallback] [--help]

Starts the backend (uvicorn route_algo.api:app) and the frontend (bun dev),
installing uv / bun and project dependencies on first run.

Model mode is on when an NVIDIA GPU is detected (nvidia-smi -L succeeds):
the backend is synced with the optional `model` extra (torch cu128 + sam3,
several GB on the first run) and processes uploaded tiles with the newest
fine-tuned SAM 3 run present (run5, else run3c). Without a GPU, or with
--no-model / --fallback, only that run's precomputed labels are served.

The web server binds $HOST (default 0.0.0.0, i.e. reachable from the LAN);
the backend stays on 127.0.0.1 behind the web server's /api proxy.

Options:
  --no-install  Skip installing uv/bun and running uv sync / bun install.
  --no-model    Do not install or use the SAM 3 model (fallback labels only).
  --fallback    Set PROCESSING_FORCE_FALLBACK=1 (serve precomputed labels
                instead of running the SAM 3 model). Implies --no-model.
  -h, --help    Show this help.

Environment (all optional):
  BACKEND_PORT               Backend port (default 8001)
  FRONTEND_PORT              Frontend port (default 3000)
  HOST                       Web server bind address (default 0.0.0.0 = all interfaces;
                             use 127.0.0.1 for local-only)
  DATA_DIR                   Data root (default: <repo>/data, else main checkout's data/)
  SAM3_FT_WEIGHTS            Fine-tuned checkpoint (default $DATA_DIR/tested-on-vm/sam3_ft/run5/
                             best_effective.pth, else run5/best.pth, else the same under run3c/)
  SAM3_BASE_WEIGHTS          Base SAM 3 weights, needed with raw best.pth
                             (default $DATA_DIR/weights/sam3/sam3.pt)
  SAM3_PARCELS, SAM3_TTA     Passed through to the model if you set them
  SAM3_FALLBACK_LABELS_DIR   Precomputed labels (default <run5 or run3c>/labels)
  PROCESSING_DATA_DIR        Upload/job storage (default route-algo/.processing-data)
  ROUTE_CONSTRAINTS_DIR      Sireț3 02_route constraints (default: organizer assets if found)
USAGE
}

INSTALL=1
USE_MODEL=auto
for arg in "$@"; do
  case "$arg" in
    --no-install) INSTALL=0 ;;
    --no-model) USE_MODEL=0 ;;
    --fallback) export PROCESSING_FORCE_FALLBACK=1; USE_MODEL=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

log()  { printf '[start] %s\n' "$*"; }
warn() { printf '[start] WARNING: %s\n' "$*" >&2; }
die()  { printf '[start] ERROR: %s\n' "$*" >&2; exit 1; }

# port_in_use PORT: true if something already accepts TCP connections on PORT.
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}
check_port() {
  if port_in_use "$2"; then
    die "$1 port $2 is already in use (set ${1^^}_PORT to another port)"
  fi
}
check_port backend "$BACKEND_PORT"
check_port frontend "$FRONTEND_PORT"

# ---------------------------------------------------------------- model mode
if [[ $USE_MODEL == auto ]]; then
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    USE_MODEL=1
    log "GPU detected: $(nvidia-smi -L | head -n1)"
  else
    USE_MODEL=0
    log "No NVIDIA GPU detected; running without the SAM 3 model."
  fi
fi

# ---------------------------------------------------------------- tooling
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
  [[ $INSTALL -eq 1 ]] || die "uv not found and --no-install given"
  log "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  command -v uv >/dev/null 2>&1 || die "uv installation failed"
fi

if ! command -v bun >/dev/null 2>&1; then
  [[ $INSTALL -eq 1 ]] || die "bun not found and --no-install given"
  log "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "bun installation failed"
fi

if [[ $INSTALL -eq 1 ]]; then
  if [[ $USE_MODEL -eq 1 ]]; then
    warn "syncing backend with the 'model' extra (torch + sam3); the first run downloads several GB"
    uv sync --project "$ROOT/route-algo" --locked --extra model
  else
    log "Syncing backend dependencies (uv sync)..."
    uv sync --project "$ROOT/route-algo" --locked
  fi
  FRONT="$ROOT/vineyard-front"
  if [[ ! -d "$FRONT/node_modules" || "$FRONT/bun.lock" -nt "$FRONT/node_modules" ]]; then
    log "Installing frontend dependencies (bun install)..."
    (cd "$FRONT" && bun install --frozen-lockfile)
    touch "$FRONT/node_modules"
  fi
fi

# ---------------------------------------------------------------- data defaults
resolve_data_dir() {
  if [[ -n "${DATA_DIR:-}" ]]; then printf '%s' "$DATA_DIR"; return; fi
  if [[ -d "$ROOT/data" ]]; then printf '%s' "$ROOT/data"; return; fi
  local common
  if common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
     && [[ -d "$common/../data" ]]; then
    (cd "$common/../data" && pwd); return
  fi
  printf '%s' "$ROOT/data"
}
REPO_DATA="$(resolve_data_dir)"
[[ -d "$REPO_DATA" ]] || warn "data directory not found ($REPO_DATA); set DATA_DIR"

# default_path VAR candidate... : export the first existing candidate if VAR unset.
default_path() {
  local var="$1"; shift
  if [[ -n "${!var:-}" ]]; then
    [[ -e "${!var}" ]] || warn "$var=${!var} does not exist"
    return
  fi
  local c
  for c in "$@"; do
    if [[ -e "$c" ]]; then export "$var=$c"; return; fi
  done
  warn "$var not set and no default found (tried: $*)"
}

RUN5="$REPO_DATA/tested-on-vm/sam3_ft/run5"
RUN3C="$REPO_DATA/tested-on-vm/sam3_ft/run3c"
# Prefer the newest fine-tuned run (run5) when present, else run3c.
if [[ -e "$RUN5/best_effective.pth" || -e "$RUN5/best.pth" ]]; then RUN_DIR="$RUN5"; else RUN_DIR="$RUN3C"; fi
if [[ $USE_MODEL -eq 1 ]]; then
  default_path SAM3_FT_WEIGHTS "$RUN_DIR/best_effective.pth" "$RUN_DIR/best.pth" \
    "$RUN3C/best_effective.pth" "$RUN3C/best.pth"
  if [[ -z "${SAM3_BASE_WEIGHTS:-}" && -e "$REPO_DATA/weights/sam3/sam3.pt" ]]; then
    export SAM3_BASE_WEIGHTS="$REPO_DATA/weights/sam3/sam3.pt"
  fi
  # SAM3_PARCELS / SAM3_TTA are not set here; exported values pass through.
  [[ -z "${SAM3_PARCELS:-}" ]] || log "SAM3_PARCELS=$SAM3_PARCELS"
  [[ -z "${SAM3_TTA:-}" ]] || log "SAM3_TTA=$SAM3_TTA"
fi
default_path SAM3_FALLBACK_LABELS_DIR "$RUN_DIR/labels" "$RUN3C/labels"
shopt -s nullglob
constraint_candidates=("$ROOT"/assets_for_participants-*/assets_for_participants/02_route)
shopt -u nullglob
default_path ROUTE_CONSTRAINTS_DIR "${constraint_candidates[@]}" \
  "$REPO_DATA/marcaj-data/assets_for_participants/02_route"

export PROCESSING_DATA_DIR="${PROCESSING_DATA_DIR:-$ROOT/route-algo/.processing-data}"
mkdir -p "$PROCESSING_DATA_DIR"

# Frontend -> backend wiring: one backend serves /plan and /api/surveys.
export PROCESSING_API_URL="$BACKEND_URL"
export ROUTE_API_URL="$BACKEND_URL"

# ---------------------------------------------------------------- processes
API_PID=""
WEB_PID=""
STOPPING=0

cleanup() {
  [[ $STOPPING -eq 1 ]] && return
  STOPPING=1
  trap - INT TERM
  log "Shutting down..."
  local pid
  for pid in $WEB_PID $API_PID; do
    kill -TERM -- "-$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 50); do
    local alive=0
    for pid in $WEB_PID $API_PID; do
      kill -0 -- "-$pid" 2>/dev/null && alive=1
    done
    [[ $alive -eq 0 ]] && break
    sleep 0.1
  done
  for pid in $WEB_PID $API_PID; do
    kill -KILL -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  log "Stopped."
}
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap cleanup EXIT

# start_prefixed PREFIX DIR CMD...: run CMD in DIR in its own process group
# (setsid) with each output line prefixed. Sets $! to the group leader.
start_prefixed() {
  local prefix="$1" dir="$2"; shift 2
  # shellcheck disable=SC2016  # expanded by the inner shell
  setsid bash -c 'prefix="$1"; cd "$2"; shift 2; "$@" 2>&1 | sed -u "s/^/$prefix /"' \
    _ "$prefix" "$dir" "$@" &
}

run_label() { local d; d="$(basename "$(dirname "${1:-x/unknown/x}")")"; printf '%s' "$d"; }
if [[ $USE_MODEL -eq 1 ]]; then
  MODE="live model (SAM 3 $(run_label "${SAM3_FT_WEIGHTS:-}"), weights: ${SAM3_FT_WEIGHTS:-missing}); falls back to precomputed labels on failure"
else
  MODE="fallback only (precomputed $(run_label "${SAM3_FALLBACK_LABELS_DIR:-}") labels: ${SAM3_FALLBACK_LABELS_DIR:-missing})"
fi
log "Processing mode: $MODE"

# Re-check: installs can take a while and something may have grabbed a port.
check_port backend "$BACKEND_PORT"
check_port frontend "$FRONTEND_PORT"

log "Starting backend on $BACKEND_URL"
# --no-sync: a plain `uv run` would re-sync and strip the optional model extra.
start_prefixed "[api]" "$ROOT" uv run --project "$ROOT/route-algo" --no-sync \
  uvicorn route_algo.api:app --host 127.0.0.1 --port "$BACKEND_PORT"
API_PID=$!

log "Waiting for backend health..."
for i in $(seq 1 120); do
  if curl -fsS -o /dev/null "$BACKEND_URL/health" 2>/dev/null; then break; fi
  kill -0 "$API_PID" 2>/dev/null || die "backend exited during startup"
  [[ $i -eq 120 ]] && die "backend did not become healthy within 60s"
  sleep 0.5
done
log "Backend healthy."

log "Starting frontend on $HOST:$FRONTEND_PORT"
# Bun.serve() picks its port from $PORT and its bind address from $HOST (src/index.ts).
start_prefixed "[web]" "$ROOT/vineyard-front" env PORT="$FRONTEND_PORT" HOST="$HOST" bun dev
WEB_PID=$!

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$FRONTEND_URL" 2>/dev/null && break
  sleep 0.5
done

cat <<INFO
[start] ------------------------------------------------------------
[start] Frontend      $FRONTEND_URL  (bound to $HOST)
$([[ $HOST == 0.0.0.0 && -n $LAN_IP ]] && echo "[start] LAN           http://$LAN_IP:$FRONTEND_PORT")
[start] Backend       $BACKEND_URL   (POST /plan, /api/surveys)
[start] Backend docs  $BACKEND_URL/docs
[start] Processing    $MODE
[start] Press Ctrl+C to stop both.
[start] ------------------------------------------------------------
INFO

# Exit (and clean up) as soon as either process dies.
wait -n "$API_PID" "$WEB_PID" 2>/dev/null || true
warn "a service exited; stopping the other"
