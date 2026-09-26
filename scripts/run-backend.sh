#!/usr/bin/env bash
# Start the GeoTech FastAPI backend.
#
# Env overrides:
#   HOST   bind address (default 0.0.0.0 — reachable by Headscale mesh peers)
#   PORT   listen port  (default 8000)
#   DEV    set to 1 to enable uvicorn --reload (local development)
#   GEOTECH_DB    SQLite DB path (see backend/app config; default backend/data/geotech.db)
#   GEOTECH_TILES tiles directory (default points at the repo data path)
#
# The backend serves /api/... and /health.
set -euo pipefail

# Resolve the worktree/repo root relative to this script so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}/backend"

# Ensure the virtualenv exists; create + install deps if missing.
if [ ! -d "venv" ]; then
  echo "[run-backend] venv not found — creating and installing requirements..." >&2
  python3 -m venv venv
  ./venv/bin/pip install --upgrade pip
  ./venv/bin/pip install -r requirements.txt
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

RELOAD_ARGS=()
if [ "${DEV:-0}" = "1" ]; then
  RELOAD_ARGS+=("--reload")
fi

echo "[run-backend] starting uvicorn on ${HOST}:${PORT}${DEV:+ (dev/reload)}" >&2
exec ./venv/bin/uvicorn app.main:app --host "${HOST}" --port "${PORT}" "${RELOAD_ARGS[@]}"
