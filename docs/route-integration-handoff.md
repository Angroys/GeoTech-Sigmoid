# Next-session prompt: routing integration after frontend merge

Continue in `/home/calin/Projects/Hackathon/GeoTech-Sigmoid` on branch
`feat/route-algorithm`.

Integrate and verify route calculation against the latest merged frontend,
preserving its Feature-Sliced Design (FSD) structure. First read `plan.md`,
especially sections 7, 9 and 12, and use the existing `graphify-out/graph.json`
and `graphify-out/GRAPH_REPORT.md` to locate the original routing requirements
and their source documents. Inspect the current code before editing: an initial
routing service and frontend connection already exist. Improve and complete
that integration rather than replacing it with a second implementation.

Keep the interface's new layout, public module exports, waste loupe, role flows,
and uploaded-survey behavior intact. Check the calculation action, custom start,
mode changes, loading/errors, cancellation/stale results, route map, ordered
stops, progress, and GeoJSON downloads for both owner and inspector roles.

The user's latest concern is that the route appears outside vineyard boundaries.
Distinguish vineyard block outlines, the study-area boundary, supplied passages,
forbidden areas, and inferred demo headlands. Make the actual walking constraints
and route violations inspectable on the map, rather than treating all block
boundary crossings as invalid or relying solely on a text warning.

Check the implementation against `plan.md`: EPSG:32635 calculations, the supplied
start, one closed route, approach within 2 m, unreachable-target reporting, and
validation of the entire final polyline. Keep demo inference clearly separate
from supplied-only routing. Never present inferred headlands as validated
passages or demo coverage as hidden-reference coverage. Do not change the
challenge's validity thresholds to make the demo pass. Identify missing data and
remaining plan requirements honestly; do not attempt the unrelated segmentation
or training work in this session.

Run meaningful backend/frontend checks and a browser test of the merged UI.
Fix integration regressions and report what works, what remains data-blocked,
and how to run it. Work on this branch; preserve user edits. Do not push or merge
into `main` unless asked.

## Git state prepared for this session

The requested merges are already complete, in this order:

- `5b71c1f`: existing route implementation saved in a commit.
- `9965c58`: merged `origin/feat/frontend` at **`791303a`** (`ref: FSD`).
- `85e2660`: merged `origin/docs/challenge-plan` at **`fbebecd`**.
- The only textual merge conflict was `.gitignore`; both sets of ignore rules
  were preserved. No remote push was performed.

The handoff itself is committed after those merges. Check `git status` and the
current log before making changes. Do not redo the merges or overwrite the
frontend with its older version.

## Where the implementation lives

- `route-algo/README.md`: setup, API contract, algorithm and limitations.
- `route-algo/route_algo/api.py`: FastAPI `/plan`, `/health`, `/docs`; loads local
  organizer constraints for `constraint_set: siret3`.
- `route-algo/route_algo/models.py`: projected GeoJSON input model.
- `route-algo/route_algo/geometry.py`: permitted-area construction, constrained
  triangulation, triangle/portal graph and geometry-checked path shortening.
- `route-algo/route_algo/planner.py`: NetworkX shortest paths, OR-Tools closed tour,
  2 m approach/coverage checks, stop order, route and diagnostics.
- `route-algo/route_algo/demo.py`: **explicit demo-only** inferred headlands.
- `vineyard-front/src/index.ts`: same-origin `/api/routes/plan` proxy to Python.
- `vineyard-front/src/entities/survey/api/plan-route.ts`: projection, API response,
  route/reachability updates and projected export metadata.
- `vineyard-front/src/features/calculate-route/model/use-route-calculation.ts`:
  calculation state, mode/start invalidation, cancellation and download.
- `vineyard-front/src/pages/vineyard-workspace/`: integration into page/panel/map.
- `vineyard-front/src/widgets/vineyard-map/`: map layers and new frontend loupe.
- `vineyard-front/src/widgets/route-panel/`: ordered stops and summary.

The new frontend narrows several public `index.ts` exports and relocates
`WorkspaceHeader` into the workspace page. Preserve these FSD choices. The merge
currently compiles; avoid gratuitous restructuring.

## Known geometry facts and limitations

- Frontend `public/data/siret3/` canopy, row, inter-row and target files are
  **generated demo annotations**, not reviewed challenge outputs.
- The exact organizer start `[629504.7, 5220250.75]` replaced the old approximate
  demo start, which was about 0.33 m outside a supplied passage.
- In supplied-only mode, just **3 of 102 aisles** touch the passage network
  reachable from the official start. **0 of 33 inspection/waste targets** are
  reachable within 2 m. The gaps to other aisles reach about 7.1 m.
