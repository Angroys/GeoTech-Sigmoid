# Running GeoTech-Sigmoid

Operator guide for running the backend + frontend on the team's Headscale private mesh.

## Prerequisites

- Python 3.11
- Node 18
- The `data/` directory present locally under `backend/` (tiles + example annotations).
  It is **gitignored and never committed** — copy/sync it onto each host out of band.

## One-time setup

The run scripts handle setup automatically:

- `scripts/run-backend.sh` creates `backend/venv` and `pip install -r requirements.txt` if the venv is missing.
- `scripts/run-frontend.sh` runs `npm install` in `frontend/` if `node_modules` is missing.

So a fresh checkout just needs the two scripts — no manual bootstrap.

## Start on the Headscale mesh

Both services bind `0.0.0.0` by default so mesh peers can reach them.

```bash
# Terminal 1 — backend (serves /api/... and /health on :8000)
./scripts/run-backend.sh

# Terminal 2 — frontend dev server (:5173, proxies /api -> localhost:8000)
./scripts/run-frontend.sh
```

### Env vars

| Var             | Default        | Applies to | Purpose                                                        |
|-----------------|----------------|------------|----------------------------------------------------------------|
| `HOST`          | `0.0.0.0`      | both       | Bind address (use a Headscale IP to pin to the mesh iface).    |
| `PORT`          | `8000`/`5173`  | both       | Listen port (backend / frontend defaults).                     |
| `DEV`           | unset          | backend    | `DEV=1` enables uvicorn `--reload`.                            |
| `MODE`          | `dev`          | frontend   | `MODE=preview` → `npm run build` then serve the prod bundle.   |
| `GEOTECH_DB`    | `backend/data/geotech.db` | backend | SQLite DB path.                                     |
| `GEOTECH_TILES` | repo data path | backend    | Tiles directory to serve.                                      |
| `VITE_API_BASE` | (proxy)        | frontend   | Backend base URL for a **built/preview** app not on same origin. |

Tile serving requires `GEOTECH_TILES` (and `GEOTECH_DB`) to point at a valid local `data/`.

## How a teammate reaches it

Open the frontend at:

```
http://<your-headscale-ip>:5173
```

The dev server proxies `/api` to the backend on `localhost:8000`, so same-host runs work out of the box.

For a **built/preview** deploy where the frontend and backend are not same-origin, set `VITE_API_BASE` to the backend's mesh URL before building:

```bash
VITE_API_BASE=http://<backend-headscale-ip>:8000 MODE=preview ./scripts/run-frontend.sh
```

## First run — load example data

Once both services are up, import the example annotations via either:

- The app's **"Import example CVAT"** action in the UI, or
- `POST /api/import/cvat` directly:

  ```bash
  curl -X POST http://<backend-headscale-ip>:8000/api/import/cvat
  ```

## Quick verify

```bash
# Backend tests
cd backend && ./venv/bin/pytest

# Frontend production build
cd frontend && npm run build
```
