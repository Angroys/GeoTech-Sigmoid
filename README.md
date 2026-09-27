# GeoTech-Sigmoid

Hackathon project.

The routing service lives in [`route-algo`](route-algo/README.md) and connects to
the frontend's Route tab. See its README for setup, inputs, validation, and the
current demo's disconnected walking areas.

## Run everything

```bash
scripts/start-all.sh            # Ctrl+C stops both services
```

The script installs `uv` and `bun` if they are missing, runs `uv sync` for
`route-algo`, and runs `bun install` in `vineyard-front` (on the first run, or
when `bun.lock` changes). It then starts one backend,
`uvicorn route_algo.api:app` on `127.0.0.1:8001`, which serves `POST /plan` and
the `/api/surveys` processing API. Once `/health` responds, it starts `bun dev`
on `localhost:3000`, with `PROCESSING_API_URL` and `ROUTE_API_URL` both pointing
at that backend. Output from the two services is prefixed with `[api]` and
`[web]`. The script prints the frontend, backend and `/docs` URLs.

| Flag | Effect |
|---|---|
| `--no-install` | Skip tool and dependency installation |
| `--fallback` | Set `PROCESSING_FORCE_FALLBACK=1`, which serves precomputed labels instead of running the model |
| `--help` | Show usage |

| Variable | Default |
|---|---|
| `BACKEND_PORT` / `FRONTEND_PORT` | `8001` / `3000` |
| `DATA_DIR` | `./data`, else the main checkout's `data/` (for worktrees) |
| `SAM3_FT_WEIGHTS` | `$DATA_DIR/tested-on-vm/sam3_ft/run3c/best.pth` |
| `SAM3_FALLBACK_LABELS_DIR` | `$DATA_DIR/tested-on-vm/sam3_ft/run3c/labels` |
| `PROCESSING_DATA_DIR` | `route-algo/.processing-data` (ignored by Git) |
| `ROUTE_CONSTRAINTS_DIR` | `assets_for_participants-*/…/02_route`, else `$DATA_DIR/marcaj-data/assets_for_participants/02_route` |

The script exports a default path only if that path exists. Otherwise it prints
a warning. Data and weights are never committed.

## Workflow

- Work happens in branches — no direct commits to `main`.
- Branch naming: `feat/<slug>`, `fix/<slug>`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:` …).
- Changes land via pull request into `main`.
