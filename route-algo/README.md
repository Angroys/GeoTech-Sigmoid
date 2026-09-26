# Vineyard routing module

Python service and offline planner for closed walking tours. Geometry uses
**EPSG:32635 metres**; the frontend converts longitude/latitude for display.

From the repository root, start the service:

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

Open a vineyard, select **Route**, and select **Calculate route**. A custom start
must lie within permitted walking geometry. The map, walking order, cumulative
stop distances and unreachable-target notices update from the response. Download
exports the projected route. Calculated routes remain in memory until navigation
or reload; the start preference is stored by the existing frontend.

The built-in Sireț3 **generated demo survey** defaults to **Demo paths — inferred
access at row ends**. This mode derives headland areas from each block boundary
and the extent of its row axes, connecting the generated aisles to the supplied
passages. It still excludes canopies, forbidden areas and barriers. Its route is
explicitly a demo: exports are named `demo_route.geojson` (or
`demo_route_waste.geojson`), carry `path_mode: demo_headlands`, and record
`outside_supplied_length_m`. The UI also reports that distance. These inferred
paths are not validated challenge annotations.

Select **Supplied passages only** to disable inference. The API defaults to
supplied-only mode; inference must be requested explicitly. Uploaded surveys use
supplied-only mode in the UI.

The Bun server proxies `/api/routes/plan` to `http://127.0.0.1:8001/plan`. Set
`ROUTE_API_URL` on the Bun process to change it. Static frontend deployments need
an equivalent proxy; the generated `dist/` directory alone cannot run the API.
The service is intended for local development; deployment authentication and
job scheduling are outside this initial module.

## Inputs

`POST /plan` accepts the following JSON. All geometries must be valid, finite,
two-dimensional GeoJSON in the declared CRS; a FeatureCollection's optional CRS
member must agree. `/docs` provides the complete request schema.

| Field | Meaning |
|---|---|
| `crs` | Required literal `EPSG:32635` |
| `start` | Required `[easting, northing]`; preserved exactly |
| `interrows` | Required Polygon/MultiPolygon FeatureCollection |
| `path_mode` | `supplied` (default) or explicit `demo_headlands` |
| `blocks`, `rows` | Required for demo inference: Polygon blocks and LineString row axes, grouped by `vineyard_id` |
| `canopy`, `forbidden`, `barriers` | Polygon/MultiPolygon exclusions; default empty |
| `passages` | Authorised Polygon/MultiPolygon walking areas; default empty |
| `study_area` | Optional polygonal processing boundary |
| `inspection_points` | Points with unique `point_id` properties |
| `waste` | Points or polygons with unique `waste_id`; polygon centroids are targets |
| `purpose` | `inspection` visits inspection and waste targets; `waste_collection` visits waste only |
| `constraint_set` | Optional `siret3` loads organizer passages, forbidden zones and study area |
| `clearance_m` | Optional inward clearance, default 0 (point walker), range 0–2 m |
| `solver_seconds` | OR-Tools search limit, default 2, range 1–10 seconds |

Sireț3 constraints are read from the supplied `assets_for_participants-*/…/02_route`
directory at the exact default path in `route_algo/api.py`. Set
`ROUTE_CONSTRAINTS_DIR` to another directory containing `passages.geojson`,
`forbidden.geojson`, and `study_area.geojson`. Missing constraints return HTTP 503;
they are never silently omitted. Organizer assets are local and ignored by Git.
Retain the supplied OpenStreetMap attribution and ODbL notices when using or
distributing those data.

Uploaded vineyards currently send inter-rows, canopies and targets from the
browser. Their upload form does not yet accept passage/forbidden files. Call the
API or offline planner with those additional constraints when needed. The supplied-only
planner does not infer headlands or connections through unlabelled ground.

## Algorithm and outputs

1. Union inter-rows with passages; subtract canopies, forbidden zones and barriers;
   intersect the study area and apply requested clearance. In explicit demo mode,
   also add ground between block boundaries and the convex hull of row axes,
   with a 25 cm overlap at aisle endpoints, before subtracting exclusions.
2. Keep the polygonal walking region containing the start. Disconnected islands
   and connections consisting solely of a zero-width touch are not corridors.
3. Build a constrained triangle/portal graph, preserving polygon boundaries and
   holes without choosing a raster resolution.
4. Choose one nearest reachable approach per target, accepting distances at most
   2 m. Ignore any pre-existing demo `reachable` flags and recompute accessibility.
5. Use NetworkX shortest-path distances and OR-Tools to order a closed tour;
   retain a nearest-neighbour baseline and use it if its expanded route is shorter.
6. Expand graph paths and shorten only through fully permitted line segments.
   Check the entire final polyline and each target's first entry into a 2 m disk.

The response contains `route` (one-feature GeoJSON FeatureCollection with a closed
LineString, or `null` when there are no reachable targets) and `report` (coverage, approaches, unreachable reasons, closure,
length outside permitted areas, timing and warnings). Lengths and cumulative stop
distances are computed from the final route. Validation allows only a 1e-6 m
aggregate floating-point residual outside the geometry. Targets are counted only
against the inputs, never the hidden challenge references.
In demo mode, `outside_length_m` measures departures from the augmented walking
areas; `outside_supplied_length_m` and `outside_supplied_ratio` separately measure
departures from the supplied inter-rows/passages, counting repeated traversals.

This is a heuristic, not an optimality guarantee. One fixed approach per target
and triangle graph paths can be longer than a continuous coverage-optimal tour.
The initial limits are 200 targets and 100,000 triangles in the start region. The
search limit applies to OR-Tools, not geometry processing. Full inspection sweep
mode and alternative approach optimisation remain future work. A request with
no reachable targets returns `route: null` and an explicit warning. The frontend
shows no route or download. The CLI writes the report, removes any stale route
file in the output directory, and exits with code 2.

## Current demo data

The checked-in canopy/inter-row/target files are generated demo annotations.
Only **3 of 102 aisles** touch the passage network reachable from the official
start in supplied-only mode. The target aisles remain disconnected: **0/33 targets are reachable** there.
Gaps between aisles and supplied passages reach approximately 7.1 m.
The frontend start has been corrected to the organizer's exact coordinate, and
the old unvalidated precomputed demo routes are no longer loaded automatically.

Demo-headland mode produces an approximately **2.8 km closed route covering 32/33
targets** from the official start. The browser integration run took about 27 s;
approximately 752 m of that route used inferred access outside supplied walking
areas. Solver results can vary with the time budget. This demonstrates the
algorithm and interface; it is not a valid supplied-only challenge route.

For an end-to-end partial-route check in **supplied-only mode**, use custom UTM start
`629572.7603686221, 5220217.758529621`: it is inside a demo aisle and produces an
approximately 15.7 m closed route visiting one target. This illustrates the
connection and geometry constraints; it is not the official-start submission.
Reviewed, connected inter-row/passage geometry is needed for a useful submission.

## Offline use and checks

Save a JSON request matching the API contract, then run:

```bash
uv run --project route-algo python -m route_algo request.json --output /tmp/route-output
uv run --project route-algo pytest route-algo/tests -q
cd vineyard-front
bun test
bun x tsc --noEmit
bun run build
```

Offline output is `route.geojson` (or `demo_route.geojson` in demo mode) plus
`report.json`.