- A no-target/no-reachable-target result is `route: null` with diagnostics. The
  UI has no route download, fictitious 0 m itinerary, or 0/0 progress in this case.
- The built-in generated Sireț3 demo defaults to `demo_headlands` in the UI;
  the API and uploaded surveys default to `supplied`. The user can select
  **Supplied passages only**. Reconsider presentation as needed, while keeping
  inference explicit and preserving supplied-only behavior.
- Demo headlands are ground between each block boundary and the convex hull of
  row axes, with a 25 cm overlap at aisle ends. Canopies, forbidden areas and
  barriers are still subtracted and the study boundary is enforced.
- Inspector demo: about **2.79 km**, **32/33 targets**, around **752 m** outside
  supplied walking areas on inferred paths; about 27 s in the browser run.
- Owner demo targets waste only: about **1.48 km**, **8/9 waste targets**. A
  regenerated owner route measured **370 m outside block outlines**, but **0 m
  outside blocks union supplied passages**, **0 m outside the study area**, and
  **0 m inside forbidden zones**. Nonetheless, **403 m / 27.3%** was outside the
  supplied walking areas, using inferred headlands inside blocks.
- Therefore the demo is **not a valid supplied-only challenge submission**.
  `plan.md` records zero routing score above 2% outside passable areas and an
  efficiency threshold of 90% hidden-reference coverage. Demo detections are not
  those hidden references. Solver lengths can vary with its time budget.
- Exports preserve `path_mode`, `outside_supplied_length_m`, and EPSG:32635 CRS.
  Demo downloads use `demo_route.geojson` / `demo_route_waste.geojson`.
- Existing map layers do **not yet show** supplied passages, forbidden/study
  boundaries or inferred headland areas. That is the key visual explanation gap.
- Full inspection sweep mode and optimisation over multiple approach choices
  remain unimplemented. The initial solver is heuristic, with one nearest
  reachable approach per target, 200-target and 100,000-triangle limits.
- Uploaded-survey forms do not yet accept passage/forbidden files; the API does.

## Reading the plan and graph correctly

The docs branch supplies `plan.md` and the existing graph (68 nodes, 84 edges).
The graph indexes challenge assets/documentation, **not the newly merged frontend
or routing code**. Use it to find source evidence, then read the relevant PDFs
and code directly; do not infer that it describes current implementation.

Useful graph concepts include:

- `Closed Walking Route over Passable Areas`
- `Route Start, Passages, Forbidden Zones, and Study Area`
- `Route Constraint Preview`
- `Objective Metrics and Engineering Assessment`
- `Challenge Submission Artifacts`

Use the graphify skill's existing-graph query workflow. Its tracked interpreter
and root sidecars can be machine-specific. Query tools may modify cache stamps;
keep those incidental changes out of implementation commits.

## Run and validate

From the repository root:

```bash
uv sync --project route-algo --locked
uv run --project route-algo uvicorn route_algo.api:app --host 127.0.0.1 --port 8001
```

In another terminal:

```bash
cd vineyard-front
bun install --frozen-lockfile
bun dev
```

`ROUTE_API_URL` configures the Bun proxy, default `http://127.0.0.1:8001`.
`ROUTE_CONSTRAINTS_DIR` can point to the local organizer `02_route/` directory.
The supplied assets remain ignored by Git and are present in this workspace.

On this machine Bun was installed temporarily at
`/tmp/geotech-bun/node_modules/.bin/bun`; use that executable if `bun` is not on
PATH. Do not assume temporary files or running services survive a new session.
Check existing processes/listeners before starting duplicate servers. The prior
session left the frontend on port 3000 and a reloading Python server on 8001.

Post-merge checks already passed:

```bash
uv run --project route-algo pytest route-algo/tests -q  # 17 passed
cd vineyard-front
bun test                                             # 4 passed
bun x tsc --noEmit                                    # passed
bun run build                                        # passed
```

There is one dependency deprecation warning from Starlette's test client.
Browser end-to-end checks passed **before** the new FSD merge; repeat them for
the merged frontend. Browser tooling was installed in `/tmp/geotech-browser/`
(Playwright), with Chrome at `/usr/bin/google-chrome`. Existing temporary smoke
scripts/screenshots may help, but are not committed fixtures. Use the UI's demo
sign-in, then `/inspector/siret3` or `/owner/siret3`, and the Route tab. Verify both
path modes, custom/invalid starts, no stale results, map/stops, and exported CRS
and demo metadata. Allow up to 90 seconds for a full demo calculation in tests.
