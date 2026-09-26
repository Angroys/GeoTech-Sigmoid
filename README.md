# GeoTech-Sigmoid

Hackathon project.

## Workflow

- Work happens in branches — no direct commits to `main`.
- Branch naming: `feat/<slug>`, `fix/<slug>`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:` …).
- Changes land via pull request into `main`.

## Running the app

See [RUN.md](RUN.md) for the full operator guide. In short:

```bash
./scripts/run-backend.sh    # FastAPI on :8000  (/api, /health)
./scripts/run-frontend.sh   # Vite dev server on :5173 (proxies /api)
```

Both scripts bind `0.0.0.0` by default so Headscale mesh peers can reach them, and
they auto-create the backend venv / run `npm install` on first use. Teammates open
`http://<your-headscale-ip>:5173`. Note: `data/` (tiles + DB) is gitignored and must
be present locally.
