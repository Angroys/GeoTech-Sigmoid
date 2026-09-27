#!/usr/bin/env bash
# Start the GeoTech Vite + React frontend.
#
# Env overrides:
#   HOST   bind address (default 0.0.0.0 — reachable by Headscale mesh peers)
#   PORT   listen port  (default 5173)
#   MODE   set to "preview" to build then serve the production bundle;
#          anything else (default) runs the Vite dev server.
#   VITE_API_BASE  backend base URL for a BUILT/preview app when the backend is
#                  NOT same-origin (e.g. http://<backend-headscale-ip>:8000).
#                  The dev server instead proxies /api -> http://localhost:8000
#                  (see frontend/vite.config), so it is only needed when backend
#                  runs on a different host/port.
set -euo pipefail

# Resolve the worktree/repo root relative to this script so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}/frontend"

# Install node deps if missing.
if [ ! -d "node_modules" ]; then
  echo "[run-frontend] node_modules not found — running npm install..." >&2
  npm install
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-5173}"

if [ "${MODE:-dev}" = "preview" ]; then
  echo "[run-frontend] building production bundle..." >&2
  npm run build
  echo "[run-frontend] serving preview on ${HOST}:${PORT}" >&2
  exec npm run preview -- --host "${HOST}" --port "${PORT}"
else
  echo "[run-frontend] starting Vite dev server on ${HOST}:${PORT}" >&2
  exec npm run dev -- --host "${HOST}" --port "${PORT}"
fi
